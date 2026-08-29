import { Component, ReactNode } from 'react';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Last-resort boundary around the whole app: if any component throws during
 * render, show a friendly reload screen instead of a blank white page
 * (audit P2-2). It sits outside the providers so a failure in any provider,
 * screen or child is caught.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Minimal diagnostics for the developer console — name and message only,
    // never request bodies, credentials or tokens (mirrors errors.ts).
    const e = error as { name?: string; message?: string } | null;
    console.error('enough. render error:', {
      name: e?.name ?? null,
      message: e?.message ?? null,
    });
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="config-screen">
          <section className="brand">
            <h1>enough.</h1>
          </section>
          <p>{t('errors.crashTitle')}</p>
          <p>{t('errors.crashHint')}</p>
          <button type="button" className="btn-primary" onClick={this.reload}>
            {t('errors.reload')}
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
