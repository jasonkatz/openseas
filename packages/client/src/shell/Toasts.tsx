import { useToasts } from "../state/toasts.jsx";

export function Toasts() {
  const { toasts } = useToasts();
  return (
    <div className="toasts" aria-live="polite" data-testid="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.tone}`}>
          {x.text}
        </div>
      ))}
    </div>
  );
}
