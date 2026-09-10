import { invoke } from "@tauri-apps/api/core";
import { getMeta, setMeta } from "./db";
import { DEFAULT_LLM, type LlmConfig } from "./llm";

let sessionKey = "";
export async function credentialsAvailable(): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  return invoke<boolean>("credentials_available");
}

export async function loadLlmConfig(): Promise<LlmConfig> {
  const raw = await getMeta("llm_config");
  if (!raw) return { ...DEFAULT_LLM };
  let saved: Partial<LlmConfig> & { credentialId?: string };
  try {
    saved = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LLM };
  }
  const config: LlmConfig = {
    baseUrl:
      typeof saved.baseUrl === "string" ? saved.baseUrl : DEFAULT_LLM.baseUrl,
    model: typeof saved.model === "string" ? saved.model : DEFAULT_LLM.model,
    apiKey: typeof saved.apiKey === "string" ? saved.apiKey : sessionKey,
  };
  if (saved.credentialId)
    config.apiKey = await invoke<string>("read_credential", {
      id: saved.credentialId,
    });
  // Existing installations migrate only after the protected write succeeds.
  if (saved.apiKey) await saveLlmConfig(config);
  return config;
}

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  const protectedStore = await credentialsAvailable();
  const credentialId =
    protectedStore && config.apiKey ? crypto.randomUUID() : undefined;
  const previous = await getMeta("llm_config");
  if (credentialId)
    await invoke("write_credential", {
      id: credentialId,
      secret: config.apiKey,
    });
  try {
    await setMeta(
      "llm_config",
      JSON.stringify({
        baseUrl: config.baseUrl.trim(),
        model: config.model.trim(),
        credentialId,
      }),
    );
    sessionKey = config.apiKey;
  } catch (e) {
    if (credentialId)
      await invoke("delete_credential", { id: credentialId }).catch(() => {});
    throw e;
  }
  if (previous) {
    try {
      const old = JSON.parse(previous);
      if (old.credentialId)
        await invoke("delete_credential", { id: old.credentialId });
    } catch {
      /* An orphaned credential is safe; never undo a committed config. */
    }
  }
}
