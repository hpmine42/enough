import { t } from '../../i18n';
import { displayName } from '../../lib/helpers';
import { Profile } from '../../lib/types';

interface BlockedUsersPageProps {
  blockedUsers: Profile[];
  blockBusyId: string | null;
  onUnblock: (target: Profile) => void;
}

export default function BlockedUsersPage({
  blockedUsers,
  blockBusyId,
  onUnblock,
}: BlockedUsersPageProps) {
  return (
    <>
      {blockedUsers.length === 0 ? (
        <p className="muted settings-blocked-empty">{t('block.empty')}</p>
      ) : (
        blockedUsers.map((p) => (
          <div key={p.id} className="settings-row">
            <div className="settings-row-main">
              <div className="settings-row-label">{displayName(p)}</div>
              <div className="settings-row-sub">@{p.username}</div>
            </div>
            <div className="settings-row-control blocked-row-control">
              <span className="badge-soft">{t('block.status')}</span>
              <button
                type="button"
                className="btn-small"
                disabled={blockBusyId === p.id}
                onClick={() => onUnblock(p)}
              >
                {t('block.unblock')}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
