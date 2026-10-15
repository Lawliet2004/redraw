import { useEffect, useState } from "react";
import {
  providerLabel,
  subscriptionStatus,
  subscriptionLogin,
  subscriptionLogout,
  type SubscriptionConfig,
  type SubscriptionProvider,
  type SubscriptionStatus,
} from "../subscriptions";
import { loadLlmConfig, saveLlmConfig } from "../credentials";
import {
  DEFAULT_LLM,
  GEMINI_DEFAULT_MODEL,
  GEMINI_OPENAI_BASE,
  listModels,
  testConnection,
  validateLlmConfig,
  type LlmConfig,
} from "../llm";
import { isMobileOS } from "../platform";
import Dialog from "./Dialog";
import { IconGear, IconSparkle } from "./icons";

const API_PRESETS = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    id: "xai",
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-3-mini",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: GEMINI_OPENAI_BASE,
    model: GEMINI_DEFAULT_MODEL,
  },
  { id: "custom", label: "Custom", baseUrl: "", model: "" },
] as const;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
export default function AiBar({
  onAsk,
  onSettings,
}: {
  busy: boolean;
  theme: "light" | "dark";
  onAsk: () => void;
  onStop: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="ai-bar workspace-surface">
      <button
        className="primary"
        aria-label="✦ AI assistant"
        title="AI assistant (Ctrl+Enter)"
        onClick={onAsk}
      >
        <IconSparkle />
        <span>AI assistant</span>
      </button>
      <button
        className="icon-button"
        title="Settings"
        aria-label="Settings"
        onClick={onSettings}
      >
        <IconGear />
      </button>
    </div>
  );
}

export function AiSettingsDialog({
  config,
  onSave,
  onClose,
}: {
  config: SubscriptionConfig;
  theme: "light" | "dark";
  onSave: (c: SubscriptionConfig) => Promise<void>;
  onClose: () => void;
}) {
  const mobile = isMobileOS();
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadLlmConfig()
      .then((c) => {
        if (!active) return;
        const fresh = mobile && !c.apiKey && c.baseUrl === DEFAULT_LLM.baseUrl;
        setLlm(
          fresh
            ? {
                ...c,
                baseUrl: API_PRESETS[0].baseUrl,
                model:
                  c.model === DEFAULT_LLM.model
                    ? API_PRESETS[0].model
                    : c.model,
              }
            : c,
        );
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [mobile]);
  useEffect(() => {
    const provider = draft.provider;
    if (provider === "api") return;
    let active = true;
    setStatus(null);
    setError("");
    subscriptionStatus(provider)
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [draft.provider]);
  const cfg = llm ?? DEFAULT_LLM;
  const patchLlm = (patch: Partial<LlmConfig>) => setLlm({ ...cfg, ...patch });
  const preset =
    API_PRESETS.find((p) => p.baseUrl && p.baseUrl === cfg.baseUrl)?.id ??
    "custom";
  async function act(action: "login" | "logout" | "refresh") {
    if (draft.provider === "api") return;
    setBusy(true);
    setError("");
    try {
      if (action === "login") {
        const result = await subscriptionLogin(draft.provider);
        setMessage(result.message);
        setAuthUrl(result.url || "");
      }
      if (action === "logout") {
        await subscriptionLogout(draft.provider);
        setMessage("Signed out");
      }
      setStatus(await subscriptionStatus(draft.provider));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function run(action: "models" | "test") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "models") {
        const list = await listModels(cfg);
        setModels(list);
        setMessage(`${list.length} models found.`);
      } else {
        await testConnection(cfg);
        setMessage("Connected. The model is available.");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveApi() {
    if (!llm) return;
    await saveLlmConfig(validateLlmConfig(llm));
    await onSave({ provider: "api", model: "" });
  }
  const providers: SubscriptionProvider[] = mobile
    ? ["api"]
    : ["chatgpt", "grok", "api"];
  const labels: Record<SubscriptionProvider, string> = {
    chatgpt: "ChatGPT · Codex",
    grok: "Grok · Build",
    api: "API key",
  };
  return (
    <Dialog title="AI connection" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (draft.provider === "api") await saveApi();
            else await onSave(draft);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          {draft.provider === "api"
            ? "Use your own API key from a provider. Requests go directly from this device to the provider."
            : "Connect through the provider’s official app. Your plan’s access and usage limits apply."}
        </p>
        <div
          className="segments"
          role="group"
          aria-label="Subscription provider"
        >
          {providers.map((provider) => (
            <button
              type="button"
              key={provider}
              disabled={busy}
              aria-pressed={draft.provider === provider}
              onClick={() => {
                setDraft({ provider, model: "" });
                setMessage("");
                setAuthUrl("");
                setError("");
              }}
            >
              {labels[provider]}
            </button>
          ))}
        </div>
        {draft.provider === "api" ? (
          <>
            <div className="connection-card">
              <strong>{llm?.apiKey ? "Connected" : "Not connected"}</strong>
              <p role="status">
                {llm?.apiKey
                  ? `${providerLabel("api")} saved for ${llm.model || "the selected model"}.`
                  : "Add an API key to use AI."}
              </p>
            </div>
            <label className="setting-field">
              Provider
              <select
                value={preset}
                onChange={(e) => {
                  const next = API_PRESETS.find((p) => p.id === e.target.value);
                  if (!next || !next.baseUrl) return;
                  patchLlm({
                    baseUrl: next.baseUrl,
                    model:
                      !cfg.model || cfg.model === DEFAULT_LLM.model
                        ? next.model
                        : cfg.model,
                  });
                }}
              >
                {API_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field">
              Base URL
              <input
                type="url"
                value={cfg.baseUrl}
                onChange={(e) => patchLlm({ baseUrl: e.target.value })}
              />
            </label>
            <label className="setting-field">
              API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={cfg.apiKey}
                onChange={(e) => patchLlm({ apiKey: e.target.value })}
              />
            </label>
            <label className="setting-field">
              Model
              <input
                list="ai-api-models"
                value={cfg.model}
                onChange={(e) => patchLlm({ model: e.target.value })}
              />
              <datalist id="ai-api-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy || !llm}
                onClick={() => void run("models")}
              >
                Load models
              </button>
              <button
                type="button"
                disabled={busy || !llm}
                onClick={() => void run("test")}
              >
                Test connection
              </button>
            </div>
            <p className="muted">
              {mobile
                ? "Stored privately on this device."
                : "Stored in the system credential store when available."}
            </p>
          </>
        ) : (
          <>
            <div className="connection-card">
              <strong>
                {status?.authenticated
                  ? "Connected"
                  : status?.available
                    ? "Ready to connect"
                    : "Connection status"}
              </strong>
              <p role="status">
                {status?.message || "Checking official client…"}
              </p>
              {status?.usage && <p>{status.usage}</p>}
              <div className="dialog-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("refresh")}
                >
                  Refresh status
                </button>
                {status?.authenticated ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act("logout")}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !status?.available}
                    onClick={() => void act("login")}
                  >
                    Connect in browser
                  </button>
                )}
              </div>
            </div>
            <label className="setting-field">
              Model
              <select
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              >
                <option value="">Provider default</option>
                {status?.models?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {authUrl && (
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(authUrl)
                    .then(() =>
                      setMessage(
                        "Sign-in link copied. Open it in your browser.",
                      ),
                    )
                    .catch(() =>
                      setError(
                        "Could not copy the sign-in link. Try Connect again.",
                      ),
                    )
                }
              >
                Copy sign-in link
              </button>
            )}
            <p className="muted">
              After signing in, refresh status. Redraw uses its own sign-in
              session; credentials stay with the official client on this device.
            </p>
          </>
        )}
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || (draft.provider === "api" && !llm)}
          >
            {draft.provider === "api" ? "Save API key" : "Save connection"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
