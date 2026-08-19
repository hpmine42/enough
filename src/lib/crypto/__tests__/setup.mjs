// Test environment setup for crypto layer tests.
// Installs a browser-like environment:
//   - globalThis.crypto from Node (Ed25519/X25519/HKDF/AES-GCM supported in Node 22)
//   - indexedDB via fake-indexeddb
//   - btoa/atob are built-in in Node 16+
//
// Must be imported FIRST in any crypto test file.

// Node 22 exposes webcrypto on globalThis already, but ensure it's present
// regardless. If for some reason it's missing (older Node), pull from node:crypto.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
  // Use defineProperty because some Node versions make crypto a getter-only.
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
}

// Install fake-indexeddb.
import 'fake-indexeddb/auto';

// Sanity checks
if (!globalThis.indexedDB) {
  throw new Error('fake-indexeddb failed to install indexedDB global');
}
if (!globalThis.crypto?.subtle) {
  throw new Error('Web Crypto API unavailable in test environment');
}
