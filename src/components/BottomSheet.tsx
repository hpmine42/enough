import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './useFocusTrap';

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

function closeDurationMs() {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return 0;
  }
  return 180;
}

/** Bottom sheet opened by long-pressing a message (or other in-app actions). */
export default function BottomSheet({
  title,
  items,
  cancelLabel,
  onClose,
}: BottomSheetProps) {
  const [closing, setClosing] = useState(false);
  const pendingSelect = useRef<(() => void) | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Trap Tab/Shift+Tab inside the sheet and restore focus on close (P2-3).
  useFocusTrap(sheetRef);

  const requestClose = useCallback(
    (after?: () => void) => {
      if (closing) return;
      pendingSelect.current = after ?? null;
      setClosing(true);
    },
    [closing],
  );

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => {
      pendingSelect.current?.();
      pendingSelect.current = null;
      onClose();
    }, closeDurationMs());
    return () => window.clearTimeout(t);
  }, [closing, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return (
    <div
      className={`sheet-backdrop${closing ? ' closing' : ''}`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={sheetRef}
        className={`sheet${closing ? ' closing' : ''}`}
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
              disabled={item.disabled || closing}
              onClick={() => {
                requestClose(item.onSelect);
              }}
              type="button"
            >
              {item.icon && <span className="sheet-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
        <button
          className="sheet-cancel"
          onClick={() => requestClose()}
          type="button"
          disabled={closing}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
