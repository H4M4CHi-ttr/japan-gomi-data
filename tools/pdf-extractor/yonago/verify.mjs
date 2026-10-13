import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { periodDates, expandRange } from '../../_lib/schedule.mjs';
import { diffRange } from '../../_lib/verify.mjs';
import { parseIndex, parseAreas } from './parse.mjs';
import { CACHE, OUTDIR, PERIOD, CAT_ORDER } from './sources.mjs';

// 公式PDFの実画像から転記した1/4〜1/9。B可燃、N不燃+不燃性粗大、
// C缶+ビン+白色発泡、G缶+ビン、F白色発泡、Pペット、R古紙、H電池等、-収集なし。
const PDF_SAMPLES = {
  keijo: 'BN P - B R -', meidou: 'B PR C B N -', shusyo: '- B P C B -', gihou: 'B - - BP C -',
  sumiyoshi: '- BN R - B -', kuzumo: 'B R - B C -', kamo: 'C B R - B -', kawasaki: 'B C - B P -',
  hukuikehigashi: '- B PR N B -', hukuikenishi: '- B P N B -',
  hukuyonehigashi: 'B - N BP - -', hukuyonenishi: 'BP - NR B - -',
  hikona: '- B R C BP -', sakitsu: 'C B R - BP -', oshinozu_wada: 'BC - R B - -', tomimasu_yomi: 'B C - B - -',
  narumi_syoutoku: '- BP C - B -', nagae: 'B P C B R -', gosengoku: 'B P C B - -', iwao_ootaka: 'B C - B N -',
  kasuga_agata: '- B - C B -', yodoe: '- B N P BF -', nishibara_udagawa: 'B N P B F -', yamato: '- P B N FR B',
};
const EXTRA_SAMPLES = [
  ['keijo', '2026-05-01', 'P'], ['keijo', '2026-05-04', 'B'], ['keijo', '2026-05-05', '-'], ['keijo', '2026-05-06', '-'],
  ['keijo', '2026-05-07', 'B'], ['keijo', '2026-05-08', 'R'], ['keijo', '2027-01-11', 'B'], ['keijo', '2027-01-12', 'C'],
  ['yamato', '2026-06-03', 'B'], ['yamato', '2026-06-04', 'N'], ['yamato', '2026-06-05', 'P'], ['yamato', '2026-06-06', 'BH'],
  ['yamato', '2026-06-11', 'G'], ['yamato', '2026-06-12', 'FR'], ['yamato', '2026-06-13', 'B'],
  ['yamato', '2026-08-01', 'B'], ['yamato', '2026-08-08', 'B'],
  ['narumi_syoutoku', '2026-09-05', 'H'], ['narumi_syoutoku', '2026-09-09', 'NR'], ['narumi_syoutoku', '2026-09-23', '-'],
  ['yodoe', '2026-04-01', 'N'], ['yodoe', '2026-04-02', 'P'], ['yodoe', '2026-04-03', 'B'],
  ['yodoe', '2026-04-08', 'G'], ['yodoe', '2026-04-09', 'R'], ['yodoe', '2026-04-10', 'BF'],
];
const SYMBOLS = {
  B: ['burnable'], N: ['non_burnable', 'oversized'], C: ['beverage_can', 'glass_bottle', 'plastic'],
  G: ['beverage_can', 'glass_bottle'], F: ['plastic'], P: ['pet_bottle'], R: ['paper'], H: ['hazardous'], '-': [],
};
const decode = (token) => {
  assert.match(token, /^(?:-|[BNCGFPRH]+)$/);
  return [...new Set([...token].flatMap((t) => SYMBOLS[t]))].sort();
};
const read = (file) => readFileSync(join(CACHE, file), 'utf8');
const courses = parseIndex(read('index.html'));
const { assignments } = parseAreas(read('areas.html'), courses, JSON.parse(read('abr-town.json')).towns);
const extracted = JSON.parse(read('extracted.json'));
const files = readdirSync(join(OUTDIR, PERIOD)).filter((f) => f.startsWith('course-'));
assert.deepEqual(files.sort(), courses.map((c) => `course-${c.course}.yaml`).sort(), 'courseの欠落・追加');
const docs = courses.map((c) => yamlParse(readFileSync(join(OUTDIR, PERIOD, `course-${c.course}.yaml`), 'utf8')));
const dates = periodDates(PERIOD);
let eventCount = 0;
for (const doc of docs) {
  const c = courses.find((c) => c.course === doc.metadata.course);
  const src = extracted.find((s) => s.file === c.file);
  assert.equal(doc.metadata.period, PERIOD);
  assert.equal(doc.metadata.source.source_url, c.url);
  assert.deepEqual(doc.metadata.areas.map((a) => a.name).sort(), assignments.filter((a) => a.course === c.course).map((a) => a.area.name).sort(), 'areaの欠落・追加');
  assert.equal(doc.metadata.areas.length, new Set(doc.metadata.areas.map((a) => a.name)).size, 'areaの重複');
  assert.deepEqual(diffRange(PERIOD, doc.rules, doc.overrides, new Map(Object.entries(src.events))), [], `${c.course}: 全日付の自己照合`);
  for (const r of doc.rules) {
    assert.ok(CAT_ORDER.includes(r.category));
    assert.equal(r.dates?.length ?? 0, new Set(r.dates ?? []).size, `${c.course}: 日付重複`);
    for (const date of r.dates ?? []) {
      assert.equal(new Date(date + 'T00:00:00Z').toISOString().slice(0, 10), date, '無効な実日付');
      assert.ok(dates.includes(date), '年度境界');
    }
  }
  const events = expandRange(PERIOD, doc.rules, doc.overrides);
  for (const date of events.keys()) assert.ok(dates.includes(date), '期間外への展開');
  for (const cats of events.values()) {
    assert.equal(cats.length, new Set(cats).size, '展開種別の重複');
    eventCount += cats.length;
  }
  assert.deepEqual([...events].filter(([, cats]) => cats.includes('hazardous')).map(([d]) => d), ['2026-06-06', '2026-09-05', '2026-12-05', '2027-03-06']);
}
assert.equal(eventCount, 6504, '確認した版の種別別イベント数');
let sampleCount = 0;
const sampleErrors = [];
function checkSample(course, date, token) {
  const doc = docs.find((d) => d.metadata.course === course);
  const events = expandRange(PERIOD, doc.rules, doc.overrides);
  const actual = (events.get(date) ?? []).sort(), expected = decode(token);
  if (actual.join(',') !== expected.join(',')) sampleErrors.push({ course, date, actual, expected });
  sampleCount++;
}
for (const [course, row] of Object.entries(PDF_SAMPLES)) {
  const tokens = row.split(' ');
  assert.equal(tokens.length, 6);
  tokens.forEach((t, i) => checkSample(course, `2027-01-${String(i+4).padStart(2, '0')}`, t));
  checkSample(course, '2027-01-01', '-');
  checkSample(course, '2027-01-02', '-');
}
for (const sample of EXTRA_SAMPLES) checkSample(...sample);
assert.deepEqual(sampleErrors, [], 'PDF画像目視サンプルとの不一致');

// 両方向の改竄で検査そのものが効くことを確認。生成ファイルは変更しない。
const original = docs.find((d) => d.metadata.course === 'keijo');
const expected = new Map(Object.entries(extracted.find((s) => s.file === 'R8_keijo.pdf').events));
for (const kind of ['remove', 'add']) {
  const changed = structuredClone(original);
  const pet = changed.rules.find((r) => r.category === 'pet_bottle');
  if (kind === 'remove') {
    assert.ok(pet.dates.includes('2026-04-03'), '改竄が空振り');
    pet.dates = pet.dates.filter((d) => d !== '2026-04-03');
  } else {
    assert.ok(!pet.dates.includes('2026-04-04'), '改竄が空振り');
    pet.dates.push('2026-04-04');
  }
  assert.ok(diffRange(PERIOD, changed.rules, changed.overrides, expected).length > 0, `${kind}: 差分を検出しない`);
}
console.log(`OK: ${docs.length * dates.length} day slots / ${eventCount} category events / ${assignments.length} areas`);
console.log(`PDF visual samples: ${sampleCount} day slots; deletion/addition mutation checks: 2 passed`);
console.log('Limit: full-date verification uses the same PDFs; no independent official full-date source is available.');
