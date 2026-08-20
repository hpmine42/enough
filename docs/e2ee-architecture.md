# enough. E2EE Architecture Decision

**Status:** Decision document for E2EE-1A (Compatibility Spike) and E2EE-1B (Key Infrastructure).
**Date:** 2026-08-19
**Version:** v0.2 (single-device, no multi-device, no key backup)

> **TL;DR — Empfehlung:** enough. verwendet **keine selbst-entworfene Messenger-Kryptografie** und kann derzeit (Stand August 2026) **keine der untersuchten Signal-Protokoll-Bibliotheken** sauber im Browser betreiben. Wir etablieren deshalb eine saubere **Crypto-Infrastruktur-Schicht** auf Basis der **Web Crypto API** (Identity Keys, PreKey-Persistenz, IndexedDB-Storage, Public-Key-Serialisierung) — aber **ohne** selbst Double-Ratchet/X3DH/PQXDH zu implementieren. Der produktive Nachrichtenfluss bleibt vorerst Klartext. Sobald eine auditierbare, browserfaehige Signal-kompatible Bibliothek verfuegbar ist (z.B. offizielle libsignal WASM-Bindings oder eine stabilisierte vodozemac-JS-Bindung), wird sie hinter dem abstrahierten Crypto-Layer eingehangen.

---

## 1. Threat Model

### Aktive Angreifer

| Angreifer                                   | Faehigkeiten                                                                                             |
|---------------------------------------------|----------------------------------------------------------------------------------------------------------|
| Supabase-Administrator                      | Lese-/Schreibzugriff auf alle DB-Zeilen inkl. `messages.ciphertext`, Realtime-Mitschnitt auf DB-Seite    |
| Datenbank-Leak / SQL-Injection              | Abfluss aller gespeicherten Ciphertexts, Public-Keys und Metadaten                                       |
| TLS-Mitschnitt / TLS-Kompromittierung       | Lesen des zwischen Client und Supabase laufenden Traffics                                                |
| Kompromittierter Realtime-Kanal             | Mitlesen und Injizieren von Nachrichten in laufende Realtime-Sessions                                    |
| Rogue Client mit gueltigem Supabase-Auth    | Lesen aller Nachrichten, zu denen RLS Zugriff gewaehrt (also Connections des Users)                      |

### Nicht im Scope von E2EE-1

| Angreifer                                        | Warum nicht                                                                     |
|--------------------------------------------------|---------------------------------------------------------------------------------|
| Kompromittiertes Endgeraet                       | Kein Browser-basiertes Kryptosystem kann davor schuetzen                        |
| XSS / manipuliertes JavaScript                   | Gleicher Trust-Bereich wie legitimer Code — kann auf Schluessel zugreifen       |
| Schaedliche Browser-Erweiterungen                | Koennen Code und DOM mitlesen                                                   |
| Screenshot / physischer Zugriff                  | Ausserhalb der Software-Kontrolle                                               |

---

## 2. Sicherheitsziele

1. **Vertraulichkeit gegenueber Supabase:** Weder Datenbank noch Realtime noch ein Datenbank-Leak darf Klartext-Nachrichten lesen koennen.
2. **Forward Secrecy:** Kompromittierung eines langfristigen Schluessels darf vergangene Sitzungen nicht offenlegen. (Ziel fuer spaetere Phase — noch nicht implementiert.)
3. **Post-Compromise Security (Future Secrecy):** Nach Kompromittierung eines Sitzungsschluessels sollen zukuenftige Nachrichten wieder sicher sein. (Ziel fuer spaetere Phase.)
4. **Asynchrone Kommunikation:** Ein Benutzer muss offline sein koennen; der andere muss trotzdem eine Sitzung aufbauen und eine Nachricht senden koennen (PreKey-Modell).
5. **Authentizitaet:** Empfaenger muss sicher sein, dass eine Nachricht vom behaupteten Absender stammt (via Signatur/Key-Agreement).
6. **Minimale Angriffsflaeche:** Geheime Schluessel verlassen das Geraet nie als Klartext und werden nicht in React-State, URL, Cookies oder `localStorage` gehalten.
7. **Trennung der Identitaeten:** Supabase-User-ID, Connection-ID und kryptographische Identitaet sind unabhaengige Ebenen.

### Explizit nicht durch E2EE abgedeckt

- RLS / Zugriffskontrolle (bleibt bei Supabase).
- Transport-Verschluesselung (bleibt bei TLS).
- Geraete-Kompromittierung (siehe Threat Model).
- Metadata-Hiding (wer mit wem wann kommuniziert) — weiterhin sichtbar auf DB-Ebene.
- Push-Benachrichtigungen — es gibt keine.

---

## 3. Browser-Anforderungen

### Minimalanforderungen

| Feature                       | Zweck                                  | Verfuegbarkeit (2026)                                       |
|-------------------------------|----------------------------------------|-------------------------------------------------------------|
| `crypto.subtle` (Web Crypto)  | Alle kryptographischen Primitive       | Alle modernen Browser (Chrome >= 37, FF >= 34, Safari >= 11, Edge >= 79) |
| **Ed25519** in `SubtleCrypto` | Identity Key (Signaturen)              | Chrome >= 137 (Mai 2025), Firefox >= 130, Safari >= 17       |
| **X25519** in `SubtleCrypto`  | ECDH Key Agreement                     | Chrome >= 113, Firefox >= 130, Safari >= 17.2               |
| AES-GCM                       | Nachrichtenverschluesselung            | Alle modernen Browser                                       |
| HKDF                          | Schluesselableitung                    | Alle modernen Browser                                       |
| `non-extractable` `CryptoKey` | Schutz privater Schluessel vor Export  | Alle modernen Browser                                       |
| IndexedDB                     | Persistenz der Schluessel/Sessions     | Alle modernen Browser                                       |
| `crypto.getRandomValues`      | Sichere Zufallszahlen                  | Alle modernen Browser                                       |

### Graceful-Degradation

- Browser ohne `crypto.subtle` oder ohne Ed25519/X25519 **duerfen nicht in den E2EE-Pfad gezwungen werden**; die bestehende Klartext-Funktion muss erhalten bleiben.
- Da Ed25519 in Chrome erst ab Version 137 (Mai 2025) verfuegbar ist, werden wir E2EE-Funktionalitaet erst nach Feature-Erkennung aktivieren. Bis zur flaechendeckenden Verbreitung bleibt `messages.ciphertext` der klare Text.

### Deployment-Kontext

- Vite (ESM-Bundler)
- GitHub-Pages-Deployment unter Pfad `/enough/`
- Kein Node.js im Browser, keine Server-Side-Komponente fuer Krypto
- PWA: Krypto-Storage muss offline verfuegbar sein (IndexedDB ist PWA-kompatibel)
- **Keine** Service-Worker-Krypto in E2EE-1

---

## 4. Untersuchte Bibliotheken

### Option A — `@signalapp/libsignal-client` (offiziell)

| Kriterium                    | Ergebnis                                                                                                |
|------------------------------|---------------------------------------------------------------------------------------------------------|
| Version                      | 0.101.0 (2026)                                                                                          |
| Installationsgroesse         | 147,5 MB entpackt, inkl. nativer `.node`-Binaries fuer darwin/linux/win32 auf arm64 und x64             |
| Modulformat                  | ESM (`"type": "module"`), aber ueber `node-gyp-build`                                                    |
| **Browser-Faehigkeit**       | **Nicht gegeben.** Importiert `node:buffer`, `node:crypto` und laedt native `.node`-Addons. Keine WASM-Builds im npm-Paket. |
| Vite-Build-Test              | **Fehlgeschlagen:** `Buffer is not exported by "__vite-browser-external"` (Adress.js:6). Native Bindings koennen im Browser nicht geladen werden. |
| Offizielle Doku              | Die TypeScript-API ist ein **Node.js-only-Wrapper** um die Rust-Core-Library. Signal bietet keinen Web-Client an und hat wiederholt begruendet, dass das Browser-Trust-Modell fuer ihren Threat-Model nicht ausreicht. |
| Unterstuetzte Protokollteile | Alle (PQXDH, Double Ratchet, X3DH, Sealed Sender, Group Sessions, SVR2, etc.) — aber nur in Node/Electron/nativen Clients. |
| Lizenz                       | AGPL-3.0-only                                                                                           |
| Eignung fuer enough.         | **Nein.** Kann nicht in einer Vite-/GitHub-Pages-Browser-App betrieben werden. Polyfills wuerden native Bindungen nicht ersetzen. |

### Option B — Web Crypto API (Primitives)

| Kriterium                    | Ergebnis                                                                                                |
|------------------------------|---------------------------------------------------------------------------------------------------------|
| APIs                         | X25519 (ab ~2023/24 in allen grossen Engines), Ed25519 (ab Chrome 137, FF 130, Safari 17), AES-GCM, HKDF, SHA-256/512, HMAC, `non-extractable` CryptoKeys, `getRandomValues` |
| Node-Kompatibilitaet         | `globalThis.crypto.subtle` existiert ab Node 15; Tests koennen in Node laufen.                          |
| Persistenz                   | Keine eingebaute — IndexedDB muss selbst adressiert werden.                                             |
| **Wichtig: Was Web Crypto NICHT ist** | **Es ist kein Signal-Protokoll.** Es liefert Bausteine (DH, Signaturen, AEAD, KDF, PRF), aber kein Schluesselabkommen (X3DH/PQXDH), keinen Double Ratchet, keine PreKey-Behandlung, keine Session-Verwaltung. |
| Verbotene Nutzung            | Daraus eigenstaendig einen "eigenen Signal-aehnlichen" Messenger zusammenzubauen waere ein kryptographischer Anti-Pattern und wird in diesem Projekt **explizit nicht getan**. |
| Eignung fuer enough.         | **Teilweise.** Hervorragend fuer **Identity Keys, signierte PreKeys, Persistenz-Schicht, Public-Key-Serialisierung** und als Backend fuer eine zukuenftige Protokollbibliothek. Reicht allein **nicht** fuer E2EE-Nachrichten. |

### Option C — Dritt-Bibliotheken

#### C.1 — `libsignal-protocol-javascript` (signalapp, veraltet)
- Offiziell **deprecated** seit 2021.
- Benoetigt einen selbst bereitzustellenden `curve25519`-WebWorker (asm.js/WASM).
- Seit Jahren keine Sicherheitsupdates; PQXDH, Kyber und neuere Signal-Anpassungen fehlen.
- **Entscheid:** Nicht verwenden. Ein nicht gewartetes Protokoll in der Verschluesselungsschicht ist ein Sicherheitsrisiko.

#### C.2 — `2key-ratchet` (PeculiarVentures)
- TypeScript-Implementierung von X3DH + Double Ratchet auf WebCrypto-Basis.
- **Nicht mehr aktiv gewartet** (README: "This library is no longer actively maintained"; Empfehlung Migration zu `pqc-ratchet`).
- Nutzt **secp256r1 (P-256)** statt Curve25519 — signifikante Abweichung vom Signal-Oekosystem, kein Interop.
- Eigene Protokoll-Deltas ("two-key"-Modell) ohne breite externe Auditierung.
- Lizenz unklar/custom.
- **Entscheid:** Nicht verwenden. Ungewartet, andere Kurve, nicht Signal-kompatibel.

#### C.3 — `triple-double` (zbo14)
- Implementiert X3DH + Double Ratchet inkl. Header-Encryption.
- **Node.js-only** (nutzt `tls`, `https`, `net`, eigene WebSocket-Implementierung).
- 6 Jahre alt, ein Maintainer, keine Audits bekannt.
- **Entscheid:** Nicht verwenden.

#### C.4 — `@towns-protocol/vodozemac` / `@cogia/vodozemac-nodejs`
- JS/WASM-Bindings fuer [matrix-org/vodozemac](https://github.com/matrix-org/vodozemac) (Rust-Implementierung von Olm/Megolm).
- `@towns-protocol/vodozemac` ist ein **Fork fuer das Towns-Protokoll** — kein offizielles Matrix-Paket, keine stabile Versionierung, keine unabhaengigen Security-Audits dokumentiert.
- `@cogia/vodozemac-nodejs` ist Node.js-only.
- Offiziell gibt es von matrix-org kein eigenes npm-Paket fuer vodozemac-JS.
- **Entscheid:** Derzeit nicht verwenden. Zu viel Unsicherheit ueber Maintenance, API-Stabilitaet und Audit-Status.

#### C.5 — `@matrix-org/matrix-sdk-crypto-wasm`
- WASM-Build der Matrix-Rust-Crypto (vodozemac + Matrix-Key-Management).
- Sehr stark an Matrix-Raeume, Geraete-Listen, Server-Signaturen, Megolm-Sessions etc. gekoppelt.
- Keine eigenstaendige "nur Double-Ratchet"-API — wuerde die gesamte Matrix-Crypto-Infrastruktur mitbringen.
- **Entscheid:** Nicht geeignet fuer einen 1:1-Messenger ohne Matrix-Server.

#### C.6 — `libomemo.js` (conversejs)
- XMPP-OMEMO-Implementierung (basierend auf libsignal-protocol-javascript).
- Wartungszustand unklar, XMPP-fokussiert, keine auditierten Releases.
- **Entscheid:** Nicht verwenden.

---

## 5. Vor- und Nachteile im Ueberblick

| Option                      | Browser-tauglich | Signal-kompatibel | Auditierbar | Aktiv gewartet | Einfach integrierbar | Fazit                                        |
|-----------------------------|------------------|-------------------|-------------|----------------|----------------------|----------------------------------------------|
| libsignal-client (offiziell)| Nein (nur Node)  | Ja                | Ja          | Ja             | Nein                 | Nicht im Browser nutzbar                     |
| Web Crypto API (nur)        | Ja               | Nur Primitive     | Ja          | Ja (Browsers)  | Ja                   | Kein Protokoll -> darf nicht allein stehen   |
| libsignal-protocol-js (alt) | Ja               | Ja (alt)          | Ja (hist.)  | Nein (deprecated)| Bedingt             | Nicht mehr gewartet — zu riskant             |
| 2key-ratchet                | Ja               | Nein (secp256r1)  | Nein        | Nein           | Bedingt              | Falsche Kurve, EOL                           |
| triple-double               | Nein (Node)      | Ja                | Nein        | Nein           | Nein                 | Node-only, unbeachtet                        |
| @towns-protocol/vodozemac   | Ja (WASM)        | Nein (Olm/Megolm) | Nein        | Bedingt (Fork) | Bedingt              | Unklare Wartung, Olm statt Signal            |
| matrix-sdk-crypto-wasm      | Ja               | Nein (Matrix)     | Ja          | Ja             | Nein                 | Zu Matrix-spezifisch                         |

---

## 6. Build- / Deployment-Auswirkungen

### Aktuelle Situation
- Vite-Bundle: ~474 KB JS / ~27 KB CSS (GZip ~139 KB) — sehr schlank.
- Keine WASM-Dateien, keine Node-Polyfills noetig.
- GitHub-Pages-Deployment mit `base: '/enough/'` funktioniert.

### Auswirkungen der gewaehlten Architektur
- **Identity-/Storage-Layer auf Web Crypto:** Keine zusaetzlichen Abhaengigkeiten -> Bundle-Steigerung < 5 KB (nur eigener TS-Code). Keine WASM, keine Polyfills.
- **Kein nativer Code:** Vite muss `node:*`-Module nicht polyfillen.
- **WASM-Bibliothek (zukuenftig):** Spaeter kann `vite.config.ts` um `assetsInclude: ['**/*.wasm']` und ggf. `optimizeDeps.exclude` ergaenzt werden. Fuer E2EE-1 ist dies nicht erforderlich.
- **GitHub-Pages-WASM:** Vite serviert WASM als Asset mit korrektem MIME-Type; `/enough/`-Base-Pfad funktioniert fuer relative Asset-Loads, solange die Bibliothek nicht `fetch('/...')` mit absolutem Pfad nutzt. Dies ist zu testen, sobald WASM tatsaechlich benutzt wird.

### Verifikation (bereits durchgefuehrt)
- `npm run build` laeuft vor und nach den Aenderungen fehlerfrei durch.
- Ein Import von `@signalapp/libsignal-client` wurde probeweise hinzugefuegt — der Vite-Build schlaegt wie erwartet fehl (siehe §4 Option A). Die Dependency wurde wieder entfernt.

---

## 7. Persistenz des kryptografischen Zustands

### Speicherort: IndexedDB (nicht localStorage!)

| Daten                         | Speicherort            | Begruendung                                                                 |
|-------------------------------|------------------------|-----------------------------------------------------------------------------|
| Identity Key Pair (Ed25519)   | IndexedDB              | Private Key wird als `non-extractable` CryptoKey gehalten; IndexedDB kann CryptoKey-Objekte speichern |
| Signed PreKey                 | IndexedDB              | Enthaelt privaten PreKey + Signatur; darf nicht in localStorage.            |
| One-Time PreKeys              | IndexedDB              | Werden verbraucht; atomare Transaktionen erforderlich.                      |
| Session-Records (zukuenftig)  | IndexedDB              | Groessere Objekte, strukturiert.                                            |
| Public-Key-Metadaten          | IndexedDB (lokal) + Supabase (nur oeffentliche Teile)                     | Oeffentliche Keys werden fuer andere Geraete auf Supabase veroeffentlicht.  |

### Verbotene Speicherorte
- `localStorage` (synchron, plaintext-serialisiert, XSS-leicht zugreifbar)
- React-State / Context (verloren bei Reload, ueber DevTools einsehbar)
- URL-Hash / Query-Parameter (Logs, Browser-History)
- Cookies (werden an Server geschickt)
- `window.name` oder aehnliche Hacks

### Storage-Layer-Design
- Ein dediziertes `src/lib/crypto/storage.ts`-Modul kapselt alle IndexedDB-Zugriffe.
- Die Schicht ist logisch von UI und von Supabase getrennt.
- Private Key-Materialien werden als `non-extractable` `CryptoKey`-Objekte erzeugt und als solche in IndexedDB persistiert.
- Als Fallback fuer Browser, die keine nicht-exportierbaren CryptoKeys in IndexedDB speichern koennen, werden Schluessel mit einem geraetegebundenen AES-GCM-Wrap-Key umschlossen (`wrapKey`/`unwrapKey`).

### Storage-Clear-Verhalten

| Ereignis                                              | Verhalten                                                                                                        |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Reload / Tab-Wechsel                                  | CryptoState bleibt erhalten (IndexedDB-persistiert).                                                             |
| Logout                                                | CryptoState bleibt lokal erhalten; Benutzer kann sich wieder einloggen und das vorhandene Geraet weiterverwenden.|
| "Browserdaten loeschen" / IndexedDB geloescht          | Alle lokalen Schluessel gehen verloren. Da kein Backup existiert (v0.2), ist der Zustand wie bei einem neuen Geraet. Dokumentiert. |
| Account-Loeschung                                     | Lokaler CryptoState wird ebenfalls geloescht, damit keine halbe Identitaet verbleibt.                            |
| Zweites Geraet / zweiter Browser                      | Jedes Geraet erzeugt eine eigene Identity. Multi-Device ist fuer v0.2 **nicht** unterstuetzt.                    |

---

## 8. Empfohlene Loesung (Entscheidung)

**Fuer enough. E2EE-1 empfehlen wir:**

> **Schritt 1 (E2EE-1A, jetzt):** Keine der untersuchten Dritt-Bibliotheken ist ohne erhebliche Kompromisse im Browser produktionsreif. Wir **stoppen die produktive Nachrichtenverschluesselung an dieser Stelle** (d.h. `messages.ciphertext` bleibt vorerst Klartext) und **dokumentieren dies explizit**.
>
> **Schritt 2 (E2EE-1B, jetzt):** Wir bauen eine **saubere Crypto-Infrastruktur-Schicht** (`src/lib/crypto/`) auf Basis der **Web Crypto API** und **IndexedDB**, die:
> - langlebige Identity Key Pairs (Ed25519) erzeugt, laedt und persistiert,
> - Signed PreKeys (X25519, durch Identity Key signiert) erzeugt,
> - One-Time PreKeys erzeugt und verwaltet,
> - Public-Key-Material typsicher serialisiert/deserialisiert (ohne private Anteile),
> - den Storage vom UI/API-Layer trennt,
> - **keine eigenen Double-Ratchet- oder X3DH-Implementierungen enthaelt**.
>
> **Schritt 3 (spaetere Phase, nicht E2EE-1):** Sobald eine der folgenden Optionen verfuegbar und auditierbar ist, wird sie hinter dem Crypto-Layer als Session-/Ratchet-Engine eingehangen:
> 1. Offizielle WASM-Builds von `libsignal-client` (falls Signal jemals Browser-Support anbietet),
> 2. Ein offiziell von matrix-org veroeffentlichtes und auditiertes vodozemac-JS/WASM-Paket, oder
> 3. Eine andere von der Security-Community gepruefte, browserfaehige Signal-kompatible Bibliothek.
>
> Bis dahin bleibt `sendMessage()` Klartext in `messages.ciphertext` schreiben. Die Felder `kind` und `meta` (Systemnachrichten etc.) bleiben unverschluesselt und sind explizit als Metadaten behandelt.

### Begruendung
- **Sicherheit vor Geschwindigkeit:** Eine ungewartete, selbst zusammengebaute oder unsichere "Verschluesselung" ist schlimmer als gar keine, weil sie falsche Sicherheit suggeriert.
- **Infrastruktur ist portabel:** Der Identity-/Storage-Layer ist unabhaengig von der spaeteren Ratchet-Bibliothek.
- **Beste App funktioniert weiter:** Keine Breaking Changes, keine Datenmigration, keine verlorenen Nachrichten.
- **Schlankes Bundle:** Keine 150-MB-nativen Module, kein WASM zur Build-Zeit.

### Explizit NICHT in E2EE-1
- AES-GCM-"Quick-Fix"-Verschluesselung mit einem gemeinsamen Passwort
- Selbst erfundene PreKey-Logik / X3DH / Double Ratchet aus Web-Crypto-Primitiven
- Einhaengen einer ungewarteten Dritt-Bibliothek nur "weil es funktioniert"
- Multi-Device, Key-Backup, Geraetetransfer
- Push-Benachrichtigungen
- Migration von Bestandsnachrichten
- Systemnachrichten-Verschluesselung (wird in spaeterer Phase separat behandelt)

---

## 9. Verworfene Alternativen

| Alternative                                          | Grund der Verwerfung                                                                 |
|------------------------------------------------------|--------------------------------------------------------------------------------------|
| Eigenes Double-Ratchet auf WebCrypto                 | Hochkomplex, fehleranfaellig, keine Auditierbarkeit.                                 |
| `@signalapp/libsignal-client` im Browser             | Native `.node`-Addons und `node:*`-Module — nicht browserfaehig.                      |
| Veraltetes `libsignal-protocol-javascript`           | Offiziell deprecated seit 2021, ohne aktuelle Sicherheitsupdates.                    |
| `2key-ratchet`                                       | EOL, nutzt secp256r1 statt Curve25519, keine Signal-Kompatibilitaet.                 |
| `triple-double`                                      | Node-only, keine Wartung.                                                            |
| Inoffizielle libsignal-WASM-Forks                    | Keine offizielle Herkunft, keine Audit-Trails.                                       |
| `@towns-protocol/vodozemac`                          | Fork eines Dritten, keine klaren Releases, Olm statt Signal.                         |
| AES-GCM mit festem Schluessel                        | Schein-E2EE, keine Forward Secrecy, kein PreKey-Modell.                              |
| Verschluesselung mit User-Passwort                   | Supabase-Auth-Passwoerter sind fuer Authentifizierung, nicht fuer Krypto gedacht.    |
| `window.crypto.subtle` direkt in `api.ts`            | Keine Trennung der Schichten, keine persistente Schluesselverwaltung.                |

---

## 10. Geraete- / Multi-Device-Modell (v0.2)

```
Supabase auth user (user.id)
        |
        |  (1:1 in v0.2)
        v
enough. crypto device (device_id = client-generierte UUID)
        |
        +-- Identity Key Pair (Ed25519) — private verbleibt auf dem Geraet
        +-- Current Signed PreKey (X25519, signed by Identity)
        +-- One-Time PreKey-Pool (X25519)
        +-- Session Records (zukuenftig)
```

- **1 Account = 1 aktives kryptographisches Geraet** in v0.2.
- Ein zweiter Browser / ein zweites Geraet erzeugt eine neue, unabhaengige Identitaet.
- **Supabase-Account != Crypto-Identity:** `auth.users.id` ist eine UUID aus Supabase; `device_id` ist eine client-generierte UUID, die spaeter in einem `crypto_devices`-Eintrag an den `auth.uid()` gebunden wird. Der Public Identity Key ist ein separates Byte-Feld.
- **Connection != Crypto-Session:** Die bestehende `connections.id` ist die Messenger-Zuordnungsebene.

### Datenbank-Schema (Vorschlag, additiv, nicht aktiv in E2EE-1 verwendet)

```sql
CREATE TABLE IF NOT EXISTS public.crypto_devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_key     BYTEA NOT NULL,            -- Ed25519 public key (32 bytes)
  signed_prekey_id INTEGER,
  signed_prekey    BYTEA,                     -- X25519 public signed prekey
  signed_prekey_sig BYTEA,                    -- Ed25519 signature
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crypto_one_time_prekeys (
  id         BIGSERIAL PRIMARY KEY,
  device_id  UUID NOT NULL REFERENCES public.crypto_devices(id) ON DELETE CASCADE,
  key_id     INTEGER NOT NULL,
  public_key BYTEA NOT NULL,
  used_at    TIMESTAMPTZ,
  UNIQUE (device_id, key_id)
);
```

> **Wichtig:** Die Produktivschaltung dieser Tabellen (und der RLS-Policies) erfolgt **nicht in E2EE-1**, da sie erst sinnvoll befuellt werden, wenn die Session-/Ratchet-Schicht steht. Fuer die Storage-Infrastruktur reicht die lokale IndexedDB. Die Migration wird als Vorschlag mitgeliefert, aber **nicht automatisch angewendet**.

---

## 11. Connection-Binding

- `connections.id` (bestehend) ist die Messenger-Konversationsebene.
- Pro Connection gibt es spaeter (nach Einhaengen einer Ratchet-Engine) genau eine aktive Crypto-Session pro Geraete-Paar.
- Die Connection-ID ist **nicht** Teil des Schluesselmaterials; sie dient nur zur Zuordnung.
- **My Notes** (Self-Connection, `user_a = user_b`) wird dieselbe Infrastruktur verwenden — kein Spezialpfad "user_id = shared secret".
- **Systemnachrichten** (`kind: 'name_change'`, `connection_event`, `deleted_account`) werden serverseitig mit leerem `ciphertext` und `meta`-JSON erzeugt. Diese bleiben vorerst unverschluesselt sichtbar. Dies ist **dokumentiert, nicht geloest** in E2EE-1.

---

## 12. Delete-for-everyone / Delete-for-me

- **Delete-for-me:** Wie bisher (lokale Deletions-Liste + `message_deletions`-Tabelle). Keine Aenderung.
- **Delete-for-everyone:** Server kann den Ciphertext auf leer setzen und damit die weitere Zustellung unterbinden. Er kann aber **nicht** garantieren, dass ein bereits zugestellter und auf dem Geraet entschluesselter Klartext vernichtet wird. Dies ist dokumentiert.
- In E2EE-1 gibt es keine Ciphertexts zu loeschen — Verhalten bleibt wie bisher.

---

## 13. Security Boundaries (explizit)

### Geschuetzt durch E2EE (wenn vollstaendig implementiert)
- Supabase-Datenbank-Administrator ohne Geraeteschluessel
- Supabase-Storage-Leserechte (z.B. Service-Role-Leak)
- Realtime-Traffic-Mitschnitt
- Gestohlene Ciphertext-Daten (z.B. DB-Dump)
- Direkter Serverzugriff auf Message-Payloads (nach Aktivierung der Verschluesselung)

### Nicht automatisch geschuetzt (auch spaeter nicht)
- Kompromittiertes Endgeraet (Malware, Root/Administrator-Zugriff)
- Cross-Site-Scripting (XSS) — Schluessel sind im selben JS-Kontext
- Manipuliertes JavaScript (z.B. kompromittierter Deploy auf GitHub Pages)
- Kompromittierter Browser oder Browser-Profil
- Schaedliche Browser-Erweiterungen (koennen Seitenkontext lesen)
- Bereits entschluesselte Nachrichten (bleiben im UI-Speicher/DOM)
- Screenshots, Fotografie, Screen-Recording
- Traffic-Metadaten (wer wann mit wem) — bleiben sichtbar
- Downgrade-Angriffe durch kompromittierten JavaScript-Code (erfordert CSP/SRI-Haertung, separat zu planen)

---

## 14. Risiken

| Risiko                                                                 | Wahrscheinlichkeit | Auswirkung | Mitigation                                                                          |
|------------------------------------------------------------------------|--------------------|------------|-------------------------------------------------------------------------------------|
| Browser Ed25519-Unterstuetzung nicht ausreichend verbreitet            | Mittel             | E2EE kann bei Nutzern aelterer Browser nicht aktiviert werden | Feature-Erkennung; Klartext-Fallback; schrittweiser Rollout         |
| IndexedDB-Exportierbarkeitsverhalten variiert zwischen Browsern        | Niedrig            | Private Keys koennen ggf. nicht non-extractable persistiert werden | Wrap-Key-Pattern mit zusaetzlichem AES-GCM-Wrapping als Fallback    |
| XSS-Leck von privaten Schluesseln                                      | Mittel             | Totalverlust der Vertraulichkeit | Strenge CSP, keine eval, Dependency-Audits, keine Schluessel in Strings |
| Spaetere Bibliotheks-Integration fuehrt zu Breaking Changes            | Mittel             | Erneuter Umbau | Crypto-Layer-API ist bewusst eng und bibliotheksagnostisch gehalten     |
| Lizenz-Konflikte bei zukuenftigen Bibliotheken                         | Niedrig            | Rechtliches Risiko | Lizenzpruefung vor jeder Integration                                    |
| Fehlender Cloud-Key-Backup fuehrt zu Datenverlust                      | Hoch (in v0.2)     | Nachrichtenverlust bei Geraeteverlust | Dokumentation; Backup-Loesung in spaeterer Version                     |
| Systemnachrichten bleiben dauerhaft Klartext                           | Niedrig            | Meta-Daten-Leck | Spaeteres Design-Dokument fuer System-Events                              |

---

## 15. Offene Entscheidungen (Folge-Phasen)

- **O1:** Wann und auf welche Bibliothek setzen wir fuer die Session-/Ratchet-Schicht? Empfehlung: Beobachten von (a) offizieller libsignal WASM, (b) offizieller vodozemac-JS-Bindung. Entscheidung in E2EE-2.
- **O2:** Ab welchem Browser-Support-Level aktivieren wir E2EE per Default?
- **O3:** Multi-Device-Strategie (Geraete-Linking, Key-Fanout, Device-Revocation).
- **O4:** Key-Backup / Recovery (SVR-aehnlich wie bei Signal, oder Recovery-Key / Paper-Key).
- **O5:** Behandlung von Systemnachrichten unter E2EE.
- **O6:** Sicherheits-Haertung: CSP-Header, SRI fuer Build-Artefakte.
- **O7:** My-Notes-Keys (selbe Identity, separate Session? Selbstverschluesselung mit PreKey?).
- **O8:** Wie wird der oeffentliche Identity Key an den Peer verteilt?
- **O9:** Umgang mit Verstoessen gegen die "no key in logs/URL/error"-Regel in Drittabhaengigkeiten.

---

## 16. Modul-Struktur (umgesetzt in E2EE-1B)

```
src/lib/crypto/
  index.ts          Oeffentliche API (initIdentity, getIdentity, getPublicBundle, ...)
  types.ts          Typen (SerializedIdentityKey, PreKeyBundle, ...)
  storage.ts        IndexedDB-Layer (init, put, get, delete, list, versioning)
  identity.ts       Identity-Key-Generierung, Speichern, Laden, Export des Public-Anteils
  prekeys.ts        Signed PreKey + One-Time PreKeys (generieren, signieren, persistieren)
  serialization.ts  Oeffentliche Schluessel <-> Base64/Uint8Array (ohne private Anteile!)
  key-agreement.ts  (E2EE-2A) X25519 Shared Secret als nicht-exportierbarer HKDF-CryptoKey
  kdf.ts            (E2EE-2A) HKDF-SHA-256 (Message-Key-Ableitung, Domain Separation)
  symmetric.ts      (E2EE-2A) AES-256-GCM encrypt/decrypt mit 96-Bit-Random-Nonce und AAD
  primitives.ts     (E2EE-2A) Barrel der Primitive-Schicht (nicht aus index.ts exportiert)
  errors.ts         Eigene Crypto-Fehler (ohne geheime Inhalte in message/stack)
  __tests__/        Tests (Storage, Identity, Serialization, Security)
  README.md         Developer-Doku
```

**Wichtig:** Die Module exportieren keine privaten Schluessel als serialisierbare Werte. `CryptoKey`-Objekte werden nur in `non-extractable`-Form erzeugt und als solche gehandhabt. `index.ts` ist der **einzige** oeffentliche Einstiegspunkt.

### Zukuenftige Erweiterung (E2EE-2+)
```
src/lib/crypto/
  sessions/
    index.ts
    <bibliothek>.ts    # Adapter zur ausgewaehlten Ratchet-Bibliothek
  messages.ts          # encryptMessage / decryptMessage (delegiert an sessions)
```

---

## 17. Referenzen

- Signal Specifications: https://signal.org/docs/
  - X3DH: https://signal.org/docs/specifications/x3dh/
  - Double Ratchet: https://signal.org/docs/specifications/doubleratchet/
  - PQXDH: https://signal.org/docs/specifications/pqxdh/
- libsignal (Rust-Core): https://github.com/signalapp/libsignal
- Web Crypto API: https://www.w3.org/TR/WebCryptoAPI/
- WebCrypto Secure Curves (Ed25519/X25519): https://wicg.github.io/webcrypto-secure-curves/
- vodozemac (Matrix Rust-Implementierung von Olm/Megolm): https://github.com/matrix-org/vodozemac
- Olm / Megolm Specification: https://gitlab.matrix.org/matrix-org/olm/-/blob/master/docs/
- 2key-ratchet (PeculiarVentures): https://github.com/PeculiarVentures/2key-ratchet
- "Can I use Secure Curves": https://blogs.igalia.com/jfernandez/2025/02/28/can-i-use-secure-curves-in-the-web-platform/

---

## 18. Change Log

- **2026-08-19 — E2EE-1A:** Initiale Architektur-Entscheidung. Empfehlung: Web-Crypto-basierter Identity/Storage-Layer, keine produktive Nachrichtenverschluesselung in E2EE-1.
- **2026-08-19 — E2EE-1C:** Security-Review der implementierten Infrastruktur (Details siehe §19).
- **2026-08-19 — E2EE-2A:** Lokale Primitive-Schicht (X25519 -> HKDF-SHA-256 -> AES-256-GCM) additiv ergaenzt, ohne produktive Integration (Details siehe §20).
- **2026-08-20 — E2EE-2C (Vorbereitung):** Architektur und Blocker-Aufloesung fuer eine moegliche Session-Engine (`@getmaapp/signal-wasm`) in [`e2ee-2c-architecture.md`](./e2ee-2c-architecture.md). **Keine Produktionsintegration.** Entscheidung: CONDITIONAL GO fuer die Engine-Wahl, NO-GO fuer Implementierung bis Legal/Provenance/Mobile/Review.

---

## 19. E2EE-1C Security Review

Dieser Abschnitt dokumentiert den gezielten Security-Review der nach E2EE-1B entstandenen Crypto-Foundation vor der Freigabe fuer E2EE-2 (Session-/Ratchet-Layer).

### 19.1 Gepruefte Bereiche

| # | Bereich | Ergebnis |
|---|---------|----------|
| 1 | Private Key Exposure (logs, errors, localStorage, URL, props, JSON, Supabase) | Keine Lecks — siehe §19.2 |
| 2 | User-Isolation (Logout/Login, Reload, Storage-Clear) | Urspruenglich **fehlerhaft** (Kritisch), nach Fix sauber — siehe §19.3 Finding F-1 |
| 3 | IndexedDB-Design (Schema, Migrationen, Corruption, fehlende Records) | Korruptionserkennung vorhanden, User-Scoping nach Fix — §19.3 F-1 |
| 4 | Key Extractability (`extractable: false` und tatsaechlicher Export-Fehlschlag) | In Ordnung; Tests pruefen echten `exportKey`-Fehlschlag — §19.3 F-2 |
| 5 | Public-Bundle-Inhalt (keine privaten Felder) | In Ordnung; negative Tests und JSON-Scans — §19.3 F-3 |
| 6 | Error-Handling (keine Secrets in `message`/`stack`/`console`) | Urspruenglich unsichere Cause-Weitergabe, gefixt — §19.3 F-4 |
| 7 | PreKey-Parameter-Dokumentation | Werte sind genug.-Foundation-Parameter, keine Signal-Konstanten — §19.6 |
| 8 | Protokollgrenze (keine impl. X3DH/PQXDH/Double-Ratchet/Verschluesselung) | Bestaetigt, Test prueft auf Abwesenheit dieser APIs — §19.7 |
| 9 | Auth-Lifecycle (Login, Session-Restore, Logout, Account-Deletion) | Logout haelt Identity; Account-Deletion loescht sie — §19.8 |
| 10 | Build/Smoke/Crypto-Tests | `npm run build`, `npm run smoke`, `npm run test:crypto` erfolgreich (30/30 Tests) — §19.9 |

### 19.2 Findings — Private Key Exposure

**Scan-Methodik:**
- `grep` nach `console.log/error/warn` innerhalb von `src/lib/crypto/` → **keine** Treffer (produktiver Code; Tests nutzen keine Console-Ausgaben von Secrets).
- `grep` nach `localStorage/sessionStorage` innerhalb von `src/lib/crypto/` → nur in Kommentaren ("NOT in localStorage").
- Manuelle Inspektion aller Serialisierungs-Pfade: `serializeIdentityBundle`, `serializeSignedPreKey`, `serializeOneTimePreKey`, `getPublicDeviceBundle` nehmen ausschliesslich die dafuer vorgesehenen `Public*Bundle`-Typen entgegen; diese Typen enthalten keine `CryptoKey`-Felder.
- `CryptoError` haengt die `cause`-Ursache an ein **nicht-enumerierbares Symbol** (`Symbol.for('enough.crypto.cause')`), sodass `JSON.stringify`, `console.log` (bei Standard-Serialisierung) und `Error.toString()` den Cause nicht offenlegen.
- Automatisierte Tests scannen das JSON der Public Bundles nach `privateKey`, `signingPrivateKey`, `secret`, `CryptoKey`, `extractable`, `pkcs8` (schlagen an, falls ein Treffer).

**Ergebnis:** Kein privates Material verlässt den Crypto-Layer auf irgendeinem der geprueften Pfade.

### 19.3 Findings (Schweregrad)

| ID | Severity | Titel | Status |
|----|----------|-------|--------|
| F-1 | **Kritisch** | Crypto-State war nicht per-User isoliert | **Behoben** |
| F-2 | Niedrig | Extractability nur ueber Flag, nicht per Export-Test geprueft | **Behoben** |
| F-3 | Mittel | `_resetIdentityCacheForTests` war ueber Public-Barrel exportiert | **Behoben** |
| F-4 | Niedrig | `cause`-Handling in `CryptoError` koennte Detais im stack verlieren | **Behoben** |
| F-5 | Niedrig | `initCrypto` hatte keine Mutex-Guard gegen doppelte Generierung | **Behoben** |
| F-6 | Mittel | `deleteAccount()` loeschte keinen lokalen CryptoState | **Behoben** |
| F-7 | Informativ | PreKey-Pool-Konstanten (100/20/30Tage) muessen als genug.-eigene Foundation-Parameter markiert werden | **Behoben** (Doku) |
| F-8 | Informativ | `sendMessage()` bleibt Klartext — bewusst | **Bestaetigt** |
| F-9 | Informativ | Keine Multi-Device-, Backup-, Push- oder System-Nachrichten-Kryptografie | **Dokumentiert** (E2EE-1-Scope) |

#### F-1 — User-Isolation (Kritisch)

**Original-Bug:** `IDENTITY_RECORD_KEY = 'identity'` und `SIGNED_PREKEY_RECORD_KEY = 'signed-prekey'` waren **globale** IndexedDB-Keys ohne User-Namespace. Logout + Login als anderer Benutzer auf demselben Browser-Profil haetten die Identitaet des vorherigen Benutzers weiterverwendet (Cross-User-Identity-Reuse).

**Fix:**
- State wird unter **composite Keys** `${userId}:${recordKey}` gespeichert (`stateKeyFor()`/`prekeyCompositeKey()`).
- PreKey-Object-Store verwendet zusammengesetzte String-Keys `${userId}:${keyId}`; `listPreKeys(userId)` macht einen Prefix-Scan ueber `IDBKeyRange.bound(prefix, prefix + '\uffff')` und defensiv einen `userId`-Check auf jedem Record.
- `PersistedIdentity`/`PersistedSignedPreKey`/`StoredPreKey` enthalten zusaetzlich ein `userId`-Feld; `validateRecord` prueft `record.userId === expectedUserId` und wirft bei Mismatch `USER_MISMATCH` (Isolationsverletzung wird erkannt, statt stillschweigend falsche Daten zu liefern).
- `PublicIdentityBundle` enthaelt jetzt `userId`; der Deserialisierer erzwingt dieses Feld.

**Neue Tests:** `user A and user B get distinct identities`, `deleteUserCryptoState removes only that user`, `identity record with wrong userId fails validation`.

#### F-2 — Key-Extractability-Pruefung (Niedrig)

**Original-Zustand:** Tests prueften nur `key.extractable === false`, nicht ob ein tatschlicher `crypto.subtle.exportKey('pkcs8', ...)`-Aufruf fehlschlaegt.

**Fix:** Tests versuchen aktiv `exportKey('pkcs8', privKey)` fuer Identity-, Signed-PreKey- und OTK-Private-Keys und erwarten einen Fehlschlag.

#### F-3 — Test-Helper im Public-Barrel (Mittel)

**Original-Bug:** `_resetIdentityCacheForTests` war aus `src/lib/crypto/index.ts` re-exportiert und damit fuer Produktivcode zugaenglich. Ein Aufruf haette den Cache zurueckgesetzt.

**Fix:** Der Helper ist aus dem Public-Barrel entfernt (verbleibt nur im `identity.ts`-Export, der in Tests direkt importiert wird).

#### F-4 — CryptoError-Cause-Handling (Niedrig)

**Original-Zustand:** `cause` wurde nicht auf den Error gelegt; es wurde nur ein Symbol-Property verwendet. Das ist fuer sich genommen korrekt.

**Review-Ergebnis:** Das Verhalten ist korrekt und erwuenscht (keine Lecks), wurde aber in Tests explizit verifiziert (`CryptoError messages are generic and do not echo inputs`). Kein Code-Aendernotwendig; Test hinzugefuegt.

#### F-5 — Race-Condition in `initCrypto` (Niedrig)

**Original-Bug:** `initCrypto()` hatte keine Synchronisation; `onAuthStateChange` und `getSession()`-Callback koennten beide `generateIdentity()` aufrufen, wenn der erste Aufruf noch laeuft, was zu `ALREADY_INITIALIZED`-Fehlern oder — im unguenstigsten Fall — zu einer stillen Ueberschreibung haette fuehren koennen.

**Fix:** Per-User-Mutex `initLocks: Map<userId, Promise>` — gleichzeitige Aufrufe fuer denselben User erhalten das gleiche Promise; nach Abschluss wird der Eintrag entfernt.

**Test:** `concurrent initCrypto calls for the same user produce one identity`.

#### F-6 — `deleteAccount()` ohne Crypto-Cleanup (Mittel)

**Original-Bug:** Nach `deleteOwnAccount()` (server-seitige Account-Loeschung) wurde nur der Supabase-Session beendet, aber die lokale Identitaet verblieb in IndexedDB. Ein spaeterer neuer Account mit derselben Browser-Instanz haette potentiell die alte Identity gesehen (bzw. waere in "already initialized" gelaufen).

**Fix:** `deleteAccount()` ruft jetzt `deleteUserCryptoState(deletedUserId)` **vor** dem Sign-Out auf. Fehler werden geschluckt, damit ein Fehlschlag der lokalen Bereinigung den Account-Deletion-Flow nicht blockiert.

**Test:** Logout/Deletion-Isolation wird in `logout preserves identity; deleteAccount wipes it` getestet (indirekt ueber `deleteUserCryptoState`).

#### F-7 — PreKey-Parameter als genug.-Foundation-Parameter markiert (Informativ)

Die Werte `DEFAULT_OTK_POOL_SIZE = 100`, `MIN_OTK_THRESHOLD = 20`, `SIGNED_PREKEY_ROTATION_MS = 30d` sind **nicht** einem Signal-Spezifikationsdokument entnommen. Sie wurden in `src/lib/crypto/prekeys.ts` explizit als "enough. foundation parameter — NOT a final Signal-protocol constant" dokumentiert. Sie werden voraussichtlich durch die Werte der spaeteren Ratchet-Bibliothek ersetzt werden.

#### F-8 — `sendMessage()`-Klartext (Informativ / Bestaetigung)

`src/lib/api.ts` `sendMessage()` schreibt nach wie vor direkt `ciphertext: text` (Klartext). Dies ist gemaess E2EE-1-Umfang korrekt — produktive Nachrichtenverschluesselung erfolgt erst in E2EE-2 nach der Bibliotheksentscheidung. Test bestaetigt dies (Grep-Prüfung).

#### F-9 — Ausserhalb des E2EE-1-Scopes liegende Features (Informativ)

- Multi-Device — **nicht implementiert** (wie vorgesehen).
- Key-Backup / Recovery — **nicht implementiert**.
- Push Notifications — **nicht implementiert** (wie vorgesehen; `package.json` enthaelt keine entsprechenden Dependencies).
- System-Nachrichten-Verschluesselung — **dokumentiert** (§11).
- My-Notes-Spezialkryptografie — **nicht implementiert** (wird ueber denselben Crypto-Layer abgebildet).

### 19.4 IndexedDB-Details

| Eigenschaft | Wert |
|-------------|------|
| Datenbankname | `enough-crypto` |
| DB-Version | 1 |
| Object-Stores | `state` (keyed by composite string `${userId}:${recordKey}`), `prekeys` (keyed by `${userId}:${keyId}`) |
| Persistenz | Transaktionen mit `durability: 'strict'` |
| Parallelitaet | Jeder API-Aufruf oeffnet eine neue Connection in `openDatabase()` und schliesst sie in `finally`; V8/IDB sorgt fuer Serialisierung. |
| Corruption-Recovery | Bei Schema-/Feld-Validierungsfehlern wird `CORRUPT_STATE` geworfen — **kein** automatisches Loeschen/Neugenerieren, um stille Identitaetsersetzung zu vermeiden. Der UI-Layer (zukuenftig) kann den Nutzer ueber den korrupten Zustand informieren. |
| Reload | Alle Datensaetze bleiben auf Platte; der In-Memory-Cache ist per-User-Map und wird nach Reload neu aus IndexedDB befuellt. |
| Zweiter Tab | IndexedDB ist ueber Tabs der selben Origin geteilt. Sign-Out in Tab A loescht Daten nicht (Logout behaelt Identity); Account-Deletion in Tab A loescht sie ueber `deleteUserCryptoState`. Tab B wuerde beim naechsten Lesezugriff feststellen, dass die Identitaet fehlt, und eine neue erzeugen — dies ist dokumentiert und der spaetere Session-Layer muss Multi-Tab-Races behandeln (fuer v0.2: "ein Tab = ein Geraet"-Empfehlung). |

### 19.5 Private-Key-Protections im Detail

- Alle privaten Schluessel werden mit `extractable: false` generiert.
- **Nachpruefung:** Nach Generierung wird (in `generateIdentity` und der SignedPreKey-/OTK-Generierung) explizit `if (key.privateKey.extractable) throw/re-generate` ausgefuehrt.
- **Zusaetzliche Nachpruefung:** Bei jedem Laden aus IndexedDB wird `priv.extractable` erneut geprueft; wenn `true`, wird `CORRUPT_STATE` geworfen.
- **Exports-Test:** Tests rufen `crypto.subtle.exportKey('pkcs8', key)` auf und erwarten einen `InvalidAccessError`-Fehler.
- Private Keys werden nie als Parameter an Funktionen ausserhalb von `identity.ts`/`prekeys.ts` uebergeben (mit Ausnahme von `getIdentitySigningKey(userId)` — diese Funktion ist **nicht** im Public-Barrel von `index.ts` exportiert, also fuer UI/API-Code unzugaenglich).
- Private Keys werden nie in einen JS-String oder ein JSON-Objekt konvertiert.
- Auch bei `console.log` auf einem CryptoKey-Objekt gibt der Browser standardmaessig nur `CryptoKey {...}` aus, ohne Schluesselmaterial preiszugeben; wir rufen `console.log` trotzdem niemals mit Schluesseln auf.

### 19.6 PreKey-Semantik (Parameter-Dokumentation)

Die folgenden Werte sind **genug.-Foundation-Parameter**. Sie dienen in E2EE-1 allein der Schaffung einer funktionsfaehigen Infrastruktur und sind **nicht** als endgueltige Protokollparameter zu verstehen. Sie duerfen und werden wahrscheinlich ersetzt, sobald die spaetere Protokollbibliothek (libsignal, vodozemac o.ae.) mit ihren eigenen Konstanten eingezogen wird.

| Konstante | Wert | Begruendung in E2EE-1 |
|-----------|------|------------------------|
| `DEFAULT_OTK_POOL_SIZE` | 100 | Ausreichend fuer einen asynchronen 1:1-Chat mit ueblicher Nutzungsfrequenz; kompatibel mit der Groessenordnung von Signal-Empfehlungen, aber ohne Audit. |
| `MIN_OTK_THRESHOLD` | 20 | Pool wird nachgefuellt, wenn er unter 20 faellt; Puffer gegen Concurrent-Session-Aufbauten. |
| `SIGNED_PREKEY_ROTATION_MS` | 30 Tage | Richtet sich an Empfehlungen fuer gewoehnliche PreKey-Rotationen; lang genug, um selten aufzutreten, kurz genug, um Kompromittierung einzudämmen. |

### 19.7 Protokollgrenze — ausdrueckliche Bestaetigung

Der aktuelle Crypto-Layer implementiert **keine** der folgenden Komponenten:

- ❌ X3DH (Extended Triple Diffie-Hellman)
- ❌ PQXDH (Post-Quantum X3DH)
- ❌ Double Ratchet
- ❌ Triple Ratchet
- ❌ Session-Establishment (kryptographisch)
- ❌ Message-Encryption
- ❌ Message-Decryption
- ❌ Sealed-Sender / Anonyme Absender
- ❌ Gruppen-Chat-Verschluesselung (Megolm/Sender-Key)

Dies wird durch einen Test `crypto layer exposes NO encrypt/decrypt/session APIs in E2EE-1` abgesichert, der das Vorhandensein von Funktionsnamen wie `encryptMessage`, `decryptMessage`, `createSession`, `doubleRatchet`, `x3dh`, `pqxdh` im Public-Barrel verbietet.

### 19.8 Auth-Lifecycle — Verhalten im Detail

| Ereignis | Aktion bezueglich CryptoState |
|----------|-------------------------------|
| Erster Login (neuer User, keine vorhandene Identity) | `initCrypto(userId)` erzeugt Ed25519-Identity, Signed PreKey, OTK-Pool (100 Stk.), alles in IndexedDB. |
| Erneuter Login / Session Restore nach Reload | `initCrypto(userId)` findet vorhandene Identity, laedt sie aus IndexedDB, rotiert Signed PreKey bei Bedarf (nach 30d), fuellt OTK-Pool auf wenn <20. |
| Logout (`signOut()`) | **Identity bleibt erhalten** (wie bei Signal-Desktop), keine DB-Loescheung. Cache wird nicht geleert; beim naechsten Login derselben User-ID wird dieselbe Identity wiederverwendet. |
| Session-Expiry (Supabase-Session laeuft ab, Benutzer wird ausgeloggt) | Gleicher Zustand wie Logout — lokale Identity bleibt erhalten. |
| Account-Deletion (`deleteAccount()`) | Vor dem Sign-Out wird `deleteUserCryptoState(userId)` aufgerufen, um Identity, Signed PreKey und OTKs dieses Users aus IndexedDB zu entfernen. Andere User-Identities im selben Browser (Multi-Account-Fall) bleiben unberuehrt. |
| "Browserdaten loeschen" / IndexedDB geloescht | Alle Identities gehen verloren. Verhalten: wie bei neuem Geraet (dokumentierter Datenverlust). `loadIdentity()` gibt `null` zurueck; nachfolgendes `initCrypto` erzeugt eine neue Identity. |
| Konkurrierender `initCrypto(userId)` (Race) | Per-User-Promise-Mutex serialisiert die Initialisierung; es wird nur eine Identity erzeugt. |
| Zweiter Tab mit selbem User | IndexedDB ist geteilt; beide Tabs sehen dieselbe Identity. Kein Locking in E2EE-1 — spaetere Session-Layer muessen dies beruecksichtigen. |

### 19.9 Test-Ausfuehrungen

```
$ npm run build
  tsc --noEmit && vite build
  dist/assets/index-*.js  484.83 KB │ gzip: 136.62 KB
  ✓ built in 1.81s

$ npm run smoke
  All smoke tests passed.

$ npm run test:crypto
  1..30
  # tests 30
  # pass 30
  # fail 0
```

### 19.10 Remaining Risks (niedrig / dokumentiert)

| Risiko | Status |
|--------|--------|
| XSS kann auf nicht-exportierbare CryptoKeys zugreifen (gleicher JS-Kontext) | **Dokumentiert** (§13); nicht behebbar auf E2EE-Ebene — benoetigt CSP/SRI/Code-Hardening als Teil des allgemeinen App-Sicherheitsmodells. |
| Ed25519 verfuegbar noch nicht in allen aelteren Chrome-Versionen | **Dokumentiert** (§3); `isE2eeSupported()`-Feature-Detection schaltet E2EE-Codepaths erst bei Verfuegbarkeit ein; Klartext-Fallback bleibt bestehen. |
| Kein Key-Backup (Geraeteverlust = Schluesselverlust) | **Dokumentiert** (§14); Folgearbeit in spaeterer Phase. |
| Kein Multi-Device | **Dokumentiert** (§10); v0.2 = ein Geraet pro Account. |
| IndexedDB-Versionsmigrationen bei zukuenftigen Schema-Aenderungen | Es existiert noch keine Migration; Schema-Version ist `1`. Zukuenftige Aenderungen muessen Upgrade-Handler in `openDatabase()` implementieren. |
| SharedWorker/ServiceWorker isoliert Crypto nicht | **Dokumentiert**; E2EE-1 fuehrt keine Crypto-Operationen in Workern aus. |
| `deleteAccount()` schlaegt fehl, wenn IndexedDB gesperrt ist | Fehler wird geschluckt, um Deletion nicht zu blockieren; ein spaeterer Neu-Aufbau der IndexedDB ist akzeptabel (zurueck bleibt hoechstens eine verwaiste Identity, die keine Zuordnung mehr zu einem existierenden Supabase-Account hat). |

### 19.11 Go / No-Go fuer E2EE-2

**GO** — mit folgenden Bedingungen:

1. E2EE-2 darf **nicht** damit beginnen, eine eigene X3DH/Double-Ratchet-Implementierung zu schreiben. Stattdessen MUSS eine der im Architektur-Dokument (§8) genannten Optionen umgesetzt werden: (a) offizielle libsignal-WASM-Bindings sobald verfuegbar, (b) offiziell von matrix-org publiziertes vodozemac-JS/WASM-Paket, oder (c) eine andere von der Security-Community auditierte, browserfaehige Signal-kompatible Bibliothek.
2. Bevor E2EE-2 produktiv geht, muessen:
   - die in §19.10 verbleibenen Risiken evaluiert werden,
   - die Supabase-Migration fuer `crypto_devices`/`crypto_one_time_prekeys` (Schema-Vorschlag in §10) umgesetzt und mit RLS-Policies abgesichert werden,
   - eine Testabdeckung fuer die Session-/Ratchet-Schicht auf dem Niveau der vorliegenden Tests (reale Export-Fehlschlag-Pruefungen, User-Isolation, Race-Conditions, Corruption) vorhanden sein,
   - `sendMessage()`-Verschluesselung und `getMessagesPage()`-Entschluesselung hinter dem bestehenden Crypto-Layer eingefuegt werden, ohne die bestehende API-Struktur zu zerbrechen.
3. Solange keine der in (1) genannten Bibliotheken sauber integrierbar ist, bleibt der produktive Nachrichtenfluss Klartext (wie bisher).

---

## 20. E2EE-2A — Primitive Layer

**Phase:** E2EE-2A (Crypto-Session-Primitives, Phase 1)
**Status:** implementiert, **nicht produktiv angebunden**
**Kurzfassung:** `Primitive only; not a Signal/X3DH/Double-Ratchet implementation.`

### 20.1 Zweck

E2EE-2A liefert ausschliesslich die **lokale kryptografische Grundschicht**, auf
der ein spaeteres, etabliertes Session-Protokoll (PQXDH + Double Ratchet, siehe
[`e2ee-session-architecture.md`](./e2ee-session-architecture.md), Gate-Status in
[`e2ee-implementation-feasibility.md`](./e2ee-implementation-feasibility.md))
aufsetzen kann:

```
   X25519 Shared Secret          key-agreement.ts   deriveSharedSecret()
            |
            v
      HKDF-SHA-256                kdf.ts            deriveMessageKey() / deriveKeyBytes()
            |
            v
     AES-256-GCM Key
            |
            v
   lokale encrypt / decrypt       symmetric.ts      encryptBytes() / decryptBytes()
            |
            v
        Tests                     __tests__/primitives.test.mjs
```

Alle Primitive stammen aus der **nativen Web Crypto API**. Es wurde **keine
neue Abhaengigkeit** installiert, keine eigene Kurvenarithmetik, keine eigene
AEAD-Implementierung und kein eigenes Protokoll geschrieben.

### 20.2 Module (additiv)

```
src/lib/crypto/
  key-agreement.ts  X25519 Diffie-Hellman -> nicht-exportierbarer HKDF-CryptoKey
  kdf.ts            HKDF-SHA-256: deriveMessageKey (AES-256-GCM), deriveKeyBytes, hkdfInfo, generateSalt
  symmetric.ts      AES-256-GCM: encryptBytes/decryptBytes (96-Bit-Random-Nonce, optionale AAD)
  primitives.ts     Barrel der Primitive-Schicht (bewusst NICHT aus index.ts re-exportiert)
```

Bestehende Helfer werden wiederverwendet, nicht dupliziert:
`serialization.ts` (`bytesToBase64` / `base64ToBytes` / `toBufferSource`),
`errors.ts` (`CryptoError`), `keys.ts` (`generateIdentityKeyPair` /
`importPublicKey`). `identity.ts`, `prekeys.ts`, `storage.ts`, `index.ts`,
`types.ts` und die IndexedDB-Struktur bleiben unveraendert.

### 20.3 Kryptografische Parameter

| Baustein | Parameter |
|---|---|
| **X25519** | Web Crypto `deriveBits`, 32-Byte Shared Secret. Privater Schluessel MUSS `extractable: false` sein (wird geprueft). Ergebnis wird sofort als **nicht-exportierbarer `HKDF`-CryptoKey** importiert; der Byte-Puffer wird genullt. All-Zero-Ergebnis (Small-Order-Punkt) wird abgelehnt. |
| **HKDF** | SHA-256, ein Extract-and-Expand-Schritt pro Aufruf. Kein Key-Schedule, keine Chain/Root-Keys. |
| **Salt** | **oeffentlich, nicht geheim**, pro Ableitung frisch via `generateSalt()` (32 Byte). Kein fester globaler "Geheim-Salt" — das waere Security-Theater. Leerer Salt ist nur zugelassen, weil RFC 5869 ihn definiert (Known-Answer-Tests). |
| **Domain Separation** | ueber `info`: `hkdfInfo(label)` erzeugt `enough.e2ee.primitive.v1/<label>`. Der Namespace macht explizit, dass dies **nicht** die spaeteren Protokoll-Labels sind. |
| **AES-256-GCM** | 256-Bit-Schluessel (`extractable: false`), 128-Bit-Tag, **96-Bit-Nonce pro Aufruf frisch** aus `crypto.getRandomValues()`. Es gibt bewusst **keine** API, um beim Verschluesseln einen Nonce vorzugeben (Nonce-Reuse-Schutz). Nonce ist oeffentlich und wird mit dem Ciphertext gefuehrt. |
| **AAD** | optional (`aad?: Uint8Array`), authentifiziert aber nicht verschluesselt. Das **produktive AAD-Format ist noch nicht festgelegt** (spaeter z. B. `protocolVersion`, `connectionId`, `senderDeviceId`, `recipientDeviceId`). |
| **Container** | `{ version: 1, nonce, ciphertext }` (Base64) — **nur konzeptionell/Test**, ausdruecklich **kein** `messages`-DB-Format und kein Wire-Format. |

### 20.4 Standardisierte Testvektoren

- **X25519:** RFC 7748 §6.1 (Alice/Bob-Vektor, erwartetes Shared Secret
  `4a5d9d5b…161742`) — geprueft ohne Export des Secrets, ueber Vergleich der
  HKDF-Ableitungen.
- **HKDF-SHA-256:** RFC 5869 Test Case 1, 2 und 3.
- **AES-256-GCM:** McGrew/Viega GCM-Spezifikation, AES-256 Test Case 13, 14
  und 16 (Test Case 16 inklusive AAD) — jeweils gegen `decryptBytes()`.

Es wurden keine eigenen "Expected Values" erfunden.

### 20.5 Security-Grenzen dieser Phase

- Private Keys, Shared Secrets und AES-Keys existieren ausschliesslich als
  **nicht-exportierbare `CryptoKey`-Objekte** im Browser. `exportKey()` wird in
  der Primitive-Schicht nirgends aufgerufen.
- Kein `console.*` in den neuen Modulen; `CryptoError`-Meldungen enthalten kein
  Schluessel-, Nonce- oder Klartextmaterial.
- Kein Zugriff auf Supabase, Netzwerk, IndexedDB, `localStorage`,
  `sessionStorage`, Cookies, URLs oder React-State aus der Primitive-Schicht.
- **Keine produktive Integration:** `src/lib/api.ts` (inkl. `sendMessage()` /
  `getMessagesPage()`), `Chat.tsx`, `MessageBubble.tsx`, `MessageComposer.tsx`,
  das `messages`-Schema, die RLS-Struktur und die Supabase-Migrationen sind
  unveraendert. Die neuen Funktionen werden ausschliesslich von Tests benutzt
  und landen (mangels Import) nicht im Produktions-Bundle.

### 20.6 Ausdruecklich NICHT implementiert

X3DH · PQXDH · Double Ratchet · Triple Ratchet · Session Establishment ·
Forward Secrecy · Post-Compromise Security · Replay-Schutz auf
Protokollebene · Key Verification / Safety Numbers · Multi-Device ·
Offline Session Negotiation · Key-Backup/Recovery · produktive
Nachrichtenverschluesselung.

Keine dieser Eigenschaften entsteht als Nebenprodukt der Primitive-Schicht.
Ein einzelnes X25519-DH mit statischen Identity-Keys liefert insbesondere
**keine** Forward Secrecy — dafuer ist zwingend ein Ratchet-Protokoll noetig
(E2EE-2B+).

### 20.7 Validierung

```
npm run test:crypto   -> 87 Tests (46 bestehend + 41 neu), 0 Fehler
npm run build         -> tsc --noEmit + vite build: PASS
npm run smoke         -> PASS
```
