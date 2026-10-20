# enough. — Verbesserungs-Roadmap

> **Erstellt:** 2026-10-19
> **Basierend auf:** Code-Audit auf Commit `ca1faf3`
> **Arbeits-Branch:** `arena/fbc464d9-enough`
>
> Die Punkte sind nach Priorität (P0 → P4) sortiert. Abgearbeitete Punkte werden
> mit einem Häkchen markiert. Der Changelog am Ende dokumentiert die Änderungen.

---

## P0 — Sicherheit / Dependencies

- [x] **#1 — `source-map-js` High-Severity-Lücke schließen** (GHSA-68fv-2mgg-jv7q)
- [x] **#2 — `jsdom`-Version prüfen** (bleibt auf 24.1.3, aktuellste v24)
- [x] **#3 — `npm audit`-Gate im CI-Workflow hinzufügen** (ci.yml + deploy.yml)
- [x] **#4 — CSP um `object-src 'none'`, `base-uri 'self'` ergänzen**

---

## P1 — Code-Gesundheit / Wartbarkeit

- [x] **#5 — `Chat.tsx` (2.113 Zeilen) in Custom-Hooks zerlegen**
- [x] **#6 — ESLint-Konfiguration hinzufügen + im CI laufen lassen**
- [x] **#7 — Die zwei expliziten `any` in `src/lib/api.ts` sauber typisieren**
- [x] **#8 — Monolithische `src/index.css` aufteilen**

---

## P2 — Performance / Bundle

- [x] **#9 — Bundle-Splitting konfigurieren (React, Supabase, WASM trennen)**
- [x] **#10 — `.wasm`-Datei im Service-Worker-Precache einschließen**
- [x] **#11 — Routen via `React.lazy()` + `Suspense` lazy-loaden**

---

## P3 — Features / Produkt

- [x] **#12 — Safety-Number/Fingerprint-UI für E2EE-Verifikation**
- [x] **#13 — Explizite Warnung bei Nutzung eines zweiten Geräts**
- [x] **#14 — C-1 Rollback: Monotoner Nachrichten-Counter als Verteidigung**
- [x] **#15 — i18n-Struktur für weitere Sprachen vorbereiten (Doku + Skript)**
- [x] **#16 — Offline-Send-Queue (IndexedDB Outbox)**

~**#17 — Medien/Anhänge**~ — **explizit abgelehnt**: `enough.` bleibt ein reiner Text-Messenger. Keine Bilder, Dateien, Sprache oder Video — weder jetzt noch in zukünftigen Versionen. Der Eintrag bleibt nur zur Dokumentation, warum er NICHT gebaut wird.

---

## P4 — DevEx / Kleinigkeiten

- [x] **#18 — Pre-commit-Hooks (eigener Script ohne Husky-Runtime) einrichten**
- [x] **#19 — Vereinheitlichtes `npm test`-Kommando**
- [x] **#20 — `console.error` in Produktion mit dev-Guard versehen**
- [x] **#21 — Legacy-Fallback-Dokumentation aufräumen + Deprecation-Hinweis**
- [x] **#22 — Lokale Supabase-CLI-Entwicklung dokumentiert** (bereits vorhanden in `docs/self-hosting.md`)
- [x] **#23 — CONTRIBUTING.md erstellen**
- [x] **#24 — Strengere TypeScript-Compiler-Optionen**

---

## Fortschritt: **24 / 24 Punkte abgeschlossen**

Nicht gebaut (explizit abgelehnt):
- **#17** — Medien/Anhänge: `enough.` ist und bleibt **nur Text** (Benutzer-Entscheidung vom 20.10.2026). Weder Bilder noch Dateien, Sprache oder Video werden jemals hinzugefügt.

---

## Changelog

### #1 — `source-map-js` High-Severity-Lücke geschlossen (2026-10-19)
GHSA-68fv-2mgg-jv7q (event-loop DoS via indexierter Source-Map-Offsets,
CVSS 7.5, betraf `source-map-js < 1.2.2`). Mit `npm audit fix` auf
`source-map-js@1.2.2` gehoben. **0 vulnerabilities**.

### #2 — jsdom-Version geprüft
`jsdom@24.1.3` ist aktuellste v24.x. v25/v26 würden Breaking Changes bringen;
die Lücke saß in der Vite/PostCSS-Kette und ist mit #1 geschlossen.

### #3 — npm audit Gate in CI
In `.github/workflows/ci.yml` und `deploy.yml` nach `npm ci` der Step
`npm audit --omit=dev --audit-level=high` eingefügt. DevDeps werden
ausgeschlossen (nie an Besucher ausgeliefert).

### #4 — CSP-Härtung
Meta-CSP in `index.html` um `object-src 'none'` und `base-uri 'self'` ergänzt.

### #6 — ESLint-Konfiguration
`eslint.config.js` (flat config) mit `@eslint/js`, `typescript-eslint` und
`eslint-plugin-react-hooks@6`. Regeln: `no-explicit-any`, `no-unused-vars`
mit `_`-Opt-In, `consistent-type-imports`, `no-console` außerhalb Allow-Liste,
react-hooks Regeln. Toter Code dabei mitbereinigt (unbenutzte Imports,
tote handleAccept/handleCancelRequest in Settings nach v0.5-Umbau, unbenutztes
Prop). Skripte `lint`/`lint:fix` in CI integriert. Ergebnis: **0 errors, 0 warnings**.

### #7 — `any` in `src/lib/api.ts` typisiert
Die zwei `any`-Parameter in `getUnreadCounts`/`batchUnreadFallback` durch
`UnreadQueryClient = Pick<SupabaseClient, 'from'>` ersetzt. Keine `any` mehr
im Produktivcode außerhalb von Kommentaren.

### #9 — Bundle-Splitting
`vite.config.ts` um `build.rollupOptions.output.manualChunks` ergänzt.
Erzeugt separate Chunks: `react-vendor` (44 KB gz), `supabase-vendor`
(56 KB gz), `signal-wasm` (5 KB gz JS-Einstieg, WASM ist separates Asset)
sowie `vendor` für den Rest. Initialer App-Chunk sinkt von 690 KB auf
225 KB (198 KB → 71 KB gzip).

### #10 — WASM im Service-Worker-Precache
`.wasm` in Precache-Whitelist und `isStaticAsset()`-Regex des SW aufgenommen.
Das 798 KB große Signal-WASM (303 KB gzip) wird jetzt bei wiederholten Besuchen
aus dem Cache geladen statt neu aus dem Netz.

### #11 — Routen via `React.lazy()` lazy-loaden
Chat, Register, ForgotPassword, ResetPassword, Settings, Imprint und Privacy
werden per `React.lazy()` + `Suspense` geladen. Home, Login und der Boot-Screen
bleiben synchron. Dafür wurde `settingsCategoryFromRoute` nach
`src/lib/settingsRoute.ts` extrahiert, damit App.tsx den Bottom-Nav-Status
ohne statischen Import des ganzen Settings-Overlays berechnen kann.

### #18 — Pre-commit-Hooks (ohne Husky-Runtime)
`scripts/install-git-hooks.mjs` schreibt bei `npm install` (via `prepare`-Skript)
einen kleinen Shell-Hook nach `.git/hooks/pre-commit`, der `lint-staged`
aufruft. `.lintstagedrc.json` führt ESLint auf geänderten Dateien und
`tsc --noEmit` aus. Keine zusätzliche Runtime-Dependency (husky) nötig.
Bestehende manuelle Hooks werden nicht überschrieben.

### #19 — Vereinheitlichtes `npm test`
`scripts/run-all-tests.mjs` entdeckt alle `test:*`-Skripte aus package.json
und läuft sie sequentiell mit aggregiertem Exit-Code. `npm run test:smoke`
schließt den Smoke-Test mit ein.

### #20 — console.error-Dev-Guard
Der zentrale Error-Logger in `src/lib/errors.ts` schreibt in Production-Builds
nur dann in die Konsole, wenn `localStorage.enoughDebug === '1'` gesetzt ist;
sonst bleibt die Console leer. Entwickler-Builds (`import.meta.env.DEV`)
loggen weiterhin wie bisher. Die Security-sensitiven Logs in E2EEContext und
ErrorBoundary betrafen nur nicht-inhaltliche Metadaten und wurden beibehalten.

### #21 — Legacy-Fallback-Deprecation-Hinweis
README-Markdown im Setup-Abschnitt um eine Hinweisbox ergänzt: Migration 0011
(crypto prekeys) ist das Minimum für funktionierende E2EE; neue Deployments
sollten immer vom Tip ausgehen; Fallbacks für 0005/0008/0013 bleiben vorerst
erhalten, um ältere Backends nicht sofort kaputt zu machen.

### #22 — Lokale Supabase-Entwicklungsdokumentation
`docs/self-hosting.md` existierte bereits mit Anleitung zur Einrichtung einer
eigenen Supabase-Instanz. Keine neuen Änderungen nötig; Punkt ist abgedeckt.

### #23 — CONTRIBUTING.md
Neu erstellt mit: Voraussetzungen, Setup, Kommando-Referenz, Branching/PR-Regeln,
Code-Style-Hinweisen (TS strict, ESLint-Rules, i18n, XSS/CSP), Security-Hinweise
(E2EE-Transportgrenze in `sendMessage()`, Fehler-Behandlung), Lizenz-Hinweis
und Out-of-Scope-Hinweis.

### #24 — Strengere TypeScript-Compiler-Optionen
`tsconfig.json` um `noUncheckedIndexedAccess: true` und
`noImplicitOverride: true` ergänzt. Alle 32 dabei aufgedeckten echten
Type-Fehler wurden behoben:
- `override`-Modifier an ErrorBoundary-Klassenmethoden und CryptoError.cause
- Non-Null-Guards in Regex-Matches (Markdown-Parser, Chat-Route)
- Explizite Array-Index-Guards (useFocusTrap, chatRealtime)
- Definitive Rückgabetypen für `fetchUnread`-Callback
- Defensiver Null-Check in Settings-Kategorie-Parser
- Sichere Destrukturierung mit Non-Null-Assertions an Regex-Gruppen im
  Markdown-Parser (die durch die vorangehende `if (match)`-Prüfung
  abgesichert sind)

`tsc --noEmit`, ESLint, Build und Smoke laufen grün.

### #15 — i18n-Struktur für weitere Sprachen vorbereitet (2026-10-19)
- `scripts/check-i18n.mjs` (neues Skript, via `npm run i18n:check` aufrufbar) lädt
  `src/i18n/translations.ts` direkt per Node `--experimental-strip-types` (mit
  minimalen Browser-Global-Stubs für `window`/`localStorage`/`document`) und
  vergleicht jeden Sprachen-Baum Blatt für Blatt mit dem englischen Wörterbuch.
  Fehlende Keys oder verwaiste Keys (die es in EN nicht mehr gibt) führen zu
  Exit-Code 1. Damit sind fragile Regex-Parser überflüssig.
- CI (`.github/workflows/ci.yml`) führt den Check nach `npm run lint` aus, so
  dass PRs mit veralteten Übersetzungen scheitern.
- `docs/i18n.md` neu erstellt: Struktur der i18n-Dateien, Anleitung zum
  Hinzufügen einer neuen Sprache, Invarianten (keine hardcodierten Strings in
  JSX, Single-Pass-Interpolation, EN-Fallback, Repository-Texte bleiben
  Englisch), Test-Instruktionen.
- Die Dokumentation erwähnt explizit die Interpolation-Sicherheit: `t()`
  ersetzt `{name}`-Platzhalter in einem einzigen Left-to-Right-Pass, so dass
  Parameter-Werte niemals erneut als Template gescannt werden — das verhindert
  Rekursion auch wenn ein Parameter zufällig `{…}` enthält.

### #13 — Multi-Device-Warnbanner (2026-10-19)
- `src/lib/e2ee/prekeys-api.ts`: neue Funktion `listUserDevices(userId)`, die
  alle `crypto_devices`-Zeilen einer User-Id zurückgibt.
- `src/hooks/useDeviceCount.ts`: neuer Hook, der nach Mount (und erst wenn der
  Browser online ist — kein zusätzlicher Request im Offline-Modus) die
  Geräteliste abfragt und einen `{ count, isMultiDevice }`-State bereitstellt.
  Er berücksichtigt die lokale `deviceId`, damit ein frisch resetteter lokaler
  Speicher das Banner nicht fälschlicherweise auslöst.
- `src/components/MultiDeviceBanner.tsx`: schmaler amberfarbener Status-Banner
  (role="status") mit dem Hinweis, dass Nachrichten gerätespezifisch
  Ende-zu-Ende verschlüsselt sind und daher auf Geräten ohne eigenständige
  Multi-Device-Sessions noch nicht überall lesbar sein können. Der Banner
  blockiert kein Senden und verändert keinen Session-State — rein informativ.
- Eingebunden in `Home.tsx` und `Chat.tsx` direkt unter dem bestehenden
  `OfflineBanner`.
- i18n: neue Namespace `multiDevice.banner` in EN und DE (362 Keys,
  `npm run i18n:check` grün). Offline-Rauchtests stellen sicher, dass der
  neue Hook im Offline-Modus keine zusätzlichen Netzwerk-Requests auslöst
  (2 zuvor fehlschlagende Offline-Tests passieren wieder).

### #14 — C-1 Rollback-Schutz: monotone Sequenznummern (2026-10-19)
Defense-in-depth gegen serverseitiges Replay/Rollback von Nachrichten nach
etablierter Session (roadmap C-1).
- `src/lib/e2ee/seq-counter.ts` (neu): persistiert pro `(lokalUser, peer,
  localDeviceId)` einen ausgehenden Zähler und pro `(lokalUser, sender,
  senderDeviceId, localDeviceId)` einen eingehenden High-Water-Mark (hwm)
  in IndexedDB via `crypto/storage.ts` (neuer Record-Typ
  `RECORD_SEQ_COUNTERS`). Löschen des User-Crypto-States wirft den
  Zählerstand mit weg.
- Envelope auf v2 angehoben: jede von uns erzeugte Nachricht trägt ein
  zusätzliches Feld `c` (ganzzahlig ≥ 1), das beim Versenden VOR der
  Verschlüsselung inkrementiert und persistiert wird, so dass auch bei
  Transportfehlern keine Doppelvergabe entsteht (Lücken sind erlaubt,
  Wiederverwendung nicht). V1-Envelopes (ältere Clients vor diesem Patch)
  werden weiterhin akzeptiert — sie nehmen nur nicht am Rollback-Schutz
  teil und bewegen den hwm nicht.
- Auf der Empfangsseite wird `c` unter dem gleichen Web-Lock + Per-User-Mutex
  geprüft, der auch die Ratchet-Session schützt (keine Race-Conditions
  zwischen zwei gleichzeitig eintreffenden Nachrichten):
    * WHISPER mit `c <= hwm` → `CryptoError('ROLLBACK_DETECTED')`, Nachricht
      wird nicht entschlüsselt (fail closed);
    * PREKEY (Session-Neuaufbau) → akzeptiert, setzt den hwm auf den neuen
      Wert, da eine neue Kette beginnt;
    * fehlendes oder unplausibles `c` (0, negativ, nicht-ganzzahlig, NaN) →
      abgelehnt.
- `resetPeerSecurityState` (C2-Identity-Recovery) setzt auch den
  Inbound-hwm für diesen Peer zurück, damit nach einer expliziten
  Vertrauensstellungszurücksetzung die nächste PREKEY-Nachricht eine neue
  Kette sauber beginnen kann.
- `src/lib/e2ee/session-manager.ts`: `parseEnvelope` akzeptiert v1 und v2,
  `encryptForPeer` stempelt `c`, `decryptFromPeer` prüft und committet den
  Zähler. `receiveEstablishBytes` (neu) liefert rohe Bytes, damit die
  Entschlüsselung VOR der Counter-Freigabe abgeschlossen ist.
- `src/lib/e2ee/__tests__/seq-counter.test.mjs` (neu, 8 Tests): monotones
  Inkrement, Isolation zwischen Peers/Usern, Replay-Ablehnung,
  PREKEY-Reset, Malformed-C-Ablehnung, v1-Backward-Compat,
  `resetInboundFor`-Selektivität, Per-Sender-Isolation.
- Bestehender MF12-Test an v2 als gültige Version angepasst.
- Gesamte Test-Suite läuft grün: 247 Crypto-Tests, 65 Engine-Integrations-
  Tests, Smoke, Lint, Typecheck, Build.

### #8 — Monolithische `src/index.css` aufgeteilt (2026-10-20)
- `src/index.css` (3.380 Zeilen) ist jetzt ein schlanker Entry (27 Zeilen), der
  24 nach Themen geordnete Partials via `@import` einbindet. Die Aufteilung
  folgt den vorhandenen `/* ---------- … ---------- */`-Kommentarblöcken der
  Originaldatei 1:1, so dass Selektoren in **genau der gleichen Reihenfolge**
  im zusammengefügten Stylesheet landen — keine Spezifitäts-Regressionen,
  keine doppelt angewandten Regeln.
- Partials unter `src/styles/`:
  - `01-preamble.css`, `02-tokens-warm-light.css`, `03-tokens-soft-warm-dark.css`
  - `04-base.css`, `05-app-stage.css`, `06-shared-controls.css`
  - `07-auth.css`, `08-home-chat-overview.css`, `09-avatar.css`
  - `10-chat-rows.css`, `11-loading-skeleton.css`, `12-empty-error-state.css`
  - `13-settings.css`, `14-settings-overlay.css`, `15-primary-navigation.css`
  - `16-dialogs.css`, `17-chat.css`, `18-legal.css`
  - `19-responsive.css`, `20-markdown-in-messages.css`, `21-account-delete.css`
  - `22-reduced-motion.css`, `23-pwa.css`, `24-offline.css`
- `scripts/split-css.cjs` enthält die Abschnittsgrenzen für den Fall, dass die
  Aufteilung erneut aus einem monolithischen File reproduziert werden muss.
- Alle 17 Testdateien, die bisher `src/index.css` per `readFileSync` direkt
  regex-gescannt haben (Accessibility, Bottom-Nav, Danger/Toggle/Separator
  Contrast, Home/Chat-Overview/Loading/Scroll-Down/PWA/Screen-Transition/
  Settings-Layout/Settings-People/Privacy-Routing), importieren jetzt den
  Helper `src/lib/__tests__/read-styles.mjs`. `readStyles()` löst die
  `@import './styles/...'`-Direktiven auf und liefert den kompletten
  zusammengefügten CSS-String, so dass die Source-Level-Assertions 1:1 weiter
  funktionieren.
- Verifikationslauf: Typecheck, ESLint, `vite build` (CSS-Asset 41,76 KB /
  8,20 KB gzip — unverändert gegenüber dem Monolithen), Smoke-Test, alle
  Unit-Suites (247 Crypto, 65 Engine, 36 i18n, 8 Seq-Counter, 19 A11y,
  30 PWA-Chrome, 14 Bottom-Nav, 101 Home, 18 E2EE-State, 59 Privacy,
  Kontrast-, Toggle-, Listen-, Transition-Tests) grün.

### #12 — Safety-Number/Fingerprint-UI (2026-10-20)
- `src/lib/e2ee/safetyNumber.ts` (neu): berechnet einen für beide Seiten
  identischen Fingerabdruck aus den Ed25519-Identity-Public-Keys. Die Keys
  werden lexikografisch sortiert (Alice und Bob sehen also die gleiche
  Nummer), per SHA-256 gehasht und als 6 Gruppen zu je 5 Dezimalziffern
  formatiert (ca. 30 Bit Entropie — im Stil von Signal Safety Numbers, kurz
  genug zum mündlichen Vergleich). Das Modul ist REIN UI; es beeinflusst
  niemals die TOFU-/Trust-Entscheidung — diese bleibt ausschließlich in
  `session-manager.applyPeerTrust` / `resetPeerSecurityState`, die auch ohne
  diese Anzeige weiterhin fail-closed laufen.
- `E2EESessionManager.peerIdentityKey(peerUserId)` (neu): UI-only-Methode,
  die den gespeicherten base64-Identity-Key eines Peers aus
  `peer-trust:<peer>` liest. Niemals in sicherheitsrelevanten Pfaden
  verwendet; ein fehlender/kaputter Datensatz gibt einfach `null` zurück
  statt zu werfen.
- `src/hooks/useSafetyNumber.ts` (neu): Hook, der lokal und beim Peer die
  Identity-Public-Keys abholt, die Nummer berechnet und `null` zurückgibt,
  solange einer der Keys noch nicht verfügbar ist (Initialisierung), bei
  My-Notes/ended-Chats/fehlgeschlagenem Engine oder wenn die E2EE noch
  nicht ready ist.
- Chat-Header: unter dem `@username` wird in einem dezenten monospace-Stil
  (`.chat-safety-number`) die Sicherheitsnummer angezeigt, wenn es sich um
  eine Peer-Unterhaltung mit etabliertem E2EE-Status handelt. Der Lock-Icon
  bleibt als kompakte Kennzeichnung erhalten; die Nummer ist via
  `aria-label` und `title` für Screenreader und Tooltips zugänglich.
- i18n: neue Keys `chat.safetyNumberLabel` / `chat.safetyNumberHint` in EN
  und DE; `npm run i18n:check` grün (364 Keys).
- Tests: `src/lib/e2ee/__tests__/safety-number.test.mjs` (4 Tests) —
  Symmetrie (a+b ≡ b+a), Format (sechs 5er-Gruppen), Verschiedenheit bei
  unterschiedlichen Keys, Ablehnung von nicht-32-Byte-Schlüsseln.
  Crypto-Suite jetzt 251 Tests grün; Smoke, Build, Typecheck, ESLint grün.

### #16 — Offline-Send-Queue (IndexedDB Outbox) (2026-10-20)
- `src/lib/outbox.ts` (neu): AES-256-GCM-versiegelte Outbox unter dem
  bestehenden Schlüssel `offline:outbox` im gleichen IndexedDB-Store
  (`enough-crypto` → `state`) und unter dem gleichen non-extractable
  Sealing-Key wie Offline-Snapshots und Message-Cache. Die AAD bindet
  `userId` + Record-Key; Manipulationen werden einzeln ignoriert
  (fail-closed, keine fabrizierten Klartexte im UI). Exports:
  `enqueueMessage`, `loadOutbox`, `removeFromOutbox`, `updateOutboxError`,
  `outboxForConnection`. `deleteUserCryptoState` wischt die Queue über den
  bereits vorhandenen `offline:`-Präfix-Scan mit.
- `src/hooks/useOutbox.ts` (neu): Hook, der bei Online-Übergängen (und bei
  Mount, wenn online) die FIFO-Queue der aktiven Konversation draint —
  jeder Eintrag läuft durch den normalen `prepareSend` → `sendMessage`
  Pfad, also gelten die gleichen E2EE-Garantien wie online. Bei Erfolg
  wird die Platzhalter-Blase (`outbox-*`) durch die echte Server-Meldung
  ersetzt; bei Fehler (Blockierung, Prekey-Fehler etc.) wird der Eintrag
  als fehlgeschlagen markiert, der Drain stoppt und der Fehler wird im
  Chat-Banner angezeigt.
- Chat.tsx: Composer ist jetzt **aktiviert**, wenn E2EE-Ready und offline
  (Nachrichten gehen in die Queue). Server-abhängige Aktionen (Menü,
  My-Notes, nicht-ready-E2EE) bleiben wie bisher deaktiviert. Outbox-
  Platzhalterblasen werden mit der bestehenden `.message.pending`-Optik
  (pulsierend/kursiv) gerendert und sind nicht antippbar (keine
  Long-Press-Aktion auf einer noch nicht zugestellten Nachricht).
- Smoke-Test `offline: sending is disabled` angepasst: er prüft jetzt,
  dass im Offline-Zustand das Offline-Banner erscheint und server-
  abhängige Header-Aktionen deaktiviert sind — statt pauschal ein
  deaktiviertes Eingabefeld zu verlangen, was der neuen UX
  widerspricht.
- Tests: `src/lib/__tests__/outbox.test.mjs` (8 Tests, Q1–Q8) —
  enqueue/load Round-Trip, FIFO-Reihenfolge, Verbindungsfilter,
  remove/update, Account-Isolation, Manipulationserkennung (Bitflip im
  verschlüsselten Block → Eintrag wird verworfen) und Löschung via
  `deleteUserCryptoState`. Alle Gates grün: tsc, lint, build, smoke,
  test:crypto (251), test:outbox (8), i18n:check (364 Keys).

### #5 — Chat.tsx in Custom-Hooks zerlegt (2026-10-20)
Chat.tsx war mit 2.152 Zeilen (nach Einbau der Outbox-Hook-Integration) der
größte Wartungs-Blocker der Codebase. Die Action-Handler wurden in zwei
fokussierte, typ-sichere Custom Hooks extrahiert — ohne irgendeine
Verhaltensänderung:
- `src/hooks/useConnectionActions.ts` (148 Zeilen): Accept / Decline /
  Block / Unblock / Cancel / Re-request / Delete-Chat / Clear-My-Notes.
  Konsolidiert alle verbindungsbezogenen Mutationen inkl. optimistischer
  UI-Updates und Rollback bei Netzwerkfehlern.
- `src/hooks/useMessageActions.ts` (194 Zeilen): Delete-for-Everyone /
  Delete-for-Me / Copy-to-Clipboard sowie die C2-Peer-Reset- und
  Device-Reset-Handler (die beiden einzigen Aufrufstellen von
  `resetPeerSecurityState` und `resetDeviceState`, inkl. Lifecycle-Token-
  Guards und Fallback für fehlende Async-Clipboard-API).
Die Hooks besitzen KEINEN eigenen State; sie erhalten den aktuellen
Snapshot und die React-Setter von Chat.tsx, sodass alle abgeleiteten
Werte und Dialog-Flags an einer Stelle bleiben. Neun nur für die
Handler benötigte API-Imports wurden aus Chat.tsx entfernt.
Ergebnis: Chat.tsx von 2.152 auf 1.940 Zeilen (-212, ~10 %),
Verantwortlichkeiten klarer getrennt, alle Gates weiterhin grün: tsc,
lint (0 warnings), build, smoke, test:crypto, test:outbox, i18n:check.
Das Chat JSX, die Lade-Effekte, die Scroll-Anker-Logik, die Realtime-
Merge-Pipeline und der Outbox-Drain verbleiben bewusst in Chat.tsx — sie
sind eng mit dem Komponenten-Lifecycle verknüpft und ein weiterer Split
brächte keinen ausreichenden Nutzen gegen das Regressionsrisiko.

### #17 — Medien/Anhänge: abgelehnt (nur Text)
Der Punkt #17 (Bilder/Dateien/Sprache/Video) wird **nicht** gebaut.
Benutzer-Entscheidung vom 20.10.2026: `enough.` ist ein reiner
Text-Messenger und soll das auch bleiben. Jegliche
Attachment-Funktionalität widerspricht dem Projektziel — keine
Planung, keine Tickets, keine Implementierung, weder in v0.6 noch in
zukünftigen Versionen.
