import { t } from '../../i18n';
import { displayName } from '../../lib/helpers';
import { Connection, Profile } from '../../lib/types';
import { SearchIcon } from '../icons';
import { Section } from './settings-ui';

interface PeopleSearchProps {
  query: string;
  onSearchChange: (value: string) => void;
  searchActive: boolean;
  searching: boolean;
  searchError: string | null;
  results: Profile[];
  statusOf: (otherId: string) => Connection | undefined;
  blockedIds: Set<string>;
  blockedByIds: Set<string>;
  blockBusyId: string | null;
  onUnblock: (target: Profile) => void;
  onOpenConversation: (other: Profile) => void;
  actionBusyId: string | null;
  me: string;
}

/**
 * Settings-wide people search.
 *
 * This is the single search implementation used by the Settings overview and
 * by the shared subpanel header, so the same UI stays available while the user
 * navigates through Settings without duplicating any search state or logic.
 */
export default function PeopleSearch({
  query,
  onSearchChange,
  searchActive,
  searching,
  searchError,
  results,
  statusOf,
  blockedIds,
  blockedByIds,
  blockBusyId,
  onUnblock,
  onOpenConversation,
  actionBusyId,
  me,
}: PeopleSearchProps) {
  return (
    <Section title={t('settingsScreen.searchPeople')}>
      <div className="at-field search-field">
        <span className="at-prefix" aria-hidden="true">
          @
        </span>
        <input
          className="input at-input"
          type="text"
          placeholder={t('settingsScreen.searchPlaceholder')}
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={t('settingsScreen.searchPeople')}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
        />
        {searchActive && !searching && (
          <SearchIcon className="at-status" size={18} />
        )}
      </div>
      {searchActive && (
        <div className="settings-search-results">
          {searching && <p className="muted">{t('loading')}</p>}
          {!searching && searchError && (
            <p className="error" role="alert">
              {searchError}
            </p>
          )}
          {!searching && !searchError && results.length === 0 && (
            <p className="muted">{t('settingsScreen.searchNoResults')}</p>
          )}
          {!searching &&
            results.map((r) => {
              const conn = statusOf(r.id);
              const blockedByMe = blockedIds.has(r.id);
              const blockedByThem = blockedByIds.has(r.id);
              if (blockedByMe || blockedByThem) {
                // A block overrides the normal request affordance.
                return (
                  <div
                    key={r.id}
                    className="chat settings-search-row blocked-search-row"
                  >
                    <div className="chat-text">
                      <div className="chat-name">{displayName(r)}</div>
                      <div className="chat-preview">
                        {blockedByMe ? t('block.byYou') : t('block.byThem')}
                      </div>
                    </div>
                    <div className="chat-trailing">
                      <span className="badge-soft">{t('block.status')}</span>
                      {blockedByMe && (
                        <button
                          type="button"
                          className="btn-small"
                          disabled={blockBusyId === r.id}
                          onClick={() => onUnblock(r)}
                        >
                          {t('block.unblock')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={r.id}
                  type="button"
                  className="chat settings-search-row"
                  onClick={() => onOpenConversation(r)}
                  disabled={actionBusyId === r.id}
                >
                  <div className="chat-text">
                    <div className="chat-name">{displayName(r)}</div>
                    <div className="chat-preview">@{r.username}</div>
                  </div>
                  <div className="chat-trailing">
                    {conn?.status === 'accepted' && (
                      <span className="badge-soft">{t('connection.accepted')}</span>
                    )}
                    {conn?.status === 'pending' &&
                      (conn.user_a === me
                        ? t('connection.requestSent')
                        : t('connection.requestTitle'))}
                    {conn?.status === 'declined' && t('connection.requestDeclined')}
                    {conn?.status === 'expired' && t('connection.requestExpired')}
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </Section>
  );
}
