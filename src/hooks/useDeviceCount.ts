// enough. — Multi-device awareness.
// ---------------------------------------------------------------------------
// Exposes `useDeviceCount()` which polls the list of this account's
// published crypto_devices rows and returns a simple summary. Home and Chat
// use this to show a non-blocking informational banner when more than one
// device has registered for the same user id — a scenario where Signal-WASM
// sessions diverge and messages may not be readable on every device.
//
// The check is read-only: it never affects session state or message send.
// It is a user-facing heads-up, not a safety interlock.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listUserDevices } from '../lib/e2ee/prekeys-api';
import { useAuth } from '../context/AuthContext';
import { getDeviceId } from '../lib/crypto/identity';
import { shouldSkipNetwork, useConnectivity } from '../lib/connectivity';

export interface DeviceCountState {
  count: number;
  isMultiDevice: boolean;
  loading: boolean;
  /** Resolve once, after the first fetch resolves. */
  checked: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDeviceCount(): DeviceCountState {
  const { user } = useAuth();
  const connectivity = useConnectivity();
  const [state, setState] = useState<Omit<DeviceCountState, 'refresh'>>({
    count: 1,
    isMultiDevice: false,
    loading: false,
    checked: false,
    error: null,
  });
  const mounted = useRef(true);
  const didInitialFetch = useRef(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    // Do not issue an additional network request when the browser is
    // fully offline — a stale multi-device banner is harmless and the
    // offline banner already communicates status.
    if (shouldSkipNetwork()) {
      setState((s) => (s.checked ? s : { ...s, loading: false, checked: true }));
      return;
    }
    setState((s) => (s.checked ? s : { ...s, loading: true }));
    const { devices, error } = await listUserDevices(user.id);
    if (!mounted.current) return;
    if (error) {
      setState({ count: 1, isMultiDevice: false, loading: false, checked: true, error });
      return;
    }
    // If our local device id doesn't match any of the registered device ids
    // (e.g. after a local storage reset or first registration race), count
    // conservatively so we don't flash the banner incorrectly.
    const local = await getDeviceId(user.id).catch(() => null);
    const count = devices.length;
    const isMultiDevice =
      count > 1 && (local === null || devices.some((d) => String(d.device_id) === String(local)));
    setState({ count: isMultiDevice ? count : 1, isMultiDevice, loading: false, checked: true, error: null });
  }, [user]);

  useEffect(() => {
    mounted.current = true;
    if (!user) {
      didInitialFetch.current = false;
      setState({ count: 1, isMultiDevice: false, loading: false, checked: false, error: null });
      return;
    }
    // Defer the fetch until connectivity is reported, so we don't race a
    // Supabase call during the first-render offline test scenarios.
    if (connectivity === 'offline') {
      setState((s) => (s.checked ? s : { ...s, loading: false, checked: true }));
      return;
    }
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [user, connectivity, refresh]);

  return { ...state, refresh };
}
