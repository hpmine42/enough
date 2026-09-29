import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RESEND_COOLDOWN_MS,
  resendCooldownRemaining,
} from '../lib/authOtp';

/**
 * Resend cooldown for one-time-code screens.
 *
 * Starts (or restarts) a `RESEND_COOLDOWN_MS` window on `markSent()` — call
 * it once when the screen appears (an email has just gone out) and again
 * after every successful resend. The seconds left are exposed for the hint
 * text; the caller disables the resend button while `remaining > 0`.
 *
 * Purely a UX mirror of the server's per-address send window; the server
 * limit is what actually enforces the spacing between emails.
 */
export function useResendCooldown(initiallySent = false): {
  remaining: number;
  markSent: () => void;
} {
  const [sentAt, setSentAt] = useState<number | null>(() =>
    initiallySent ? Date.now() : null,
  );
  const [remaining, setRemaining] = useState(() =>
    initiallySent ? RESEND_COOLDOWN_MS : 0,
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (sentAt === null) return undefined;
    const tick = () => setRemaining(resendCooldownRemaining(sentAt));
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [sentAt]);

  const markSent = useCallback(() => {
    setSentAt(Date.now());
    setRemaining(RESEND_COOLDOWN_MS);
  }, []);

  return { remaining, markSent };
}
