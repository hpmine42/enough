import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../lib/router';
import {
  acceptConnection,
  getLastMessages,
  getMyConnections,
  getProfiles,
} from '../lib/api';
import { otherUserId } from '../lib/helpers';
import { supabase } from '../lib/supabase';
import { Connection, Message, Profile } from '../lib/types';
import UserSearch from './UserSearch';

export default function Home() {
  const { user, signOut } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [others, setOthers] = useState<Record<string, Profile>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
  const [loading, setLoading] = useState(true);
  const [searchActive, setSearchActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = user?.id ?? '';

  const load = useCallback(async () => {
    if (!me) return;
    const conns = await getMyConnections(me);
    setConnections(conns);

    const ids = conns.map((c) => otherUserId(c, me));
    const profiles = await getProfiles(ids);
    setOthers(profiles);

    const last = await getLastMessages(conns.map((c) => c.id));
    setLastMessages(last);

    setLoading(false);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    setLoading(true);
    load();
  }, [me, load]);

  useEffect(() => {
    if (!supabase || !me) return;
    const client = supabase;
    const channel = client
      .channel('home-connections')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connections' },
        (payload) => {
          const row = payload.new as Connection | undefined;
          if (row && (row.user_a === me || row.user_b === me)) load();
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [me, load]);

  const incoming = connections.filter(
    (c) => c.status === 'pending' && c.user_b === me,
  );
  const accepted = connections
    .filter((c) => c.status === 'accepted')
    .sort((a, b) => {
      const la = lastMessages[a.id]?.created_at ?? a.created_at ?? '';
      const lb = lastMessages[b.id]?.created_at ?? b.created_at ?? '';
      return lb.localeCompare(la);
    });

  async function handleAccept(connectionId: string) {
    setError(null);
    const err = await acceptConnection(connectionId);
    if (err) setError(err);
    else load();
  }

  async function handleLogout() {
    await signOut();
    navigate('#/');
  }

  return (
    <main className="home-screen">
      <header className="home-header">
        <div className="logo">enough.</div>
        <button
          className="add"
          aria-label="Person suchen"
          onClick={() => document.getElementById('person-search')?.focus()}
        >
          +
        </button>
      </header>

      <UserSearch
        me={me}
        connections={connections}
        onActiveChange={setSearchActive}
        onChanged={load}
      />

      {error && !searchActive && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!searchActive && (
        <>
          {incoming.length > 0 && (
            <>
              <p className="section-title">Anfragen</p>
              {incoming.map((c) => (
                <div className="row" key={c.id}>
                  <div className="row-name">
                    @{others[otherUserId(c, me)]?.username ?? '…'}
                  </div>
                  <button
                    className="btn-small"
                    onClick={() => handleAccept(c.id)}
                  >
                    Annehmen
                  </button>
                </div>
              ))}
            </>
          )}

          <p className="section-title">Verbindungen</p>

          {accepted.length === 0 && !loading ? (
            <section className="empty">
              <div className="empty-title">Noch keine Verbindung.</div>
              <div className="empty-text">
                Suche nach einer Person,
                <br />
                um einen Chat zu starten.
              </div>
            </section>
          ) : (
            accepted.map((c) => {
              const other = others[otherUserId(c, me)];
              const last = lastMessages[c.id];
              return (
                <button
                  className="chat"
                  key={c.id}
                  onClick={() => navigate(`#/chat/${c.id}`)}
                >
                  <div>
                    <div className="chat-name">@{other?.username ?? '…'}</div>
                    <div className="chat-preview">
                      {last ? last.ciphertext : 'Noch keine Nachrichten.'}
                    </div>
                  </div>
                </button>
              );
            })
          )}

          <div className="logout">
            <button onClick={handleLogout}>Abmelden</button>
          </div>
        </>
      )}
    </main>
  );
}
