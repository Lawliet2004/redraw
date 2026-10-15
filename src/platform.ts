import { useSyncExternalStore } from "react";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isMobileOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Touch-first UI (phone/tablet). CSS media — no OS plugin. */
export function isTouchUi(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none) and (max-width: 1024px)").matches
  );
}

export const PHONE_QUERY =
  "(max-width: 640px), (pointer: coarse) and (max-height: 500px)";
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(PHONE_QUERY);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
