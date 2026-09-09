# enough. — E2EE-2C Legal Review Packet

**Status:** LEGAL REVIEW REQUIRED — this is **not legal advice**
**Date:** 2026-08-20
**Status update (2026-09-09):** the project owner selected the project license
and recorded a documented residual-risk acceptance; see §8. **No legal counsel
review took place**, so the eight questions in §5 remain unanswered and this
packet must not be cited as evidence of a legal review.
**Repository branch:** `arena/01a020e0-enough`
**Purpose:** Package the facts a lawyer / human decision-maker needs to assess
the license implications of adopting `@getmaapp/signal-wasm@0.6.6` (and
upstream libsignal) in the enough. browser app. This document explicitly does
**not** conclude that AGPL is compatible or incompatible with enough.'s
distribution model.

---

## 1. Relevant licenses (verified)

| Component | License | Evidence |
|---|---|---|
| `@getmaapp/signal-wasm@0.6.6` (wrapper) | **AGPL-3.0-only** | npm `license` field; package `LICENSE` file; source repo `LICENSE` |
| libsignal (upstream, `b056faa6…` = v0.101.0) | **AGPL-3.0-only** | official `@signalapp/libsignal-client@0.101.0` npm `license` = AGPL-3.0-only; official repo LICENSE |
| enough. (this repository) | **none declared** | no `LICENSE` file; no `NOTICE`; no `license` field in `package.json` |

Verified 2026-08-20:
- enough. repo root: no `LICENSE`, no `NOTICE`, no copyright/license notice files.
- enough. `package.json`: no `license` field.
- Wrapper: `AGPL-3.0-only` (both npm metadata and LICENSE file).
- Official libsignal npm `0.101.0`: `AGPL-3.0-only`.

## 2. Components affected

- `@getmaapp/signal-wasm@0.6.6` — WASM + JS glue + TS declarations (6 npm files: `LICENSE`, `README.md`, `package.json`, `signal_wasm.js`, `signal_wasm.d.ts`, `signal_wasm_bg.wasm`).
- Upstream libsignal Rust crates (`libsignal-protocol`, `zkgroup`, `libsignal-core`, `libsignal-account-keys`, `libsignal-debug`, `poksho`, `signal-crypto`, `zkcredential`) pinned at `b056faa6…`.
- `spqr` (SparsePostQuantumRatchet) `v1.5.3` — a separate git dependency (license to be confirmed in the full inventory; not verified here).
- ~230 additional transitive Rust registry crates (license metadata not retrievable in this environment — see `e2ee-2c-readiness-gate-p0.md` Gate H).
- enough. application code + wasm-bindgen generated glue JS.

## 3. Planned use (proposed, NOT implemented)

- Bundling the AGPL WASM+JS wrapper into a static GitHub Pages app served to every visitor's browser.
- Building a thin "crypto engine adapter" in enough. that imports and calls the wrapper.
- Transport of opaque envelopes through Supabase (untrusted server).
- No forking of the wrapper is currently planned (it would be called/bundled unmodified).

## 4. Distribution / deployment model

- **Deployment:** static web app on GitHub Pages (public URL, `https://<user>.github.io/enough/`).
- **Distribution:** the AGPL WASM+JS is shipped/downloaded to every end-user's browser.
- **Network use:** end-users interact with the app over the network (implicates AGPL §13 network-use source offer questions).
- **Source availability today:** the wrapper source is public on GitHub; enough. source is public on GitHub but **without a declared license grant**.
- **WASM:** compiling to WASM does not by itself avoid license obligations.

## 5. Concrete legal questions that must be answered by a human/lawyer

1. Does bundling **unmodified** AGPL WASM+JS into the enough. client make the enough. client a "combined work" / "derivative work" that must be licensed under AGPL-3.0?
2. What is the scope of the **Corresponding Source** obligation for the distributed client (wrapper source, wasm-bindgen glue, enough. integration code, build/CI scripts, dependency sources)?
3. Does the **AGPL §13 network-use** provision require offering Corresponding Source to users who interact with enough. over the network, and what exactly must be offered?
4. Does hosting on GitHub Pages + a public GitHub repository satisfy the source-offer obligations **if** licenses are properly declared?
5. Does enough. need to **choose and declare its own license** before it can lawfully distribute or convey AGPL-licensed code together with its own code?
6. Is there a conflict between enough.'s intended future license and the AGPL-3.0-only terms of the wrapper/libsignal?
7. Trademark: the wrapper is not Signal-endorsed; must enough. ensure UI/README does not imply otherwise?
8. Are any of the ~230 transitive Rust dependencies licensed under terms incompatible with AGPL-3.0-only combination (e.g. a permissive vs copyleft mismatch that still requires attribution/NOTICE, or a license that conflicts)? — depends on the full license inventory (Gate H).

## 6. Decisions needed

| Decision | Who | Blocking? |
|---|---|---|
| Written legal conclusion that shipping AGPL-3.0-only WASM+JS on GitHub Pages is acceptable | Lawyer / counsel | **YES (Gate A)** |
| enough. SPDX license selection + LICENSE file + NOTICE as required | Project owner + counsel | **YES (Gate A)** |
| Vendor policy: use npm registry package vs vendor the reviewed WASM | Project owner | yes (Gate B/W) |
| Accept the XSS / browser-trust residual and publish the user-facing security statement | Product owner | yes (impl phase) |

> **Status of this table (2026-09-09):** row 2 (SPDX selection, `LICENSE`,
> `NOTICE`) has been carried out by the project owner without counsel — §8
> records exactly what was decided and what was not. Row 1 is **still open**: no
> written legal conclusion exists, and the recorded residual-risk acceptance is
> not a substitute for one. Row 3 is decided (`docs/e2ee-f5-supply-chain.md` §3:
> CI hash assertion against the audited manifest, no vendoring) and row 4 is
> published (the app's privacy notice, `privacy.sectionE2eeLimits`, states that
> E2EE does not protect a compromised device).

## 7. Conclusion

```text
LEGAL REVIEW REQUIRED
```

Gate A remains **BLOCKED** until a human legal review with a documented
written conclusion is available. Neither the auditor nor this repository has
that review on record. Do **not** treat "the repo is already public" as AGPL
compliance, and do **not** treat the absence of a license file as absence of
obligations.

---

## 8. Decision record (2026-09-09)

**Decided by:** the project owner, in an Arena session, as an explicit
**residual-risk acceptance**. This is **not** the result of a legal review: no
lawyer or counsel was engaged for any of the eight questions in §5, and nothing
below may be cited as a legal conclusion.

**What was decided**

| # | Decision | Outcome |
|---|---|---|
| D1 | Project license for enough. | `AGPL-3.0-only` — the narrowest option consistent with the engine and its upstreams. Recorded in `LICENSE` (canonical verbatim text), `NOTICE`, `package.json`, and the `package-lock.json` root entry. |
| D2 | Legal review | **Waived, with the residual risk accepted by the owner.** §5 remains open and unanswered. The gate records (`docs/e2ee-2c-readiness-gate.md` §6 "Gate A", `docs/e2ee-2c-readiness-gate-p0.md` §3) stay as written — this section does **not** claim any gate passed; it records that shipping continues on an owner decision instead of a reviewed one. |
| D3 | Source availability to users | Both mechanisms: the public repository, and the license text served by the deployed origin (`public/LICENSE` → `/LICENSE`, added because the built bundle carries no attribution — `NOTICE` §3). |

**Rationale recorded at the time**

* The engine itself was already owner-approved — `README.md` §Stack states "The
  wrapper is AGPL-3.0-only; its use in enough. was explicitly approved by the
  project owner" — and the source has been public since E2EE-v0.2. A permissive
  or proprietary declaration would have been the inconsistent option, not the
  conservative one.
* `AGPL-3.0-only` was chosen over `AGPL-3.0-or-later` although the wrapper's own
  29-line notice mentions "any later version": `-only` is the narrower
  obligation set, and the wrapper's `package.json` declares `-only`.
* `spqr` (the Kyber code inside the shipped WASM), listed in §2 as "license to
  be confirmed", was checked on 2026-09-09: its `LICENSE` at the pinned commit
  is the full AGPL-3.0 text. It adds no license class beyond the one above, so
  this packet's §2 line about it is superseded by `NOTICE` §4.
* The transitive-crate question (§5 Q8) could not be answered here: the crate
  registry is not reachable from the build environment and no Rust toolchain is
  available, so the inventory is an owner action, not a completed one.

**Residual risks accepted by this record (explicitly, not silently)**

1. Whether bundling the AGPL WASM+JS makes the enough. client a combined work
   that must be AGPL: the owner proceeded on the assumption that **it does** and
   licensed enough. accordingly. That assumption is **unverified by counsel**.
2. The exact scope of "Corresponding Source" for a Pages-hosted client (§5 Q2)
   and whether GitHub Pages + a public repository discharges §13 for every user
   of the instance (§5 Q3/Q4).
3. The transitive Rust license inventory (240 packages in the pinned
   `Cargo.lock`) is **not generated** and no claim is made that those crates are
   license-compatible (`NOTICE` §4, `docs/self-hosting.md` §15).
4. `AGPL-3.0-only` practically forecloses a later proprietary distribution of
   this client without replacing the engine — recorded in
   `docs/e2ee-2c-validation-report.md` as a business decision, not a technical
   one.
5. Conveyances made **before** this commit — every deployment since E2EE-v0.2 —
   shipped the AGPL bundle while enough. declared no license at all. This record
   starts the declaration here; it does not retroactively cure that window, and
   it does not assert that the window was compliant.

**Reversal path.** If counsel concludes in the future that this distribution
model is not acceptable, the alternative already documented is an **engine
change** (`docs/e2ee-engine-decision.md`: the permissive candidates implement
Olm/Megolm rather than PQXDH/Double Ratchet, or have no maintained WASM
bindings), **not** a relicensing of the current code.

**Verification of the mechanics:** `npm run test:license` pins the `LICENSE`
digest, the SPDX id in `package.json` and `package-lock.json`, the `NOTICE`
dependency coverage, the Signal non-endorsement statement, the "not verified"
marker on the crate inventory, and the existence of this section. It verifies
declaration consistency only — it verifies no legal property.
