# enough. — E2EE-2D: Crash- und Rollback-Härtung

**Status:** E2EE-2D implementiert. **Die vollständige E2EE-Integration existiert weiterhin NICHT.**
**Stand:** 2026-08-23
**Scope:** lokaler kryptografischer Zustand. Kein Message-Flow, keine UI, keine Supabase-Änderung.

> E2EE-2D hardens the local cryptographic state lifecycle against rollback and
> crash-consistency failures. It does not constitute the complete enough. v0.2
> E2EE implementation.

`sendMessage()` schreibt weiterhin Klartext nach `messages.ciphertext`
(`src/lib/api.ts:604`). Daran ändert E2EE-2D nichts.

---

## 1. Problem

### 1.1 Der reproduzierte Fehler

Vor der Implementierung wurde geprüft, ob das vermutete Problem überhaupt real ist
(Auftrag §32). Ergebnis: **ja, aber auf der Anwendungsschicht, nicht in der Library.**

Die bestehende Persistenz (`src/lib/crypto/storage.ts`, `putState`) ist ein
unbedingtes `IDBObjectStore.put()` — reines Last-Write-Wins ohne jede
Revisionsprüfung. Reproduktion gegen die echte Implementierung:

```
after commit rev5 : {"state":"S5","revision":5}
after stale write : {"state":"S2","revision":2}

ROLLBACK POSSIBLE AT APPLICATION LAYER: YES — silent overwrite
```

Ein älterer Zustand überschreibt einen neueren **stillschweigend**. Es gibt
keinen Mechanismus, der das bemerkt oder ablehnt.

### 1.2 Die tatsächliche kryptografische Konsequenz — korrekt benannt

Der Auftrag verlangt ausdrücklich keine unbelegte Behauptung über „AES-GCM IV
reuse". Diese Präzisierung ist berechtigt, denn **die Bezeichnung wäre falsch
gewesen**. Untersuchung des tatsächlichen Binaries von
`@getmaapp/signal-wasm@0.6.6`:

| Symbol im WASM | vorhanden |
|---|---|
| `cipher_key`, `mac_key`, `iv` | ja |
| `cbc`, `aes`, `padding`, `hmac` | ja |
| `GCM` / `Gcm` / `AES-GCM` | **nein** |

Signal verwendet für die Nachrichtenverschlüsselung **AES-CBC + HMAC-SHA256**,
nicht AES-GCM. Die Message Keys werden über
`libsignal_protocol::ratchet::keys::MessageKeys::derive_keys` deterministisch
aus dem Chain Key abgeleitet und liefern das Tripel
`(cipher_key, mac_key, iv)`.

Empirisch nachgewiesen (Engine-Test gegen 0.6.6):

```
identical plaintext -> identical ciphertext:            true
differ at plaintext byte 40 -> shared prefix:           150 bytes
total differing bytes:                                   55 of 1824
```

Korrekte Beschreibung der Gefahr:

* Der Ratchet leitet pro Chain-Index **genau einen** Message Key ab.
* Wird der Zustand auf einen früheren Index zurückgesetzt, wird **derselbe
  `(cipher_key, iv)`** für einen **anderen** Klartext verwendet.
* Weil AES-CBC deterministisch ist, sind die Chiffrate bei gleichem Klartext
  **bytegleich**, und bei gemeinsamem Klartext-Präfix teilen sie sich ein
  Chiffrat-Präfix in **AES-Blockgranularität** (16 Byte).
* Ein Beobachter lernt daraus, **ob und wie weit zwei Nachrichten
  übereinstimmen** — ohne jeden Schlüssel.

Das ist kein Keystream-XOR-Bruch wie bei CTR/GCM (dort ergäbe
`C1 XOR C2 = P1 XOR P2` den vollständigen Klartext-XOR). Es ist eine
**deterministische Chiffrat-Gleichheit und Präfix-Leakage** plus die Verletzung
der fundamentalen Double-Ratchet-Regel, dass ein Message Key **genau einmal**
verwendet wird.

> **Korrektur gegenüber `docs/e2ee-2c-validation-report.md`:** Der dortige
> Bericht bezeichnet den Effekt als „Keystream-/IV-Reuse" und impliziert damit
> eine Stromchiffre. Das ist ungenau. Die Beobachtung (bytegleiche Chiffrate,
> gemeinsames Präfix) war korrekt, die Benennung des Mechanismus nicht. Für
> AES-CBC lautet die korrekte Aussage: deterministische Wiederverwendung des
> `(cipher_key, iv)`-Paars mit Präfix-Leakage auf Blockebene.

### 1.3 Zweite Konsequenz: Replay-Fenster auf der Empfängerseite

Der Duplicate-/Replay-Schutz des Double Ratchet (`DuplicatedMessage`) lebt
**ausschließlich im Session-State**. Wird der Empfänger-State zurückgerollt,
öffnet sich das Fenster erneut, und eine bereits verarbeitete Nachricht wird ein
zweites Mal akzeptiert. Auch das ist ein Persistenz-, kein Krypto-Problem.

---

## 2. Threat Model

Betrachtet werden **Fehlerszenarien und lokale Angreifer**, nicht der Netzwerk-
oder Server-Angreifer (der ist Gegenstand der eigentlichen E2EE-Integration).

| # | Szenario | Betrachtet |
|---|---|---|
| T1 | Browser-Crash / Tab-Kill zwischen Encrypt und Persist | ja |
| T2 | iOS/Android beendet Hintergrund-Tab (Normalbetrieb, kein Randfall) | ja |
| T3 | Wiederhergestelltes Profil-/Storage-Backup mit altem IndexedDB-Stand | ja |
| T4 | Zwei Tabs derselben Anwendung schreiben konkurrierend | ja |
| T5 | Teilweise beschädigter oder gelöschter IndexedDB-Inhalt | ja |
| T6 | Lokaler Angreifer mit DevTools-Zugriff auf IndexedDB | **teilweise** — siehe §8 |
| T7 | Netzwerk-/MITM-Angreifer | nein — E2EE-Integration |
| T8 | Kompromittierter Supabase-Server | nein — E2EE-Integration |

**Wichtig zu T6:** Ein Angreifer, der bereits same-origin-JavaScript ausführen
kann, ist durch diese Schicht **nicht** abwehrbar. Das ist eine dokumentierte
Grenze, keine gelöste Bedrohung.

---

## 3. Security Invariants

### Invariante A — Monotonic State
Jeder persistierte Zustand trägt eine ganzzahlige, streng monoton steigende
Revision. Der erste Commit erhält Revision 1. Eine Revision wird niemals
verkleinert.

### Invariante B — No Silent Rollback
Ein älterer Zustand wird nie stillschweigend übernommen. Jeder Rollback wird
**erkannt**, **abgelehnt** und als eindeutiger Status
(`ROLLBACK_DETECTED`) bzw. `CryptoError`-Code diagnostizierbar gemeldet.
Es existiert **kein** Force-Flag und **kein** automatisches Fallback auf ein
älteres Backup.

### Invariante C — Commit Before Externalization
Die verbindliche Reihenfolge lautet:

```
load → encrypt → COMMIT → send
```

Der Zustand ist dauerhaft gültig, **sobald die IndexedDB-Transaktion des
Commits abgeschlossen ist** — nicht vorher. Erst danach darf das Chiffrat das
Gerät verlassen.

### Invariante D — Atomicity of (state, revision)
Zustand und Revision liegen **im selben Record** und werden in **einer**
Transaktion geschrieben. Die Kombination `state = S2, revision = 1` ist
strukturell unmöglich.

### Invariante E — Isolation
Der Storage-Key ist `${userId}:${connectionId}`. Es gibt **keine** globale
`currentCryptoRevision`. Weder zwei Accounts noch zwei Connections teilen sich
jemals einen Zustand.

---

## 4. State Lifecycle und Crash-Punkte

```
        ┌──────────┐
        │  LOADED  │  Zustand + Revision gelesen, validiert
        └────┬─────┘
             │  crash ──▶ nichts passiert. Sicher.
             ▼
        ┌──────────┐
        │ENCRYPTED │  Engine hat Ratchet vorgerückt (nur im Speicher)
        └────┬─────┘
             │  crash ──▶ neuer Zustand verloren, nichts gesendet.
             │            Wiederholung erzeugt dasselbe Chiffrat
             │            aus demselben Zustand. SICHER.
             ▼
        ┌──────────┐
        │COMMITTED │  ◀── Punkt der Dauerhaftigkeit
        └────┬─────┘
             │  crash ──▶ Zustand ist vorgerückt, Nachricht nie gesendet.
             │            Nachricht verloren. Kein Key-Reuse. AKZEPTABEL.
             ▼
        ┌──────────┐
        │   SENT   │
        └──────────┘
             │  crash ──▶ Zustand bleibt vorgerückt. Korrekt.
```

### Bewertung jedes Unterbrechungspunkts

| Unterbrechung | persistent | nicht persistent | Neustart sicher? | Nachricht erneut senden? | Key-Reuse möglich? |
|---|---|---|---|---|---|
| nach `LOADED` | S0 | — | ja | n/a | nein |
| nach `ENCRYPTED` | S0 | S1 | ja | ja, identisch | nein |
| nach `COMMITTED` | S1 | — | ja | **nein** (Nachricht verloren) | nein |
| nach `SENT` | S1 | — | ja | nein | nein |

**Die verbotene Reihenfolge** (`send` vor `commit`) hätte in Zeile 3 stattdessen
`persistent = S0` bei bereits gesendetem Chiffrat — und damit exakt den in §1.2
beschriebenen `(cipher_key, iv)`-Reuse beim nächsten Encrypt.

### Die bewusste Abwägung

Commit-before-send tauscht **Nachrichtenverlust** gegen **Key-Reuse**.
Ein verlorener Text ist ärgerlich und für den Nutzer sichtbar reparierbar
(erneut tippen). Ein wiederverwendeter Message Key ist ein stiller, dauerhafter
Vertraulichkeitsverlust. Die Reihenfolge bevorzugt deshalb **immer** den
Nachrichtenverlust.

---

## 5. Persistence Model

### 5.1 Was IndexedDB tatsächlich garantiert

Der Auftrag verlangt, keine falsche Atomizität zu behaupten (§6). Konkret:

| Eigenschaft | Realität |
|---|---|
| Mehrere `put()` in **einer** Transaktion | atomar — alle oder keine |
| `put()` über **mehrere** Transaktionen | **nicht** atomar |
| Zwei Transaktionen auf denselben Store | vom Browser serialisiert |
| `durability: 'strict'` | fordert Flush auf Medium an; **keine Garantie gegen OS-/Hardware-Verlust** |
| Storage-Eviction durch das OS | kann die **gesamte** Datenbank entfernen |

Deshalb liegt alles, was konsistent sein muss, in **einer** Transaktion und in
**einem** Record.

### 5.2 Datenmodell

Store `ratchet` in der bestehenden Datenbank `enough-crypto` (Version 1 → 2,
rein additiv):

```ts
interface PersistedRatchetState {
  version: number;        // Record-Format, nicht Protokollversion
  userId: string;
  connectionId: string;
  revision: number;       // monoton, erster Commit = 1
  state: Uint8Array;      // OPAKE Engine-Bytes, nie interpretiert
  committedAt: number;
}
```

Zwei Schlüssel pro Session:

```
${userId}:${connectionId}                 → PersistedRatchetState
${userId}:${connectionId}:__watermark     → number (High-Water-Mark)
```

Der Suffix `:__watermark` enthält Zeichen, die in einer UUID nicht vorkommen,
kann also nie mit einem echten Record-Key kollidieren.

### 5.3 Warum zusätzlich eine Watermark?

Die Revision **im Record** schützt gegen konkurrierende Writer. Sie schützt
**nicht** gegen den Fall, dass der Record selbst durch einen älteren ersetzt
oder gelöscht wird (Backup-Restore, Teilverlust) — dann wäre auch die Revision
wieder klein und alles sähe konsistent aus.

Die Watermark ist der monotone Höchststand aller je committeten Revisionen.
Damit werden zwei sonst unsichtbare Fälle erkennbar:

* Record-Revision **kleiner** als Watermark → `ROLLBACK_DETECTED`
* Record **fehlt**, Watermark **> 0** → `ROLLBACK_DETECTED` (und ausdrücklich
  **nicht** `MISSING`, was fälschlich eine neue Session rechtfertigen würde)

### 5.4 Compare-and-Swap

```ts
commitRatchetState(userId, connectionId, expectedRevision, state)
```

In **einer** `readwrite`-Transaktion:

1. aktuellen Record lesen und validieren
2. `storedRevision === expectedRevision`? sonst → `REVISION_CONFLICT`, Abbruch
3. `nextRevision = expectedRevision + 1`
4. `nextRevision > watermark`? sonst → `ROLLBACK_DETECTED`, Abbruch
5. Record **und** Watermark schreiben
6. Transaktion abschließen

Schritt 4 ist Defence-in-Depth: Selbst ein Aufrufer mit passender, aber
veralteter Revision kann nicht auf oder unter den Höchststand zurückfallen.

---

## 6. Conflict Handling

Ein Stale Writer (zweiter Tab, wiederaufgewachter Hintergrund-Tab) erhält
`CryptoError('REVISION_CONFLICT')`. Der Commit findet **nicht** statt.

Kritisch: Im Sequencer schlägt der Commit **vor** dem Senden fehl, das Chiffrat
wird also **verworfen und nie übertragen**. Das ist korrekt — es stammt aus
einem Zustand, der nicht mehr aktuell ist. Nachgewiesen durch Test `D2`:
bei drei parallelen Sendeversuchen wird genau **ein** `send()` ausgeführt.

Es gibt **kein** automatisches Merge und **kein** Retry innerhalb dieser
Schicht. Der Aufrufer muss den Zustand neu laden und die Operation bewusst
wiederholen (Test `D3`).

**Nicht implementiert:** ein Web Lock. Diese Schicht macht konkurrierende
Schreibzugriffe *sicher*, sie macht sie nicht *seltener*. Ein Lock bleibt als
Performance-Optimierung sinnvoll — als Sicherheitsmechanismus ist er ungeeignet,
weil ein OS-Kill den Lock ohne `finally` verschwinden lässt. Die
CAS-/Watermark-Prüfung ist die autoritative Verteidigung.

---

## 7. Recovery

| Status | Bedeutung | Erlaubte Reaktion |
|---|---|---|
| `VALID` | Record vorhanden, konsistent, ≥ Watermark | normal weiterarbeiten |
| `MISSING` | kein Record **und** Watermark = 0 | neue Session zulässig |
| `CORRUPTED` | Record unlesbar/strukturell ungültig | **anhalten**, Nutzer informieren |
| `ROLLBACK_DETECTED` | Record älter als Watermark, oder fehlt bei Watermark > 0 | **anhalten**, kein Encrypt/Decrypt |
| `USER_MISMATCH` | Record gehört zu anderem User/Connection | **anhalten** |

Verbindliche Regeln:

* `loadRatchetState()` wirft bei defekten Daten **nicht**, sondern liefert einen
  Status. Der Aufrufer muss sich explizit entscheiden.
* `CORRUPTED` führt **niemals automatisch** zu einer neuen Session. Das würde
  eine bestehende Session zerstören und Sicherheitsinvarianten brechen.
  Nur `MISSING` rechtfertigt einen Neuanfang.
* `encryptCommitSend()` und `decryptAndCommit()` **verweigern die Arbeit**, bevor
  sie die Engine überhaupt aufrufen, wenn der Status nicht `VALID`/`MISSING` ist
  (Tests `C4`, `G4`). Damit wird nie ein weiterer Message Key auf einem
  nicht vertrauenswürdigen Zustand abgeleitet.
* `commitRatchetState()` überschreibt einen korrupten Record **nicht** blind
  (Test `F3`).

Das im Auftrag §14 verbotene Muster existiert nirgends im Code:

```ts
try { loadState(); } catch { loadOldBackup(); }   // kommt nicht vor
```

---

## 8. Remaining Limitations

Ehrliche Auflistung dessen, was **nicht** gelöst ist.

1. **Keine kryptografische Authentizität des Vaults.**
   Revision und Watermark liegen als Klartext-Zahlen in IndexedDB. Wer
   same-origin-JavaScript ausführen oder direkt in den Profilordner schreiben
   kann, kann sie manipulieren. Getestet wurde die *Richtung*, die zählt: Ein
   Angreifer kann die Revision **hochsetzen** (Test `F4`) — das führt zu einem
   Denial-of-Service, aber die echte ältere Session lässt sich danach **nicht**
   mehr einspielen. Ein Angreifer, der die Watermark **senkt**, kann den Schutz
   aushebeln. Ein authentifizierter Vault (wie in
   `experiments/e2ee-2c/` mit non-extractable AES-256-GCM-Wrapping-Key und AAD)
   würde das adressieren; er ist hier **bewusst nicht** integriert, weil das den
   Scope von E2EE-2D überschreitet und eigene Krypto-Entscheidungen erfordert.
   **Bewusst keine selbst erfundene Kryptografie.**

2. **Kein Schutz gegen vollständige Storage-Löschung.**
   Wird die gesamte Datenbank entfernt (Nutzer löscht Browserdaten, OS-Eviction),
   verschwindet auch die Watermark. Das ist von einer neuen Installation nicht
   unterscheidbar. Abgefangen wird nur der **partielle** Verlust.

3. **Kein Web Lock.** Siehe §6.

4. **Nicht in einem echten Browser getestet.** Alle Tests laufen unter Node mit
   `fake-indexeddb`. Realverhalten von Safari/WebKit — insbesondere
   Storage-Eviction und `durability: 'strict'` — ist damit **nicht** verifiziert.

5. **Keine Integration in den Message-Flow.** `encryptCommitSend()` wird von
   keinem Produktionscode aufgerufen. Der Nachweis, dass die echte
   Signal-Engine korrekt daran andockt, steht aus.

6. **Multi-Device ist nicht adressiert.** Das Modell kennt genau einen lokalen
   Zustand pro `(userId, connectionId)`.

7. **Account-Löschung entfernt auch die Watermark.** Für die Löschung ist das
   richtig, bedeutet aber: ein neu angelegter Account mit derselben
   `connectionId` startet bei Revision 0.

---

## 9. Dependency Audit

| Punkt | Ergebnis |
|---|---|
| `@getmaapp/signal-wasm` in `package.json` der App | **nein** |
| Vorkommen im Lockfile der App | **keines** |
| Einzige Nutzung | `experiments/e2ee-2b/` (isolierter Spike, `0.6.6`, exakt gepinnt) |
| Neue Dependencies durch E2EE-2D | **keine** |
| Dependency-Upgrades durch E2EE-2D | **keine** |
| Mehrfache Versionen desselben Signal-Pakets | nein |

E2EE-2D fügt **keine** Abhängigkeit hinzu. Die Analyse des Chiffrier-Modus
(§1.2) erfolgte gegen `0.6.6` in einem temporären Verzeichnis außerhalb des
Repositories.

Bewusste Konsequenz: `ratchet-state.ts` behandelt den Zustand als **opake
Bytes** und hat **keine** Kenntnis der Engine. Diese Schicht bleibt damit auch
gültig, falls die Engine-Entscheidung später revidiert wird.

---

## 10. Geänderte und neue Dateien

| Datei | Art | Inhalt |
|---|---|---|
| `src/lib/crypto/ratchet-state.ts` | **neu** | CAS-Persistenz, Watermark, Recovery-Status |
| `src/lib/crypto/ratchet-session.ts` | **neu** | Sequencer + Failure Injection |
| `src/lib/crypto/__tests__/ratchet-state.test.mjs` | **neu** | 35 Tests |
| `src/lib/crypto/types.ts` | geändert | DB v2, `ratchet`-Store, Key-Helfer, 2 Fehlercodes |
| `src/lib/crypto/storage.ts` | geändert | Store-Anlage, Löschung inkl. Ratchet-State |
| `src/lib/crypto/errors.ts` | geändert | Meldungen für die 2 neuen Codes |
| `package.json` | geändert | neue Testdatei in `test:crypto` |

**Nicht geändert:** `api.ts`, `sendMessage()`, UI-Komponenten, `AuthContext`,
Supabase-Migrationen, RLS, Routing, Theme, i18n.

Der Produktions-Bundle wächst um **0.46 kB** (489.30 kB gegenüber 488.84 kB) —
die neuen Module werden mangels Importeur wegoptimiert. Das ist der beste
Beleg dafür, dass nichts in den Produktpfad eingebaut wurde.

---

## 11. Testabdeckung

35 neue Tests in `src/lib/crypto/__tests__/ratchet-state.test.mjs`.
Der Schwerpunkt liegt bewusst auf dem Nachweis, dass **falsches Verhalten
abgelehnt wird** (Auftrag §31), nicht auf dem Happy Path.

| Gruppe | Tests | Kern |
|---|---|---|
| A — Revision | A1–A5 | Monotonie, ältere/zukünftige Revision abgelehnt, (state, revision) konsistent |
| B — Crash | B1–B6 | Crash vor/nach Commit, vor/nach Send; Reihenfolge beobachtbar; Sendefehler rollt nicht zurück |
| C — Rollback | C1–C5 | Snapshot 10 vs 11, Stale Tab, manipulierter Store, Encrypt verweigert, fehlender Record |
| D — Concurrency | D1–D3 | genau ein Gewinner, Verlierer senden nicht, Retry nach Konflikt |
| E — Isolation | E1–E5 | Connection- und User-Trennung, Account-Löschung inkl. Watermark |
| F — Recovery | F1–F5 | `MISSING`, 7 Korruptionsfälle, kein blindes Überschreiben, Manipulationsgrenze, Argumentprüfung |
| G — Replay | G1–G4 | Idempotenz-Leiter, kein Re-Encrypt nach Restore, Empfängerseite |
| H — Property | H1–H2 | 240 zufällige Operationen (deterministischer LCG): Revision sinkt nie |

Ergebnis:

```
npm run test:crypto   → 122/122 bestanden (87 bestehende + 35 neue)
npm run build         → erfolgreich
npm run smoke         → alle bestanden
```

Zusätzlich verifiziert: Das Upgrade der Datenbank von Version 1 auf 2 erhält
bestehende Identitäten und Prekeys (separat geprüft, keine Datenmigration
nötig).
