import { useLayoutEffect, useRef } from 'react';

// React 18 forwards the empty string as the native boolean attribute. Using
// `true` would be dropped as an unknown non-boolean React DOM property.
export function inertWhen(hidden: boolean): { inert?: '' } {
  return { inert: hidden ? '' : undefined };
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), ' +
  'textarea:not([disabled]), select:not([disabled]), [tabindex="0"]';
const isAvailable = (element: HTMLElement) =>
  element.isConnected && !element.closest('[inert], [aria-hidden="true"]');

/**
 * Move focus with the Settings navigation stack, not with its animations.
 * Remember each level's focused control so Back restores the category/row
 * that opened the next level. Native inert handles Tab and the accessibility
 * tree; this hook only chooses the entry/return target, never traps the page.
 */
export function useScreenFocus(region: string): void {
  const previousRegion = useRef(region);
  const remembered = useRef(new Map<string, HTMLElement>());

  useLayoutEffect(() => {
    const remember = (event: FocusEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !isAvailable(element)) return;
      const owner = element.closest<HTMLElement>('[data-focus-region]');
      if (owner?.dataset.focusRegion) {
        remembered.current.set(owner.dataset.focusRegion, element);
      }
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);

  useLayoutEffect(() => {
    const previous = previousRegion.current;
    previousRegion.current = region;
    // Do not take focus on the initial Home/Chat render, or on ordinary chat
    // changes. Only Settings navigation owns focus here.
    if (region === 'stage' && previous === 'stage') return;
    const container = Array.from(
      document.querySelectorAll<HTMLElement>('[data-focus-region]'),
    ).find((element) => element.dataset.focusRegion === region);
    if (!container || !isAvailable(container)) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && container.contains(active) && isAvailable(active)) return;
    const saved = remembered.current.get(region);
    const target = saved && container.contains(saved) && isAvailable(saved)
      ? saved
      : Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isAvailable);
    target?.focus({ preventScroll: true });
  }, [region]);
}
