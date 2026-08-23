# enough. — E2EE-2D: Crash- und Rollback-Härtung

**Status:** E2EE-2D.2 implementiert (Stage 1–6). **Die vollständige E2EE-Integration existiert weiterhin NICHT.**
**Stand:** 2026-08-23
**Scope:** lokaler kryptografischer Zustand. Kein Message-Flow, keine UI, keine Supabase-Änderung.

> E2EE-2D hardens the local cryptographic state lifecycle against rollback and
> crash-consistency failures. It does not constitute the complete enough. v0.2
> E2EE implementation.

`sendMessage()` schreibt weiterhin Klartext nach `messages.ciphertext`
(`src/lib/api.ts:604`). Daran ändert E2EE-2D.2 nichts.

> **Korrekturhinweis zu diesem Dokument.** Frühere Fassungen haben T3
> (Storage-Restore) als abgedeckt und Invariante B als vollständig durchgesetzt
> beschrieben. **Das Architekturdokument war hier falsch.** Ein vollständiger
> Origin-Restore wird von der lokalen Watermark **nicht** erkannt; siehe §2, §3
> und §8.1. Die betroffenen Aussagen sind unten korrigiert, nicht abgeschwächt.

### Was E2EE-2D.2 gegenüber E2EE-2D ändert

| Befund | Status nach 2D.2 |
|---|---|
| C-2 — alter State mit erhöhter Revision akzeptiert | **geschlossen** — Revision ist AEAD-AAD, siehe §5.5 |
| H-1 — Engine-Divergenz nach verlorenem CAS | **geschlossen** — Ephemeral Engine, siehe §4.1 |
| H-2 — `Number`-Revision, `1e308` wedged die Session | **geschlossen** — uint64, siehe §5.6 |
| H-3 — `MISSING` wurde wie eine neue Session behandelt | **geschlossen** — `NEEDS_ESTABLISH`, siehe §7 |
| C-1 — koordinierter Full-Origin-Rollback | **OFFEN** — braucht externen Anchor, siehe §8.1 |

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
| T3 | Wiederhergestelltes Profil-/Storage-Backup mit altem IndexedDB-Stand | **nein — nur teilweise, siehe unten** |
| T4 | Zwei Tabs derselben Anwendung schreiben konkurrierend | ja |
| T5 | Teilweise beschädigter oder gelöschter IndexedDB-Inhalt | ja |
| T6 | Lokaler Angreifer mit DevTools-Zugriff auf IndexedDB | **teilweise** — siehe §8 |
| T7 | Netzwerk-/MITM-Angreifer | nein — E2EE-Integration |
| T8 | Kompromittierter Supabase-Server | nein — E2EE-Integration |

**Wichtig zu T3 — Korrektur.** Frühere Fassungen dieses Dokuments haben T3 als
„ja" markiert. **Das Architekturdokument war hier falsch.** Zu unterscheiden
sind zwei Fälle:

* **Partieller Rollback** (nur der Record wird alt, Watermark bleibt aktuell;
  Record gelöscht; Watermark manipuliert): wird erkannt und abgelehnt.
* **Koordinierter Full-Origin-Rollback** (Record, Watermark **und** Sealing Key
  werden gemeinsam auf einen früheren Stand zurückgesetzt — Profil-Backup,
  Dateisystem-Snapshot, Container-Rollback): wird **nicht** erkannt. Der
  wiederhergestellte Zustand ist echt versiegelt und in sich konsistent; jede
  lokale Prüfung sagt korrekt `VALID`.

Der Grund ist strukturell und nicht durch bessere lokale Krypto behebbar: Jeder
lokale Anker liegt **innerhalb** dessen, was zurückgerollt wird. Ein weiterer
IndexedDB-Wert würde mit zurückgerollt. Siehe §8.1.

Regressionstest `C8` in `ratchet-state.test.mjs` hält diese Grenze fest und
behauptet ausdrücklich **nicht**, dass der Fall erkannt wird.

**Wichtig zu T6:** Ein Angreifer, der bereits same-origin-JavaScript ausführen
kann, ist durch diese Schicht **nicht** abwehrbar. Das ist eine dokumentierte
Grenze, keine gelöste Bedrohung. Was 2D.2 hinzufügt: Ein solcher Angreifer kann
einen alten State **nicht** mehr durch bloßes Hochsetzen der Revision
autoritativ machen (C-2), weil er dafür den nicht-extrahierbaren Sealing Key
bräuchte. Er kann weiterhin Daten löschen (DoS) und — falls er den State selbst
lesen kann — beliebigen Schaden anrichten.

---

## 3. Security Invariants

### Invariante A — Monotonic State
Jeder persistierte Zustand trägt ein streng monoton steigendes Paar
`(epoch, revision)`, beide als **uint64** (`Uint8Array(8)`, Big-Endian
persistiert, `BigInt` im Speicher). Der erste Commit einer Epoch erhält
Revision 1. Ein Wert wird niemals verkleinert; ein Überlauf über `2^64 - 1`
wird abgelehnt und **nicht** umgebrochen.
Tests: `A1`, `A2`, `A6`, `J1`, `revision.test.mjs` R1–R16.

### Invariante B — No Silent Rollback (**korrigierte Fassung**)

Frühere Fassungen behaupteten hier, **jeder** Rollback werde erkannt.
**Das Architekturdokument war hier falsch.** Korrekt ist:

* Ein älterer Zustand wird nie **stillschweigend übernommen**, soweit er lokal
  **unterscheidbar** ist.
* Erkannt und abgelehnt werden: Record älter als Watermark, fehlender Record bei
  Watermark > 0, gelöschte oder manipulierte Watermark, gefälschte Revision,
  fremder User/fremde Connection.
* **Nicht** erkannt wird der koordinierte Full-Origin-Rollback (§8.1).
* Es existiert **kein** Force-Flag und **kein** automatisches Fallback auf ein
  älteres Backup.

Invariante B gilt also **relativ zum lokalen Anker**, nicht absolut. Absolut
wird sie erst mit einem externen, monoton wachsenden Epoch-Anker.
Tests: `C1`–`C7` (Erkennung), `C8` (dokumentierte Grenze).

### Invariante F — Cryptographic Binding (neu in 2D.2)
Revision, Epoch, User-Id, Connection-Id und Envelope-Version sind **AEAD
Additional Data** über den State-Bytes. Ein Header-Feld lässt sich nicht ändern,
ohne das Authentication Tag ungültig zu machen. Damit ist
`revision ↔ state bytes` kryptografisch untrennbar.
Tests: `sealed-state.test.mjs` S7–S18, `ratchet-state.test.mjs` C2.

### Invariante G — No Implicit Session Creation (neu in 2D.2)
Ein Sende- oder Empfangsversuch erzeugt **niemals** eine Session. Fehlender
State führt zu `NEEDS_ESTABLISH` und zum Abbruch. Sessions entstehen
ausschließlich über `adoptSessionFromEstablishment()`.
Tests: `F2`, `F3`, `F4`, `F5`.

### Invariante H — No Engine Residue (neu in 2D.2)
Ein Message Key darf nie aus einer geteilten, dauerhaft veränderten Engine
stammen. Pro Versuch existiert eine eigene, wegwerfbare Engine; ein verlorener
CAS verwirft sie samt Chiffrat.
Tests: `D2`, `H1`–`H4`, real-engine `RE1`, `RE3`, `RE4`.

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

Die Watermark ist der monotone Höchststand aller je committeten
`(epoch, revision)`-Paare. Damit werden drei sonst unsichtbare Fälle erkennbar:

* Record-Version **kleiner** als Watermark → `ROLLBACK_DETECTED`
* Record **fehlt**, Watermark **> 0** → `ROLLBACK_DETECTED` (und ausdrücklich
  **nicht** `MISSING`, was fälschlich eine neue Session rechtfertigen würde)
* Watermark **fehlt oder ist unlesbar**, obwohl ein Record existiert → `WEDGED`

Der letzte Fall ist neu in 2D.2 und wichtig: Eine fehlende Watermark als „0"
zu lesen, würde die Rollback-Erkennung genau dann abschalten, wenn ein
Angreifer sie abschalten möchte. Record und Watermark werden in **einer**
Transaktion geschrieben; nur eines von beiden vorzufinden ist im ehrlichen
Betrieb unmöglich. Tests `C5`, `C6`.

#### Die Watermark ist KEIN vollständiger Trust Anchor

Ausdrücklich festgehalten, weil frühere Fassungen das Gegenteil nahelegten:
Die Watermark liegt in **derselben** IndexedDB-Datenbank, in **demselben**
Object Store und in **demselben** Origin-Storage-Bucket wie der Record. Sie
teilt dessen Lebenszyklus vollständig — Backup, Restore, Eviction, Löschung
treffen beide gemeinsam. Sie kann daher nur **Inkonsistenzen zwischen** Record
und Watermark aufdecken, nicht deren **gemeinsame** Rückdatierung.

Eine zweite lokale Watermark, eine zweite IndexedDB-Datenbank oder ein
`localStorage`-Spiegel ändern daran nichts: Sie liegen alle im selben Origin
und werden mitrestauriert. Der Versuch, C-1 lokal zu lösen, ist deshalb
aufgegeben und **nicht** implementiert.

### 5.4 Compare-and-Swap

```ts
commitRatchetState(userId, connectionId, { epoch, revision }, state)
```

Der Commit läuft in **zwei Phasen**. Grund: Web Crypto ist asynchron, und ein
`await` auf `crypto.subtle` **innerhalb** einer IndexedDB-Transaktion lässt
diese auto-committen — der folgende `put()` wirft dann
`TransactionInactiveError`. Versiegeln und Verifizieren müssen deshalb außerhalb
der Transaktion passieren.

**Phase 1 — asynchron, außerhalb jeder Transaktion:**

1. Overflow-Prüfung: `nextRevision = revision + 1`, Abbruch bei `> 2^64 - 1`
2. Sealing Key laden, sonst → `KEY_MISSING`
3. Record + Watermark konsistent lesen
4. gespeicherten Envelope **entsiegeln und authentifizieren** — erst danach
   definiert er „current". Den Klartext-Header eines unverifizierten Records zu
   glauben, ist genau die C-2-Lücke.
5. `current === expected`? sonst → `REVISION_CONFLICT`
6. `(epoch, nextRevision) > watermark`? sonst → `ROLLBACK_DETECTED`
7. neuen Envelope versiegeln

**Phase 2 — die atomare Transaktion, rein synchron:**

8. Record und Watermark erneut lesen
9. Ist der Record **byte-identisch** mit dem in Phase 1 authentifizierten?
   Sonst → `REVISION_CONFLICT`. Byte-Identität ist hier die richtige Prüfung:
   sie braucht keinen Schlüssel, ist selbst nicht fälschbar und schlägt bei
   *jeder* Änderung an — auch bei einem Overwrite auf derselben Revision.
10. Watermark unverändert? sonst → `REVISION_CONFLICT`
11. Record **und** Watermark schreiben, Transaktion abschließen

Schritt 6/10 ist Defence-in-Depth: Selbst ein Aufrufer mit passender, aber
veralteter Version kann nicht auf oder unter den Höchststand zurückfallen.
Test `D1` zeigt: bei 50 parallelen Writern gewinnt genau **einer**.

### 5.5 Sealed State Envelope (neu in 2D.2)

Der Record ist kein Klartextobjekt mehr, sondern:

```
AAD    = "enough.e2ee.ratchet.v3|<userId>|<connectionId>|<epochHex>|<revHex>"
sealed = AES-GCM-256(sealingKey, stateBytes, AAD)
```

* Sealing Key: pro User ein **nicht extrahierbarer** AES-GCM-256 `CryptoKey`
  (`extractable: false`, verifiziert in Test `S1`: `exportKey` schlägt für
  `raw` **und** `jwk` fehl), gespeichert im neuen Store `vaultkeys`.
* Epoch und Revision gehen als **feste 16-stellige Hex-Werte** in die AAD, damit
  die Abbildung Wert → AAD eindeutig ist.
* `|` ist als Trennzeichen in User-/Connection-Ids **verboten** (Test `S24`),
  sonst wären `("a|b","c")` und `("a","b|c")` nicht unterscheidbar.
* Es wird **keine eigene Kryptografie** implementiert. AES-GCM und die
  Schlüsselerzeugung kommen aus WebCrypto.

**Was die Versiegelung leistet:** Ein Header-Feld — Version, User, Connection,
Epoch, Revision — lässt sich nicht ändern, ohne das Tag zu brechen. Der
C-2-Angriff (echter alter State + `revision: 500`) schlägt fehl (`S7`, `C2`).

**Was sie nicht leistet — geprüft, nicht angenommen:** AEAD macht ein Chiffrat
nicht *innerhalb* eines Tupels eindeutig. Zwei Envelopes, die für dasselbe
`(user, connection, epoch, revision)` versiegelt wurden, sind gegeneinander
austauschbar (Test `S10b`). Das ist hier folgenlos, aber aus einem
**strukturellen** Grund, nicht aus einem kryptografischen: Pro Slot wird nie
mehr als ein Envelope persistiert, weil der Verlierer eines CAS seinen Envelope
verwirft. Der Punkt ist als Test festgehalten, damit er nicht später zu einer
stärkeren Behauptung umgedeutet wird.

### 5.6 Revision als uint64 (neu in 2D.2)

`Number` ist als Sicherheitszähler ungeeignet:

```js
Number.isInteger(1e308) === true   // besteht eine naive Prüfung
1e308 + 1 === 1e308                // Inkrement ohne Wirkung
```

Ein solcher Wert im Revisionsfeld hätte die Session **dauerhaft** blockiert, da
kein Commit je eine höhere Revision erreichen kann. Ersetzt durch:

| Aspekt | Wahl |
|---|---|
| persistiert | `Uint8Array(8)`, Big-Endian, unsigned |
| im Speicher | `BigInt` |
| Domäne | `0 … 2^64 - 1`, hart geprüft |
| Overflow | `REVISION_OVERFLOW`, **kein** Wrap, **keine** Sättigung |
| `Number`-Eingabe | nur über `revisionFromNumber()`, nur sichere Integer |

Big-Endian mit fester Breite, weil `memcmp` damit der numerischen Ordnung
entspricht, es als IndexedDB-**Key** zulässig ist (ein nacktes `BigInt` wirft
`DataError`) und es genau **eine** Kodierung pro Wert gibt — letzteres ist
nötig, weil die Bytes in die AAD eingehen.

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

## 7. Recovery und Missing-State-Semantik

| Status | Bedeutung | Erlaubte Reaktion |
|---|---|---|
| `VALID` | Envelope authentifiziert, nicht älter als Watermark | normal weiterarbeiten |
| `MISSING` | kein Record **und** Watermark = 0 | **kein** Auto-Start; nur expliziter Establish-Pfad |
| `CORRUPTED` | Record strukturell ungültig | **anhalten**, Nutzer informieren |
| `UNSEAL_FAILED` | AEAD-Tag falsch: Header oder Chiffrat manipuliert | **anhalten** |
| `ROLLBACK_DETECTED` | Record älter als Watermark, oder fehlt bei Watermark > 0 | **anhalten**, kein Encrypt/Decrypt |
| `EPOCH_STALE` | Record-Epoch kleiner als aufgezeichnete Epoch | **anhalten** |
| `KEY_MISSING` | Sealing Key fehlt, versiegelte Daten existieren | **anhalten**, nicht als neu behandeln |
| `USER_MISMATCH` | Record gehört zu anderem User/Connection | **anhalten** |
| `WEDGED` | Storage in sich inkonsistent (Watermark fehlt/defekt, Revision am Limit) | **anhalten**, manueller Eingriff |

`NEEDS_ESTABLISH` ist der zugehörige **Fehlercode**, den der Sequencer wirft,
wenn auf fehlendem State gesendet werden soll.

### Der entscheidende Unterschied

```
neuer Account / neue Session      →  MISSING          →  Establish erlaubt
bestehende Session, State weg     →  ROLLBACK_DETECTED / KEY_MISSING / WEDGED
                                                       →  HALT
```

Verbindliche Regeln:

* `loadRatchetState()` wirft bei defekten Daten **nicht**, sondern liefert einen
  Status. Der Aufrufer muss sich explizit entscheiden.
* Ein Sendeversuch erzeugt **niemals** eine Session (Invariante G, Befund H-3).
  Früher wurde `MISSING` wie „neue Session, Revision 0" behandelt — damit hätte
  alles, was den Record löschen kann, eine frische Ratchet-Kette ab Counter 0
  erzwingen können. Jetzt: `NEEDS_ESTABLISH`, Abbruch, **keine** Engine wird
  überhaupt konstruiert (Test `F2`).
* `CORRUPTED` führt **niemals automatisch** zu einer neuen Session.
* `commitRatchetState()` überschreibt einen korrupten Record **nicht** blind
  (Test `F7`).
* Ein Record, dessen Sealing Key fehlt, ist `KEY_MISSING` — **nicht** `MISSING`.
  Andernfalls wäre „Schlüssel weg" von „neuer Nutzer" ununterscheidbar (`F5`).

### `restoreRatchetSnapshot()` — entfernt

Die Funktion existiert **nicht mehr**. Sie war unsicher: Sie akzeptierte einen
vollständigen Record inklusive frei wählbarer Revision und prüfte nur
`revision > watermark`. Ein alter State mit `revision: 500` wurde damit gegen
eine laufende Session bei Revision 9 angenommen (Befund C-2).

Sie wurde **nicht umbenannt, nicht mit einem Force-Flag versehen und nicht als
Test-API exportiert**. Ersatz ist eine bewusst andere Primitive:

```ts
adoptSessionFromEstablishment(userId, connectionId, initialState, { replacesEpoch? })
```

Unterschiede, die nicht kosmetisch sind:

* Die Revision ist **kein Parameter** — eine neue Session startet immer bei 1.
* Die Epoch ist ebenfalls keiner — sie wird als `watermark.epoch + 1`
  abgeleitet, Adoption ist also **strikt vorwärtsgerichtet**.
* Kein Force-Flag. Adoption über eine lebende Session hinweg verlangt, deren
  aktuelle Epoch zu benennen (`replacesEpoch`), ist also ein CAS.
* Eingabe sind Engine-Bytes aus einem **echten Handshake**, kein aus dem Storage
  geborgener Blob.

Weil die Epoch steigt, steht eine adoptierte Session **über** allem zuvor
Committeten, obwohl ihre Revision wieder bei 1 beginnt. Genau deshalb wird
Frische als Paar `(epoch, revision)` verglichen. Tests `G1`–`G5`.

**Was das nicht leistet:** Es beweist nicht, dass das Handshake-Material selbst
frisch war. Auch das braucht den externen Anker (C-1).

---

## 8. Remaining Limitations

Ehrliche Auflistung dessen, was **nicht** gelöst ist.

### 8.1 C-1 — Koordinierter Full-Origin-Rollback (OFFEN, bewusst)

**Der wichtigste offene Punkt.** Wird der gesamte Origin auf einen früheren
Stand zurückgesetzt, werden Record, Watermark **und** Sealing Key gemeinsam
mitrestauriert:

```
Revision 6
    ↓ vollständiger Storage-Restore
Revision 2
    ↓
VALID
```

Das Ergebnis ist ein echt versiegelter, in sich konsistenter älterer Zustand.
Jede lokale Prüfung sagt korrekt `VALID` — die Signatur stimmt ja, sie wurde von
diesem Gerät für genau dieses `(user, connection, epoch, revision)` erzeugt.

**Warum das lokal nicht lösbar ist:** Jeder lokale Anker liegt innerhalb dessen,
was zurückgerollt wird. IndexedDB-Transaktionen sind zudem per Spezifikation
datenbanklokal, sodass eine zweite Datenbank die Atomarität zwischen Record und
Anker verlöre, ohne den Restore zu verhindern — Eviction und Backup sind
origin-weit.

**Die Lösung, die NICHT Teil von E2EE-2D.2 ist:**

```
sealed local state  +  server-seitiger monotoner Epoch-Anker
```

Ein Zähler außerhalb des Origins, der bei jedem Session-Establishment steigt und
dessen Wert in die AAD eingeht. Das `epoch`-Feld ist **jetzt schon** durch AAD
und Envelope geführt, damit dieser Schritt später eine Wert- und keine
Formatänderung ist. Solange kein Server-Epoch existiert, unterscheidet die
lokale Epoch nur Session-Generationen auf diesem Gerät.

**Diese Dokumentation behauptet ausdrücklich nicht, dass C-1 gelöst ist.**
Regressionstest `C8` hält die Grenze fest und würde rot, wenn jemand sie
stillschweigend als gelöst markierte.

### 8.2 Forward Secrecy und Post-Compromise Security bei Receiver-Rollback

Ein Rollback ist nicht nur ein Replay-Problem. Gemessen an der realen Engine:

**Konsumierte Message Keys werden wieder nutzbar.** Der Double Ratchet legt
Schlüssel für übersprungene Nachrichten im Session-State ab und **löscht sie bei
Gebrauch**. Messung: Empfänger-State 637 B → 1076 B nach dem Überspringen von
m1–m4 (~110 B je Schlüssel) → 714 B nach deren Konsum, also −362 B. Die
Schlüssel sind danach weg.

Wird der State auf den Stand *vor* dem Konsum zurückgerollt, sind die
gespeicherten Skipped Keys **wieder da**. Gegen den lebenden State werden alle
Replays abgelehnt; gegen den zurückgerollten State werden m1–m4 **erneut
akzeptiert und entschlüsselt** (m5 bleibt abgelehnt). Das ist ein Verlust an
**Forward Secrecy auf der Empfängerseite**, nicht bloß ein Replay-Fenster: Wer
den alten State und die alten Chiffrate hat, bekommt den Klartext zurück, den
der Ratchet bereits als unwiederbringlich behandelt hatte.

**Post-Compromise Security wird ebenfalls beschädigt.** Ein DH-Ratchet-Schritt
ändert den State (633 B → 775 B). Ein Rollback auf den Stand *vor* dem Schritt
macht die Erneuerung des Schlüsselmaterials rückgängig — genau die Eigenschaft,
die nach einer Kompromittierung die Sicherheit wiederherstellen soll.

**Senderseite:** Der Sender hält nur Sending-Chain-Schlüssel, daher kein
direkter FS-Verlust. Das Risiko dort ist Schlüssel-/IV-Wiederverwendung (§1.2).

**Was 2D.2 hier tut und was nicht.** Die Versiegelung verhindert das
*Fälschen* eines alten Zustands und der Sequencer verhindert das *versehentliche*
Zurückfallen nach einem verlorenen CAS oder Crash. Gegen einen echten
Full-Origin-Restore hilft beides nicht (§8.1). Ein Tombstone-Log konsumierter
Message Keys wäre die passende zusätzliche Maßnahme; es ist in diesem Auftrag
**ausdrücklich nicht** implementiert und bleibt offen.

### 8.3 Weitere Grenzen

1. **Kein Schutz gegen vollständige Storage-Löschung.** Wird die gesamte
   Datenbank entfernt (Nutzer löscht Browserdaten, OS-Eviction), verschwinden
   Watermark und Sealing Key. Das ist von einer neuen Installation nicht
   unterscheidbar. Abgefangen wird nur der **partielle** Verlust.

2. **Migrierte v2-Records sind nicht rückwirkend vertrauenswürdig.** Ein
   Legacy-Record konnte vor dem Upgrade bereits manipuliert worden sein; das ist
   im Nachhinein nicht feststellbar. Die Migration stellt die Bindung nur **ab
   diesem Zeitpunkt** her.

3. **Kein Web Lock.** Bewusst nicht implementiert. `navigator.locks` wäre eine
   Liveness-/Performance-Optimierung; als Sicherheitsmechanismus ist es
   ungeeignet, weil ein OS-Kill den Lock ohne `finally` verschwinden lässt.
   Sicherheitsbasis bleiben CAS + Sealed State.

4. **Nicht in einem echten Browser getestet.** Alle Tests laufen unter Node mit
   `fake-indexeddb`. Realverhalten von Safari/WebKit — insbesondere
   Storage-Eviction und ob `durability: 'strict'` tatsächlich **honoriert**
   wird — ist damit **nicht** verifiziert. Test `M13` prüft nur, dass das Flag
   angefordert wird; `fake-indexeddb` kann echte Durability nicht simulieren,
   und es wird hier kein Testbeweis dafür erfunden.

5. **Keine Integration in den Message-Flow.** `encryptCommitSend()` wird von
   keinem Produktionscode aufgerufen. `sendMessage()` ist unverändert.

6. **Multi-Device ist nicht adressiert.** Das Modell kennt genau einen lokalen
   Zustand pro `(userId, connectionId)`.

7. **Account-Löschung entfernt auch Watermark und Sealing Key.** Für die
   Löschung ist das richtig, bedeutet aber: ein neu angelegter Account mit
   derselben `connectionId` startet wieder bei Epoch 1.

8. **Kein Tombstone-Log konsumierter Message Keys** (§8.2).

9. **Kein serverseitiger Epoch** (§8.1). Keine Supabase-Migration, keine RPC,
   keine RLS-Änderung in diesem Auftrag.

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
| `src/lib/crypto/revision.ts` | **neu (2D.2)** | uint64-Revision/Epoch, Encoding, Overflow |
| `src/lib/crypto/sealed-state.ts` | **neu (2D.2)** | AEAD-Envelope, AAD, Sealing-Key-Verwaltung |
| `src/lib/crypto/ratchet-state.ts` | überarbeitet | Sealed CAS, uint64, `adoptSessionFromEstablishment`, Lazy-Migration; `restoreRatchetSnapshot` **entfernt** |
| `src/lib/crypto/ratchet-session.ts` | überarbeitet | Ephemeral-Engine-Sequencer, fail-closed Missing-State |
| `src/lib/crypto/storage.ts` | geändert | DB v3 + `vaultkeys`, `onversionchange`, Cache-Invalidierung, Löschung inkl. Sealing Key |
| `src/lib/crypto/types.ts` | geändert | DB v3, Envelope-Version, 7 neue Fehlercodes, `sealingKeyFor` |
| `src/lib/crypto/errors.ts` | geändert | Meldungen für die neuen Codes |
| `src/lib/crypto/identity.ts` | geändert | Cache-Invalidierung bei Account-Löschung |
| `src/lib/crypto/keys.ts` | geändert | Cache-Invalidierung bei Account-Löschung |
| `src/lib/crypto/__tests__/revision.test.mjs` | **neu** | 16 Tests |
| `src/lib/crypto/__tests__/sealed-state.test.mjs` | **neu** | 26 Tests |
| `src/lib/crypto/__tests__/migration.test.mjs` | **neu** | 13 Tests |
| `src/lib/crypto/__tests__/ratchet-state.test.mjs` | überarbeitet | 51 Tests |
| `src/lib/crypto/__tests__/real-engine.integration.test.mjs` | **neu** | 5 Tests gegen die echte WASM-Engine (opt-in) |
| `package.json` | geändert | Testdateien in `test:crypto`, neues `test:crypto:engine` |

**Nicht geändert:** `api.ts`, `sendMessage()`, UI-Komponenten, `AuthContext`,
Supabase-Migrationen, RLS, Routing, Theme, i18n. Keine neue Dependency.

---

## 11. Testabdeckung

```
npm run test:crypto          → 193/193 bestanden
npm run test:crypto:engine   →   5/5   bestanden (echte @getmaapp/signal-wasm 0.6.6)
npm run build                → erfolgreich
npm run smoke                → bestanden
```

| Gruppe | Kern |
|---|---|
| `revision` R1–R16 | uint64-Grenzen, `2^64` abgelehnt, Overflow, Malformed, 1e308-Wedge |
| `sealed-state` S1–S25 | Nicht-Extrahierbarkeit, C-2, State-Substitution, Cross-User/Connection, Header-Manipulation, dokumentierte AAD-Grenze |
| `ratchet-state` A–J | Revision, Crash-Punkte, Rollback, Concurrency, Isolation, Missing-State, Establishment, Ephemeral Engine, Property |
| `migration` M1–M13 | v2-Migration, Account-Löschung inkl. Caches, `onversionchange`, Durability-Flag |
| `real-engine` RE1–RE4 | H-1 gegen die echte Engine, kein Engine-Residue |

### Mutation Testing

Jede Mutation muss von mindestens einem Test erkannt werden:

| # | Mutation | erkannt durch |
|---|---|---|
| 1 | Watermark-Prüfung entfernen | `C5`, `C6`, `C1` |
| 2 | `durability: 'strict'` entfernen | `M13` (nur Flag beobachtbar, siehe §8.3.4) |
| 3 | Defensive `new Uint8Array(state)` entfernen | `H5`, `H6`, `H7`, `S6` |
| 4 | Revision aus der AAD entfernen | `S7`, `S8`, `S9`, `C2` |
| 5 | userId aus der AAD entfernen | `S13`, `S15` |
| 6 | connectionId aus der AAD entfernen | `S14` |
| 7 | CAS-Prüfung entfernen | `D1`, `D2`, `A3`, `A4`, `C7` |
| 8 | Commit/Send vertauschen | `B1`, `B3`, `B4`, `D2`, `RE4` |
| 9 | `MISSING → fresh session` reaktivieren | `F2`, `F3`, `F4` |
| 10 | Overflow-Prüfung entfernen | `A6`, `R11`, `R12` |

Zusätzlich verifiziert: Das Upgrade der Datenbank von Version 1/2 auf 3 erhält
bestehende Identitäten, Prekeys und Ratchet-States (`M1`, `M6`, `M8`).
