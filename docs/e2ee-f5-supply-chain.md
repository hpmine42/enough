# enough. — F5: Supply-Chain-Härtung für `@getmaapp/signal-wasm@0.6.6`

**Status:** implementiert (CI-Hash-Assert, Option A) — Vendoring geprüft und verworfen
**Datum:** 2026-08-24
**Betrifft:** ausschließlich die Supply-Chain-Verifikation der WASM-/Crypto-Artefakte.
Keine Änderung an E2EE-Architektur, engine-adapter, session-manager, Protokoll,
Schema, RLS oder Tests.

---

## 1. Audit-Fund F5

> Vendoring der WASM-Artefakte und/oder ein CI-Hash-Assert gegen die bekannten
> Provenienzwerte fehlt.

Bisherige Absicherung: npm-Lockfile + exakte Dependency-Version (`0.6.6`) +
dokumentierte Artefakt-Hashes (`docs/e2ee-2c-provenance.md`,
`experiments/e2ee-2c-provenance/manifest.json`) — aber **keine maschinelle
Prüfung** dieser Hashes.

## 2. Bestandsaufnahme (Phase 1, 2026-08-24)

| Frage | Befund |
|---|---|
| Welche WASM-Dateien werden verwendet? | `signal_wasm_bg.wasm` (797.749 B, der ausgeführte Crypto-Kern) und `signal_wasm.js` (78.213 B, wasm-bindgen-Glue). Dazu `signal_wasm.d.ts` (nur Typen) sowie `LICENSE`/`README.md`/`package.json` (nicht ausführbar). |
| Woher kommen sie? | npm-Tarball `https://registry.npmjs.org/@getmaapp/signal-wasm/-/signal-wasm-0.6.6.tgz`; npm-Publikation **ohne** Provenance-Attestierung (dokumentiert in `docs/e2ee-2c-provenance.md`). |
| Laden direkt aus npm oder Bundle-Verarbeitung? | Beides: Browser lädt zur Laufzeit das von Vite emittierte `dist/assets/signal_wasm_bg-*.wasm`; Vite kopiert die Datei **byteidentisch** (in dieser Phase per Hashvergleich bewiesen). `signal_wasm.js` wird von Vite gebundelt/transformiert (Hash nach Bundling nicht stabil). Node-Tests laden `signal_wasm_bg.wasm` per `initSync` direkt aus `node_modules`. |
| Welche Dateien müssen geprüft werden? | Alle 6 Dateien des Pakets (vollständige Abdeckung; entspricht dem auditierten Manifest). |
| Sind die dokumentierten Hashes weiterhin exakt reproduzierbar? | **Ja.** Frisches `npm ci` am 2026-08-24: alle 6 SHA-256-Werte aus `docs/e2ee-2c-provenance.md` §1 stimmen byte-exakt mit den installierten Dateien überein. |
| Ist ein CI-Hash-Assert deterministisch möglich? | **Ja.** Reine Dateisystem-Prüfung gegen `npm ci`-installierte Artefakte; kein zusätzliches Netzwerk, keine Secrets, Node-Bordmittel (`node:crypto`). |

## 3. Entscheidung: Option A (CI-Hash-Assert), kein Vendoring

Vendoring wurde geprüft und **verworfen**:

- `npm ci` verifiziert bereits kryptographisch die sha512-Integrität des
  Tarballs gegen das Lockfile. Der Hash-Assert deckt darüber hinaus jede
  Veränderung der **entpackten, tatsächlich verwendeten Dateien** ab — auch
  nach der Installation. Für Integrität bringt Vendoring damit keinen
  Zusatzgewinn.
- Vendoring würde invasive Änderungen erfordern: Das einzige Produktionsmodul,
  das `@getmaapp/signal-wasm` importiert, ist `src/lib/e2ee/engine-adapter.ts`
  (bewusst eingefroren). Ein vendoriertes Artefakt müsste entweder die
  Dependency-Auflösung (`file:`-Dependency) oder die Ladeschicht ändern —
  beides ist für F5 ausgeschlossen (keine eigene Crypto-/WASM-Ladeschicht,
  keine Architekturänderung).
- Vendoring würde ~1 MB Binaries ins Repository bringen, mit Drift-Risiko
  (repo vs. npm) bei jedem Versionswechsel.
- Der einzige echte Zusatznutzen von Vendoring wäre **Verfügbarkeit**
  (Schutz vor Unpublish/Registry-Ausfall), nicht Integrität — nicht der
  Gegenstand von F5.

## 4. Implementierung

- **`scripts/verify-signal-wasm.mjs`** (npm-Script `verify:signal-wasm`):
  1. `package.json` pinnt `@getmaapp/signal-wasm` exakt auf `0.6.6` (kein Range-Operator).
  2. `package-lock.json`: Version, Tarball-URL und sha512-Integrität entsprechen dem auditierten Stand.
  3. Installiertes Paket identifiziert sich als `@getmaapp/signal-wasm@0.6.6`.
  4. Paketverzeichnis enthält **exakt** die 6 auditierten Dateien (nichts fehlt, nichts zusätzlich).
  5. SHA-256 jeder Datei == auditierter Manifest-Wert.
  6. Falls `dist/` existiert: genau ein `signal_wasm_bg-*.wasm`-Asset und byteidentisch mit dem auditierten WASM.
- **`.github/workflows/deploy.yml`**: Schritt „Verify signal-wasm artifacts (F5)"
  direkt nach `npm ci`, **vor** Build, allen Tests und dem Pages-Deploy.
  Exit-Code ≠ 0 bricht den Workflow ab; ein Hash-Mismatch verhindert das Deployment.
  Bestehende F4- (Test-Gate) und F3- (Live-Postgres) Schritte bleiben unverändert erhalten.

### Geprüfte SHA-256-Werte (Quelle: `docs/e2ee-2c-provenance.md` §1; am 2026-08-24 aus frischem `npm ci` unabhängig neu berechnet und bestätigt)

| Datei | SHA-256 |
|---|---|
| `signal_wasm_bg.wasm` | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` |
| `signal_wasm.js` | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` |
| `signal_wasm.d.ts` | `32441be517be4cf6b5bd12506e756d07dabb84859941cffb56657ff4c9dad7f2` |
| `package.json` | `677b54900bf2c8fc422e7771efd90d1a5c10b251402c8bcae27d5fd445cddded` |
| `README.md` | `6c1b3f948eec9e7d8527dd5d5ad6fb5b2405e059a51ce292baadd7cdb0d2fe26` |
| `LICENSE` | `2b87ae924bd39116783dbb5d33770a9fcd4d62a5578204c6304f572bcdc5f091` |

## 5. Was der Check garantiert — und was nicht

**Garantiert:**
- Das Lockfile pinnt die Dependency-Version exakt (`0.6.6`, kein Range).
- npm-Integritätsschutz: `npm ci` verifiziert die sha512-Tarball-Integrität gegen das Lockfile.
- Der CI-Hash-Assert erkennt jede unerwartete Änderung der installierten
  Artefakte (Substitution bei Publikation, Manipulation nach der Installation,
  unerwartete zusätzliche Dateien) und jede Abweichung von Lockfile/Manifest.
- Das ausgelieferte `dist`-WASM (sofern gebaut) ist byteidentisch mit dem auditierten Artefakt.

**Nicht garantiert:**
- **Kein bewiesener reproduzierbarer Build.** Das Upstream-Repository pinnt
  keine Toolchain und hat keine CI; ein byte-exakter Nachbau wurde nie
  ausgeführt (siehe `docs/e2ee-2c-provenance.md` §4/§7: „REPRODUCTION BLOCKED
  BY ENVIRONMENT"). Das Repository ist damit **nicht** „vollständig
  reproduzierbar".
- **Die npm-Supply-Chain ist nicht vollständig abgesichert.** Die Quelle bleibt
  der npm-Registry-Tarball ohne Provenance-Attestierung. Der Check pinnt die
  *bekannten auditierten Bytes* — er kann nicht beweisen, dass diese Bytes
  korrekt aus dem Upstream-Quellcode gebaut wurden.
- Ein kompromittierter CI-Runner (nach dem Verifier-Schritt) ist durch den
  Check nicht abgedeckt; das ist außerhalb des Scopes statischer Artefakt-Prüfung.

## 6. Negativtest (2026-08-24, vollständig wiederhergestellt)

1. `signal_wasm_bg.wasm` in `node_modules` um 1 Byte verändert → `npm run verify:signal-wasm` → **FAIL** (SHA-256-Mismatch, Exit-Code 1).
2. Artefakt byte-exakt wiederhergestellt (SHA-256 kontrolliert) → **PASS** (Exit-Code 0).
3. Zusätzlich: sha512-Integrität in `package-lock.json` verfälscht → **FAIL**; Lockfile wiederhergestellt (SHA-256 kontrolliert) → **PASS**.

Es wurde kein Produktionsartefakt und keine Dependency dauerhaft verändert.

## 7. Pflege bei einem legitimen Versionswechsel

Bei einem bewussten Upgrade von `@getmaapp/signal-wasm` müssen **gemeinsam**
aktualisiert werden: `package.json`, `package-lock.json` und die Manifest-Werte
in `scripts/verify-signal-wasm.mjs` (dortige Kommentare zur Hash-Herkunft
beachten). Der neue Hash ist vorher aus den tatsächlich installierten Dateien
zu ermitteln, nicht aus Fremdquellen zu übernehmen, und die Provenienz der
neuen Version ist wie in `docs/e2ee-2c-provenance.md` beschrieben neu zu bewerten.
