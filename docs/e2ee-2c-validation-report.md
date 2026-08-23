# enough. E2EE Engine Selection — Validation Report

**Auftragstyp:** Strict Validation / Red Team — keine Implementierung
**Datum:** 2026-08-23
**Repository:** `hpmine42/enough` @ `9b13a73` (branch `arena/01a02bfb-enough`)
**Zu testende Hypothese:** „`@getmaapp/signal-wasm@0.6.6` ist im August 2026 die technisch sicherste und realistischste Möglichkeit, echtes 1:1-E2EE mit Signal PQXDH + Double Ratchet in enough. als Browser/PWA umzusetzen."

> **Hinweis zur Arbeitsweise:** Es wurde keine Produktionsdatei verändert, keine Dependency hinzugefügt, keine Migration erzeugt, kein Commit erstellt. `git status` ist leer (verifiziert nach Abschluss aller Tests). Alle Ausführungstests liefen in Kopien außerhalb des Repos (`/tmp/run2b`, `/tmp/run2c`, `/tmp/redteam`, `/tmp/swverify`, `/tmp/swgit`). Diese Datei ist das einzige erzeugte Artefakt.

---

## 1. Executive Verdict

### **CONDITIONAL GO**

Die Kernhypothese hält der Prüfung **weitgehend stand** — und zwar deutlich besser, als ich zu Beginn erwartet hatte. Ich habe aktiv versucht, die Entscheidung zu zerstören, und die entscheidenden kryptographischen Behauptungen sind unabhängig bestätigt: Die drei im Architekturdokument genannten SHA-256-Hashes reproduzieren **exakt**; das WASM-Artefakt enthält nachweisbar echten libsignal-Code aus `signalapp/libsignal` Revision `b056faa6dd02961cff24064c54c089c52e1a0753`, was per `git ls-remote` **exakt dem offiziellen Upstream-Tag `v0.101.0` entspricht**; es gibt keinen Fork, kein Vendoring, keine `[patch]`-Sektion und keine eigene Kryptographie im Wrapper. PQXDH mit Kyber1024, Double Ratchet, Forward Secrecy, Replay-Rejection und identitätsgebundene Prekey-Signaturen habe ich mit eigenen, selbst geschriebenen Angriffstests empirisch bestätigt — nicht nur über den vorhandenen Spike.

Aber: Ich habe **einen CRITICAL-Blocker** gefunden, der im Architekturdokument nicht adressiert ist und der nicht durch einen Adapter wegdefiniert werden kann — **Ratchet-State-Rollback führt zu deterministischer Keystream-Wiederverwendung** (§7, §13.A). Ich konnte reproduzierbar zeigen, dass zwei Verschlüsselungen aus demselben wiederhergestellten Session-State bei identischem Klartext **bytegleiche Ciphertexts** erzeugen und bei unterschiedlichem Klartext 134 Byte gemeinsames Präfix teilen. Das ist AES-CTR-Keystream-Reuse mit allen bekannten Konsequenzen. Der vorhandene E2EE-2C-Vault-Spike löst genau dieses Problem bereits (monotone Revisionen, Rollback-Rejection) — die Architektur-Entscheidung erwähnt es aber nicht als das, was es ist: die sicherheitskritischste Eigenschaft des gesamten Designs. Dazu kommen ein **HIGH**-Blocker in der Supply Chain (keine CI, keine npm-Provenance, Build von einem Entwickler-Laptop mit `/Users/me/`-Pfaden im Binary, Single-Maintainer) und mehrere **sachlich falsche Detailangaben** im Dokument (Wrapper-Größe, Envelope-Vollständigkeit, teils die Kyber-Terminologie).

Die Engine-Wahl selbst ist richtig — es existiert im August 2026 **keine bessere browserfähige Option**, das habe ich unabhängig geprüft (§12). Die Architektur *drumherum* braucht vor der Implementierung konkrete Korrekturen.

---

## 2. Repository Findings

### 2.1 Tatsächlicher E2EE-Zustand

| Phase | Status | Evidenz |
|---|---|---|
| **E2EE-1** | ✅ **Gemergt, ausführbarer Produktionscode** | `src/lib/crypto/` — 13 TS-Module, 3811 LOC. X25519-Identity + Ed25519-Signing, non-extractable `CryptoKey` in IndexedDB, Prekey-Pool. |
| **E2EE-2A** | ✅ **Gemergt, aber bewusst nicht verdrahtet** | `key-agreement.ts`, `kdf.ts`, `symmetric.ts`, `primitives.ts`. **Absichtlich nicht** aus `index.ts` re-exportiert — die Grenze ist per Test mechanisch erzwungen (`__tests__/primitives.test.mjs`). |
| **E2EE-2B** | ⚠️ **Nur isolierter Spike** | `experiments/e2ee-2b/` — 403 LOC Harness, 13 Checks gegen `@getmaapp/signal-wasm@0.6.6`. Eigenes `package.json`, nie von `src/` importiert. |
| **E2EE-2C** | ⚠️ **Nur isolierter Spike + Doku** | `experiments/e2ee-2c/` — 305 LOC Vault-Modell, 7 Tests. Plus `docs/e2ee-2c-architecture.md` (50 KB). |
| **Compat-Spike** | ⚠️ **Nur Spike** | `spikes/e2ee-compat-spike/` — testet `mlkem-wasm` + `@noble/post-quantum`, **nicht** signal-wasm. |
| **Supabase-Prekey-Schema** | ❌ **Existiert nicht** | Migrationen gehen nur bis `0010_identity_public_key.sql`. `crypto_devices`, `crypto_signed_prekeys`, `crypto_one_time_prekeys`, `crypto_kyber_prekeys`, `claim_prekey_bundle()` kommen **ausschließlich in `docs/` vor** — kein SQL. |

**Testlauf-Ergebnisse (alle grün, von mir ausgeführt):**
- `npm run test:crypto` → **87/87 passed**
- `npm run build` → grün (`tsc --noEmit` + Vite, 488.84 kB / 137.21 kB gzip)
- `npm run smoke` → alle bestanden
- `experiments/e2ee-2b` → **13/13 passed**
- `experiments/e2ee-2c` → **7/7 passed**

### 2.2 Plaintext-Zustand — bestätigt

**`messages.ciphertext` enthält heute reinen Klartext.** Beleg, exakte Stelle:

```ts
// src/lib/api.ts:602-606
const { data, error } = await supabase
  .from('messages')
  .insert({ connection_id: connectionId, sender_id: senderId, ciphertext: text })
```

`text` ist der unveränderte String aus `MessageComposer`. Es findet **keinerlei** Verschlüsselung im echten Message-Flow statt.

Lesende/schreibende Stellen:
- **Schreiben:** `api.ts:604` (`sendMessage`), `api.ts:623` (`deleteMessageForEveryone` setzt `ciphertext: ''`)
- **Lesen:** `api.ts:556`, `api.ts:583` (SELECT-Listen), `components/MessageBubble.tsx:112-114` (rendert direkt), `components/Home.tsx:56` (Chat-Vorschau), `components/Chat.tsx:584`
- **Server-seitig:** Systemnachrichten werden per SQL in Klartext eingefügt (`0001:182,210`, `0008:186,209,247`) — diese können naturgemäß **nie** E2EE-verschlüsselt werden und brauchen einen eigenen Envelope-Typ.
- **DB-Constraint:** `0009_explicit_base_rls.sql:163-175` erzwingt, dass `ciphertext` nur auf `''` geändert werden darf, und nur beim Löschen.

**Fazit:** `src/lib/crypto/README.md` beschreibt den Zustand korrekt und ehrlich. Die Doku übertreibt hier nichts.

---

## 3. signal-wasm Verification

### 3.1 Paket-Fakten (npm-Registry, unabhängig abgefragt)

| Feld | Wert |
|---|---|
| Name / Version | `@getmaapp/signal-wasm@0.6.6` |
| Veröffentlicht | 2026-08-19T12:50:10Z |
| Lizenz | `AGPL-3.0-only` |
| Maintainer | **`thecannabisapp <jia@thecannabis.app>` (einziger)** |
| `gitHead` | `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` |
| Dateien | 6 (LICENSE, README, package.json, .d.ts, .js, .wasm) |
| Dependencies | **keine** |
| Install-Scripts | **keine** (`hasInstallScript: None`) |
| npm-Provenance | ❌ **keine** (`/-/npm/v1/attestations/...` → `{"error":"Not found"}`) |
| Releases | 12 Versionen seit 2026-01-14 |

**Positiv:** Keine transitiven Dependencies, keine Install-Scripts, keine unerwarteten Dateien. Die Angriffsfläche des npm-Pakets selbst ist minimal.

### 3.2 Trust Chain

```
Signal specification (PQXDH, Double Ratchet)     → VERIFIED
        ↓
official libsignal v0.101.0 (b056faa6d)          → VERIFIED
        ↓
@getmaapp/signal-wasm 0.6.6 (git dep, no patch)  → VERIFIED (source) / PARTIALLY VERIFIED (build)
        ↓
WASM artifact (hash-matched, unreproducible)     → PARTIALLY VERIFIED
        ↓
enough. adapter (existiert noch nicht)           → UNVERIFIED
```

**Beweis Glied 2→3** — `Cargo.toml` des Wrappers (`/tmp/swgit`, HEAD = `0a5e3cb`, identisch mit npm `gitHead`):

```toml
libsignal-protocol = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
zkgroup             = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
```

**Unabhängige Verifikation dieser Revision gegen Signal:**
```
$ git ls-remote https://github.com/signalapp/libsignal | grep v0.101
e1d4fd21fec6b9b5583aa4e7d319777765372d00  refs/tags/v0.101.0
b056faa6dd02961cff24064c54c089c52e1a0753  refs/tags/v0.101.0^{}
```
→ Der gepinnte Commit **ist** exakt das offizielle Signal-Release-Tag `v0.101.0`. Das ist der stärkste Einzelbefund dieser Validierung.

**Beweis, dass der Core im Binary steckt** — Strings aus `signal_wasm_bg.wasm`:
```
/Users/me/.cargo/git/checkouts/libsignal-2a193a9867decbc4/b056faa/rust/protocol/src/pqxdh.rs
/Users/me/.cargo/git/checkouts/libsignal-2a193a9867decbc4/b056faa/rust/protocol/src/double_ratchet.rs
/Users/me/.cargo/git/checkouts/libsignal-2a193a9867decbc4/b056faa/rust/protocol/src/ratchet/keys.rs
libsignal_protocol::kem::kyber1024::Parameters::encapsulate
libsignal_protocol::ratchet::keys::MessageKeys::derive_keys
```
Cargo-Git-Checkout-Pfade mit Revisions-Präfix `b056faa` — das ist ein echter Git-Dependency-Build, kein kopierter Code.

### 3.3 Antworten auf die 12 Fragen aus §7 des Auftrags

1. **libsignal-Version:** v0.101.0
2. **Commit:** `b056faa6dd02961cff24064c54c089c52e1a0753` (= offizielles Tag)
3. **Direkt als Dependency?** ✅ Ja, Cargo-Git-Dependency
4. **Code kopiert?** ❌ Nein
5. **Code geforkt?** ❌ Nein — Remote ist `github.com/signalapp/libsignal`
6. **Core verändert?** ❌ Nein — keine `[patch.crates-io]`, keine `[replace]`, kein `vendor/`
7. **Original Signal:** gesamte Kryptographie (PQXDH, Double Ratchet, KEM, Curve25519, KDF, AEAD, Fingerprints)
8. **Vom Wrapper:** ausschließlich wasm-bindgen-Bindings + Store-Decorators (`RemovableSessionStore`, `ConsumptionTrackingPreKeyStore`, `KyberUsageTrackingStore`, `RemovableSenderKeyStore`)
9. **Eigene Krypto-Implementierungen:** **keine** — `grep` nach `Hmac|Sha256::|Aes|chacha|fn hkdf|derive_key` in `src/lib.rs` liefert **null** Treffer
10. **Patch-Dateien:** keine
11. **Lokale Forks:** keine
12. **Abweichungen:** nur additive Store-Funktionalität (`delete_session`, `remove_kyber_pre_key`, Usage-Tracking) — dokumentiert und begründet mit Upstream-Zeilenverweisen

> **Das Architekturdokument ist hier korrekt.** Die Behauptung „offizieller libsignal Rust Core" ist **VERIFIED**.

### 3.4 Korrektur: Wrapper-Größe

> **The architecture document is incorrect here.** Die Behauptung „wrapper is ~500 lines" ist **INCORRECT**. `wc -l src/lib.rs` → **2024 Zeilen**, plus 2771 Zeilen Tests (`tests/web.rs`). Das ist ein Faktor 4. Das ist kein Sicherheitsproblem — mehr Code bedeutet hier mehr Store-Sorgfalt, nicht mehr Krypto —, aber die Zahl im Dokument ist schlicht falsch und muss korrigiert werden, weil sie zur Risikobewertung („trivial auditierbar") herangezogen wird. 2024 Zeilen Rust sind auditierbar, aber nicht an einem Nachmittag.

---

## 4. PQXDH Verification

### 4.1 Empirischer Nachweis

Aus meinem eigenen Test (`/tmp/redteam/t2.mjs`, nicht der Spike):
```
[KEM] kyber pub bytes  = 1569   (ML-KEM-1024/Kyber1024 pk = 1568 + 1 Typ-Byte)
[KEM] kyber sig bytes  = 64     (XEdDSA über X25519-Identity)
[KEM] kyber record     = 4821
```
1568 Byte ist die **eindeutige** Public-Key-Größe von Kyber-1024 / ML-KEM-1024. Damit ist die Parameterwahl unabhängig von jeder Dokumentation bewiesen.

### 4.2 Quellcode-Nachweis

`/tmp/swgit/src/lib.rs:1473-1495`:
```rust
#[wasm_bindgen(js_name = generateKyberPreKey)]
pub async fn generate_kyber_pre_key(key_id: u32, identity_key_pair: &WasmIdentityKeyPair, ...) {
    let key_pair = kem::KeyPair::generate(kem::KeyType::Kyber1024, &mut rng);
    let signature = identity_key_pair.private_key.0
        .calculate_signature(&key_pair.public_key.serialize(), &mut rng)?;
    let kyber_record = KyberPreKeyRecord::new(key_id.into(), timestamp, &key_pair, &signature);
```
Der Kyber-Prekey wird mit dem **Identity-Key signiert** — genau wie die PQXDH-Spezifikation es verlangt. Ich habe das auch negativ geprüft: eine gefälschte Signatur wird mit `SignatureValidationFailed` abgelehnt.

### 4.3 PQXDH-Info-String aus dem Binary

```
WhisperText_X25519_SHA-256_CRYSTALS-KYBER-1024
X3DH no longer supported
```
Das ist der kanonische PQXDH-Domain-Separator von libsignal. Bemerkenswert: **`X3DH no longer supported`** — die Engine erzwingt PQXDH, ein Downgrade auf klassisches X3DH ist nicht möglich. Zusätzlich bestätigt durch `Kyber pre key must be present for this session version`.

Mein Test bestätigt das an der API: `processPreKeyBundle` hat **keine Overload ohne Kyber-Parameter** — `kyber_prekey_id`, `kyber_prekey`, `kyber_prekey_signature` sind non-nullable, während `prekey_id`/`prekey` nullable sind. **PQXDH ist nicht optional.**

### 4.4 Terminologie — teilweise Korrektur

Die Frage aus §8 des Auftrags war berechtigt, die Antwort ist differenzierter als erwartet. Im Binary finden sich **zwei** PQ-Primitiven:

| Verwendung | Primitive | Nachweis |
|---|---|---|
| **PQXDH-Handshake** | **Kyber1024** (Round-3 CRYSTALS-Kyber, *nicht* FIPS-203-ML-KEM) | `libsignal_protocol::kem::kyber1024::Parameters::encapsulate`, Info-String `CRYSTALS-KYBER-1024` |
| **SPQR / Triple Ratchet** | **ML-KEM-768** (FIPS 203) über `libcrux-ml-kem 0.0.10` | `spqr::incremental_mlkem768`, `Signal_PQCKA_V1_MLKEM768:...`, Dependency `SparsePostQuantumRatchet v1.5.3` |

> **Verdict:** „Kyber1024" ist für **PQXDH** die **korrekte und weiterhin aktuelle** Bezeichnung — libsignal v0.101.0 verwendet dort bewusst das Round-3-Kyber, nicht ML-KEM. Das Dokument ist hier also **richtig**, aber **unvollständig**: Es erwähnt nicht, dass 0.6.6 zusätzlich Signals **SPQR-Triple-Ratchet mit ML-KEM-768** enthält. Das ist eine *Verbesserung* (kontinuierliche PQ-Rekeying statt nur PQ-Handshake), muss aber in der Doku stehen — schon weil es die Session-Record-Größe auf **5885 Byte** treibt (statt der ~2 KB, die man von klassischem libsignal erwartet). Das hat direkte Konsequenzen für das IndexedDB-Budget.

**PQXDH: VERIFIED.**

---

## 5. Double Ratchet Verification

Alle Prüfungen sind empirisch, mit eigenen Tests.

| Eigenschaft | Ergebnis | Evidenz |
|---|---|---|
| Message-Typen | ✅ | `prekey=3`, `signal=2`, `senderkey=7` |
| Erste Nachricht = PreKeyMessage | ✅ | `t=3`, danach `t=2` |
| Sending/Receiving Chain | ✅ | Protobuf-Feldnamen im Binary: `sender_chain`, `receiver_chains`, `root_key`, `chain_key`, `message_keys` |
| **DH-Ratchet** | ✅ | `ratchet_key_of_ciphertext` liefert für Alice und Bob **verschiedene** Ratchet-Keys |
| Symmetrischer Ratchet | ✅ | Session-State ändert sich nach **jedem** encrypt/decrypt (6 unique Snapshots) |
| **Skipped Message Keys / Out-of-order** | ✅ | M1→M3→M2 dekryptiert korrekt, danach M4 — Session bleibt konsistent |
| **Replay-Rejection** | ✅ | Zweiter Decrypt desselben Ciphertexts → `DuplicatedMessage` |
| Tampered Ciphertext | ✅ | Bit-Flip → abgelehnt |
| **Forward Secrecy** | ✅ **empirisch** | Session-State nach m1..m3 gestohlen → **0 von 3** alten Ciphertexts entschlüsselbar |
| **Post-Compromise Security** | ⚠️ **eingeschränkt** | Gestohlener State entschlüsselt m4 (nächste Nachricht derselben Chain). PCS greift erst, **nachdem** die Gegenseite den DH-Ratchet dreht. |
| Session-Serialisierung | ✅ | `export_session`/`import_session`, 5885 B, kryptographisch neutral (rohe libsignal-Records) |

> **Zur Behauptung „Double Ratchet provides forward secrecy and post-compromise security":** FS ist **VERIFIED** (empirisch). PCS ist **PARTIALLY VERIFIED** — das ist keine Schwäche der Engine, sondern die korrekte, spezifikationsgemäße Eigenschaft des Double Ratchet. Das Dokument sollte PCS aber nicht unqualifiziert behaupten: PCS ist *eventual*, nicht sofortig, und setzt einen Antwort-Roundtrip voraus. In einem 1:1-Messenger, in dem ein Nutzer tagelang nicht antwortet, ist das ein real relevanter Unterschied.

---

## 6. Browser/WASM Verification

| Prüfpunkt | Ergebnis | Evidenz |
|---|---|---|
| Node-Globals (`fs`, `path`, `process`, `Buffer`, `require`) | ✅ **keine** | grep über `signal_wasm.js` → null Treffer |
| Node-Crypto-Import | ✅ **keiner** | Nutzt `globalThis.crypto.getRandomValues` (Web Crypto) |
| Polyfills nötig | ✅ **nein** | Vite-Build ohne jede Polyfill-Konfiguration grün |
| **SharedArrayBuffer / Atomics** | ✅ **nicht verwendet** | grep → null Treffer |
| **COOP/COEP / Cross-Origin-Isolation** | ✅ **nicht erforderlich** | Folgt direkt aus dem vorigen Punkt |
| Worker erforderlich | ✅ nein | Single-threaded |
| WASM-Laden | ✅ | `new URL('signal_wasm_bg.wasm', import.meta.url)` → von Vite als Asset gehasht |
| MIME | ⚠️ | `instantiateStreaming` braucht `application/wasm`; Fallback auf `instantiate` vorhanden. GitHub Pages liefert korrekt. |
| **Vite-Build** | ✅ **grün** | `dist/assets/signal_wasm_bg-fOyaQtRb.wasm 797.75 kB │ gzip: 302.94 kB` |
| Haupt-App-Build | ✅ grün | 488.84 kB / 137.21 kB gzip |
| CSP | ⚠️ | Braucht `'wasm-unsafe-eval'` in `script-src`. **Im Dokument nicht erwähnt.** |

### 6.1 Korrektur: Bundle-Größe

> **The architecture document is incorrect here.** Die Behauptung „299 KB gzip" ist **INCORRECT**, wenn auch knapp:

| Datei | roh | gzip -9 |
|---|---|---|
| `signal_wasm_bg.wasm` | 797 749 B | **300 711 B** |
| `signal_wasm.js` | 78 213 B | **12 920 B** |
| **Summe** | 875 962 B | **313 631 B ≈ 306 KB** |

Vite meldet für das WASM allein 302.94 kB gzip. Die korrekte Zahl für den **Gesamtzuwachs** ist **~306 KB gzip**, nicht 299 KB. Zum Vergleich: die aktuelle App ist 137 KB gzip — die Engine **verdreifacht** die Download-Größe. Für eine mobile-first PWA ist das die wichtigste Zahl im ganzen Dokument und sie sollte nicht zu niedrig angegeben werden.

### 6.2 Nicht verifizierbar in dieser Umgebung

Der Playwright-Chromium-Download ist in dieser Sandbox blockiert (Netzwerk + fehlende System-Fonts). **Alle Engine-Tests liefen unter Node 24, nicht in einem echten Browser.** Das ist eine ehrliche Lücke: Node und Browser teilen zwar `globalThis.crypto` und die WASM-Engine, aber iOS-Safari-spezifisches Verhalten (WASM-Speicherlimits, IndexedDB-Eviction, Web Locks) ist **nicht** getestet. Das Architekturdokument stützt sich auf denselben Node-Spike — die Behauptung „läuft sauber in Browser/PWA" ist damit **PARTIALLY VERIFIED** und braucht einen echten Gerätetest.

---

## 7. Persistence Verification

### 7.1 Der CRITICAL-Befund: Rollback ⇒ Keystream-Reuse

Das ist das wichtigste Ergebnis dieser Validierung. Reproduzierbarer Test (`/tmp/redteam/t3.mjs`):

```
[KEYREUSE] gleicher Klartext, zurückgerollter State
           → Ciphertext-Bodies IDENTISCH: true
[KEYREUSE] verschiedene Klartexte, gleicher Counter
           → gemeinsames Präfix: 134 von 1792 Byte
```

**Was passiert:** libsignal ist deterministisch. Aus demselben Chain-Key und Counter leitet `MessageKeys::derive_keys` denselben `cipher_key` **und dieselbe IV** ab. Wird der Session-State auf Revision N zurückgesetzt und erneut verschlüsselt, wird derselbe Message-Key mit derselben IV auf einen **anderen** Klartext angewendet. Zwei Ciphertexts unter identischem Keystream ⇒ XOR beider Ciphertexts = XOR beider Klartexte. Der Angreifer braucht keinen Schlüssel.

**Auslöser im geplanten Design:** Browser-Crash zwischen „Ratchet-State im WASM verändert" (`encryptMessage`) und „Vault-Commit". Beim Reload wird der alte State hydratisiert, die Nachricht neu gesendet — Keystream-Reuse. Auf iOS Safari ist genau das kein Randfall: Der OS-Kill von Hintergrund-Tabs ist Normalbetrieb.

**Sekundäreffekt (empfindlich, aber nicht kritisch):** Nach Rollback lehnt der Empfänger die zweite Nachricht mit `DuplicatedMessage` ab. Die Nachricht ist **dauerhaft verloren** — die Session erholt sich zwar (msg-C kommt an), aber msg-B ist weg, ohne dass die UI es merkt. Ein stiller Nachrichtenverlust in einem Messenger ist ein Produktfehler.

**Und die Empfängerseite ist noch schlimmer:**
```
[ROLLBACK-RECEIVER]
  erster Decrypt:            "secret"
  sofortiger Replay:         DuplicatedMessage  ✅
  nach Vault-Rollback:       AKZEPTIERT ERNEUT  ❌
```
Der Replay-Schutz des Double Ratchet lebt **ausschließlich** im Session-State. Wer den Vault auf einen älteren Stand zurücksetzt (Backup-Restore, IndexedDB-Korruption, Angreifer mit lokalem Zugriff), reaktiviert Replay-Angriffe vollständig.

**Warum kein Adapter das löst:** Die Determinismus-Eigenschaft steckt in libsignal selbst und ist dort korrekt. Ein Adapter kann sie nicht „wegkapseln". Die einzige Abwehr ist ein **Persistenz-Protokoll**, das garantiert, dass ein einmal fortgeschrittener Ratchet-State niemals rückwärts geht — d. h. **commit-before-send** mit monotoner Revision und Fail-closed-Verhalten.

**Gute Nachricht:** `experiments/e2ee-2c/` implementiert **genau das** bereits im Modell:
- `commitDecryptMutation()` schreibt Session + Kyber-Usage + Tombstones + Revision in **einer** IndexedDB-Transaktion mit `durability: 'strict'`
- Test „older session backup is rejected (rollback protection)" ✅
- Test „revision conflict aborts and leaves previous tombstones/session intact" ✅
- AAD bindet jeden Record an `userId|kind|recordId` — Records lassen sich nicht zwischen Accounts oder Slots verschieben

Der 2C-Spike ist die Lösung. Das Architekturdokument **verkauft sie nur nicht als das, was sie ist**, und schreibt die Reihenfolge-Garantie nicht als verbindliche Invariante fest.

### 7.2 Multi-Tab

```
[MULTI-TAB FORK] zwei Tabs hydratisieren denselben Snapshot, beide senden
  tab1 → "from tab1" ✅
  tab2 → REJECTED: DuplicatedMessage
```
Der Fork ist **nicht still** — der Empfänger lehnt ab. Das ist besser als befürchtet (kein unbemerkter Keystream-Reuse zwischen Tabs, weil beide denselben Counter benutzen und der zweite auffliegt). Aber: Tab 2s Nachricht ist **verloren**, und der Sender erfährt es nicht. Ein Web Lock ist damit **funktional zwingend**, nicht optional.

### 7.3 Web Locks auf iOS Safari

`navigator.locks` ist seit Safari 15.4 verfügbar, das ist nicht das Problem. Das Problem ist die **Lebensdauer**: Wird ein iOS-Tab im Hintergrund vom OS beendet, verschwindet der Lock ohne `finally`-Ausführung. Das ist für die Korrektheit sogar gut (kein Deadlock), aber es bedeutet: **Ein Lock allein ist keine Garantie.** Die Revisions-Prüfung aus 2C muss die zweite, autoritative Verteidigungslinie sein — der Lock ist Performance-Optimierung, die Revision ist der Sicherheitsmechanismus. Kann ein Send hängen? Ja, wenn der Lock nicht mit Timeout genommen wird (`ifAvailable` oder `AbortSignal` nötig).

---

## 8. Supabase Verification

**Zentraler Befund: Es gibt nichts zu verifizieren.** Die vier Tabellen und `claim_prekey_bundle()` existieren **ausschließlich in Prosa** (`docs/e2ee-2c-architecture.md:646-649`, `docs/e2ee-session-architecture.md`). Kein SQL, keine Migration, keine RLS-Policy, keine Tests. Die Behauptung, das Supabase-Modell sei „korrekt", ist damit **UNVERIFIED** — nicht falsch, nur unbelegt.

Was ich anhand des bestehenden Schemas beurteilen kann:

**Positiv:** Das Projekt hat eine belastbare RLS-Kultur — `0009_explicit_base_rls.sql` mit expliziten Base-Policies, `guard_profile_update` als Spalten-Whitelist, und eine dedizierte `supabase/rls-tests.sql`. Das ist eine gute Grundlage.

**Konkrete Risiken für das geplante Prekey-Schema:**

1. **OTK-Consumption-Race** — `claim_prekey_bundle()` **muss** `FOR UPDATE SKIP LOCKED` verwenden. Ohne das können zwei gleichzeitige Sender denselben One-Time-Prekey erhalten. Konsequenz: Beide bauen eine Session gegen denselben OTK; der Empfänger akzeptiert nur die erste (der OTK ist nach dem ersten Decrypt weg), die zweite scheitert. Kein Krypto-Bruch, aber Nachrichtenverlust.
2. **Kyber-Prekey-Consumption** — hier liegt der subtilere Fehler. Die Engine meldet konsumierte Kyber-IDs über `WasmDecryptResult.kyberPreKeyId`, **aber** `remove_kyber_pre_key()` darf für **Last-Resort-Keys nicht** aufgerufen werden (sonst geht der Anti-Replay-Schutz verloren, siehe `.d.ts:134-149`). Die Unterscheidung one-time/last-resort muss die **Anwendung** treffen — libsignal tut es nicht. Das Datenbankschema muss das `is_last_resort`-Flag also **autoritativ** führen.
3. **Last-Resort-Prekey nicht erzeugbar** — siehe §15.
4. **Claim-ohne-Send** — wenn ein Sender ein Bundle claimt und nie sendet, ist der OTK verbrannt. Braucht Nachfüll-Logik mit Schwellwert (z. B. < 20 → auf 100 auffüllen).
5. **User-Enumeration** — `profiles` SELECT ist `authenticated USING true` (aus 0009). Eine Prekey-Tabelle mit derselben Policy erlaubt es jedem eingeloggten Nutzer, Bundles beliebiger Nutzer zu claimen und damit deren OTK-Pool zu erschöpfen (DoS → erzwungener Last-Resort-Fallback). Rate-Limiting nötig.
6. **Deletion-Cascade** — `0004_delete_account.sql` muss um die Prekey-Tabellen erweitert werden.

---

## 9. Envelope Verification

Vorgeschlagen:
```json
{ "v": 1, "e": "sw", "t": 3, "b": "base64-of-libsignal-ciphertext-body" }
```

### 9.1 Ist `t` manipulierbar?

Getestet (`/tmp/redteam/t1.mjs`) — echter Typ 3, alle anderen Werte untergeschoben:
```
t=2   → rejected (Generic)
t=7   → rejected (Validation failed)
t=0   → rejected (Validation failed)
t=255 → rejected (Validation failed)
```
**Kein Sicherheitsbruch.** `t` ist ein Dispatch-Hinweis; der Ciphertext ist selbst-authentifizierend. Manipulation = DoS, nicht Entschlüsselung. Die Frage aus §16 ist damit beantwortet: `t` außerhalb der AEAD zu führen ist **akzeptabel**.

### 9.2 Was fehlt — das Envelope ist unvollständig

> **The architecture document is incorrect here.** Das Envelope ist **nicht ausreichend**.

| Fehlend | Warum zwingend |
|---|---|
| **`deviceId` (Sender)** | `decryptMessage` verlangt `sender: WasmProtocolAddress(name, device_id)`. Ohne Device-ID im Envelope **kann der Empfänger die Adresse nicht bilden**. Aktuell hardcoded auf `1` — das zementiert Single-Device für immer. `src/` kennt heute **kein** Device-Konzept (`grep deviceId src/` findet nur Testdateien). |
| **`registrationId` (Sender)** | Signal-Desktop nutzt das für Stale-Session-Erkennung; die Engine exponiert dafür extra `session_remote_registration_id()`. Ohne dieses Feld kann enough. eine Neuregistrierung des Peers nicht sauber erkennen. |
| **Envelope-Typ für Systemnachrichten** | `messages` enthält SQL-generierte Klartext-Systemnachrichten (`kind: 'name_change'` etc., z. B. `0008:186`). Diese können nie E2EE sein. Ohne Diskriminator kann der Client verschlüsselt/unverschlüsselt nicht unterscheiden → Parse-Fehler oder, schlimmer, Fallback-auf-Klartext. |

Empfohlenes Minimum:
```json
{ "v": 1, "e": "sw", "t": 3, "sd": 1, "sr": 12345, "b": "..." }
```
`v`/`e` sind korrekt und sinnvoll (Versionierung + Engine-Diskriminator für spätere Migration). Die Base64-Kodierung des Bodies ist tragbar (+33 % Overhead auf ~1759 B PreKey-Messages ≈ 2.3 KB pro Nachricht; `bytea` wäre effizienter, aber `text` ist schema-kompatibel).

**Nicht** ins Envelope gehören dürfen: Session-Identifier (die Session ergibt sich aus `(sender_address, local_address)`), Message-Keys, irgendein Ratchet-State.

**Klassifikation:** **HIGH**, nicht CRITICAL — es ist kein Krypto-Bruch, aber es macht Multi-Device dauerhaft unmöglich und bricht am Systemnachrichten-Pfad.

---

## 10. Supply Chain Verification

### 10.1 Hash-Verifikation — alle drei bestätigt ✅

Ich habe das Tarball frisch von der Registry geladen und gehasht:

| Artefakt | Dokument | Gemessen | |
|---|---|---|---|
| `signal_wasm_bg.wasm` | `71b456b8…20d6c1` | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` | ✅ |
| `signal_wasm.js` | `c72af7ae…883410` | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` | ✅ |
| npm tarball | `c3e0d6cd…5e3082` | `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082` | ✅ |

Zusätzlich in `/tmp/run2b/node_modules` nach `npm ci` gegengeprüft — identisch. **Das Dokument ist hier exakt korrekt.**

### 10.2 Aber: Hashes beweisen nur Unveränderlichkeit, nicht Vertrauenswürdigkeit

> **Zur Frage „Ist vendored artifact + hash pinning ausreichend?" — Nein.**

Ein Hash bestätigt: „dieses Byte-Array ist dasselbe wie gestern". Er bestätigt **nicht**, dass das Byte-Array aus dem geprüften Quellcode entstanden ist. Genau diese Lücke ist hier offen:

| Kontrolle | Status |
|---|---|
| npm-Provenance / SLSA-Attestation | ❌ **keine** — Registry-Endpoint liefert `{"error":"Not found"}` |
| CI / Release-Automation | ❌ **keine** — `ls .github/workflows` → existiert nicht |
| Reproducible Build | ❌ **nein** — `/Users/me/.cargo/...` und `/Users/me/src/signal-wasm/target/...` im Binary belegen einen **Laptop-Build** |
| Signierte Tags | ❌ Tags nur bis `v0.2.0`, aktuelle Releases ungetaggt |
| Maintainer | ⚠️ **Single Point of Failure** — genau eine Person |
| SBOM | ❌ nicht veröffentlicht |
| Unabhängige Audits | ❌ nur Selbst-Audit (`SECURITY_AUDIT_REPORT.md`, Stand v0.1.1 — **fünf Minor-Releases veraltet**) |
| Install-Scripts / Deps | ✅ keine (positiv) |
| Namensraum | ⚠️ unscoped `signal-wasm@0.6.2` existiert (gleicher Maintainer — kein Squat, aber Verwechslungsgefahr; Pinning auf den **scoped** Namen ist Pflicht) |

**Ich konnte den Build nicht reproduzieren** — in dieser Sandbox ist keine Rust-Toolchain vorhanden. Selbst mit Toolchain wäre exakte Reproduktion wegen der eingebetteten absoluten Pfade unwahrscheinlich, solange `--remap-path-prefix` nicht gesetzt wird.

**Realistische Risikoeinschätzung:** Der Quellcode ist verifizierbar sauber und pinnt einen verifizierbar offiziellen libsignal-Commit. Ein böswilliges Binary müsste vom veröffentlichten Quellcode abweichen — möglich, aber es gibt keinen Hinweis darauf. Das Risiko ist nicht „das Paket ist kompromittiert", sondern „**niemand kann beweisen, dass es das nicht ist**", kombiniert mit „ein einziger kompromittierter npm-Account genügt für ein bösartiges 0.6.7". Bei einer E2EE-Engine ist das eine bewusst zu treffende Entscheidung, kein Detail.

**Klassifikation: HIGH.** Minimal-Mitigation: Artefakt vendoren (nicht aus npm zur Buildzeit ziehen), Hash in CI erzwingen, `npm ci` mit Lockfile-Pin auf die **exakte** Version, und Upstream-Releases manuell reviewen statt automatisch zu übernehmen.

---

## 11. License Verification

**Ich bin kein Anwalt. Nichts hier ist Rechtsberatung.**

**Technische Fakten:**
- `@getmaapp/signal-wasm` → `AGPL-3.0-only` (npm-Metadaten **und** mitgelieferte `LICENSE` = AGPLv3-Volltext, verifiziert)
- Upstream `libsignal` v0.101.0 → ebenfalls `AGPL-3.0-only` (Signals Standardlizenz)
- `@signalapp/libsignal-client` → `AGPL-3.0-only`
- Rust-Dependencies (wasm-bindgen, getrandom, uuid, zeroize, rand, subtle) → durchweg MIT/Apache-2.0, AGPL-kompatibel
- **Verteilungsform:** Das WASM wird in das Vite-Bundle gelinkt und an jeden Browser ausgeliefert. Technisch ist das **Distribution** — und wegen der Bundle-Integration eher statisches als dynamisches Linken.
- enough. hat aktuell **keine** `LICENSE`-Datei im Repository.

**Technisch wahrscheinlich:** Die AGPL-Verpflichtung greift. Weil der Client-Code ohnehin an den Browser ausgeliefert wird, ist die praktische Hürde niedrig — der Quellcode ist bereits öffentlich auf GitHub.

**Rechtlich unklar — Legal Counsel erforderlich:**
1. **AGPL §13 („Remote Network Interaction")** — greift das, wenn der AGPL-Code im *Browser des Nutzers* läuft und nicht auf dem Server? Die Rechtslage zu WASM-im-Browser unter AGPL ist meines Wissens ungeklärt.
2. **Umfang der „Corresponding Source"** — muss nur der E2EE-Adapter, oder die **gesamte** enough.-Anwendung unter AGPL gestellt werden? Bei statischem Linken in ein gemeinsames Bundle ist die konservative Lesart: alles.
3. **Supabase-Backend** — wird die Server-Seite von §13 erfasst, obwohl dort kein AGPL-Code läuft?
4. **Impressum/Haftung** — enough. hat ein Impressum (`src/config/imprint.ts`), operiert also vermutlich unter deutschem Recht. AGPL-Durchsetzbarkeit und Gewährleistungsausschlüsse sollten dort geprüft werden.
5. **Zukünftige Kommerzialisierung** — AGPL schließt ein späteres proprietäres Modell praktisch aus. Das ist eine **Geschäftsentscheidung**, keine technische.

> **The architecture document is incorrect here** — nicht in der Sache, sondern im Ton. „enough. kann deshalb einfach AGPL werden" ist eine **rechtliche Schlussfolgerung ohne rechtliche Prüfung**. Das Wort „einfach" ist unangebracht. Die Lizenzentscheidung ist irreversibel (einmal AGPL ausgeliefert, lässt sich das für ausgelieferte Versionen nicht zurücknehmen) und braucht eine bewusste, dokumentierte Entscheidung.

---

## 12. Alternative Engines

Alle Angaben frisch von npm abgefragt (2026-08-23).

| Kandidat | Version | Lizenz | Browser? | Protokoll | Verdict |
|---|---|---|---|---|---|
| **`@signalapp/libsignal-client`** | 0.101.0 | AGPL-3.0 | ❌ **nein** | Signal PQXDH+DR | `node-gyp-build`-Dependency, `build_node_bridge.py` → **native Node-Binding**. Kein WASM-Target. **Doku bestätigt.** |
| **`@getmaapp/signal-wasm`** | 0.6.6 | AGPL-3.0 | ✅ | Signal PQXDH+DR+SPQR | Einziger browserfähiger Weg zum echten libsignal-Core. |
| **`@matrix-org/matrix-sdk-crypto-wasm`** | 18.5.0 | Apache-2.0 | ✅ | Olm/Megolm | Gepflegt (10.08.2026), sehr reif, bessere Supply Chain (Matrix.org-Org, CI). **Aber:** Olm ist **kein PQXDH** — kein Post-Quantum-Handshake. Zudem Matrix-Datenmodell (Rooms/Devices) tief verdrahtet → schwerer Impedance-Mismatch für einen 1:1-Messenger auf Supabase. |
| **`@wireapp/core-crypto`** | 10.4.0 | GPL-3.0 | ✅ | MLS + Proteus | Aktiv (19.08.2026). MLS ist gruppenorientiert; für 1:1 Overkill. Proteus = altes Axolotl **ohne PQ**. Braucht MLS Delivery Service — passt nicht zu Supabase. |
| **OpenMLS** | — | — | ⚠️ | MLS | **Nicht auf npm** (`npm view openmls` → 404). Doku bestätigt. |
| **vodozemac** | — | — | ⚠️ | Olm | **Nicht auf npm** (404). Nur via matrix-sdk-crypto-wasm. |
| **`openpgp`** | 6.3.1 | LGPL-3.0+ | ✅ | OpenPGP | **Kein Ratchet, keine Forward Secrecy.** Für Messaging ungeeignet. Doku bestätigt. |
| Pure-TS-Ports | — | — | ✅ | Signal | `@lukium/libsignal-protocol-typescript@0.1.0-beta.2` — Beta, unmaintained. Nicht vertrauenswürdig. Doku bestätigt. |

**Neuere Kandidaten (Suche nach „pqxdh", August 2026):** `webcrypto-ratchet@0.7.2`, `@open-e2ee/signal-protocol-sdk@0.4.0`, `@oxpulse/crypto-primitives`, `@transmissionbot/core-wasm@0.1.2`. Alle scheitern an denselben Kriterien: Solo-Maintainer, Pre-1.0, kein libsignal-Core, keine Audits, teils Neuimplementierungen des Protokolls in TypeScript. **Keiner ist eine ernsthafte Alternative** — mehrere sind schlechter als signal-wasm, weil sie Signal *nachbauen* statt es einzubinden.

> **Fazit:** Die Alternativen-Analyse des Dokuments ist **VERIFIED**. Die Behauptung „only browser-capable Signal implementation" stimmt in der präzisierten Form: *die einzige browserfähige Bindung an den offiziellen libsignal-Core*. Wenn PQXDH gefordert ist, gibt es **keine Wahl**. Wenn PQ verhandelbar wäre, wäre `@matrix-org/matrix-sdk-crypto-wasm` wegen der drastisch besseren Supply Chain ein legitimer Gegenkandidat — aber der Protokoll-Mismatch wiegt schwerer.

---

## 13. Threat Model Results

| # | Szenario | Ergebnis |
|---|---|---|
| **A** | **Server-Compromise** (gesamte DB + Realtime) | ✅ **Hält.** Nur öffentliche Prekeys + Ciphertexts. Private Keys und Ratchet-State verlassen den Browser nie. Metadaten (wer-mit-wem-wann) bleiben exponiert — inhärent bei Supabase, im Dokument korrekt als „untrusted" markiert. |
| **B** | **Malicious Server** (falsche Prekeys) | ✅ **Weitgehend hält.** Empirisch: Kyber-Prekey-Swap → `SignatureValidationFailed`; Signed-Prekey-Swap → `SignatureValidationFailed`. Beide sind identitätssigniert. OTK-Swap wird akzeptiert — das ist **spezifikationskonform** (OTKs sind in X3DH/PQXDH unsigniert) und harmlos, da der OTK nur in die KDF eingeht. Server kann OTK-Erschöpfung erzwingen (DoS → Last-Resort). |
| **C** | **MITM** | ⚠️ **Hängt an enough., nicht an der Engine.** Identity-Key-Ersetzung: die Engine wirft `UntrustedIdentity` bei **bekanntem** Peer — bei **erstem** Kontakt gibt es naturgemäß keinen Vergleichswert. Der Server *kann* beim Erstkontakt einen falschen Identity Key liefern. Abwehr: Safety Numbers (`generateSafetyNumber` + `verifyScannableFingerprint`, beide vorhanden und getestet) + TOFU-Pinning. **Ohne Safety-Number-UI ist enough. gegen einen bösartigen Server beim Erstkontakt nicht geschützt.** Das Dokument nennt TOFU, aber nicht als Pflicht-Deliverable. |
| **D** | **Rollback** | 🔴 **BRICHT — CRITICAL.** Siehe §7.1. Sender: Keystream-Reuse. Empfänger: Replay-Schutz vollständig aufgehoben (empirisch bestätigt: derselbe Ciphertext wird nach Vault-Rollback erneut akzeptiert). |
| **E** | **Crash** (encrypt→persist→send) | 🔴 **BRICHT — CRITICAL.** Crash nach `encryptMessage`, vor Commit → Rollback (Fall D). Crash nach Commit, vor Send → Nachricht verloren, aber **kryptographisch sicher** (Ratchet ist bereits vorgerückt). ⇒ **Die einzig sichere Reihenfolge ist encrypt → commit → send.** Verlorene Nachrichten sind akzeptabel, Keystream-Reuse nicht. |
| **F** | **Multi-Tab** | ⚠️ **Degradiert, nicht gebrochen.** Zweiter Tab → `DuplicatedMessage` beim Empfänger. Kein Keystream-Reuse (beide nutzen denselben Counter, der zweite fliegt auf), aber stiller Nachrichtenverlust. Web Lock + Revisions-Check zwingend. |
| **G** | **Identity Change** (Bob löscht Browserdaten) | ✅ **Sauber.** Engine wirft `UntrustedIdentity` — Alices Store lässt die neue Identität **nicht** stillschweigend zu. enough. **muss** das als UI-Warnung behandeln („Sicherheitsnummer hat sich geändert") und darf nicht blind `archive_session` + Neuaufbau machen; sonst ist der MITM-Schutz wertlos. |
| **H** | **Key Compromise** (Session-State gestohlen) | ✅/⚠️ **Wie spezifiziert.** Alte Nachrichten: **0 von 3** entschlüsselbar → **Forward Secrecy hält**. Zukünftige Nachrichten derselben Chain: entschlüsselbar → **PCS erst nach DH-Ratchet-Drehung**. Korrektes Double-Ratchet-Verhalten. |

---

## 14. Claim Verification Matrix

| # | Behauptung | Verdict | Belegstelle |
|---|---|---|---|
| 1 | „real Signal protocol" | ✅ **VERIFIED** | libsignal v0.101.0 als Git-Dep; PQXDH+DR-Symbole im Binary |
| 2 | „official libsignal core" | ✅ **VERIFIED** | `rev = b056faa6d` = Tag `v0.101.0` via `git ls-remote` |
| 3 | „PQXDH" | ✅ **VERIFIED** | `pqxdh.rs` im Binary; Kyber non-nullable; `X3DH no longer supported` |
| 4 | „Kyber1024" | ⚠️ **PARTIALLY VERIFIED** | Für PQXDH korrekt (1569 B pk). Unerwähnt: SPQR-Triple-Ratchet nutzt zusätzlich **ML-KEM-768** |
| 5 | „Double Ratchet" | ✅ **VERIFIED** | DH- + symmetrischer Ratchet empirisch bestätigt |
| 6 | „forward secrecy" | ✅ **VERIFIED** | Gestohlener State entschlüsselt 0/3 alte Nachrichten |
| 7 | „post-compromise security" | ⚠️ **PARTIALLY VERIFIED** | Erst nach DH-Ratchet-Drehung; nicht sofort |
| 8 | „replay protection" | ⚠️ **PARTIALLY VERIFIED** | Gilt nur bei intaktem State — **durch Vault-Rollback aufhebbar** |
| 9 | „browser compatible" | ⚠️ **PARTIALLY VERIFIED** | Vite-Build grün, keine Node-Globals. **Nie in echtem Browser getestet** |
| 10 | „no COOP/COEP" | ✅ **VERIFIED** | Kein SharedArrayBuffer/Atomics |
| 11 | „299 KB gzip" | ❌ **INCORRECT** | **~306 KB** (300 711 + 12 920 B) |
| 12 | „API maps 1:1" | ❌ **INCORRECT** | Adapter für **jedes** Konzept nötig — siehe §17 |
| 13 | „wrapper is ~500 lines" | ❌ **INCORRECT** | **2024 Zeilen** `src/lib.rs` |
| 14 | „12 releases" | ✅ **VERIFIED** | 0.1.0 … 0.6.6 |
| 15 | „official Signal code" | ✅ **VERIFIED** | Kein Fork, kein Patch, keine eigene Krypto |
| 16 | „only browser-capable Signal implementation" | ✅ **VERIFIED** | Alle Alternativen geprüft |
| 17 | „AGPL is acceptable" | ⚠️ **UNVERIFIED — legal** | Technisch plausibel, juristisch ungeklärt |
| 18 | „hash pinning is sufficient" | ❌ **INCORRECT** | Keine Provenance, keine CI, Laptop-Build |
| 19 | „IndexedDB design is safe" | ⚠️ **PARTIALLY VERIFIED** | 2C-Modell ist gut; Commit-before-Send fehlt als Invariante |
| 20 | „Supabase model is correct" | ⚠️ **UNVERIFIED** | Existiert nur als Prosa |

---

## 15. Scorecard (neu berechnet)

| Dimension | Gewicht | signal-wasm | Matrix crypto-wasm | Wire core-crypto | OpenPGP.js |
|---|--:|--:|--:|--:|--:|
| Protocol security | 25 % | **9** | 7 | 6 | 2 |
| Browser suitability | 20 % | **8** | 9 | 7 | 9 |
| Implementation maturity | 15 % | **5** | 9 | 8 | 8 |
| Integration | 10 % | **7** | 3 | 3 | 6 |
| Persistence | 10 % | **6** | 7 | 6 | 8 |
| Supply chain | 10 % | **3** | 9 | 8 | 8 |
| Complexity | 10 % | **6** | 4 | 3 | 8 |
| **Gewichtet** | **100 %** | **6.95** | **7.05** | **6.10** | **6.10** |

**Begründungen (signal-wasm):**
- **Protocol security 9/10** — echtes PQXDH + Double Ratchet + SPQR, unveränderter offizieller Core. Kein Punktabzug für Krypto; −1 weil PCS nicht sofort greift und Replay-Schutz zustandsabhängig ist.
- **Browser suitability 8/10** — keine Polyfills, kein COOP/COEP, Vite-Build grün. −2 für 306 KB gzip (Verdreifachung des Bundles) auf einer mobile-first PWA und fehlenden echten Browsertest.
- **Implementation maturity 5/10** — Version 0.6.6, **Pre-1.0**, 7 Monate alt, mehrere BREAKING Changes in der Historie, Selbst-Audit auf Stand v0.1.1. Der *Core* ist maximal reif; der *Wrapper* nicht.
- **Integration 7/10** — API passt konzeptionell gut zum Vorhaben; −3 weil enough. kein Device-Modell hat, das Envelope erweitert werden muss und das gesamte Supabase-Schema noch fehlt.
- **Persistence 6/10** — Export/Import-Primitive sind vollständig und sauber; −4 für die Rollback-/Keystream-Reuse-Falle, die die Anwendung selbst abfangen muss.
- **Supply chain 3/10** — der schwächste Punkt. Single Maintainer, keine CI, keine Provenance, Laptop-Build, keine externen Audits. Hashes reproduzieren zwar, beweisen aber nur Unveränderlichkeit.
- **Complexity 6/10** — Thin-Adapter-Ansatz ist richtig, aber Store-Hydration, Tombstones, Kyber-Usage-Tracking und Locking sind erheblicher Aufwand.

> **Wichtig, und im Widerspruch zum Ausgangsdokument:** Matrix crypto-wasm gewinnt nach dieser Gewichtung **rechnerisch knapp** (7.05 vs. 6.95) — allein wegen Reife und Supply Chain. **Das macht es trotzdem nicht zur besseren Wahl**, denn die Scorecard bildet die harte Anforderung „PQXDH" nicht als K.-o.-Kriterium ab. Olm/Megolm bietet **keinen Post-Quantum-Handshake**; wenn PQ eine Anforderung ist (und das Dokument setzt sie), fällt Matrix aus der Menge der zulässigen Lösungen heraus, bevor die Punkte zählen. Ich halte das explizit fest, weil eine Scorecard, die die eigene Anforderung nicht abbildet, zu falschen Schlüssen einlädt. **Die Engine-Wahl ist richtig — die Scorecard des Dokuments war es aus den falschen Gründen.**

---

## 16. Blockers

### 🔴 CRITICAL

**C-1 — Ratchet-State-Rollback ⇒ Keystream-/IV-Wiederverwendung**
Reproduzierbar: identischer Klartext aus zurückgerolltem State ⇒ **bytegleicher Ciphertext**; unterschiedliche Klartexte ⇒ 134 Byte gemeinsames Präfix. Zusätzlich hebt ein Vault-Rollback beim Empfänger den `DuplicatedMessage`-Replay-Schutz **vollständig** auf (empirisch bestätigt). Auslöser sind Alltagsereignisse: iOS-Hintergrund-Kill, Crash zwischen Encrypt und Persist, Storage-Restore.
*Nicht per Adapter lösbar* — der Determinismus ist korrektes libsignal-Verhalten. Nur ein Persistenz-Protokoll mit **commit-before-send** und monotoner Revision verhindert es.
→ Mitigation liegt im Kern bereits in `experiments/e2ee-2c/` vor.

### 🟠 HIGH

**H-1 — Supply Chain nicht unabhängig verifizierbar.** Keine npm-Provenance, keine CI, kein reproduzierbarer Build (`/Users/me/`-Pfade im Binary), Single Maintainer, Selbst-Audit fünf Releases veraltet.
**H-2 — Envelope unvollständig.** Ohne `deviceId` kann der Empfänger die `WasmProtocolAddress` nicht bilden; ohne Systemnachrichten-Diskriminator bricht der Mixed-Content-Pfad in `messages`.
**H-3 — Supabase-Prekey-Architektur existiert nicht.** Vier Tabellen + `claim_prekey_bundle()` sind reine Prosa. OTK-Race, Kyber-Consumption-Semantik, Last-Resort-Handling, RLS und Deletion-Cascade sind ungelöst.
**H-4 — Multi-Tab ohne Lock ⇒ stiller Nachrichtenverlust.** Web Locks sind auf iOS bei OS-Kill nicht zuverlässig; die Revisionsprüfung muss die autoritative Verteidigung sein.
**H-5 — Kein Test in einem echten Browser.** Alle Belege stammen aus Node. iOS Safari (WASM-Limits, IndexedDB-Eviction, Lifecycle) ist ungetestet.

### 🟡 MEDIUM

**M-1 — Last-Resort-Kyber-Prekey nicht erzeugbar.** `generateKyberPreKey(key_id, identity_key_pair, store)` hat **keinen** `is_last_resort`-Parameter. Der Wrapper kennt das Konzept in Doku und Anti-Replay-Logik, exponiert aber keinen Generator. Konsequenz: Bei erschöpftem OTK-Pool kann kein Fallback-Bundle bedient werden → Erstkontakt schlägt fehl. **Muss vor der Implementierung mit Upstream geklärt werden.**
**M-2 — Pre-1.0-Engine** mit BREAKING Changes in der Historie; Session-Wire-Format-Stabilität über Upgrades nicht garantiert (CHANGELOG dokumentiert Wire-Format-Stabilität immerhin explizit für den letzten Pin).
**M-3 — Bundle +306 KB gzip** verdreifacht die App-Größe.
**M-4 — Session-Records ~5.9 KB** (wegen SPQR) → IndexedDB-Quota bei vielen Peers beachten.
**M-5 — CSP** braucht `'wasm-unsafe-eval'`; im Dokument nicht erwähnt.
**M-6 — PCS-Behauptung** unqualifiziert.

### 🔵 LOW

L-1 Wrapper-LOC falsch (500 → 2024) · L-2 gzip-Größe falsch (299 → 306 KB) · L-3 „API maps 1:1" falsch · L-4 Kyber-Terminologie unvollständig (SPQR/ML-KEM-768 fehlt) · L-5 unscoped `signal-wasm` als Verwechslungsrisiko dokumentieren

---

## 17. Required Corrections

Vor Implementierungsbeginn verbindlich zu erledigen:

1. **Persistenz-Invariante festschreiben (C-1):** `encrypt → commit(vault, rev+1) → send`. Niemals senden, bevor der Ratchet-State committed ist. Monotone Revision, Rollback = harter Fehler (fail-closed). Verlorene Nachricht ist akzeptabel; Rollback ist es nicht. Das 2C-Modell zum verbindlichen Vault-Design erheben.
2. **Envelope korrigieren (H-2):** `{v, e, t, sd (senderDeviceId), sr (registrationId), b}` + eigener Diskriminator für unverschlüsselte Systemnachrichten.
3. **Device-Modell einführen (H-2):** enough. hat keines. Vor dem Adapter entscheiden: fixe `deviceId=1` mit dokumentierter Single-Device-Beschränkung, oder echtes Device-Register.
4. **Supabase-Schema tatsächlich entwerfen (H-3):** Migration mit `claim_prekey_bundle()` inkl. `FOR UPDATE SKIP LOCKED`, `is_last_resort`-Flag autoritativ in der DB, RLS-Matrix, Deletion-Cascade in `0004`, Nachfüll-Schwellwert, Rate-Limit gegen OTK-Erschöpfung. Plus Erweiterung von `supabase/rls-tests.sql`.
5. **Last-Resort-Prekey klären (M-1):** Upstream-Issue bei `getmaapp/signal-wasm`. **Ohne Antwort kein Produktions-Rollout** — sonst scheitert der Erstkontakt bei leerem OTK-Pool.
6. **Supply-Chain-Maßnahmen (H-1):** WASM+JS vendoren statt zur Buildzeit ziehen; Hash-Check in `.github/workflows/deploy.yml` als Pflicht-Gate; Upstream-Updates nur nach manuellem Review; Single-Maintainer-Risiko schriftlich akzeptieren.
7. **Locking (H-4):** Web Lock `enough-e2ee:{userId}` **mit** Timeout/`AbortSignal`, plus Revisionsprüfung als autoritative zweite Linie.
8. **Echter Gerätetest (H-5):** iOS Safari + Android Chrome, installierte PWA, inkl. Hintergrund-Kill-Szenario und IndexedDB-Persistenz über App-Neustart.
9. **TOFU + Safety Numbers als Pflicht-Deliverable (Threat C/G):** `generateSafetyNumber` + `verifyScannableFingerprint` sind vorhanden und getestet. `UntrustedIdentity` **muss** eine Nutzerwarnung auslösen, nicht einen stillen Session-Neuaufbau.
10. **Dokument-Korrekturen (LOW):** 306 KB statt 299 KB · 2024 statt 500 Zeilen · „API maps 1:1" streichen · SPQR/ML-KEM-768 ergänzen · PCS als *eventual* qualifizieren · CSP `'wasm-unsafe-eval'` ergänzen.
11. **Lizenzentscheidung (§11):** Bewusster, dokumentierter Beschluss + `LICENSE`-Datei; die fünf benannten Punkte anwaltlich klären.

---

## 18. Final Decision

# CONDITIONAL GO

**Required before implementation:**

```
1.  Commit-before-send Persistenz-Invariante + monotone Revision (C-1)
2.  Envelope um senderDeviceId + registrationId + Systemnachrichten-Diskriminator erweitern (H-2)
3.  Device-Modell entscheiden und festschreiben (H-2)
4.  Supabase-Prekey-Migration real entwerfen inkl. SKIP LOCKED + RLS + Cascade (H-3)
5.  Last-Resort-Kyber-Prekey mit Upstream klären (M-1)
6.  Artefakt vendoren + Hash-Gate in CI + Single-Maintainer-Risiko akzeptieren (H-1)
7.  Web Lock mit Timeout + Revision als autoritative zweite Linie (H-4)
8.  Realer iOS-Safari-/Android-Chrome-PWA-Test (H-5)
9.  TOFU + Safety-Number-UI als Pflicht-Deliverable (Threat C/G)
10. Faktenkorrekturen im Architekturdokument (LOW)
11. Bewusste, dokumentierte AGPL-Entscheidung + LICENSE-Datei (§11)
```

---

## 19. Recommended Next Step

**Nicht** mit dem Engine-Adapter beginnen. Die Engine ist der am besten verstandene Teil des Systems; die Risiken liegen ausschließlich drumherum.

**Schritt 1 — E2EE-2D: Crash-/Rollback-Härtung (höchste Priorität).** `experiments/e2ee-2c/` um genau die Fälle erweitern, die ich gebrochen habe: Crash zwischen Encrypt und Commit, Vault-Rollback beim Empfänger, konkurrierende Tabs. Erst wenn ein Test **beweist**, dass ein zurückgerollter State niemals einen zweiten Ciphertext produziert, ist C-1 geschlossen. Das ist die Bedingung, an der alles andere hängt.

**Schritt 2 — parallel: Upstream-Issue zum Last-Resort-Kyber-Prekey.** Blockiert nichts anderes, hat aber Vorlaufzeit und ist Voraussetzung für den Produktionsbetrieb.

**Schritt 3 — Supabase-Prekey-Migration als eigener, reviewbarer PR** mit `claim_prekey_bundle()`, RLS-Tests und Concurrency-Test gegen den OTK-Race.

**Schritt 4 — erst danach** der Adapter (`engine-adapter.ts` + `session-manager.ts`) gegen die dann feststehenden Envelope- und Schema-Verträge.

---

## Antwort auf die Abschlussfrage

> **„Würdest du diese Architektur mit gutem technischem Gewissen als Grundlage für echtes E2EE in enough. implementieren?"**

## **YES — CONDITIONAL GO**

Die Engine-Entscheidung ist **richtig und belegt**. Ich habe versucht, sie zu zerstören, und die zentralen Behauptungen haben gehalten: Der Kern ist nachweisbar offizieller libsignal v0.101.0 — verifiziert gegen Signals eigenes Git-Tag, nicht gegen ein README. Es gibt keinen Fork, keine Patches, keine selbstgebaute Kryptographie. PQXDH mit Kyber1024 ist real und nicht abschaltbar. Forward Secrecy, Replay-Rejection und identitätsgebundene Prekey-Signaturen habe ich empirisch bestätigt. Alle drei Hashes reproduzieren exakt. Und es existiert im August 2026 nachweislich **keine bessere browserfähige Option**.

Aber ich würde sie **nicht so implementieren, wie das Dokument sie beschreibt**. Das Dokument hat einen blinden Fleck an der gefährlichsten Stelle: Es behandelt Persistenz als Engineering-Detail, obwohl sie hier der eigentliche Sicherheitsmechanismus ist. Bei einem deterministischen Ratchet ist die Reihenfolge von Persist und Send **kein Implementierungsdetail, sondern die Krypto-Eigenschaft selbst**. Ein einziger falsch platzierter `await` — senden, bevor committed wurde — erzeugt IV-Reuse und macht die gesamte AEAD-Garantie wertlos, ohne dass irgendein Test rot wird und ohne dass ein Nutzer es je bemerkt. Genau deshalb ist C-1 CRITICAL und nicht HIGH.

Dazu kommt eine ehrliche Einordnung des Supply-Chain-Risikos: Man vertraut hier einer einzelnen Person, die auf ihrem Laptop ein 800-KB-Binary baut und ohne CI, ohne Provenance und ohne externes Audit auf npm veröffentlicht. Der Quellcode ist sauber und pinnt verifizierbar offiziellen Signal-Code — aber niemand kann beweisen, dass das ausgelieferte Binary aus diesem Quellcode entstanden ist. Das ist ein akzeptables Risiko, wenn man es **bewusst** eingeht und das Artefakt vendored plus hash-gated. Es ist kein akzeptables Risiko, wenn man `npm install` in eine Pipeline schreibt und hofft.

Mit den elf Korrekturen aus §17 — insbesondere der Commit-before-Send-Invariante — ist das eine tragfähige Grundlage für echtes E2EE. Ohne sie wäre das Ergebnis ein System, das in jedem Test grün ist und trotzdem Klartext preisgibt, sobald ein iPhone einen Tab im Hintergrund beendet.
