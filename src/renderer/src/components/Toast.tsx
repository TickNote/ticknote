export interface ToastProps {
  text: string;
}

export function Toast({ text }: ToastProps) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}
