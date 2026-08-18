import { ReactNode, useEffect, useRef } from 'react';
import { t } from '../i18n';

interface DialogProps {
  title: string;
  text?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  /** Optional second action, e.g. "Decline and block" next to "Decline". */
  extraAction?: {
    label: string;
    onClick: () => void;
  };
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** Custom confirmation dialog. No browser alert(). */
export default function Dialog({
  title,
  text,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  confirmDisabled,
  extraAction,
  onConfirm,
  onCancel,
  children,
}: DialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="dialog-title">{title}</h2>
        {text && <p className="dialog-text">{text}</p>}
        {children}
        <div className="dialog-actions">
          <button
            className="btn-plain"
            onClick={onCancel}
            disabled={busy}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={`btn-primary${danger ? ' danger' : ''}`}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            type="button"
          >
            {busy ? t('loading') : confirmLabel}
          </button>
          {extraAction && (
            <button
              className="btn-primary danger dialog-extra"
              onClick={extraAction.onClick}
              disabled={busy || confirmDisabled}
              type="button"
            >
              {extraAction.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
