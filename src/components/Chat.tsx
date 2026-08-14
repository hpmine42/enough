import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../lib/router';
import { getConnection, getMessages, getProfiles, sendMessage } from '../lib/api';
import { otherUserId } from '../lib/helpers';
import { supabase } from '../lib/supabase';
import { Message, Profile } from '../lib/types';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';
import ThemeToggle from './ThemeToggle';

export default function Chat({ connectionId }: { connectionId: string }) {
  const { user } = useAuth();
  const [peer, setPeer] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const me = user?.id ?? '';

  useEffect(() => {
    if (!me) return;
    let active = true;
    setLoading(true);

    (async () => {
      const conn = await getConnection(connectionId);
      if (!active) return;

      const isMine =
        conn && (conn.user_a === me || conn.user_b === me);
      if (!conn || !isMine || conn.status !== 'accepted') {
        setValid(false);
        setLoading(false);
        return;
      }

      setValid(true);
      const peerId = otherUserId(conn, me);
      const profiles = await getProfiles([peerId]);
      if (active) setPeer(profiles[peerId] ?? null);

      const msgs = await getMessages(connectionId);
      if (active) {
        setMessages(msgs);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [connectionId, me]);

  useEffect(() => {
    if (!supabase || !valid) return;
    const client = supabase;
    const channel = client
      .channel(`messages-${connectionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `connection_id=eq.${connectionId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg].sort((a, b) =>
              a.created_at.localeCompare(b.created_at),
            );
          });
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [connectionId, valid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading]);

  async function handleSend(text: string) {
    setSending(true);
    setError(null);
    const { message, error } = await sendMessage(connectionId, me, text);
    setSending(false);
    if (error) {
      setError(error);
      return;
    }
    if (message) {
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
    }
  }

  return (
    <main className="chat-screen">
      <header className="chat-header">
        <button
          className="back"
          aria-label="Zurück"
          onClick={() => navigate('#/')}
        >
          ←
        </button>
        <div className="username">@{peer?.username ?? '…'}</div>
      </header>

      {loading ? (
        <div className="chat-loading">…</div>
      ) : !valid ? (
        <div className="chat-loading">
          Diese Verbindung ist nicht verfügbar.
        </div>
      ) : (
        <>
          <section className="messages">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} mine={m.sender_id === me} />
            ))}
            <div ref={bottomRef} />
          </section>

          {error && (
            <p className="error chat-error" role="alert">
              {error}
            </p>
          )}

          <MessageComposer onSend={handleSend} disabled={sending} />
        </>
      )}

      <ThemeToggle variant="chat" />
    </main>
  );
}
