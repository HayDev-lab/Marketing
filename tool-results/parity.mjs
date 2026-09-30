// i18n parity check for studio + publishing dicts
import { studio } from '/home/z/my-project/src/lib/i18n/dicts/studio.ts';
import { publishing } from '/home/z/my-project/src/lib/i18n/dicts/publishing.ts';
const check = (name, mod) => {
  const locs = Object.keys(mod);
  const sets = locs.map(l => new Set(Object.keys(mod[l])));
  const base = sets[0];
  let ok = true;
  for (let i = 1; i < sets.length; i++) {
    for (const k of base) if (!sets[i].has(k)) { console.log(`${name}[${locs[i]}] MISSING ${k}`); ok = false; }
    for (const k of sets[i]) if (!base.has(k)) { console.log(`${name}[${locs[i]}] EXTRA ${k}`); ok = false; }
  }
  console.log(`${name}: ${base.size} keys × ${locs.length} locales → ${ok ? 'PARITY-OK' : 'FAIL'}`);
};
check('studio', studio); check('publishing', publishing);
