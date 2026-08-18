import { useAuth } from './context/AuthContext';
import { useHashRoute } from './lib/router';
import Chat from './components/Chat';
import Home from './components/Home';
import Login from './components/Login';
import Register from './components/Register';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import Settings from './components/Settings';
import Imprint from './components/Imprint';
import LegalFooter from './components/LegalFooter';
import ThemeButton from './components/ThemeButton';
import { t, useLang } from './i18n';

export default function App() {
  const { configured, loading, user, recovery } = useAuth();
  const route = useHashRoute();
  // Re-render the whole tree on language changes so every t() string updates
  // without a page reload.
  useLang();

  // The imprint is public and must remain reachable without a configured
  // backend, an account, or a completed authentication check.
  if (route.startsWith('#/impressum') || route.startsWith('#/imprint')) {
    return <Imprint />;
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

  const settingsMatch = route.startsWith('#/settings');
  const chatMatch = route.match(/^#\/chat\/(.+)$/);

  return (
    <>
      <div className={`app-stage${settingsMatch ? ' shifted' : ''}`}>
        {chatMatch ? (
          <Chat connectionId={decodeURIComponent(chatMatch[1])} />
        ) : (
          <Home />
        )}
      </div>
      <Settings />
    </>
  );
}
