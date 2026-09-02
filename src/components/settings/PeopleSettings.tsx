import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { displayName } from '../../lib/helpers';
import { navigate } from '../../lib/router';
import { Connection, Profile } from '../../lib/types';
import Avatar from '../Avatar';
import { Row, Section } from './settings-ui';

export interface ActiveConnection {
  conn: Connection;
  profile: Profile;
}

interface PeopleSettingsProps {
  connections: ActiveConnection[];
  loading: boolean;
  error: string | null;
  onOpenConversation: (profile: Profile) => void;
  onLongPress: (profile: Profile) => void;
  busyId: string | null;
  blockedCount: number;
}

/**
 * One active connection row.
 *
 * A normal tap opens the chat. Holding the pointer briefly (or pressing
 * Enter/Space) opens the row action sheet instead, so the action UI never
 * competes with the chat navigation affordance.
 */
function ConnectionRow({
  conn,
  profile,
  onOpenConversation,
  onLongPress,
  busyId,
}: {
  conn: Connection;
  profile: Profile;
  onOpenConversation: (profile: Profile) => void;
  onLongPress: (profile: Profile) => void;
  busyId: string | null;
}) {
  const timerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function startPress() {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      suppressClickRef.current = true;
      onLongPress(profile);
    }, 550);
  }

  function cancelPress() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpenConversation(profile);
  }

  return (
    <button
      type="button"
      className="chat settings-connection-row"
      data-connection-id={conn.id}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onPointerMove={(e) => {
        // Cancel the long-press when the pointer moves beyond a small slop.
        if (
          timerRef.current !== null &&
          e.movementX * e.movementX + e.movementY * e.movementY > 36
        ) {
          cancelPress();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={handleClick}
      disabled={busyId === profile.id}
    >
      <Avatar name={displayName(profile)} size={44} />
      <div className="chat-text">
        <div className="chat-topline">
          <div className="chat-identity">
            <span className="chat-name">{displayName(profile)}</span>
            <span className="chat-username">@{profile.username}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function PeopleSettings({
  connections,
  loading,
  error,
  onOpenConversation,
  onLongPress,
  busyId,
  blockedCount,
}: PeopleSettingsProps) {
  return (
    <>
      <Section title={t('settingsScreen.activeConnections')}>
        {loading && <p className="muted settings-blocked-empty">{t('loading')}</p>}
        {!loading && error && (
          <p className="error settings-connection-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && connections.length === 0 && (
          <p className="muted settings-blocked-empty">
            {t('settingsScreen.activeConnectionsEmpty')}
          </p>
        )}
        {!loading &&
          connections.map(({ conn, profile }) => (
            <ConnectionRow
              key={conn.id}
              conn={conn}
              profile={profile}
              onOpenConversation={onOpenConversation}
              onLongPress={onLongPress}
              busyId={busyId}
            />
          ))}
      </Section>

      <Section title={t('block.title')}>
        <Row
          label={t('block.title')}
          sub={t('block.hint')}
          onClick={() => navigate('#/settings/people/blocked')}
        >
          {blockedCount > 0 && (
            <span className="badge-soft">{blockedCount}</span>
          )}
        </Row>
      </Section>
    </>
  );
}
