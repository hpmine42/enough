#!/usr/bin/env node
/**
 * enough. — install the local pre-commit hook into .git/hooks.
 *
 * Runs automatically on `npm install` via the `prepare` script. This avoids
 * adding a runtime dependency on husky/lint-staged's install flow while still
 * giving contributors a working pre-commit hook that lints and type-checks
 * staged files without requiring a global tool.
 *
 * Skips silently when not inside a git checkout (e.g. when installing from
 * a released tarball) and when git is not on PATH.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const gitDir = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
})();

if (!gitDir) {
  // Not inside a git working tree — nothing to do.
  process.exit(0);
}

const hooksDir = resolve(root, gitDir, 'hooks');
try {
  mkdirSync(hooksDir, { recursive: true });
} catch {
  // Already exists or unwritable; bail silently.
  process.exit(0);
}

const hookPath = resolve(hooksDir, 'pre-commit');
const marker = '# enough. pre-commit hook (installed by scripts/install-git-hooks.mjs)';

const hookBody = `#!/bin/sh
${marker}
#
# Runs lint-staged against staged files before allowing the commit.
# To skip this hook (not recommended) use:  git commit --no-verify
#
# Ensure we use the repo's node_modules/.bin even when git runs hooks
# without the project's PATH entries.
if [ -t 1 ]; then
  exec </dev/tty
fi
ROOT_DIR="\`git rev-parse --show-toplevel\`"
if [ -x "\$ROOT_DIR/node_modules/.bin/lint-staged" ]; then
  "\$ROOT_DIR/node_modules/.bin/lint-staged"
else
  echo "enough. pre-commit: node_modules not installed — run \`npm install\`." >&2
  exit 1
fi
`;

// Don't overwrite a hook the developer wrote by hand — only install ours
// when the hook is absent or was previously installed by us.
let shouldWrite = true;
if (existsSync(hookPath)) {
  try {
    const existing = readFileSync(hookPath, 'utf8');
    shouldWrite = existing.includes(marker) || existing.trim() === '';
  } catch {
    shouldWrite = false;
  }
}

if (shouldWrite) {
  writeFileSync(hookPath, hookBody, 'utf8');
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Some filesystems don't support chmod; ignore.
  }
}
