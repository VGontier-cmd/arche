import { useEffect } from "react";

/**
 * Locks `document.body` scrolling while `active` is true. Restores the
 * previous overflow value on cleanup. Used by every modal + overlay so the
 * dashboard behind a dialog cannot scroll out from under the user.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
