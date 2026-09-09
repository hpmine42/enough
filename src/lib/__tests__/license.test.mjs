/**
 * C4 — license declaration guards (audit finding F-04).
 *
 * What this suite protects:
 *
 *   1. `LICENSE` is the canonical, **verbatim** AGPL-3.0-only text — not a
 *      shortened notice (the bundled engine ships only a 29-line notice of its
 *      own), not an edited or reflowed copy.
 *   2. `public/LICENSE`, which is what the deployed origin serves, is
 *      byte-identical to it.
 *   3. `package.json` and the `package-lock.json` root entry declare exactly
 *      the SPDX id that `LICENSE` actually is.
 *   4. `NOTICE` accounts for every declared runtime dependency, so a new
 *      dependency cannot be shipped without its license being recorded and
 *      verified; and it keeps the statements that must not silently disappear
 *      (Signal non-endorsement, the open transitive-inventory item).
 *   5. `NOTICE` must not overstate the legal position: the license decision is
 *      the project owner's residual-risk acceptance recorded in
 *      `docs/e2ee-2c-legal-review.md` §8, so any affirmative claim that legal
 *      counsel reviewed or approved it fails this suite.
 *
 * Design notes:
 *   - Pure string / JSON inspection only: no network, no filesystem writes, no
 *     installed dependencies. Deterministic in any environment.
 *   - Mutation cases run against fabricated in-memory text, never against the
 *     repository's own files (docs/arena-instructions.md §11).
 *   - Declared as `npm run test:license`, so the pull-request gate picks it up
 *     automatically (`.github/workflows/ci.yml` discovers every `test:*` script
 *     from package.json) without any workflow change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8');

/* ------------------------------------------------------------------ */
/* Pinned canonical license text                                       */
/* ------------------------------------------------------------------ */

/**
 * Byte-exact SHA-256 of `LICENSE`. Source of truth: the SPDX license-list-data
 * canonical plain-text document `text/AGPL-3.0-only.txt` (34,020 bytes),
 * fetched 2026-09-09. Pinning the digest is what makes "verbatim" a testable
 * property rather than an intention: a single edited byte fails the suite.
 */
const CANONICAL_LICENSE_SHA256 =
  'd8a6cc31abc16b6748c7a21f21611f5a1ec33f67d22ca23d7da1c19b95496bee';
const CANONICAL_LICENSE_BYTES = 34020;
const LICENSE_SPDX_ID = 'AGPL-3.0-only';
/** The license the repository declares must be the license `LICENSE` is. */
const DECLARED_ID_TO_CANONICAL_SHA256 = {
  'AGPL-3.0-only': CANONICAL_LICENSE_SHA256,
};

/**
 * Structural markers of the AGPL-3.0 document. Section 13 is the clause that
 * motivates C4 (remote network interaction), so a "license file" that lost it
 * is exactly the regression worth catching.
 */
const REQUIRED_LICENSE_MARKERS = [
  'GNU AFFERO GENERAL PUBLIC LICENSE',
  'Version 3, 19 November 2007',
  '0. Definitions.',
  '6. Conveying Non-Source Forms.',
  '8. Termination.',
  '13. Remote Network Interaction; Use with the GNU General Public License.',
  '15. Disclaimer of Warranty.',
  'END OF TERMS AND CONDITIONS',
  'How to Apply These Terms to Your New Programs',
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/* ------------------------------------------------------------------ */
/* Pure checks, also exercised by the mutation cases                    */
/* ------------------------------------------------------------------ */

/** Structural sanity of a license text, independent of the pinned digest. */
function licenseTextProblems(text) {
  if (!text) return ['license text is empty'];
  const problems = [];
  // A license is only "the canonical text" if none of it was dropped: the
  // digest check in the positive case cannot be reused by the mutation cases,
  // so the pinned size is part of the structural check itself.
  if (Buffer.byteLength(text, 'utf8') !== CANONICAL_LICENSE_BYTES) {
    problems.push(
      `license text is ${Buffer.byteLength(text, 'utf8')} bytes, the canonical document is ${CANONICAL_LICENSE_BYTES}`,
    );
  }
  if (!text.startsWith('GNU AFFERO GENERAL PUBLIC LICENSE')) {
    problems.push('license text does not begin with the AGPL title line');
  }
  for (const marker of REQUIRED_LICENSE_MARKERS) {
    if (!text.includes(marker)) problems.push(`missing marker "${marker}"`);
  }
  if (/TODO|FIXME|lorem ipsum/i.test(text)) problems.push('work note left in the license text');
  if (/\[[^\]\n]{0,40}\]/.test(text)) problems.push('square-bracket placeholder in the license text');
  return problems;
}

/** Body of the `## …` section whose heading matches `headingRe`, or null. */
function sectionBody(text, headingRe) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && headingRe.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

/**
 * `name@version` bullets of the NOTICE "npm runtime dependencies" section. A
 * version must start with a digit, which keeps any prose example inside that
 * section from being parsed as a real entry.
 */
function parseDependencyBullets(notice) {
  const section = sectionBody(notice, /npm runtime dependencies/i);
  const entries = new Map();
  if (section === null) return entries;
  for (const line of section.split('\n')) {
    const m = line.match(/^- `([^`]+)@(\d[0-9A-Za-z.+-]*)` \u2014 (\S+)/);
    if (m) entries.set(m[1], { version: m[2], license: m[3] });
  }
  return entries;
}

/** Missing / stale / drifted / unverified entries in that NOTICE section. */
function dependencySectionProblems(notice, declaredVersions) {
  if (sectionBody(notice, /npm runtime dependencies/i) === null) {
    return ['NOTICE has no "npm runtime dependencies" section'];
  }
  const problems = [];
  const bullets = parseDependencyBullets(notice);
  for (const [name, version] of declaredVersions) {
    const entry = bullets.get(name);
    if (!entry) {
      problems.push(`NOTICE does not list the runtime dependency \`${name}@${version}\``);
      continue;
    }
    if (entry.version !== version) {
      problems.push(
        `NOTICE lists \`${name}@${entry.version}\` but package-lock.json pins ${version}`,
      );
    }
    if (/\[|TBD|unknown|unverified|n\/a/i.test(entry.license)) {
      problems.push(`NOTICE has no verified license id for \`${name}\` (got "${entry.license}")`);
    }
  }
  for (const name of bullets.keys()) {
    if (!declaredVersions.has(name)) {
      problems.push(
        `NOTICE lists \`${name}\` but package.json declares no such runtime dependency`,
      );
    }
  }
  return problems;
}

/** An affirmative claim that counsel reviewed/approved — must never appear. */
function affirmativeCounselClaim(notice) {
  return /\b(?:legal counsel|counsel|attorney|lawyer|law firm)\b[^.]{0,60}\b(?:reviewed|approved|endorsed|cleared|opined|advised|signed off)\b/i.exec(
    notice,
  )?.[0];
}

const hasNonEndorsement = (notice) =>
  // Whitespace-tolerant on purpose: re-wrapping a sentence in NOTICE must not
  // silently disable the trademark guard.
  /not affiliated with[\s\S]{0,90}?\bnot\s+endorsed\s+by/i.test(notice) &&
  /\bSignal Technology Foundation\b/.test(notice);

/**
 * The transitive Rust inventory is genuinely open (no `cargo about` has been
 * run, and the crate registry is not reachable from the environment this repo
 * is built in). NOTICE has to keep saying so; a file that starts claiming the
 * crates are license-clear is an overclaim, not an improvement.
 */
function inventoryOverclaim(notice) {
  const section = sectionBody(notice, /open inventory|transitive rust/i) ?? notice;
  return {
    claimsClean: /\b(?:all|every) 240 crates\b[^.]{0,80}\b(?:compatible|cleared|verified)\b/i.test(
      notice,
    ),
    marksOpen: /NOT VERIFIED/i.test(section) && /240/.test(section),
  };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const licenseText = read('LICENSE');
const servedLicenseText = read('public/LICENSE');
const noticeText = read('NOTICE');

/** name -> pinned version, taken from the lockfile (single source of truth). */
const declaredVersions = new Map(
  Object.keys(pkg.dependencies ?? {}).map((name) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry?.version) {
      throw new Error(`package-lock.json has no pinned version for ${name}`);
    }
    return [name, entry.version];
  }),
);

/* ------------------------------------------------------------------ */
/* Positive cases: the repository as it stands                         */
/* ------------------------------------------------------------------ */

test('LICENSE is the canonical AGPL-3.0-only text, byte for byte', () => {
  assert.equal(
    Buffer.byteLength(licenseText, 'utf8'),
    CANONICAL_LICENSE_BYTES,
    'LICENSE byte length drifted from the pinned canonical document',
  );
  assert.equal(
    sha256(licenseText),
    CANONICAL_LICENSE_SHA256,
    'LICENSE is no longer the pinned canonical AGPL-3.0-only text',
  );
  assert.deepEqual(licenseTextProblems(licenseText), []);
});

test('the copy the app serves is identical to the repository license', () => {
  // Vite copies `public/` into the build verbatim, so what a user fetches from
  // the deployed origin must be the same document the repository carries.
  assert.equal(sha256(servedLicenseText), sha256(licenseText));
  assert.deepEqual(licenseTextProblems(servedLicenseText), []);
});

test('package.json and the lockfile root entry declare that same license', () => {
  assert.equal(pkg.license, LICENSE_SPDX_ID);
  assert.equal(
    DECLARED_ID_TO_CANONICAL_SHA256[pkg.license],
    sha256(licenseText),
    `package.json declares ${pkg.license}, but LICENSE is not that document`,
  );
  assert.equal(
    lock.packages[''].license,
    pkg.license,
    'package-lock.json root entry is out of sync with package.json',
  );
});

test('NOTICE records the bundled engine as AGPL-3.0-only, not "or later"', () => {
  const engine = parseDependencyBullets(noticeText).get('@getmaapp/signal-wasm');
  assert.ok(engine, 'NOTICE must account for the engine that triggers the AGPL obligations');
  assert.equal(engine.license, 'AGPL-3.0-only');
  // The obligation must not be quietly widened beyond what was declared.
  assert.equal(pkg.dependencies['@getmaapp/signal-wasm'], '0.6.6');
  assert.doesNotMatch(noticeText, /AGPL-3\.0-or-later/);
});

test('NOTICE accounts for every declared runtime dependency and only those', () => {
  assert.ok(declaredVersions.size > 0, 'no runtime dependencies to account for');
  assert.deepEqual(dependencySectionProblems(noticeText, declaredVersions), []);
});

test('NOTICE keeps the Signal trademark non-endorsement statement', () => {
  assert.ok(
    hasNonEndorsement(noticeText),
    'NOTICE must state that enough. is not affiliated with or endorsed by Signal Technology Foundation',
  );
});

test('NOTICE keeps the transitive Rust inventory marked as not verified', () => {
  const { claimsClean, marksOpen } = inventoryOverclaim(noticeText);
  assert.equal(claimsClean, false, 'NOTICE may not claim the transitive crates are license-clear');
  assert.ok(
    marksOpen,
    'NOTICE must keep the 240-crate inventory flagged as NOT VERIFIED until `cargo about` has run',
  );
});

test('NOTICE does not claim that legal counsel reviewed or approved the decision', () => {
  assert.equal(affirmativeCounselClaim(noticeText), undefined);
  // The honest counterpart must be stated, not merely implied by absence.
  assert.match(noticeText, /not legal advice/i);
  assert.match(noticeText, /residual-risk acceptance/i);
});

test('the documents and surfaces NOTICE points at exist', () => {
  // Reverse pointers are only useful if they resolve: each of these is cited by
  // name in NOTICE, so moving one has to be a deliberate change.
  assert.match(read('README.md'), /^## License$/m);
  assert.match(read('docs/self-hosting.md'), /AGPL/);
  assert.match(
    read('docs/e2ee-2c-legal-review.md'),
    /^## 8\. Decision record \(2026-09-09\)/m,
    'the owner decision referenced by NOTICE §1 is not recorded in the legal review packet',
  );
  assert.ok(
    read('public/LICENSE').length > 0,
    'the deployed origin must serve the license text itself',
  );
});

/* ------------------------------------------------------------------ */
/* Negative cases: these would actually fail if the guard were removed   */
/* ------------------------------------------------------------------ */

test('mutation: an edited or truncated license text is rejected', () => {
  assert.ok(
    licenseTextProblems(licenseText.slice(0, licenseText.length - 400)).length > 0,
    'a truncated license must be rejected',
  );
  const edited = licenseText.replace(
    '13. Remote Network Interaction',
    '13. Remote Network Interaction (edited)',
  );
  assert.notEqual(sha256(edited), CANONICAL_LICENSE_SHA256);
  assert.ok(licenseTextProblems(`${licenseText}\n[TODO: confirm with counsel]`).length > 0);
  assert.ok(licenseTextProblems('').length > 0);
});

test('mutation: a served copy that diverges from the repository copy is rejected', () => {
  assert.notEqual(sha256(`${servedLicenseText}\n\nextra note\n`), sha256(licenseText));
});

test('mutation: a dependency added without a NOTICE entry is reported', () => {
  const withNewDep = new Map([...declaredVersions, ['left-pad', '1.3.0']]);
  assert.ok(
    dependencySectionProblems(noticeText, withNewDep).some((p) => p.includes('left-pad')),
    'a new runtime dependency must fail CI until NOTICE records its license',
  );
});

test('mutation: a dropped or stale NOTICE entry is reported', () => {
  const [firstName] = [...declaredVersions.keys()];
  const withoutFirst = noticeText
    .split('\n')
    .filter((l) => !l.startsWith(`- \`${firstName}@`))
    .join('\n');
  assert.ok(
    dependencySectionProblems(withoutFirst, declaredVersions).some((p) => p.includes(firstName)),
    'removing a NOTICE entry must be reported for the dependency it covered',
  );
  const withStale = noticeText.replace(
    '- `react@18.3.1` — MIT',
    '- `react@18.3.1` — MIT\n- `some-removed-package@9.9.9` — MIT',
  );
  assert.ok(
    dependencySectionProblems(withStale, declaredVersions).some((p) =>
      p.includes('some-removed-package'),
    ),
    'a NOTICE entry for a dependency that is no longer declared must be reported',
  );
});

test('mutation: a NOTICE version that no longer matches the lockfile is reported', () => {
  const drifted = noticeText.replace(
    '- `@getmaapp/signal-wasm@0.6.6` — AGPL-3.0-only',
    '- `@getmaapp/signal-wasm@0.6.7` — AGPL-3.0-only',
  );
  assert.ok(
    dependencySectionProblems(drifted, declaredVersions).some((p) => p.includes('0.6.7')),
    'NOTICE must stay pinned to the version the lockfile actually installs',
  );
});

test('mutation: a missing Signal non-endorsement statement is rejected', () => {
  const withoutDisclaimer = noticeText.replace(/## 6\. Trademarks[\s\S]*?(?=\n## )/, '');
  assert.equal(
    hasNonEndorsement(withoutDisclaimer),
    false,
    'deleting the trademark section must not leave NOTICE looking complete',
  );
});

test('mutation: an overclaimed transitive inventory is rejected', () => {
  const overclaimed = noticeText.replace(
    '- **Transitive Rust crates — NOT VERIFIED (open item).**',
    '- **Transitive Rust crates — reviewed.** All 240 crates are license-compatible.',
  );
  assert.equal(inventoryOverclaim(overclaimed).claimsClean, true);
  assert.equal(inventoryOverclaim(overclaimed).marksOpen, false);
  assert.equal(
    inventoryOverclaim(noticeText.replace('NOT VERIFIED (open item)', 'reviewed')).marksOpen,
    false,
  );
});

test('mutation: an affirmative counsel-approval claim is rejected', () => {
  for (const suffix of [
    'Legal counsel reviewed and approved this licensing decision.',
    'Our attorney approved the AGPL strategy on 2026-09-09.',
    'counsel has reviewed section 13 and cleared the build.',
  ]) {
    const fabricated = `${noticeText}\n\n${suffix}`;
    assert.notEqual(
      affirmativeCounselClaim(fabricated),
      undefined,
      `expected the fabricated claim to be detected: ${suffix}`,
    );
  }
});
