import { createContext, useCallback, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ToastType = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 4_000;

type Action =
  | { kind: "add"; toast: Toast }
  | { kind: "remove"; id: number };

let nextId = 0;

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.kind) {
    case "add": {
      // Drop the oldest toast when capacity is exceeded — prevents UI overflow
      // when many transitions fire at once (e.g. polling resync after offline).
      const next = state.length >= MAX_TOASTS ? state.slice(1) : state;
      return [...next, action.toast];
    }
    case "remove":
      return state.filter((t) => t.id !== action.id);
  }
}

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TYPE_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: "bg-[#0d1117]", border: "border-[#238636]", text: "text-[#3fb950]" },
  error: { bg: "bg-[#0d1117]", border: "border-[#da3633]", text: "text-[#f85149]" },
  info: { bg: "bg-[#0d1117]", border: "border-[#1f6feb]", text: "text-[#58a6ff]" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    const existing = timersRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(id);
    }
    dispatch({ kind: "remove", id });
  }, []);

  // Cancel any pending auto-dismiss timers when the provider unmounts so we
  // don't dispatch into an unmounted reducer.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const add = useCallback(
    (message: string, type: ToastType) => {
      const id = ++nextId;
      dispatch({ kind: "add", toast: { id, message, type } });
      const timer = setTimeout(() => remove(id), AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [remove],
  );

  const api: ToastApi = {
    success: useCallback((m: string) => add(m, "success"), [add]),
    error: useCallback((m: string) => add(m, "error"), [add]),
    info: useCallback((m: string) => add(m, "info"), [add]),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div aria-live="polite" aria-atomic="false" className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => {
            const c = TYPE_COLORS[t.type];
            return (
              <div
                key={t.id}
                onClick={() => remove(t.id)}
                className={`pointer-events-auto cursor-pointer px-4 py-2.5 rounded-[var(--rounded-box)] border ${c.bg} ${c.border} ${c.text} text-xs font-medium shadow-lg max-w-[360px] animate-[slideIn_0.2s_ease-out]`}
              >
                {t.message}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
