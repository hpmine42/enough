import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** Elements that can receive keyboard focus inside the modal container. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside a modal container while it is mounted.
 *
 * On mount, focus moves into the container (to `initialFocusRef.current` when
 * given, otherwise to the first focusable element). Tab / Shift+Tab cycle
 * within the container, and focus is restored to the previously focused
 * element when the modal unmounts (audit P2-3).
 *
 * Escape handling is deliberately left to the caller: Dialog cancels and
 * BottomSheet runs its close animation, so the two differ.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;

    // Move focus into the modal unless it is already inside (e.g. after a
    // re-render caused by the caller's own initial focus).
    if (!container.contains(document.activeElement)) {
      const target = initialFocusRef?.current ?? container.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previousFocusRef.current?.focus?.();
    };
  }, [containerRef, initialFocusRef]);
}
