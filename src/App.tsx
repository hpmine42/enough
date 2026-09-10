import { useAuth } from './context/AuthContext';
import { useHashRoute } from './lib/router';
import Chat from './components/Chat';
import Home from './components/Home';
import Login from './components/Login';
import Register from './components/Register';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import Settings, { settingsCategoryFromRoute } from './components/Settings';
import BottomNav from './components/BottomNav';
import Imprint from './components/Imprint';
import Privacy from './components/Privacy';
import LegalFooter from './components/LegalFooter';
import ThemeButton from './components/ThemeButton';
import { t, useLang } from './i18n';

export default function App() {
  const { configured, loading, user, recovery } = useAuth();
  const route = useHashRoute();
  // Re-render the whole tree on language changes so every t() string updates
  // without a page reload.
  useLang();

  // Public legal screens (Imprint & Privacy) must remain reachable without a
  // configured backend, an account, or a completed authentication check.
  if (route.startsWith('#/impressum') || route.startsWith('#/imprint')) {
    return <Imprint />;
  }
  if (
    route.startsWith('#/datenschutz') ||
    route.startsWith('#/privacy') ||
    route.startsWith('#/settings/privacy')
  ) {
    return <Privacy />;
  }

  if (!configured) {
    return (
      <>
        <main className="config-screen">
          <section className="brand">
            <h1>enough.</h1>
          </section>
          <p>{t('errors.notConfigured')}</p>
          <p>{t('errors.notConfiguredHint')}</p>
          <LegalFooter className="config-legal-footer" />
        </main>
        <ThemeButton className="floating" />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <main className="loading">{t('loading')}</main>
        <ThemeButton className="floating" />
      </>
    );
  }

  // Password-reset flow: the user followed a recovery link.
  if (recovery) {
    return <ResetPassword />;
  }

  if (!user) {
    if (route.startsWith('#/register')) return <Register />;
    if (route.startsWith('#/forgot')) return <ForgotPassword />;
    if (route.startsWith('#/reset')) return <ResetPassword />;
    return <Login />;
  }

  // Both overlay destinations (Settings and the dedicated people-search
  // screen) dim the stage behind them.
  const overlayOpen = route.startsWith('#/settings') || route.startsWith('#/new-chat');
  const chatMatch = route.match(/^#\/chat\/(.+)$/);
  // Destination the bottom navigation marks as active — same routing as
  // before, just derived here because the bar is a top-level layer.
  const active: 'chats' | 'new-chat' | 'settings' = route.startsWith('#/new-chat')
    ? 'new-chat'
    : route.startsWith('#/settings')
      ? 'settings'
      : 'chats';
  // A Settings subpage is one navigation level below the bar's own
  // destinations, so it covers the bar (which then leaves the accessibility
  // tree and the tab order).
  const navCovered = settingsCategoryFromRoute(route) !== null;

  return (
    <>
      {/* Application content: free to animate (screens slide in, the stage
          dims behind an overlay) — the navigation is NOT inside it. */}
      <div className={`app-stage${overlayOpen ? ' shifted' : ''}`}>
        {chatMatch ? (
          <Chat connectionId={decodeURIComponent(chatMatch[1])} />
        ) : (
          <Home />
        )}
      </div>
      {/* Overlay: slides in with a transform — the navigation is NOT inside
          it either, so it cannot inherit that motion. */}
      <Settings />
      {/* Persistent top-level navigation layer: a fixed sibling above both
          (see `.bottom-nav` in index.css). It stays anchored to the viewport
          while screens and overlays animate underneath it. A chat is a
          focused full-screen conversation and has no bar. */}
      {!chatMatch && <BottomNav active={active} covered={navCovered} />}
    </>
  );
}
