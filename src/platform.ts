/** Touch-first UI (phone/tablet). CSS media — no OS plugin. */
export function isTouchUi(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none) and (max-width: 1024px)").matches
  );
}
