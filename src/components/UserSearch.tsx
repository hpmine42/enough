import { useEffect, useState } from 'react';
import {
  acceptConnection,
  searchUsers,
  sendConnectionRequest,
} from '../lib/api';
import { normalizeUsername } from '../lib/helpers';
import { Connection, Profile } from '../lib/types';

type Status = 'none' | 'outgoing' | 'incoming' | 'accepted';

interface Props {
  me: string;
  connections: Connection[];
  onActiveChange: (active: boolean) => void;
  onChanged: () => void;
}

function getStatus(
  connections: Connection[],
  me: string,
  otherId: string,
): Status {
  const conn = connections.find(
    (c) =>
      (c.user_a === me && c.user_b === otherId) ||
      (c.user_a === otherId && c.user_b === me),
  );
  if (!conn) return 'none';
  if (conn.status === 'accepted') return 'accepted';
  return conn.user_a === me ? 'outgoing' : 'incoming';
}

export default function UserSearch({
  me,
  connections,
  onActiveChange,
  onChanged,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = query.trim() !== '';
  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    const q = normalizeUsername(query);
    if (!q) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    setError(null);
    const timer = setTimeout(async () => {
      const found = await searchUsers(q, me);
      setResults(found);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, me]);

  async function handleConnect(other: Profile) {
    setBusyId(other.id);
    setError(null);
    const err = await sendConnectionRequest(me, other.id);
    setBusyId(null);
    if (err) setError(err);
    else onChanged();
  }

  async function handleAccept(connection: Connection) {
    setBusyId(connection.id);
    setError(null);
    const err = await acceptConnection(connection.id);
    setBusyId(null);
    if (err) setError(err);
    else onChanged();
  }

  return (
    <>
      <input
        id="person-search"
        className="search"
        placeholder="Person suchen"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Person suchen"
      />

      {active && (
        <section className="results">
          {searching && <p className="muted">Suchen…</p>}
          {!searching && results.length === 0 && !error && (
            <p className="muted">Keine Person gefunden.</p>
          )}
          {!searching && error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!searching &&
            results.map((r) => {
              const status = getStatus(connections, me, r.id);
              const connection = connections.find(
                (c) =>
                  (c.user_a === me && c.user_b === r.id) ||
                  (c.user_a === r.id && c.user_b === me),
              );
              return (
                <div className="row" key={r.id}>
                  <div className="row-name">@{r.username}</div>
                  {status === 'none' && (
                    <button
                      className="btn-small"
                      disabled={busyId === r.id}
                      onClick={() => handleConnect(r)}
                    >
                      Verbinden
                    </button>
                  )}
                  {status === 'outgoing' && (
                    <button className="btn-small" disabled>
                      Angefragt
                    </button>
                  )}
                  {status === 'accepted' && (
                    <button className="btn-small" disabled>
                      Verbunden
                    </button>
                  )}
                  {status === 'incoming' && connection && (
                    <button
                      className="btn-small"
                      disabled={busyId === connection.id}
                      onClick={() => handleAccept(connection)}
                    >
                      Annehmen
                    </button>
                  )}
                </div>
              );
            })}
        </section>
      )}
    </>
  );
}
