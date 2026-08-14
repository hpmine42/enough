import { useAuth } from './context/AuthContext';
import { useHashRoute } from './lib/router';
import Chat from './components/Chat';
import Home from './components/Home';
import Login from './components/Login';
import Register from './components/Register';
import ThemeToggle from './components/ThemeToggle';

export default function App() {
  const { configured, loading, user } = useAuth();
  const route = useHashRoute();

  if (!configured) {
    return (
      <>
        <main className="config-screen">
          <section className="brand">
            <h1>enough.</h1>
          </section>
          <p>Die Verbindung zur Datenbank ist nicht konfiguriert.</p>
          <p>
            Bitte lege eine <code>.env</code>-Datei mit{' '}
            <code>VITE_SUPABASE_URL</code> und{' '}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> an (siehe{' '}
            <code>.env.example</code>).
          </p>
        </main>
        <ThemeToggle />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <main className="loading">…</main>
        <ThemeToggle />
      </>
    );
  }

  if (!user) {
    return (
      <>
        {route.startsWith('#/register') ? <Register /> : <Login />}
        <ThemeToggle />
      </>
    );
  }

  const chatMatch = route.match(/^#\/chat\/(.+)$/);
  if (chatMatch) {
    return <Chat connectionId={decodeURIComponent(chatMatch[1])} />;
  }

  return (
    <>
      <Home />
      <ThemeToggle />
    </>
  );
}
