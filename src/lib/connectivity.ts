/**
 * enough. — minimal connectivity abstraction (Offline Read Mode, v0.3.x).
 *
 * SCOPE
 *   This module answers exactly one question: "may the app expect a Supabase
 *   round trip to succeed right now?". It is deliberately NOT a network
 *   monitor: there is no polling, no heartbeat, no request instrumentation.
 *
 * WHY IT IS NOT JUST `navigator.onLine`
 *   `navigator.onLine === false` is reliable (the browser knows it has no
 *   network), but `true` only means "some interface is up" — a captive portal
 *   or a dead backend still fails. Callers therefore report the outcome of the
 *   requests they already make via `reportNetworkFailure()` /
 *   `reportNetworkSuccess()`, which moves the status to `unreachable` without
 *   any extra traffic.
 *
 * STATES
 *   'online'      browser reports online and no request has failed since.
 *   'offline'     browser reports offline (no request should be attempted).
 *   'unreachable' browser reports online but a request/realtime attempt failed.
 *
 * Both 'offline' and 'unreachable' are "not connected" for the UI; only
 * 'offline' suppresses network attempts outright, because in the
 * 'unreachable' case a retry is still meaningful.
 */

import { useEffect, useState } from 'react';

export type ConnectivityStatus = 'online' | 'offline' | 'unreachable';

/** True while the browser itself reports a usable network interface. */
function browserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // Some environments (jsdom, older browsers) do not implement the property.
  return navigator.onLine !== false;
}

/** Set when a request/realtime attempt failed while the browser said online. */
let requestFailed = false;

const listeners = new Set<(status: ConnectivityStatus) => void>();
let lastNotified: ConnectivityStatus | null = null;

/** Current connectivity status. */
export function getConnectivityStatus(): ConnectivityStatus {
  if (!browserOnline()) return 'offline';
  return requestFailed ? 'unreachable' : 'online';
}

/** True when the app must not present data as freshly synchronized. */
export function isOffline(): boolean {
  return getConnectivityStatus() !== 'online';
}

/**
 * True when a network attempt is pointless because the browser has no
 * network at all. `unreachable` deliberately returns false: a retry there is
 * how the app discovers that the backend came back.
 */
export function shouldSkipNetwork(): boolean {
  return getConnectivityStatus() === 'offline';
}

function notify(): void {
  const status = getConnectivityStatus();
  if (status === lastNotified) return;
  lastNotified = status;
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      /* a listener must never break connectivity signalling */
    }
  }
}

/** Report that a request or realtime attempt failed for network reasons. */
export function reportNetworkFailure(): void {
  if (requestFailed) return;
  requestFailed = true;
  notify();
}

/** Report that a request succeeded; clears a previous `unreachable`. */
export function reportNetworkSuccess(): void {
  if (!requestFailed) return;
  requestFailed = false;
  notify();
}

/** Test-only: restore the module to its initial state. */
export function _resetConnectivityForTests(): void {
  requestFailed = false;
  lastNotified = null;
  listeners.clear();
}

function handleBrowserOnline(): void {
  // A fresh interface invalidates a previous request failure: the next real
  // request decides again.
  requestFailed = false;
  notify();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', handleBrowserOnline);
  window.addEventListener('offline', notify);
}

/**
 * Subscribe to status changes. Returns an unsubscribe function.
 * The listener is only called when the status actually changes, so rapid
 * online/offline flapping collapses into the transitions that matter.
 */
export function subscribeConnectivity(
  listener: (status: ConnectivityStatus) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding for {@link getConnectivityStatus}. */
export function useConnectivity(): ConnectivityStatus {
  const [status, setStatus] = useState<ConnectivityStatus>(getConnectivityStatus);
  useEffect(() => {
    // The status may have changed between render and effect (fast toggling).
    setStatus(getConnectivityStatus());
    return subscribeConnectivity(setStatus);
  }, []);
  return status;
}
