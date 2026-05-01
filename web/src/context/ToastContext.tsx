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

const TYPE_TONE: Record<
  ToastType,
  { borderColor: string; color: string; glow: string }
> = {
  success: {
    borderColor: "var(--c-success-fg)",
    color: "var(--c-success-fg)",
    glow: "var(--glow-success)",
  },
  error: {
    borderColor: "var(--c-error-fg)",
    color: "var(--c-error-fg)",
    glow: "var(--glow-error)",
  },
  info: {
    borderColor: "var(--c-blue-400)",
    color: "var(--c-blue-200)",
    glow: "var(--glow-blue)",
  },
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
            const tone = TYPE_TONE[t.type];
            return (
              <div
                key={t.id}
                role="status"
                onClick={() => remove(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    remove(t.id);
                  }
                }}
                tabIndex={0}
                className="pointer-events-auto cursor-pointer"
                style={{
                  background: "var(--surface-1)",
                  border: `1px solid ${tone.borderColor}`,
                  color: tone.color,
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-body-sm)",
                  fontWeight: 500,
                  maxWidth: 360,
                  boxShadow: `${tone.glow}, 0 12px 24px rgba(0, 0, 0, 0.4)`,
                  animation: "slideIn 200ms var(--ease-out)",
                }}
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
