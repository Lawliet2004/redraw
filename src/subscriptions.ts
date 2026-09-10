import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getMeta, setMeta } from "./db";

export type SubscriptionProvider = "chatgpt" | "grok";
export type SubscriptionConfig = {
  provider: SubscriptionProvider;
  model: string;
};
export type SubscriptionStatus = {
  available: boolean;
  authenticated: boolean;
  message: string;
  models?: { id: string; name: string }[];
  usage?: string;
};
export const DEFAULT_SUBSCRIPTION: SubscriptionConfig = {
  provider: "chatgpt",
  model: "",
};
export async function loadSubscription(): Promise<SubscriptionConfig> {
  try {
    const value = JSON.parse((await getMeta("subscription_config")) || "{}");
    return {
      provider: value.provider === "grok" ? "grok" : "chatgpt",
      model: typeof value.model === "string" ? value.model : "",
    };
  } catch {
    return DEFAULT_SUBSCRIPTION;
  }
}
export async function saveSubscription(
  config: SubscriptionConfig,
): Promise<void> {
  await setMeta("subscription_config", JSON.stringify(config));
}
export async function subscriptionStatus(
  provider: SubscriptionProvider,
): Promise<SubscriptionStatus> {
  if (!("__TAURI_INTERNALS__" in window))
    return {
      available: false,
      authenticated: false,
      message: "Subscription connections are available in the desktop app.",
    };
  return invoke("subscription_status", { provider });
}
export async function subscriptionLogin(
  provider: SubscriptionProvider,
): Promise<{ url?: string; message: string }> {
  return invoke("subscription_login", { provider });
}
export async function subscriptionLogout(
  provider: SubscriptionProvider,
): Promise<void> {
  return invoke("subscription_logout", { provider });
}
export async function streamSubscription(opts: {
  config: SubscriptionConfig;
  prompt: string;
  systemPrompt: string;
  image?: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<string> {
  opts.signal.throwIfAborted();
  if (!("__TAURI_INTERNALS__" in window))
    throw new Error(
      "Open Redraw desktop and connect a subscription in Settings → AI.",
    );
  const requestId = crypto.randomUUID();
  const off = await listen<{ requestId: string; text: string }>(
    "subscription-delta",
    ({ payload }) => {
      if (payload.requestId === requestId && !opts.signal.aborted)
        opts.onDelta(payload.text);
    },
  );
  const cancel = () => {
    void invoke("subscription_cancel", { requestId }).catch(() => {});
  };
  opts.signal.addEventListener("abort", cancel, { once: true });
  try {
    opts.signal.throwIfAborted();
    const text = await invoke<string>("subscription_generate", {
      provider: opts.config.provider,
      requestId,
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      image: opts.image,
      model: opts.config.model || undefined,
    });
    opts.signal.throwIfAborted();
    return text;
  } finally {
    off();
    opts.signal.removeEventListener("abort", cancel);
  }
}
