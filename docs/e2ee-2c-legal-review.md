# enough. — E2EE-2C Legal Review Packet

**Status:** LEGAL REVIEW REQUIRED — this is **not legal advice**
**Date:** 2026-08-20
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

## 7. Conclusion

```text
LEGAL REVIEW REQUIRED
```

Gate A remains **BLOCKED** until a human legal review with a documented
written conclusion is available. Neither the auditor nor this repository has
that review on record. Do **not** treat "the repo is already public" as AGPL
compliance, and do **not** treat the absence of a license file as absence of
obligations.
