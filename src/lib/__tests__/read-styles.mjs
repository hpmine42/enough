// Test helper: read src/index.css and resolve @import './styles/...'
// directives so tests that regex-scan the stylesheet see the fully
// concatenated content regardless of how we split the source files.
//
// Only resolves literal @import './styles/<file>'; references (which is
// the only form we emit). External URLs are left untouched.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const stylesDir = join(repoRoot, 'src', 'styles');
const indexCssPath = join(repoRoot, 'src', 'index.css');

const importRe = /@import\s+['"]\.\/styles\/([^'"]+)['"]\s*;/g;
const cache = new Map();

function resolveFile(filePath) {
  if (cache.has(filePath)) return cache.get(filePath);
  const src = readFileSync(filePath, 'utf8');
  // Only resolve imports in the root index.css (split shards don't import).
  const resolved = src.replace(importRe, (_match, name) =>
    resolveFile(join(stylesDir, name)),
  );
  cache.set(filePath, resolved);
  return resolved;
}

// Path root for tests using `read(rel)` style (repo-relative).
export function readStyles() {
  cache.clear();
  return resolveFile(indexCssPath);
}

// Convenience: return a helper that reads repo-relative paths and, if the
// path is src/index.css, returns the resolved CSS; other files are read
// normally. This is intended to be dropped in as a drop-in replacement for
// tests that do readFileSync on 'src/index.css'.
export function readRepoFile(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized === 'src/index.css' || normalized.endsWith('/src/index.css')) {
    return readStyles();
  }
  return readFileSync(join(repoRoot, relPath), 'utf8');
}
