export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  text: string;
  action?: ToastAction | null;
}

export function Toast({ text, action }: ToastProps) {
  if (!text) return null;
  return (
    <div className={`toast${action ? ' action' : ''}`}>
      {text}
      {action ? (
        <button type="button" className="toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
