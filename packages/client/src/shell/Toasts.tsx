import { useToasts } from "../state/toasts.jsx";

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" aria-live="polite" data-testid="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.tone} ${x.action ? "has-action" : ""}`}>
          <span>{x.text}</span>
          {x.action && (
            <button
              className="toast-action"
              onClick={() => {
                x.action!.run();
                dismiss(x.id);
              }}
              data-testid={x.action.testId}
            >
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
