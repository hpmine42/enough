import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { checkSchemaCompatibility } from './lib/api';
import { bootstrapTheme, watchSystemTheme } from './lib/theme';
import './index.css';

// Apply the persisted/system theme before first paint (also done by an inline
// script in index.html; this covers every entry path).
bootstrapTheme();
watchSystemTheme();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProvider>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </AuthProvider>
  </StrictMode>,
);

// Developer aid: warn when the DB migration is missing (see docs/MIGRATIONS.md).
checkSchemaCompatibility();
