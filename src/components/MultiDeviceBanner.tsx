// enough. — Multi-device warning banner.
// ---------------------------------------------------------------------------
// Shown when useDeviceCount() reports more than one registered device for
// the current account. Purely informational: it does not block sending or
// alter session state. It tells the user that messages may not be readable
// on every device until multi-device sessions are implemented.

import { useDeviceCount } from '../hooks/useDeviceCount';
import { t } from '../i18n';

export function MultiDeviceBanner() {
  const { isMultiDevice, count, loading } = useDeviceCount();
  if (loading || !isMultiDevice) return null;
  return (
    <div
      role="status"
      className="text-sm px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-700 dark:text-amber-300"
    >
      {t('multiDevice.banner', { count: String(count) })}
    </div>
  );
}
