interface Props {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
}

export default function Toast({ message, actionLabel, onAction, onClose }: Props) {
  return (
    <section class="toast" aria-label="Notification">
      <span role="status">{message}</span>
      <span style="display:flex;gap:4px">
        {actionLabel && onAction && (
          <button type="button" class="btn" onClick={onAction}>
            {actionLabel}
          </button>
        )}
        <button type="button" class="btn btn-icon" onClick={onClose} aria-label="Close message">
          ×
        </button>
      </span>
    </section>
  );
}
