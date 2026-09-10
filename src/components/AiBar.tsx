import { useEffect, useState } from "react";
import {
  subscriptionStatus,
  subscriptionLogin,
  subscriptionLogout,
  type SubscriptionConfig,
  type SubscriptionStatus,
} from "../subscriptions";
import Dialog from "./Dialog";
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
        title="AI assistant (Ctrl+Enter)"
        onClick={onAsk}
      >
        ✦ <span>AI assistant</span>
      </button>
      <button
        className="icon-button"
        title="Settings"
        aria-label="Settings"
        onClick={onSettings}
      >
        ⚙
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
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setStatus(null);
    setError("");
    subscriptionStatus(draft.provider)
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
  async function act(action: "login" | "logout" | "refresh") {
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
  return (
    <Dialog title="AI subscriptions" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(draft);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          Connect through the provider’s official app. Your plan’s access and
          usage limits apply.
        </p>
        <div
          className="segments"
          role="group"
          aria-label="Subscription provider"
        >
          {(["chatgpt", "grok"] as const).map((provider) => (
            <button
              type="button"
              key={provider}
              disabled={busy}
              aria-pressed={draft.provider === provider}
              onClick={() => {
                setDraft({ provider, model: "" });
                setMessage("");
                setAuthUrl("");
              }}
            >
              {provider === "chatgpt" ? "ChatGPT · Codex" : "Grok · Build"}
            </button>
          ))}
        </div>
        <div className="connection-card">
          <strong>
            {status?.authenticated
              ? "Connected"
              : status?.available
                ? "Ready to connect"
                : "Connection status"}
          </strong>
          <p role="status">{status?.message || "Checking official client…"}</p>
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
                  setMessage("Sign-in link copied. Open it in your browser."),
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
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          After signing in, refresh status. Redraw uses its own sign-in session;
          credentials stay with the official client on this device.
        </p>
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save connection
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
