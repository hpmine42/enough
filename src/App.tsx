import { Suspense, lazy, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useHashRoute } from './lib/router';
import type { ChatOpenIdentity } from './lib/types';
import Home from './components/Home';
import Login from './components/Login';
import { inertWhen } from './components/useScreenFocus';
import { settingsCategoryFromRoute } from './lib/settingsRoute';
import BottomNav from './components/BottomNav';
import LegalFooter from './components/LegalFooter';
import ThemeButton from './components/ThemeButton';
import { t, useLang } from './i18n';

// Route-level code splitting: screens not shown on the first paint are
// lazy-loaded so they do not inflate the initial bundle. Chat, Home and
// Login are kept synchronous because they are the entry points; E2EE
// context (signal-wasm) is pulled in by AuthProvider regardless.
const Chat = lazy(() => import('./components/Chat'));
const Register = lazy(() => import('./components/Register'));
const ForgotPassword = lazy(() => import('./components/ForgotPassword'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));
const Settings = lazy(() => import('./components/Settings'));
const Imprint = lazy(() => import('./components/Imprint'));
const Privacy = lazy(() => import('./components/Privacy'));

// Tiny fallback shown while a lazy chunk is loading. Same quiet visual as
// the boot state so lazy navigation never shows a spinner or flashes.
function RouteFallback() {
  return <main className="loading" role="status" aria-label={t('appLoading')} />;
}

export default function App() {
  const { configured, loading, user, recovery } = useAuth();
  const route = useHashRoute();
  // Home already resolved the identity shown in each finished overview row.
  // Keep the selected row across the Home -> Chat remount so the chat header
  // can use those exact data on its first render instead of loading them again.
  const [chatOpenIdentity, setChatOpenIdentity] = useState<ChatOpenIdentity | null>(null);
  // Re-render the whole tree on language changes so every t() string updates
  // without a page reload.
  useLang();

  // Public legal screens (Imprint & Privacy) must remain reachable without a
  // configured backend, an account, or a completed authentication check.
  if (route.startsWith('#/impressum') || route.startsWith('#/imprint')) {
    return <Suspense fallback={<RouteFallback />}><Imprint /></Suspense>;
  }
  if (
    route.startsWith('#/datenschutz') ||
    route.startsWith('#/privacy') ||
    route.startsWith('#/settings/privacy')
  ) {
    return <Suspense fallback={<RouteFallback />}><Privacy /></Suspense>;
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
    // Quiet boot state: a calm empty viewport with no visible text, no
    // ellipsis and no animation. Assistive technology gets the labelled
    // status region; sighted users see nothing until the first real screen.
    return (
      <>
        <main className="loading" role="status" aria-label={t('appLoading')} />
        <ThemeButton className="floating" />
      </>
    );
  }

  // Password-reset flow: a recovery session exists — either the user
  // verified the one-time recovery code or followed a legacy reset link.
  if (recovery) {
    return <Suspense fallback={<RouteFallback />}><ResetPassword /></Suspense>;
  }

  if (!user) {
    if (route.startsWith('#/register')) return <Suspense fallback={<RouteFallback />}><Register /></Suspense>;
    if (route.startsWith('#/forgot')) return <Suspense fallback={<RouteFallback />}><ForgotPassword /></Suspense>;
    if (route.startsWith('#/reset')) return <Suspense fallback={<RouteFallback />}><ResetPassword /></Suspense>;
    return <Login />;
  }

  // Both overlay destinations (Settings and the dedicated people-search
  // screen) dim the stage behind them.
  const overlayOpen = route.startsWith('#/settings') || route.startsWith('#/new-chat');
  const chatMatch = route.match(/^#\/chat\/(.+)$/);
  const chatConnectionId = chatMatch?.[1] ? decodeURIComponent(chatMatch[1]) : null;
  const openingIdentity =
    chatConnectionId &&
    chatOpenIdentity?.accountId === user.id &&
    chatOpenIdentity.connection.id === chatConnectionId
      ? chatOpenIdentity
      : null;
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
      <div className={`app-stage${overlayOpen ? ' shifted' : ''}`}
        data-focus-region="stage"
        aria-hidden={overlayOpen || undefined}
        {...inertWhen(overlayOpen)}
      >
        {chatConnectionId ? (
          // One account/connection owns the entire Chat instance, including the
          // first committed frame. Passive resets cannot isolate that frame.
          <Suspense fallback={<RouteFallback />}>
            <Chat key={`${user.id}:${chatConnectionId}`} connectionId={chatConnectionId} initialIdentity={openingIdentity} />
          </Suspense>
        ) : (
          <Home onOpenChat={setChatOpenIdentity} />
        )}
      </div>
      {/* Overlay: slides in with a transform — the navigation is NOT inside
          it either, so it cannot inherit that motion. */}
      <Suspense fallback={null}><Settings /></Suspense>
      {/* Persistent top-level navigation layer: a fixed sibling above both
          (see `.bottom-nav` in index.css). It stays anchored to the viewport
          while screens and overlays animate underneath it. A chat is a
          focused full-screen conversation and has no bar. */}
      {!chatMatch && <BottomNav active={active} covered={navCovered} />}
    </>
  );
}
