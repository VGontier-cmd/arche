import { useEffect, useRef, useState } from "react";

/**
 * Count-up animation hook used by KpiCards (and any future ticker that wants
 * to ease a numeric value to a target). Honors prefers-reduced-motion by
 * jumping straight to the final value.
 */
export function useCountUp(target: number, duration = 400): number {
  const [value, setValue] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;

    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
