# enough. — E2EE Solution Review

**Document Type:** Market & Solution Review, Decision Record (gate for E2EE-3)
**Phase:** E2EE-SR (follow-up to E2EE-1 / E2EE-2 / E2EE-2.5, post PR #30)
**Date:** 2026-08-19
**Target Application:** `enough.` — React 18 / TypeScript / Vite 6 / Supabase / GitHub Pages PWA (`/enough/`)
**Status:** Final — **NO-GO** (see [§12](#12-recommendation))

> **Kurzfassung (Deutsch):** Dieser Review hat den Markt browserfähiger E2EE-Lösungen
> (Stand 2026-08-19) anhand von Primärquellen neu vermessen: npm-Registry-Metadaten,
> GitHub-Repositories (README, Issues, Releases, Code-Suche), Tarball-Inspektion
> (`.d.ts`-Exports, WASM-Dateigrößen) und veröffentlichte Audits. Ergebnis in einem Satz:
> **Es gibt weiterhin keine Lösung, die gleichzeitig (a) im Browser läuft, (b) die für
> enough. freigegebene Protokollarchitektur (PQXDH + Double Ratchet) implementiert,
> (c) auditiert bzw. institutionell getragen ist, (d) ohne fremde Server-Semantik
> (Matrix-Homeserver / Wire-Delivery-Service) nutzbar ist und (e) mit der
> Lizenzpolitik des Projekts vereinbar ist.** Neu seit E2EE-2.5: OpenMLS wurde im Mai
> 2026 von SRLabs (Sovereign Tech Agency) auditiert — hat aber keine offiziellen
> JS-Bindings; mit `@getmaapp/signal-wasm` existiert erstmals ein inoffizieller
> WASM-Bau der offiziellen libsignal-Crates — ohne unabhängiges Audit, mit AGPL und
> minimaler Adoption. Beides ändert die Entscheidung nicht. Die Empfehlung bleibt und
> lautet exakt: **NO-GO.**

---

## Table of Contents

1. [Scope, guardrails & method](#1-scope-guardrails--method)
2. [Requirements](#2-requirements)
3. [Screening overview](#3-screening-overview)
4. [Signal / libsignal options](#4-signal--libsignal-options)
5. [Matrix / vodozemac / matrix-sdk-crypto-wasm](#5-matrix--vodozemac--matrix-sdk-crypto-wasm)
6. [MLS family](#6-mls-family)
7. [Other serious browser E2EE libraries](#7-other-serious-browser-e2ee-libraries)
8. [Comparison table](#8-comparison-table)
9. [Security assessment](#9-security-assessment)
10. [Browser assessment](#10-browser-assessment)
11. [Implementation effort](#11-implementation-effort)
12. [Recommendation](#12-recommendation)
13. [Sources](#13-sources)

---

## 1. Scope, guardrails & method

This review answers one question: **does a realistically available E2EE solution exist
that `enough.` can adopt for its browser app today?** It re-scans the market after the
E2EE-2.5 feasibility gate ([`docs/e2ee-implementation-feasibility.md`](./e2ee-implementation-feasibility.md),
which returned NO-GO for E2EE-3) and is broader in scope: not only Signal-family
libraries, but every serious browser-capable E2EE engine.

**Guardrails (unchanged, per project rules):**

- No production E2EE implementation; `sendMessage()` stays untouched.
- No Supabase migration.
- No self-written Double Ratchet, PQXDH, X3DH, or ML-KEM.
- This document changes no application code — it is analysis only.

**Method — primary sources only, no README claims taken at face value:**

| Source class | What was extracted |
|---|---|
| npm registry API (`registry.npmjs.org`) | latest version, publish dates, license fields, unpacked sizes, dependency lists, provenance attestations, deprecation flags, full package search ("signal protocol", "double ratchet", "pqxdh", "vodozemac", "mls", "openmls") |
| GitHub API (`gh api`) | repo metadata (archived?, pushed_at, license, stars), READMEs, release history, issue threads (incl. Signal's WASM position), code search (`wasm32` in libsignal), org scans |
| Package tarballs (downloaded & unpacked) | actual `.wasm` and JS file sizes (raw **and** gzip, measured), exported API surface (`index.d.ts` class lists) |
| Published audits | Least Authority vodozemac report (PDF), SRLabs OpenMLS report (PDF link), Wire/Proteus 2017 Kudelski + X41 D-Sec audit, noble audit history |
| Specifications | Signal PQXDH spec (signal.org), Double Ratchet spec, RFC 9420 (MLS), MLS PQ drafts (`draft-ietf-mls-pq-ciphersuites`, `draft-ietf-mls-combiner`, `draft-mahy-mls-pq`), RFC 9750 (MLS architecture) |

All registry/repository data was captured **2026-08-19**. All sizes in this document
are **measured in this sandbox** from the published tarballs, not quoted from READMEs.

---

## 2. Requirements

Derived from the approved architecture ([`docs/e2ee-session-architecture.md`](./e2ee-session-architecture.md))
and the E2EE-1/2.5 decision records:

| # | Requirement | Why |
|---|---|---|
| R1 | **Browser-capable**: WASM or pure JS/TS; no Node-native addons, no `node:` polyfill chains | App is a Vite SPA on GitHub Pages |
| R2 | **React/Vite 6 compatible**: ESM, tree-shakeable or at least bundlable; WASM loadable without COOP/COEP | Build toolchain is fixed |
| R3 | **GitHub Pages compatible**: static assets under `/enough/`, HTTPS only, no server-side crypto | Hosting is fixed |
| R4 | **License compatible**: no copyleft obligation that dictates the app's licensing (repo currently declares **no license**; prior reviews rejected AGPL/GPL dependencies as policy) | E2EE-2.5 rejection criteria remain project policy |
| R5 | **Actively maintained**: releases in 2025–2026, credible maintainer (institution or funded team preferred) | Crypto layers must not rot |
| R6 | **Audited or institutionally backed**: published third-party audit of the shipped code path, or equivalent institutional trust (massive production deployment) | The engine is the trust anchor |
| R7 | **Protocol fit**: asynchronous 1:1 messaging with Forward Secrecy + Post-Compromise Security; target per approved architecture: **PQXDH + Double Ratchet**; PQ support at least plannable | E2EE-2 baseline |
| R8 | **Standalone usable**: no forced foreign server semantics (Matrix homeserver, Wire delivery service, proprietary licensing server) | Backend is Supabase, fixed |
| R9 | **Offline session establishment** (prekey/KeyPackage model) | Receiver may be offline (E2EE-2 §5) |
| R10 | **Sane bundle cost & production maturity** | PWA on mobile networks; "production-ready", not alpha |

---

## 3. Screening overview

Full-funnel result of the npm/GitHub scan (2026-08-19):

| Bucket | Candidates found | Survive screening |
|---|---|---|
| Signal official | `@signalapp/libsignal-client` (npm 0.101.0), `libsignal-protocol-javascript` (archived 2021, removed from npm — registry returns 404) | 0 |
| Signal unofficial WASM builds | `@getmaapp/signal-wasm` (libsignal crates → WASM), community ports (`libsignal-wasm`, `positive-intentions/signal-protocol`, …) | 1 (deep-dive, §4.3) |
| Matrix | `@matrix-org/matrix-sdk-crypto-wasm` 18.5.0, `vodozemac` (no official JS bindings), third-party vodozemac bindings (`@towns-protocol/vodozemac`, `@dtelecom/vodozemac-wasm`, `vodozemac-wasm-bindings`, `@cogia/vodozemac-nodejs`), `@matrix-org/olm` (archived) | 1 (deep-dive, §5) |
| MLS | OpenMLS (Rust; audited 2026), `@wireapp/core-crypto` 10.4.0 (Wire; OpenMLS inside), `mls-rs` (AWS; unaudited), `ts-mls`, `@slopus/murmur`, `ping-openmls-sdk`, `openmls-wasm` | 3 (deep-dive, §6) |
| Signal-protocol TS re-implementations | `@open-e2ee/signal-protocol-sdk`, `webcrypto-ratchet`, `ratchet-ts`, `@brashkie/signalis`, `@bcts/double-ratchet` (Parity), `veilchat-protocol`, `nostr-double-ratchet`, `@privacyresearch/libsignal-protocol-typescript`, `2key-ratchet` | 0 (all fail R6, §7) |
| Non-ratchet / other models | `openpgp` (OpenPGP.js), `@seald-io/sdk`, Themis (`wasmthemis` — gone from npm), `@wireapp/proteus` (last publish 2022, retired protocol) | 0 (§7) |

---

## 4. Signal / libsignal options

### 4.1 `@signalapp/libsignal-client` — the official library

Evidence (npm registry + GitHub, 2026-08-19):

- Latest **0.101.0** (2026-08-14); repo `signalapp/libsignal` active (pushed 2026-08-14), **AGPL-3.0-only**, 5,959 stars.
- npm package: **147.5 MB unpacked**, `main: dist/index.js`, ESM, built via `build_node_bridge.py` → **native Node addon** (`node-gyp-build`, `node:crypto`, `node:buffer`). No `browser`/`wasm` entry points. (Registry JSON, verified.)
- Repo layout: `java/`, `swift/`, `node/` bridges only. Code search for `wasm32` in the repository: **0 hits**.
- README, verbatim: *"Use outside of Signal is unsupported. In particular, the products of this repository are the Java, Swift, and TypeScript libraries … All APIs and implementations are subject to change without notice, as are the JNI, C, and Node add-on 'bridge' layers."*
- Browser/WASM position — issue [#350 "WASM Bridge / Build for libsignal-client"](https://github.com/signalapp/libsignal/issues/350) (closed, last activity 2025): Signal (jrose-signal) — *"supporting a full wasm bridge would qualify as too much of a maintenance burden to land in the main repository"*; a downstream fork would be needed; and newer: *"approaches … are much more difficult now that we have `boring` as a dependency"* (C dependency tree hostile to wasm32). The community member who attempted the port abandoned it.
- Protocol: the real thing — PQXDH (Kyber-1024-class PQ prekeys), Double Ratchet (+ SPQR research), Sealed Sender, group machinery. Deployed at Signal's scale (native apps only). **No published third-party audit of libsignal itself**; trust rests on Signal's institutional standing.

**Verdict: rejected (R1).** Cannot run in a browser at all; AGPL (R4) and "unsupported for external use" would additionally apply if forked/bridged.

### 4.2 `libsignal-protocol-javascript` — the legacy JS implementation

- Official Signal project, **deprecated/archived 2021** (`signalapp/libsignal-protocol-javascript`, archived, last push 2021-08-04; registry entry removed — npm returns **404**; GPL-3.0).
- asm.js/WebWorker era; no PQXDH, no modern maintenance.

**Verdict: rejected (R1, R5, R6).** Dead for four-plus years. Reaffirms E2EE-2.5.

### 4.3 `@getmaapp/signal-wasm` — unofficial WASM build of the official core (new since E2EE-2.5)

This is the closest thing to "official Signal protocol in the browser" that exists
today, so it was examined in depth.

Evidence:

- npm **0.6.5** (2026-08-16), 11 releases since **2026-01-14**, **AGPL-3.0-only**, 909 KB unpacked, zero runtime deps, **no npm provenance attestations**.
- Repo `getmaapp/signal-wasm`: created 2026-01, **12 stars**, 4 forks. `Cargo.toml` (verified) pins the **official crates**: `libsignal-protocol` + `zkgroup` from `signalapp/libsignal` @ rev `b5121d0` (2026-07-16, workspace 0.97.4), compiled via `wasm-bindgen`, randomness via Web Crypto (`getrandom` `js`/`wasm_js` features). README: *"not affiliated with or endorsed by Signal Technology Foundation."*
- Own additions on top: WASM bridge layer, a "device-ID decoupling" refactor, in-memory stores (`InMem*Store`) — persistence is the integrator's job.
- Measured bundle: **787 KB wasm (299 KB gzip) + 75 KB JS (12 KB gzip)** — by far the smallest full-engine WASM of all candidates.
- Security documentation: a self-published `SECURITY_AUDIT_REPORT.md` (v0.1.1, 2026-02-02). It is a **self-review, not an independent audit** (the repo contains `GEMINI.md` — the project documents AI-assisted development; the report has no external author).
- Protocol: PQXDH incl. Kyber prekeys + Kyber anti-replay memory (`export_kyber_usage`), sender keys, safety numbers. README marketing says "Triple Ratchet"; the engine is pinned upstream libsignal.

**Verdict: rejected for production (R4, R5, R6).** Unaudited unofficial packaging of an
audited-by-deployment core, single small org, ~7 months old, 12 stars, no attestations,
AGPL virality on top. Precisely the "supply-chain risk" category E2EE-2.5 flagged for
community builds. **Keep on the watch list** (§12): if it gains an independent audit,
provenance attestations and adoption, and the project accepts AGPL, it becomes the
primary GO candidate — the adapter seam in `spikes/e2ee-compat-spike` fits its API shape
1:1 (stores + `processPreKeyBundle` + `encrypt/decrypt`).

---

## 5. Matrix / vodozemac / matrix-sdk-crypto-wasm

### 5.1 `@matrix-org/matrix-sdk-crypto-wasm` — Element's Rust crypto, in the browser

The strongest audited browser E2EE engine that exists — and still not usable for `enough.`:

- npm **18.5.0** (line active; package modified 2026-08-10), **Apache-2.0**, zero deps. Production-shipped in Element Web/X (web, Vite-based builds).
- Core = `vodozemac` (Matrix's Rust Olm/Megolm implementation). **Audited by Least Authority** (final report 2022-03-30, published 2022-05-16): most findings resolved; at least two explicitly left unresolved/deferred in the published report (keys-in-memory/side-channel hardening, Megolm MAC tag truncation length). Matrix overall additionally reviewed in the German BSI CAOS2 project; the 2022 academic disclosure (Albrecht et al.) broke the *client trust model* (homeserver-controlled device lists), not vodozemac's crypto core.
- **Protocol**: Olm = X3DH + Double Ratchet variant (1:1), Megolm = group ratchet. Forward secrecy + PCS + asynchronous prekey establishment: **yes**. **No PQ** — Olm/Megolm are classical Curve25519; Matrix E2EE PQ migration is still pending industry-wide (as of 2026, deployments wrap classical Megolm in PQ *TLS* as interim HNDL mitigation; the protocol itself is not PQ).
- **API surface — verified from the shipped `index.d.ts`** (tarball, 18.5.0): exports are Matrix-machine-shaped (`OlmMachine`, `Device`, `InboundGroupSession`, `KeysUploadRequest`, `CrossSigning*`, `*Backup*`, `ToDevice*`, `Sas`, `RoomSettings`, …). **There is no exported generic Olm `Account`/`Session` API** (grep for `export class Session|Account|OlmSession` → empty). The engine is unusable without Matrix homeserver semantics (rooms, to-device events, key queries, cross-signing).
- **Measured bundle**: wasm **7.82 MB raw / 2.09 MB gzip** + JS glue 420 KB raw / 62 KB gzip. Works in Vite (the package documents the `matrix-org:wasm-esm` condition; Vite ≥5.1 `resolve.conditions` supports it; Element's own web clients build with Vite).

**Verdict: rejected (R7, R8).** Standalone use would mean driving `OlmMachine` with
fake Matrix semantics — an unsupported hack around an audited engine, with no PQ and a
2 MB gzip wasm floor. Not compatible with a Supabase 1:1 messenger without adopting
Matrix wholesale.

### 5.2 `vodozemac` standalone

- Repo `matrix-org/vodozemac`: active (pushed 2026-08-18), **Apache-2.0**, audited core (§5.1), releases 0.8.1 (2024-10) / 0.9.0 (2025-01) / 0.10.0 (2026-04).
- **No official JS/WASM bindings published by Matrix** (npm search verified). Third-party bindings only:

| npm package | Backing | Status (2026-08-19) | Assessment |
|---|---|---|---|
| `@towns-protocol/vodozemac` 0.1.0 | Towns (company; Matrix-stack fork ecosystem) | repo `towns-protocol/vodozemac-bindings`: **1 star, last push 2025-05-01 (dormant >15 months)**; npm metadata carries **no license, no repo link** | production-used by one company; stale, v0.1.0, unaudited bindings |
| `@dtelecom/vodozemac-wasm` 0.3.0 | dTelecom | 2026-05-14, 0 stars | fork-ecosystem, unaudited |
| `vodozemac-wasm-bindings` 0.8.1 | individual (Mekacher-Anis) | last activity 2025-01, **0 stars** | dormant |
| `@cogia/vodozemac-nodejs` 0.0.10 | Cogia | Node-native only (linux/darwin/win prebuilds) | **not browser (R1)** |

- Even with bindings, Olm requires the *integrator* to build the session-establishment
  orchestration (prekey upload/claim, fallback keys, replay handling) around
  `Account`/`Session` — protocol-adjacent glue the project has forbidden writing
  without a vetted engine, and the trust model lessons from the 2022 Matrix disclosure
  would have to be re-solved in `enough.`'s own layer.

**Verdict: rejected (R5, R6, R7).** Audited core, but no maintained official browser
surface; Olm (no PQ) is not the approved target protocol.

### 5.3 `@matrix-org/olm` (legacy libolm JS/WASM)

- npm deprecated (*"Package no longer supported"*), repo archived; replaced by vodozemac. Historical NCC Group audit (2016) is moot.

**Verdict: rejected (R5).** Dead.

---

## 6. MLS family

MLS (RFC 9420, 2023; architecture RFC 9750, 2025) is the IETF-standardized successor
model for Signal-style E2EE. A 1:1 chat is a 2-member MLS group; MLS provides FS and
PCS, and asynchronous establishment via KeyPackages (receiver offline). **But**: PQ
cipher suites are still IETF drafts (`draft-ietf-mls-pq-ciphersuites`,
`draft-ietf-mls-combiner`, `draft-mahy-mls-pq`) — standardized MLS today is classical
(Wire's production suite is `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`), and MLS needs a
delivery-service role that `enough.` would have to implement against Supabase.

### 6.1 OpenMLS (Rust) — now audited, but no official JS bindings

- Repo `openmls/openmls`: MIT, 1,015 stars, very active (pushed 2026-08-19); maintained by Phoenix R&D + Cryspen (5 maintainers).
- **New since E2EE-2.5: independent security audit by SRLabs, sponsored by the Sovereign Tech Agency** (announced 2026-05-27): 8 findings (1 High), 7 fixed in `openmls` 8.1 / 7.3, 1 Low in remediation. Full report published (`SRL-OpenMLS_security_assurance_assessment.pdf`). Used by Phoenix Air, XMTP, Cloudflare Meet, Wire, CoverDrop.
- `js` cargo feature exists ("enable compilation to wasm"), **but no official npm package / JS bindings are published**. Third-party: `openmls-wasm` 0.1.0 (2025-10; related repos ≤3 stars, dormant), `ping-openmls-sdk` 0.7.26 (active versioning, **but npm metadata has no repository/homepage link — unauditable provenance; supply-chain red flag; rejected**).
- PQ: tracking `draft-ietf-mls-pq-ciphersuites` behind feature flags — not stable.

**Verdict: rejected for now (R1, R7-partial).** The audited engine the MLS camp was
missing — but `enough.` cannot consume a Rust crate without maintained JS bindings, and
building/packaging the bindings ourselves would make this project the unaudited
packager (same objection as §4.3, without even getmaapp's head start). **Top watch-list
entry** (§12).

### 6.2 `@wireapp/core-crypto` — audited engine (OpenMLS) inside a Wire-locked, GPL package

- npm **10.4.0** (published 2026-08-19), **GPL-3.0**, 52 MB unpacked, active (Wire).
- Wire completed the **Proteus → MLS migration for all conversations including 1:1** in 2025 (Proteus retired; the 2017 Kudelski/X41 audit covered Proteus, i.e., the retired path). The MLS engine inside is OpenMLS (§6.1) — but the shipped JS API is Wire's `CoreCrypto` client (conversation IDs, Wire keypackage lifecycle, Wire delivery-service message semantics), documented for Wire's stack, not for standalone use.
- No published audit of the core-crypto packaging / Wire MLS delivery integration found.
- Measured browser bundle: wasm **7.71 MB raw / 2.83 MB gzip** + JS 574 KB raw / 50 KB gzip (package also ships native desktop libs).

**Verdict: rejected (R4, R8).** GPL-3.0 virality + Wire-locked semantics + P-256
classical suite (no PQ) + heavy bundle.

### 6.3 `mls-rs` (AWS Labs) and the small TS MLS libraries

- `mls-rs`: Apache-2.0, active, RFC 9420-conformant, WASM builds supported — but its own README states: *"This library has been validated for conformance to the RFC 9420 specification but **has not yet received a full security audit by a 3rd party**"*, its Web Crypto provider is flagged experimental/unsupported, and **no official npm JS bindings exist**. Rejected (R1, R6).
- `ts-mls` (1.6.2, 2026-03, MIT, pure TS + `@hpke/core`): serious interop-testing history (tested against OpenMLS), but single-author, unaudited. Rejected (R6).
- `@slopus/murmur` (0.4.4, 2026-08, npm declares MIT but the repo has **no detectable LICENSE file**; 88 stars, ~7 months old; noble-based): promising energy, MLS-over-delivery-queues concept, single author, unaudited, license ambiguous. Rejected (R4, R6). Watch.
- MLS++ (Cisco): C++, no browser target. Rejected (R1).

---

## 7. Other serious browser E2EE libraries

### 7.1 `openpgp` (OpenPGP.js)

- **6.3.1 (2026-06-04), LGPL-3.0+, 17.4 MB unpacked, actively maintained**, runs in browsers (Proton, FlowCrypt). Real, production-grade library.
- **Rejected on protocol grounds (R7)**: OpenPGP is store-and-forward public-key encryption — **no forward secrecy, no post-compromise security, no ratchets**. It is not a messenger protocol; adopting it would silently downgrade every security property E2EE-2 requires.

### 7.2 `@seald-io/sdk` (Seald)

- 0.33.1 (2025-09-03), **UNLICENSED (proprietary/commercial)**, closed core, browser SDK exists, French ANSSI-era marketing claims. Commercial licensing + dependency on Seald's backend components. Rejected (R4, R8) — not open, not embeddable in a free GitHub Pages app.

### 7.3 Signal-protocol TypeScript re-implementations (the 2025/2026 crop)

Registry data captured 2026-08-19:

| Package | Version / first release | License | Backing | Assessment |
|---|---|---|---|---|
| `@open-e2ee/signal-protocol-sdk` | 0.3.0 (2026-08-18; project ~1 yr) | AGPL-3.0-or-later | single author | PQXDH claimed; 11.5 MB, 6 deps; unaudited, near-zero adoption (unchanged vs. E2EE-2.5) |
| `webcrypto-ratchet` | 0.7.2 (**created 2026-07-24 — 4 weeks old**, 2 versions) | MIT | single author | PQXDH + *Triple* Ratchet (the variant E2EE-2 §1.2 rejected); 57 KB; unaudited |
| `ratchet-ts` | 0.5.0 (2026-08-08) | MIT | single author (gntrs) | X25519+ML-KEM-768 hybrid ratchet; unaudited |
| `@brashkie/signalis` | 0.7.1 (2026-07) | Apache-2.0 | single author | X3DH+DR in TS; unaudited |
| `@bcts/double-ratchet` | 1.0.0-alpha.23 (2026-04) | AGPL-3.0-only | Parity Technologies monorepo (`bcts`, Blockchain-Commons port suite) | interesting org backing, but **alpha**, repo self-declares *"not been audited"* and documents AI-assisted development; package no longer present in the monorepo tree |
| `veilchat-protocol`, `nostr-double-ratchet`, `@privacyresearch/libsignal-protocol-typescript` (repo gone), `2key-ratchet` (2020) | — | — | individuals | inactive, ecosystem-locked, or P-256-era |

**Common verdict: rejected (R5, R6 — and often R4).** None of these can serve as the
trust anchor for production E2EE. This is not a moral judgment about the code — it is
the E2EE-2.5 rule: the engine must arrive *with* trust (audit or institutional
deployment), not acquire it later at our users' expense.

### 7.4 Screened out

Themis/`wasmthemis` (gone from npm; Secure Session ≠ ratchet model), `@wireapp/proteus`
(standalone TS Proteus last published 2022; protocol retired by Wire), Session
ecosystem (tied to its own onion network/protocol, no independent audit of a
Signal-grade session engine), WebRTC insertable-streams (media, not text), virgil/E3Kit
(discontinued).

---

## 8. Comparison table

Legend: ✅ yes / ⚠️ partial / ❌ no / — n/a. "Standalone" = usable without foreign
server semantics (R8). Sizes = measured from npm tarballs (raw / gzip), 2026-08-19.

| Candidate | Browser impl | Vite | GH Pages | License | Maintenance | Audit status | Protocol | PQ | 1:1 fit | Offline session est. | FS | PCS | Bundle (engine) | Standalone | Production-ready | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `@signalapp/libsignal-client` 0.101.0 | ❌ Node-native (147.5 MB) | — | — | AGPL-3.0 | ✅ Signal, weekly | ⚠️ no public lib audit; massive native deployment | PQXDH + DR (reference) | ✅ Kyber-1024 prekeys | ✅ | ✅ prekeys | ✅ | ✅ | — | — | native only | **reject** |
| `libsignal-protocol-javascript` | ❌ asm.js era | — | — | GPL-3.0 (archived) | ❌ dead 2021, npm 404 | ❌ obsolete | X3DH + DR (old) | ❌ | ✅ | ✅ | ✅ | ✅ | — | — | ❌ | **reject** |
| `@getmaapp/signal-wasm` 0.6.5 | ✅ WASM (official crates pinned) | ✅ | ✅ | AGPL-3.0 | ⚠️ 1 org, 7 mo, 12★ | ❌ self-review only, no attestations | PQXDH + DR (upstream core) | ✅ | ✅ | ✅ | ✅ | ✅ | **787 KB / 299 KB** + 12 KB JS | ✅ | ⚠️ unaudited packaging | **reject (watch)** |
| `@matrix-org/matrix-sdk-crypto-wasm` 18.5.0 | ✅ WASM | ✅ (`wasm-esm` condition) | ✅ | **Apache-2.0** | ✅ Matrix/Element | ✅ vodozemac: Least Authority 2022 (few findings deferred) | Olm (X3DH+DR variant) + Megolm | ❌ | ⚠️ via Olm, but API is room/to-device shaped | ✅ (KeyPackages/OTKs) | ✅ | ✅ | **7.82 MB / 2.09 MB** + 62 KB JS | ❌ Matrix homeserver semantics | ✅ (in Matrix) | **reject** |
| `vodozemac` + 3rd-party bindings | ⚠️ unofficial WASM | ⚠️ | ⚠️ | Apache-2.0 (core) | ⚠️ core active; bindings dormant (Towns: 1★, >15 mo stale) | ✅ core audited / ❌ bindings not | Olm/Megolm | ❌ | ⚠️ same as above | ✅ | ✅ | ✅ | ~1 MB class (bindings) | ⚠️ glue is ours | ⚠️ | **reject** |
| `@matrix-org/olm` | ✅ (legacy) | ⚠️ | ⚠️ | — | ❌ archived, npm-deprecated | ⚠️ NCC 2016 (historical) | Olm/Megolm | ❌ | ✅ | ✅ | ✅ | ✅ | small | ⚠️ | ❌ | **reject** |
| OpenMLS (Rust) + unofficial bindings | ⚠️ `js` feature, no official npm pkg | ⚠️ | ⚠️ | MIT | ✅ Phoenix R&D + Cryspen | ✅ **SRLabs 2026** (7/8 fixed in 8.1/7.3) | MLS (RFC 9420) | ⚠️ PQ drafts behind flags | ⚠️ 2-member group | ✅ KeyPackages | ✅ | ✅ | unknown (self-build) | ⚠️ delivery service is ours | ⚠️ bindings immature | **reject (watch #1)** |
| `@wireapp/core-crypto` 10.4.0 | ✅ WASM | ✅ | ✅ | **GPL-3.0** | ✅ Wire (released today) | ⚠️ engine audited (OpenMLS); packaging/Wire MLS layer not | MLS (+ retired Proteus) | ❌ (P-256 suite) | ⚠️ via MLS | ✅ | ✅ | ✅ | **7.71 MB / 2.83 MB** + 50 KB JS | ❌ Wire delivery-service semantics | ✅ (in Wire) | **reject** |
| `mls-rs` (AWS) | ⚠️ WASM possible, no npm bindings | ⚠️ | ⚠️ | Apache-2.0 | ✅ AWS | ❌ self-declared *"not yet … full security audit"*; WebCrypto provider experimental | MLS | ⚠️ drafts | ⚠️ | ✅ | ✅ | ✅ | self-build | ⚠️ | ⚠️ | **reject** |
| `ts-mls` / `@slopus/murmur` / `ping-openmls-sdk` | ✅ TS / TS / ? | ✅ | ✅ | MIT / ⚠️ unclear / ? | ⚠️ individuals | ❌ unaudited (ping: **no source repo link**) | MLS | ❌ | ⚠️ | ✅ | ✅ | ✅ | ~0.7–1.4 MB | ✅ | ❌ | **reject** |
| Signal-protocol TS re-implementations (`@open-e2ee/*`, `webcrypto-ratchet`, `ratchet-ts`, `signalis`, `@bcts/double-ratchet`) | ✅ TS | ✅ | ✅ | mixed (2× AGPL) | ❌ weeks-to-months old / single authors | ❌ unaudited | X3DH/PQXDH + DR variants | ⚠️ some | ✅ | ✅ | ✅ | ✅ | 57 KB–11.4 MB | ✅ | ❌ | **reject** |
| `openpgp` (OpenPGP.js) 6.3.1 | ✅ JS/TS | ✅ | ✅ | LGPL-3.0+ | ✅ | ⚠️ long deployment history | OpenPGP (RFC 4880bis/9580) | ❌ | ⚠️ not a ratchet | ✅ (store-and-forward) | ❌ **no FS** | ❌ no PCS | large (17 MB pkg) | ✅ | ✅ | **reject (protocol)** |
| `@seald-io/sdk` | ✅ | ✅ | ⚠️ | proprietary | ⚠️ | ⚠️ claims, closed core | own (prekey-based) | ❌ | ✅ | ✅ | ⚠️ | ⚠️ | 8 MB pkg | ❌ licensing server | ⚠️ | **reject** |

---

## 9. Security assessment

**Protocol level.**

- The only engines offering the approved property set (**PQXDH handshake → HNDL-resistant initial secret + classical DR with per-message FS and 1-roundtrip PCS**) are Signal-protocol implementations. In the browser, every such implementation is either unofficial, unaudited, or AGPL — or all three (§4, §7.3).
- Olm/Megolm (Matrix): cryptographically sound, audited core, FS+PCS for 1:1 via Olm — but **no PQ**, and the 2022 academic disclosure showed that the *surrounding trust model* (server-controlled device/key distribution, key forwarding) is where Matrix E2EE has historically broken. `enough.` would inherit that design burden with no library support for it.
- MLS (RFC 9420): FS+PCS by design, now with an audited open engine (OpenMLS/SRLabs). PQ is still draft-stage; standardized suites are classical (Wire ships P-256). A 1:1 "group of two" is technically clean, but the delivery-service role (KeyPackage distribution, Welcome/Commit ordering, group state) is substantial un-auditable *application* surface we would author ourselves.

**Implementation/supply-chain level.**

- `@getmaapp/signal-wasm`: pinned upstream core is the good part; the risk is everything around it — wrapper, build pipeline, store semantics (in-memory + `export_kyber_usage` persistence contract), a self-authored "audit report" from an AI-assisted workflow, no npm provenance attestations, and zero independent review. An E2EE trust anchor cannot be "probably fine".
- `ping-openmls-sdk`: active release cadence but **no published source repository** — disqualified outright as a supply-chain risk (documented here as a pattern example).
- Licensing as security policy: AGPL/GPL engines (libsignal-derived builds, core-crypto, bcts, open-e2ee) would set the license of the entire app. The repository currently declares no license; adopting any copyleft engine is a project-owner decision that has not been made — treated as blocking, consistent with E2EE-2.5.
- Constant-time/side channels: WASM engines (vodozemac, libsignal-derived) inherit the usual browser side-channel caveats documented in E2EE-2.5 §3/§10; unchanged.

**What would be "good enough" security-wise:** an engine that (1) wraps an audited core
without protocol modifications, (2) is packaged by the auditing institution or the core
maintainer, (3) ships provenance attestations, and (4) exposes a store-based generic API
(no foreign server semantics). No browser package meets all four today.

---

## 10. Browser assessment

| Criterion | State (2026-08-19) |
|---|---|
| **WASM vs JS vs native** | All serious engines are Rust→WASM (matrix-sdk-crypto-wasm 7.8 MB, core-crypto 7.7 MB, signal-wasm 0.79 MB). Pure-TS engines are all unaudited (§7.3). Native WebCrypto covers primitives (X25519/Ed25519/HKDF/AES-GCM; ML-KEM still WICG draft, Node ≥24.7 only — per E2EE-2.5). |
| **React/Vite** | All WASM candidates are ESM-consumable; matrix-sdk-crypto-wasm documents the `matrix-org:wasm-esm` export condition (Webpack/Node documented; Vite ≥5.1 via `resolve.conditions`; Element's Vite-based web clients ship it). No React-specific coupling exists in any candidate (all engine-only). |
| **GitHub Pages** | None of the candidates requires special headers (no COOP/COEP, no threads, no streaming instantiation) — WASM loads as a static asset or inlined module under `/enough/`. GitHub Pages HTTPS satisfies WebCrypto secure-context. The PWA service worker caches only the app shell; a multi-MB engine wasm would be a first-load cost, not a SW-cache concern. |
| **Bundle cost (measured)** | signal-wasm: **299 KB gzip** wasm + 12 KB JS — negligible. matrix-sdk-crypto-wasm: **2.09 MB gzip** + 62 KB. core-crypto: **2.83 MB gzip** + 50 KB. Against the current app baseline of 136.6 KB gzip total, the Matrix/Wire engines are a 15–20× bundle increase; signal-wasm-class engines are a ~3.3× increase (still acceptable for an E2EE feature if lazily loaded). |
| **Browser floor** | Unchanged from E2EE-2.5: Chrome/Edge ≥137, Firefox ≥129, Safari ≥17 (Ed25519 gate); `isE2eeSupported()` capability gating stays mandatory. |

---

## 11. Implementation effort

Rough, honest sizing per integration path (protocol engine only; Supabase prekey/transport tables and IndexedDB session stores on top):

| Path | Effort | Breakdown | Risk |
|---|---|---|---|
| `@getmaapp/signal-wasm` | **M** (2–4 weeks) | adapter (API matches the spike's `protocol-adapter.types.ts` 1:1: stores + `processPreKeyBundle` + `encrypt/decrypt`); IndexedDB store impls; prekey tables via existing E2EE-1 layer; lazy-load the wasm | engine trust (unaudited), AGPL decision, upstream tracking of a fast-moving fork |
| `matrix-sdk-crypto-wasm` | **XL** (3+ months) | drive `OlmMachine` without a homeserver or re-implement Matrix client semantics (rooms, to-device, key queries, cross-signing) over Supabase — unsupported territory | architecture mismatch; every upstream release can break the shim; no PQ |
| vodozemac + third-party bindings | **L–XL** | bindings are v0.1.0/dormant; full session-establishment orchestration (prekeys, fallbacks, replay) written by us | our glue = unaudited protocol layer (violates the E2EE-3 gate rationale) |
| OpenMLS (official JS bindings, if they appear) | **L** | engine + KeyPackage/delivery-service mapping onto Supabase tables; 2-member-group lifecycle; identity/credential design | PQ still draft; delivery-service semantics are new architecture (needs ADR) |
| Wire `core-crypto` | **XL** + legal | Wire client semantics + GPL compliance for the whole app | rejected on license alone |

For comparison, the currently-forbidden path (own PQXDH+DR on WebCrypto+mlkem-wasm)
would be **M–L** engineering but was NO-GO'd in E2EE-2.5 for trust reasons — that
assessment stands; effort is not the blocker, trust is.

---

## 12. Recommendation

> ### ❌ **NO-GO**
>
> **Keine der untersuchten Lösungen ist derzeit für enough. geeignet.**
>
> The decision rule (unchanged since E2EE-2.5): *GO only if a concrete,
> trustworthy, browser-capable implementation of the approved protocol exists and is
> spike-testable.* As of 2026-08-19:
>
> - The **official Signal engine** remains Node/Swift/Java-only; Signal has again
>   declined WASM support in its own repo (#350), and its `boring` dependency makes
>   community ports harder, not easier.
> - The **audited, permissively licensed browser engine** that exists
>   (`matrix-sdk-crypto-wasm`) is architecturally welded to Matrix homeserver
>   semantics, exposes no generic 1:1 session API (verified in its type surface), has
>   no PQ, and weighs 2 MB gzip.
> - The **MLS camp** gained a genuinely audited engine (OpenMLS, SRLabs 2026) — the
>   biggest positive change since E2EE-2.5 — but publishes no official JS bindings,
>   and PQ cipher suites are still IETF drafts.
> - A new **unofficial WASM build of the official libsignal core** exists
>   (`@getmaapp/signal-wasm`, 299 KB gzip, correct API shape) — but it is unaudited,
>   un-attested, 7 months old, effectively unadopted, and AGPL.
> - Everything else found is unaudited, immature, dormant, copyleft-blocked,
>   proprietary, or not a ratcheting messenger protocol (OpenPGP.js).
>
> Consequently: **no productive E2EE implementation**; `sendMessage()` remains
> plaintext; no Supabase migration; no protocol code in `src/`. The E2EE-2.5 gate and
> its guard test stay in force.

**Re-evaluation triggers** (any one flips this review to GO, in order of likelihood):

1. **OpenMLS publishes official, maintained JS/WASM bindings** (MIT, audited engine) →
   re-run the spike against a 2-member MLS design; requires a protocol ADR replacing
   PQXDH+DR with MLS-2020-classical-then-PQ.
2. **`@getmaapp/signal-wasm` (or an equivalent official-core WASM build) obtains an
   independent audit + provenance attestations + real adoption** *and* the project
   owner accepts AGPL-3.0 for the app → primary candidate; spike adapter already fits.
3. **Matrix ships official standalone vodozemac JS bindings** and/or PQ E2EE, and a
   generic (non-homeserver) API surface.
4. **Signal itself ships a WASM/browser target** (currently explicitly declined).
5. Native WebCrypto ML-KEM ships (removes the PQ primitive gap but **not** the missing
   engine — alone insufficient, as established in E2EE-2.5).

---

## 13. Sources

Primary sources consulted (all accessed 2026-08-19):

**npm registry (metadata/tarballs):** `@signalapp/libsignal-client` 0.101.0 · `libsignal-protocol-javascript` (404) · `@matrix-org/matrix-sdk-crypto-wasm` 18.5.0 (+ tarball: `matrix_sdk_crypto_wasm.d.ts` export list, wasm/js sizes) · `@towns-protocol/vodozemac` 0.1.0 · `@dtelecom/vodozemac-wasm` 0.3.0 · `vodozemac-wasm-bindings` 0.8.1 · `@cogia/vodozemac-nodejs` 0.0.10 · `olm`/`@matrix-org/olm` (deprecated) · `@wireapp/core-crypto` 10.4.0 (+ tarball) · `@wireapp/proteus` 9.13.0 · `@getmaapp/signal-wasm` 0.6.5 (+ tarball; 11 versions since 2026-01-14; no attestations) · `openpgp` 6.3.1 · `@seald-io/sdk` 0.33.1 · `@open-e2ee/signal-protocol-sdk` 0.3.0 · `webcrypto-ratchet` 0.7.2 (created 2026-07-24) · `ratchet-ts` 0.5.0 · `@brashkie/signalis` 0.7.1 · `@bcts/double-ratchet` 1.0.0-alpha.23 · `ts-mls` 1.6.2 · `@slopus/murmur` 0.4.4 · `ping-openmls-sdk` 0.7.26 (no repo) · `openmls-wasm` 0.1.0.

**GitHub:** `signalapp/libsignal` (README, releases, issue #350 + jrose-signal comments, `wasm32` code search = 0) · `signalapp/libsignal-protocol-javascript` (archived) · `matrix-org/vodozemac` (releases 0.8.1/0.9.0/0.10.0) · `matrix-org/matrix-sdk-crypto-wasm` (README: wasm-esm condition) · `matrix-org/olm` (archived) · `towns-protocol/vodozemac-bindings` (1★, 2025-05) · `dTelecom/vodozemac-wasm` · `Mekacher-Anis/vodozemac-wasm-bindings` (0★) · `wireapp/core-crypto` (README/build docs) · `getmaapp/signal-wasm` (Cargo.toml pins, SECURITY_AUDIT_REPORT.md, GEMINI.md, disclaimer) · `paritytech/bcts` (README: unaudited, AI-assisted) · `awslabs/mls-rs` (README security notice, WebCrypto experimental) · `openmls/openmls` (README: `js` feature) · `slopus/murmur` (no LICENSE file) · `PrivacyResearchRS/libsignal-protocol-typescript` (gone).

**Audits:** Least Authority, *vodozemac Security Audit Report*, 2022-03-30 (matrix.org PDF; findings incl. unresolved items I/J/E) · SRLabs, *OpenMLS Security Assurance Assessment*, sponsored by Sovereign Tech Agency, published 2026-05-27 (blog.openmls.tech PDF; 8 findings, 7 fixed in 8.1/7.3) · Kudelski Security + X41 D-Sec, Wire Proteus/Cryptobox audit, 2017 (retired protocol) · NCC Group Olm/Megolm audit 2016 (legacy) · Albrecht/Cellary/Celi/Paterson et al., *Practically-exploitable Cryptographic Vulnerabilities in Matrix*, 2022 (trust-model lessons) · noble audit history (paulmillr.com/noble; PQ module excluded — per E2EE-2.5).

**Specifications:** Signal PQXDH specification (signal.org/docs/specifications/pqxdh/, Rev 3) · Signal Double Ratchet specification (signal.org) · RFC 9420 (MLS) · RFC 9750 (MLS architecture, 2025-04) · `draft-ietf-mls-pq-ciphersuites`, `draft-ietf-mls-combiner`, `draft-mahy-mls-pq` (PQ suites, draft stage) · WICG *Modern Algorithms in the Web Cryptography API* (ML-KEM, draft; per E2EE-2.5).

**Internal:** [`docs/e2ee-architecture.md`](./e2ee-architecture.md) (E2EE-1) · [`docs/e2ee-session-architecture.md`](./e2ee-session-architecture.md) (E2EE-2, approved PQXDH+DR baseline) · [`docs/e2ee-implementation-feasibility.md`](./e2ee-implementation-feasibility.md) (E2EE-2.5 gate) · `spikes/e2ee-compat-spike/` (adapter seam + primitive verification) · `src/lib/crypto/` (E2EE-1 infrastructure; guard test active).
