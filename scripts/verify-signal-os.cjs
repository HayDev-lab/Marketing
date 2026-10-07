const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function readTS(file) {
 const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports = {}; vm.runInNewContext(source,{exports,Intl,Date,Error,Object,Number}); return exports;
}
const time = readTS('src/lib/calendar-time.ts');
test('Yerevan calendar edit persists the correct UTC instant',()=>assert.equal(time.toUTC('2026-10-08T18:30','Asia/Yerevan'),'2026-10-08T14:30:00.000Z'));
test('New York summer scheduling applies daylight-saving offset',()=>assert.equal(time.toUTC('2026-07-15T09:00','America/New_York'),'2026-07-15T13:00:00.000Z'));
test('Nonexistent DST wall-clock time is rejected',()=>assert.throws(()=>time.toUTC('2026-03-08T02:30','America/New_York'),/DST_INVALID/));
test('Calendar dates reflect the selected zone across midnight',()=>assert.equal(time.dayKey(new Date('2026-10-07T22:00:00Z'),'Asia/Yerevan'),'2026-10-08'));
const dict = readTS('src/lib/i18n/dicts/signal.ts').signal;
test('New UI translations have complete matching keys in HY/RU/EN',()=>{const keys=Object.keys(dict.en).sort();for(const locale of ['ru','hy'])assert.deepEqual(Object.keys(dict[locale]).sort(),keys);for(const locale of ['en','ru','hy'])for(const value of Object.values(dict[locale]))assert.ok(value.trim());});
function luminance(hex){const rgb=hex.match(/\w\w/g).map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('Core primary and secondary text tokens meet WCAG AA',()=>{for(const bg of ['080A0F','0D1118','111722'])for(const fg of ['F4F7FB','9BA7B8'])assert.ok(contrast(bg,fg)>=4.5);assert.ok(contrast('FFFFFF','7145D6')>=4.5);});
