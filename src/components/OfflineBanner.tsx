import { t } from '../i18n';
import type { ConnectivityStatus } from '../lib/connectivity';

/**
 * Minimal, non-blocking offline indicator (Offline Read Mode, v0.3.x).
 *
 * A single quiet status line in the existing enough. visual language — no
 * modal, no notification, no redesign. It renders nothing while online, so
 * the online UI is byte-for-byte unchanged.
 *
 * `role="status"` (polite) announces the transition once without stealing
 * focus, which matters because cached reading must stay uninterrupted.
 */
export default function OfflineBanner({ status }: { status: ConnectivityStatus }) {
  if (status === 'online') return null;
  return (
    <div className="offline-banner" role="status">
      <span className="offline-dot" aria-hidden="true" />
      <span className="offline-text">
        {status === 'offline' ? t('offline.banner') : t('offline.unreachable')}
      </span>
    </div>
  );
}
