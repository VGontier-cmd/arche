import { createContext, useCallback, useContext, useReducer, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ToastType = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type Action =
  | { kind: "add"; toast: Toast }
  | { kind: "remove"; id: number };

let nextId = 0;

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.kind) {
    case "add":
      return [...state, action.toast];
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

  const remove = useCallback((id: number) => dispatch({ kind: "remove", id }), []);

  const add = useCallback(
    (message: string, type: ToastType) => {
      const id = ++nextId;
      dispatch({ kind: "add", toast: { id, message, type } });
      setTimeout(() => remove(id), 4000);
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
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
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
