//! Subscription access stays in the official CLIs. Redraw never reads tokens.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{watch, Mutex},
    time::timeout,
};

const RPC_TIMEOUT: Duration = Duration::from_secs(30);
const RESPONSE_LIMIT: usize = 1_000_000;
const FRAME_LIMIT: u64 = 4_000_000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Provider {
    Chatgpt,
    Grok,
}
impl Provider {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "chatgpt" => Ok(Self::Chatgpt),
            "grok" => Ok(Self::Grok),
            _ => Err("Choose ChatGPT or Grok.".into()),
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Chatgpt {
            "chatgpt"
        } else {
            "grok"
        }
    }
}

struct Cancellation(watch::Sender<bool>);
impl Default for Cancellation {
    fn default() -> Self {
        Self(watch::channel(false).0)
    }
}
impl Cancellation {
    fn cancel(&self) {
        self.0.send_replace(true);
    }
    async fn wait(&self) {
        let mut receiver = self.0.subscribe();
        let _ = receiver.wait_for(|cancelled| *cancelled).await;
    }
}

#[derive(Default)]
pub struct SubscriptionState {
    // Only the sign-in server is persistent; each generation has its own cancellable process.
    codex_auth: Mutex<Option<Rpc>>,
    grok_login: Mutex<Option<tokio::task::JoinHandle<()>>>,
    requests: StdMutex<HashMap<String, (Provider, Arc<Cancellation>)>>,
}

struct ActiveRequest<'a> {
    state: &'a SubscriptionState,
    id: String,
}
impl Drop for ActiveRequest<'_> {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.state.requests.lock() {
            requests.remove(&self.id);
        }
    }
}

fn provider_paths(
    app: &tauri::AppHandle,
    provider: Provider,
) -> Result<(PathBuf, PathBuf), String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("subscriptions")
        .join(provider.name());
    let cwd = root.join("canvas");
    let home = root.join("account");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    if provider == Provider::Grok {
        // This home belongs exclusively to Redraw. Never overwrite user CLI settings.
        let config = home.join("config.toml");
        if !config.exists() {
            std::fs::write(config, "[cli]\nauto_update = false\n").map_err(|e| e.to_string())?;
        }
    }
    Ok((cwd, home))
}

fn executable(provider: Provider) -> Option<PathBuf> {
    let base = if provider == Provider::Chatgpt {
        "codex"
    } else {
        "grok"
    };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        dirs.push(PathBuf::from(&home).join(".grok/bin"));
        dirs.push(PathBuf::from(home).join("AppData/Roaming/npm"));
    }
    for dir in dirs {
        let candidate = dir.join(if cfg!(windows) {
            format!("{base}.exe")
        } else {
            base.to_string()
        });
        if candidate.is_file() {
            return Some(candidate);
        }
        // npm's .cmd is a shell program. Resolve its known native package layout instead.
        #[cfg(windows)]
        if provider == Provider::Chatgpt {
            let (package, triple) = if cfg!(target_arch = "aarch64") {
                ("codex-win32-arm64", "aarch64-pc-windows-msvc")
            } else {
                ("codex-win32-x64", "x86_64-pc-windows-msvc")
            };
            for relative in [format!("node_modules/@openai/codex/node_modules/@openai/{package}/vendor/{triple}/bin/codex.exe"), format!("node_modules/@openai/{package}/vendor/{triple}/bin/codex.exe"), format!("node_modules/@openai/codex/vendor/{triple}/codex/codex.exe")] {
                let native = dir.join(relative);
                if native.is_file() { return Some(native); }
            }
        }
    }
    None
}

fn command(provider: Provider, cwd: &Path, home: &Path) -> Result<Command, String> {
    let path = executable(provider).ok_or_else(|| {
        format!(
            "Install the official {} CLI, then restart Redraw.",
            if provider == Provider::Chatgpt {
                "Codex"
            } else {
                "Grok"
            }
        )
    })?;
    let mut cmd = Command::new(path);
    cmd.current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    // Subscription mode must never fall back to an inherited API key or endpoint.
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy().to_uppercase();
        if ["CODEX", "OPENAI", "GROK", "XAI", "ANTHROPIC"]
            .iter()
            .any(|prefix| name.starts_with(prefix))
        {
            cmd.env_remove(key);
        }
    }
    cmd.env(
        if provider == Provider::Chatgpt {
            "CODEX_HOME"
        } else {
            "GROK_HOME"
        },
        home,
    );
    Ok(cmd)
}

struct Rpc {
    _child: Child,
    #[cfg(windows)]
    _job: ProcessJob,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next_id: u64,
    init: Value,
}

// Closing the job kills descendants too (CLI launchers may create helper processes).
#[cfg(windows)]
struct ProcessJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
// An owned Windows kernel handle may be moved between threads; it is closed once.
unsafe impl Send for ProcessJob {}
#[cfg(windows)]
impl ProcessJob {
    fn attach(child: &Child) -> Result<Self, String> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err("Could not isolate the AI process.".into());
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(
                    handle,
                    child.raw_handle().ok_or("AI process handle unavailable")? as _,
                ) == 0
            {
                return Err("Could not isolate the AI process for cancellation.".into());
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

impl Rpc {
    async fn start(provider: Provider, cwd: &Path, home: &Path) -> Result<Self, String> {
        let mut cmd = command(provider, cwd, home)?;
        if provider == Provider::Chatgpt {
            cmd.args([
                "app-server",
                "--listen",
                "stdio://",
                "-c",
                "forced_login_method=\"chatgpt\"",
                "-c",
                "model_provider=\"openai\"",
                "-c",
                "web_search=\"disabled\"",
            ]);
            for feature in [
                "shell_tool",
                "unified_exec",
                "apps",
                "plugins",
                "hooks",
                "browser_use",
                "computer_use",
                "code_mode",
                "code_mode_host",
                "multi_agent",
                "view_image",
                "image_generation",
                "skill_search",
                "workspace_dependencies",
                "memories",
                "sleep_tool",
            ] {
                cmd.args(["-c", &format!("features.{feature}=false")]);
            }
        } else {
            cmd.args([
                "--deny",
                "*",
                "--tools",
                "",
                "--no-subagents",
                "--disable-web-search",
                "--permission-mode",
                "dontAsk",
                "agent",
                "--no-leader",
                "stdio",
            ]);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start the official CLI: {e}"))?;
        #[cfg(windows)]
        let job = ProcessJob::attach(&child)?;
        let input = child.stdin.take().ok_or("CLI input unavailable")?;
        let output = BufReader::new(child.stdout.take().ok_or("CLI output unavailable")?);
        let mut rpc = Self {
            _child: child,
            #[cfg(windows)]
            _job: job,
            input,
            output,
            next_id: 1,
            init: Value::Null,
        };
        let params = if provider == Provider::Chatgpt {
            json!({"clientInfo":{"name":"redraw","title":"Redraw","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":false}})
        } else {
            json!({"protocolVersion":1,"clientInfo":{"name":"redraw","version":env!("CARGO_PKG_VERSION")},"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}})
        };
        rpc.init = rpc.call("initialize", params).await?;
        if provider == Provider::Chatgpt {
            rpc.send(json!({"method":"initialized","params":{}}))
                .await?;
        }
        Ok(rpc)
    }

    async fn send(&mut self, message: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        self.input
            .write_all(&bytes)
            .await
            .map_err(|_| "The AI connection closed.".to_string())?;
        self.input.flush().await.map_err(|e| e.to_string())
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<u64, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .await?;
        Ok(id)
    }

    async fn next(&mut self) -> Result<Value, String> {
        loop {
            let mut bytes = Vec::new();
            let n = (&mut self.output)
                .take(FRAME_LIMIT + 1)
                .read_until(b'\n', &mut bytes)
                .await
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("The AI connection closed. Reconnect and try again.".into());
            }
            if n as u64 > FRAME_LIMIT {
                return Err("The AI response exceeded the message limit.".into());
            }
            // Some CLI releases write harmless startup diagnostics on stdout.
            let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            if value.get("method").is_some() && value.get("id").is_some() {
                self.send(deny_request(&value)).await?;
                continue;
            }
            return Ok(value);
        }
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        timeout(RPC_TIMEOUT, async {
            let id = self.request(method, params).await?;
            loop {
                let message = self.next().await?;
                if message["id"] == id {
                    return response(&message);
                }
            }
        })
        .await
        .map_err(|_| format!("{method} timed out. Check the CLI connection and try again."))?
    }
}

fn response(message: &Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        Err(error["message"]
            .as_str()
            .unwrap_or("The AI provider rejected this request.")
            .chars()
            .take(500)
            .collect())
    } else {
        Ok(message.get("result").cloned().unwrap_or(json!({})))
    }
}

fn deny_request(message: &Value) -> Value {
    let method = message["method"].as_str().unwrap_or("");
    if method == "session/request_permission" {
        json!({"jsonrpc":"2.0","id":message["id"],"result":{"outcome":{"outcome":"cancelled"}}})
    } else if method.ends_with("/requestApproval") {
        json!({"id":message["id"],"result":{"decision":"decline"}})
    } else {
        json!({"jsonrpc":"2.0","id":message["id"],"error":{"code":-32601,"message":"Redraw does not permit tools, filesystem access, or terminal execution."}})
    }
}

fn text_delta(message: &Value) -> Option<&str> {
    match message["method"].as_str()? {
        "item/agentMessage/delta" => message["params"]["delta"].as_str(),
        "session/update"
            if message["params"]["update"]["sessionUpdate"] == "agent_message_chunk" =>
        {
            message["params"]["update"]["content"]["text"].as_str()
        }
        _ => None,
    }
}

fn grok_auth_mode(init: &Value) -> Option<&'static str> {
    let methods = init["authMethods"].as_array()?;
    if methods.iter().any(|m| m["id"] == "cached_token") {
        return Some("cached_token");
    }
    // Current Grok Build reports its cached OAuth method in initialize. It restores
    // that session in session/new, without an authenticate call or a browser prompt.
    if methods.iter().any(|m| m["id"] == "grok.com")
        && init["_meta"]["defaultAuthMethodId"] == "grok.com"
    {
        return Some("grok.com");
    }
    None
}

async fn grok_auth(rpc: &mut Rpc) -> Result<(), String> {
    match grok_auth_mode(&rpc.init) {
        Some("cached_token") => {
            rpc.call(
                "authenticate",
                json!({"methodId":"cached_token","_meta":{"headless":true}}),
            )
            .await?;
            Ok(())
        }
        Some("grok.com") => Ok(()),
        _ => Err("Sign in with your Grok subscription first, then refresh the connection.".into()),
    }
}

#[tauri::command]
pub async fn subscription_status(app: tauri::AppHandle, provider: String) -> Result<Value, String> {
    let provider = Provider::parse(&provider)?;
    if executable(provider).is_none() {
        return Ok(
            json!({"available":false,"authenticated":false,"message":format!("Install the official {} CLI and restart Redraw.", if provider == Provider::Chatgpt {"Codex"} else {"Grok"})}),
        );
    }
    let (cwd, home) = provider_paths(&app, provider)?;
    let result: Result<Value, String> = async {
        let mut rpc = Rpc::start(provider, &cwd, &home).await?;
        if provider == Provider::Chatgpt {
            let account = rpc.call("account/read", json!({"refreshToken":false})).await?;
            let authenticated = account["account"]["type"] == "chatgpt";
            let mut models = Vec::new();
            let mut usage = None;
            if authenticated {
                if let Ok(result) = rpc.call("model/list", json!({"limit":50,"includeHidden":false})).await {
                    if let Some(items) = result["data"].as_array() { models = items.iter().map(|m| json!({"id":m["model"],"name":m["displayName"]})).collect(); }
                }
                if let Ok(result) = rpc.call("account/rateLimits/read", json!({})).await {
                    if let Some(used) = result["rateLimits"]["primary"]["usedPercent"].as_f64() { usage = Some(format!("{:.0}% remaining in the current usage window", (100.0-used).clamp(0.0,100.0))); }
                }
            }
            Ok(json!({"available":true,"authenticated":authenticated,"message":if authenticated {"Connected through your ChatGPT subscription."} else {"Sign in to ChatGPT to connect Redraw."},"models":models,"usage":usage}))
        } else {
            let models: Vec<Value> = rpc.init["_meta"]["modelState"]["availableModels"].as_array().map(|items| items.iter().map(|m|json!({"id":m["modelId"],"name":m["name"]})).collect()).unwrap_or_default();
            let authenticated = if grok_auth(&mut rpc).await.is_ok() {
                // Session setup checks cached authentication, but does not run inference.
                rpc.call("session/new",json!({"cwd":cwd,"mcpServers":[]})).await.is_ok()
            } else { false };
            Ok(json!({"available":true,"authenticated":authenticated,"models":models,"message":if authenticated {"Connected through your Grok subscription."} else {"Sign in to Grok to connect Redraw."}}))
        }
    }.await;
    match result {
        Ok(value) => Ok(value),
        Err(message) => Ok(json!({"available":true,"authenticated":false,"message":message})),
    }
}

fn open_auth_url(url: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "Invalid sign-in URL")?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("auth.openai.com" | "chatgpt.com" | "auth.chatgpt.com")
        )
    {
        return Err("Unexpected sign-in URL from Codex.".into());
    }
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("rundll32.exe");
        c.args(["url.dll,FileProtocolHandler", url]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn subscription_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, SubscriptionState>,
    provider: String,
) -> Result<Value, String> {
    let provider = Provider::parse(&provider)?;
    let (cwd, home) = provider_paths(&app, provider)?;
    if provider == Provider::Chatgpt {
        let mut auth = state.codex_auth.lock().await;
        // Dropping a prior server also cancels its outstanding OAuth callback.
        *auth = Some(Rpc::start(provider, &cwd, &home).await?);
        let result = auth
            .as_mut()
            .unwrap()
            .call("account/login/start", json!({"type":"chatgpt"}))
            .await?;
        let url = result["authUrl"]
            .as_str()
            .ok_or("Codex did not provide a sign-in link.")?;
        let opened = open_auth_url(url).is_ok();
        Ok(
            json!({"url":url,"message":if opened {"Complete ChatGPT sign-in in your browser, then refresh connection status."} else {"Open the sign-in link, then refresh connection status."}}),
        )
    } else {
        let mut login = state.grok_login.lock().await;
        if let Some(task) = login.take() {
            task.abort();
            let _ = task.await;
        }
        let mut cmd = command(provider, &cwd, &home)?;
        cmd.args(["login", "--oauth"])
            .stdin(Stdio::null())
            .stdout(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let handle = app.clone();
        *login = Some(tokio::spawn(async move {
            let success = matches!(timeout(Duration::from_secs(300), child.wait()).await, Ok(Ok(status)) if status.success());
            let _ = handle.emit(
                "subscription-login",
                json!({"provider":"grok","success":success}),
            );
        }));
        Ok(
            json!({"message":"Complete the official Grok sign-in in your browser, then refresh connection status."}),
        )
    }
}

#[tauri::command]
pub async fn subscription_logout(
    app: tauri::AppHandle,
    state: tauri::State<'_, SubscriptionState>,
    provider: String,
) -> Result<(), String> {
    let provider = Provider::parse(&provider)?;
    if let Ok(requests) = state.requests.lock() {
        for (p, cancel) in requests.values() {
            if *p == provider {
                cancel.cancel();
            }
        }
    }
    let (cwd, home) = provider_paths(&app, provider)?;
    if provider == Provider::Chatgpt {
        *state.codex_auth.lock().await = None;
        let mut rpc = Rpc::start(provider, &cwd, &home).await?;
        rpc.call("account/logout", json!({})).await?;
    } else {
        if let Some(task) = state.grok_login.lock().await.take() {
            task.abort();
            let _ = task.await;
        }
        let mut cmd = command(provider, &cwd, &home)?;
        let status = timeout(
            RPC_TIMEOUT,
            cmd.arg("logout").stdout(Stdio::null()).status(),
        )
        .await
        .map_err(|_| "Grok sign-out timed out")?
        .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Grok sign-out failed. Try again.".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn subscription_cancel(
    state: tauri::State<'_, SubscriptionState>,
    request_id: String,
) -> Result<(), String> {
    let requests = state
        .requests
        .lock()
        .map_err(|_| "Request state unavailable")?;
    if let Some((_, cancel)) = requests.get(&request_id) {
        cancel.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn subscription_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, SubscriptionState>,
    provider: String,
    request_id: String,
    prompt: String,
    image: Option<String>,
    system_prompt: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let provider = Provider::parse(&provider)?;
    if request_id.is_empty()
        || request_id.len() > 128
        || prompt.len() > 100_000
        || system_prompt.as_ref().is_some_and(|s| s.len() > 20_000)
    {
        return Err("The AI request is too large or invalid.".into());
    }
    if let Some(value) = &image {
        if value.len() > 20_000_000
            || ![
                "data:image/png;base64,",
                "data:image/jpeg;base64,",
                "data:image/webp;base64,",
            ]
            .iter()
            .any(|prefix| value.starts_with(prefix))
        {
            return Err("Use a PNG, JPEG, or WebP image under 15 MB.".into());
        }
    }
    if model
        .as_ref()
        .is_some_and(|s| s.len() > 200 || s.chars().any(char::is_control))
    {
        return Err("Invalid model name.".into());
    }
    let cancel = Arc::new(Cancellation::default());
    {
        let mut requests = state
            .requests
            .lock()
            .map_err(|_| "Request state unavailable")?;
        if requests.contains_key(&request_id) {
            return Err("This AI request is already running.".into());
        }
        if requests.len() >= 4 {
            return Err("Too many AI requests. Stop one before starting another.".into());
        }
        requests.insert(request_id.clone(), (provider, cancel.clone()));
    }
    let _active = ActiveRequest {
        state: &state,
        id: request_id.clone(),
    };
    let (cwd, home) = provider_paths(&app, provider)?;
    let generation = generate(
        &app,
        provider,
        &cwd,
        &home,
        &request_id,
        &prompt,
        image.as_deref(),
        system_prompt.as_deref(),
        model.filter(|s| !s.is_empty()),
    );
    tokio::select! {
        biased;
        _ = cancel.wait() => Err("AI request cancelled.".into()),
        result = timeout(Duration::from_secs(120), generation) => result.map_err(|_| "AI request timed out. Try a smaller selection or a faster model.".to_string())?,
    }
}

async fn generate(
    app: &tauri::AppHandle,
    provider: Provider,
    cwd: &Path,
    home: &Path,
    request_id: &str,
    prompt: &str,
    image: Option<&str>,
    system: Option<&str>,
    model: Option<String>,
) -> Result<String, String> {
    let mut rpc = Rpc::start(provider, cwd, home).await?;
    let completion_id;
    if provider == Provider::Chatgpt {
        let account = rpc
            .call("account/read", json!({"refreshToken":false}))
            .await?;
        if account["account"]["type"] != "chatgpt" {
            return Err("Sign in with your ChatGPT subscription first.".into());
        }
        let thread = rpc.call("thread/start",json!({"cwd":cwd,"model":model,"modelProvider":"openai","approvalPolicy":"never","sandbox":"read-only","ephemeral":true,"baseInstructions":"You answer questions on a whiteboard. Return only the requested answer. Do not use tools or access files.","developerInstructions":system.unwrap_or(""),"serviceName":"redraw"})).await?;
        let thread_id = thread["thread"]["id"]
            .as_str()
            .ok_or("Codex did not create a conversation.")?;
        let mut input = vec![json!({"type":"text","text":prompt})];
        if let Some(image) = image {
            input.push(json!({"type":"image","url":image}));
        }
        completion_id = rpc
            .request("turn/start", json!({"threadId":thread_id,"input":input}))
            .await?;
    } else {
        if image.is_some() && rpc.init["agentCapabilities"]["promptCapabilities"]["image"] != true {
            return Err("This Grok CLI does not support image input over ACP. Use ChatGPT for image questions.".into());
        }
        grok_auth(&mut rpc).await?;
        let session = rpc
            .call("session/new", json!({"cwd":cwd,"mcpServers":[]}))
            .await?;
        let session_id = session["sessionId"]
            .as_str()
            .ok_or("Grok did not create a conversation.")?;
        if let Some(model) = model {
            rpc.call(
                "session/set_model",
                json!({"sessionId":session_id,"modelId":model}),
            )
            .await?;
        }
        let mut input = vec![
            json!({"type":"text","text":format!("{}\n\n{}",system.unwrap_or("Answer only the whiteboard question. Do not use tools."),prompt)}),
        ];
        if let Some(image) = image {
            let (header, data) = image.split_once(',').ok_or("Invalid image")?;
            input.push(json!({"type":"image","mimeType":header.trim_start_matches("data:").trim_end_matches(";base64"),"data":data}));
        }
        completion_id = rpc
            .request(
                "session/prompt",
                json!({"sessionId":session_id,"prompt":input}),
            )
            .await?;
    }
    let mut text = String::new();
    loop {
        let message = timeout(Duration::from_secs(45), rpc.next())
            .await
            .map_err(|_| "AI stopped responding. Try again.")??;
        if let Some(delta) = text_delta(&message) {
            if text.len() + delta.len() > RESPONSE_LIMIT {
                return Err("The AI response exceeded the length limit.".into());
            }
            text.push_str(delta);
            let _ = app.emit(
                "subscription-delta",
                json!({"requestId":request_id,"text":text}),
            );
        }
        if message["id"] == completion_id {
            let result = response(&message)?;
            if provider == Provider::Grok {
                if result["stopReason"] == "cancelled" {
                    return Err("AI request cancelled.".into());
                }
                break;
            }
        }
        if provider == Provider::Chatgpt && message["method"] == "turn/completed" {
            let turn = &message["params"]["turn"];
            if turn["status"] != "completed" {
                return Err(turn["error"]["message"]
                    .as_str()
                    .unwrap_or("AI generation did not complete.")
                    .chars()
                    .take(500)
                    .collect());
            }
            break;
        }
    }
    if text.trim().is_empty() {
        return Err("The AI returned no answer. Try rephrasing the question.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn grok_uses_official_cached_oauth_across_protocol_versions() {
        assert_eq!(
            grok_auth_mode(&json!({"authMethods":[{"id":"cached_token"}]})),
            Some("cached_token")
        );
        assert_eq!(
            grok_auth_mode(
                &json!({"authMethods":[{"id":"grok.com"}],"_meta":{"defaultAuthMethodId":"grok.com"}})
            ),
            Some("grok.com")
        );
        assert_eq!(
            grok_auth_mode(
                &json!({"authMethods":[{"id":"grok.com"}],"_meta":{"defaultAuthMethodId":null}})
            ),
            None
        );
        assert_eq!(
            grok_auth_mode(
                &json!({"authMethods":[{"id":"xai.api_key"}],"_meta":{"defaultAuthMethodId":"xai.api_key"}})
            ),
            None
        );
    }

    #[tokio::test]
    async fn cancellation_before_wait_is_not_lost() {
        let cancel = Cancellation::default();
        cancel.cancel();
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), cancel.wait())
                .await
                .is_ok()
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn stopping_an_ai_process_terminates_its_windows_job() {
        // A local waiting process models an unresponsive CLI; no provider is contacted.
        let mut command = Command::new("cmd.exe");
        command
            .args(["/D", "/C", "ping -n 30 127.0.0.1 >nul"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .kill_on_drop(true);
        let mut child = command.spawn().unwrap();
        let job = ProcessJob::attach(&child).unwrap();
        let handle = child.raw_handle().unwrap();
        drop(job);
        let stopped = unsafe {
            windows_sys::Win32::System::Threading::WaitForSingleObject(handle as _, 2000)
        };
        assert_eq!(stopped, windows_sys::Win32::Foundation::WAIT_OBJECT_0);
        let _ = child.wait().await;
    }

    #[test]
    fn stream_ignores_reasoning_and_tool_output() {
        assert_eq!(
            text_delta(
                &json!({"method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"text":"private"}}}})
            ),
            None
        );
        assert_eq!(
            text_delta(&json!({"method":"item/agentMessage/delta","params":{"delta":"5"}})),
            Some("5")
        );
        assert_eq!(
            text_delta(
                &json!({"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"text":"New Delhi"}}}})
            ),
            Some("New Delhi")
        );
    }

    #[test]
    fn server_tool_requests_are_always_denied() {
        assert_eq!(
            deny_request(&json!({"id":2,"method":"session/request_permission"}))["result"]
                ["outcome"]["outcome"],
            "cancelled"
        );
        assert_eq!(
            deny_request(&json!({"id":3,"method":"item/commandExecution/requestApproval"}))
                ["result"]["decision"],
            "decline"
        );
        assert_eq!(
            deny_request(&json!({"id":4,"method":"fs/read_text_file"}))["error"]["code"],
            -32601
        );
    }
}
