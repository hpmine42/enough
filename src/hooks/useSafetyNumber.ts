// enough. — derive the safety number for the open peer conversation.
// ---------------------------------------------------------------------------
// Returns the formatted safety-number string once both local and peer
// identity keys are available, or null while initializing / for My Notes /
// for failed engines. Reading is best-effort — it never throws.

import { useEffect, useState } from 'react';
import { getIdentityBundle } from '../lib/crypto/identity';
import { safetyNumber } from '../lib/e2ee/safetyNumber';

export function useSafetyNumber(opts: {
  me: string;
  peerId: string | null;
  isSelf: boolean;
  ended: boolean;
  manager: { peerIdentityKey: (peerId: string) => Promise<string | null> } | null;
  e2eeReady: boolean;
}): string | null {
  const { me, peerId, isSelf, ended, manager, e2eeReady } = opts;
  const [number, setNumber] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setNumber(null);
    if (!peerId || isSelf || ended || !manager || !e2eeReady) return;
    (async () => {
      try {
        const [localBundle, peerKey] = await Promise.all([
          getIdentityBundle(me).catch(() => null),
          manager.peerIdentityKey(peerId).catch(() => null),
        ]);
        if (!active || !localBundle || !peerKey) return;
        const n = await safetyNumber(localBundle.identityKey, peerKey);
        if (active) setNumber(n);
      } catch {
        if (active) setNumber(null);
      }
    })();
    return () => { active = false; };
  }, [me, peerId, isSelf, ended, manager, e2eeReady]);

  return number;
}
