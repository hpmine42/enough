
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
globalThis.document = { documentElement: { lang: 'en' } };
const { translations } = await import('../src/i18n/translations.ts');

function walk(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? prefix + '.' + k : k;
    if (typeof v === 'string') {
      out.push({ key: path, hasValue: v.length > 0 });
    } else if (v && typeof v === 'object') {
      walk(v, path, out);
    }
  }
}
const report = {};
for (const [lang, dict] of Object.entries(translations)) {
  const entries = [];
  walk(dict, '', entries);
  report[lang] = entries;
}
process.stdout.write(JSON.stringify(report));
