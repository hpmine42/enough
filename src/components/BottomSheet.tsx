import { ReactNode, useEffect } from 'react';

interface SheetItem {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onSelect: () => void;
}

interface BottomSheetProps {
  title?: string;
  items: SheetItem[];
  cancelLabel: string;
  onClose: () => void;
}

/** Bottom sheet opened by long-pressing a message (or other in-app actions). */
export default function BottomSheet({
  title,
  items,
  cancelLabel,
  onClose,
}: BottomSheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? cancelLabel}
      >
        {title && <div className="sheet-title">{title}</div>}
        <div className="sheet-items">
          {items.map((item) => (
            <button
              key={item.key}
              className={`sheet-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              type="button"
            >
              {item.icon && <span className="sheet-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
        <button className="sheet-cancel" onClick={onClose} type="button">
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
