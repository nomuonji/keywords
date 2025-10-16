interface ToastProps {
  message: string;
  type?: 'info' | 'success' | 'error';
}

export function Toast({ message, type = 'info' }: ToastProps) {
  const color = (() => {
    switch (type) {
      case 'success':
        return 'bg-success/10 text-success border-success/40';
      case 'error':
        return 'bg-danger/10 text-danger border-danger/40';
      default:
        return 'bg-primary/10 text-primary border-primary/40';
    }
  })();

  return (
    <div
      className={`pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg transition ${color}`}
    >
      {message}
    </div>
  );
}
