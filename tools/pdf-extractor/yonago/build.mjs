import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { findPython } from '../../_lib/python.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { classifyRules } from '../../_lib/classify.mjs';
import { expandRange, periodDates, cancelledOverrides } from '../../_lib/schedule.mjs';
import { diffRange } from '../../_lib/verify.mjs';
import { parseIndex, parseAreas, expandTown } from './parse.mjs';
import { HERE, CACHE, OUTDIR, PERIOD, EDITION_JA, INDEX_URL, AREAS_URL, CAT_ORDER } from './sources.mjs';

const at = process.env.EXTRACTED_AT;
assert.match(at ?? '', /^\d{4}-\d{2}-\d{2}$/, 'EXTRACTED_AT=YYYY-MM-DD が必要');
execFileSync(findPython(['pdfplumber']), [join(HERE, 'extract.py'), CACHE], { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const read = (file) => readFileSync(join(CACHE, file), 'utf8');
const courses = parseIndex(read('index.html'));
const { rows, assignments } = parseAreas(read('areas.html'), courses, JSON.parse(read('abr-town.json')).towns);
const extracted = JSON.parse(read('extracted.json'));
const manifest = JSON.parse(read('manifest.json'));
assert.deepEqual(extracted.map((x) => x.file).sort(), courses.map((x) => x.file).sort(), 'PDFと地区の対応に欠落');
const dates = periodDates(PERIOD);
const docs = [], exceptions = [];
for (const c of courses) {
  const src = extracted.find((s) => s.file === c.file);
  assert.deepEqual(Object.keys(src.events), dates, `${c.course}: 年度の境界・全日付`);
  for (const cats of Object.values(src.events)) {
    assert.equal(cats.length, new Set(cats).size, '同日種別の重複');
    assert.ok(cats.every((cat) => CAT_ORDER.includes(cat)), '未知の種別');
  }
  const { rules, stopDays } = classifyRules({ dates, events: src.events, catOrder: CAT_ORDER });
  assert.deepEqual(new Set(rules.map((r) => r.category)), new Set(CAT_ORDER), `${c.course}: 全9種別`);
  const stops = cancelledOverrides(rules, stopDays, '公式PDFにこの日の収集記載なし');
  const closed = new Set([...src.closed, ...stops.map((o) => o.date)]);
  const overrides = [...closed].sort().map((date) => ({ date, cancelled: true, note: '公式PDFの収集なし日' }));
  const expected = new Map(Object.entries(src.events));
  assert.deepEqual(diffRange(PERIOD, rules, overrides, expected), [], `${c.course}: 自己検証`);
  const areas = assignments.filter((a) => a.course === c.course).map((a) => a.area)
    .sort((a, b) => {
      const x = `${a.yomi ?? a.name}\0${a.name}`, y = `${b.yomi ?? b.name}\0${b.name}`;
      return x < y ? -1 : x > y ? 1 : 0;
    });
  assert.ok(areas.length, `${c.course}: 地域の欠落`);
  docs.push(courseDoc({
    city: 'yonago', course: c.course, courseNameJa: c.names.join('・'), areas, period: PERIOD,
    source: {
      edition_ja: EDITION_JA, source_url: c.url, extracted_at: at, extracted_by: 'Codex',
      verified_by: 'PDF罫線・日番号・品目文字座標の抽出と365日自己照合。公式HTML通常曜日表と比較し例外を別記。PDF画像の端・祝日・分割セルを目視照合。',
    }, rules, overrides,
  }));
  const base = expandRange(PERIOD, c.baseRules, []);
  for (const date of dates) {
    const nominal = (base.get(date) ?? []).sort();
    const actual = src.events[date].filter((cat) => cat !== 'hazardous');
    if (actual.join(',') !== nominal.join(',')) exceptions.push({ course: c.course, date, nominal, actual });
  }
}
mkdirSync(OUTDIR, { recursive: true });
console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses / ${assignments.length} area candidates`);
writeFileSync(join(OUTDIR, 'sources.json'), JSON.stringify({ retrieved_at: at, period: PERIOD, index_url: INDEX_URL, area_url: AREAS_URL, pdfs: manifest }, null, 2) + '\n');
const md = [
  '# 米子市の地区・町丁目対応', '',
  `取得日: ${at}。対象期間: 2026-04-01〜2027-03-31。`, '',
  `出典: [公式カレンダー](${INDEX_URL})、[公式町名一覧](${AREAS_URL})。`, '',
  `24 PDF・30地区。公式町名表 ${rows.length} 行を ${new Set(assignments.map((a) => a.town)).size} 町丁目へ展開し、${assignments.length} area 候補を収録。`, '',
  '複数地区にまたがる町を地区名つきの候補として掲載する。番地などの境界を推測していない。住所だけで収集地区を一意に決められない場合は、公式一覧の案内に従い地区を確認する。', '',
  '| course | 公式地区 | area 候補数 | PDF |', '|---|---|---:|---|',
  ...courses.map((c) => `| ${c.course} | ${c.names.join('・')} | ${assignments.filter((a) => a.course === c.course).length} | [公式PDF](${c.url}) |`), '',
  '## 公式町名表の全行との対応', '',
  '| 町名（公式の範囲表記） | 公式地区・限定条件 | course |', '|---|---|---|',
  ...rows.map((r) => `| ${r.town} | ${r.districts} | ${[...new Set(assignments.filter((a) => expandTown(r.town).includes(a.town)).map((a) => a.course))].join(' / ')} |`), '',
  '## 地区を確認する必要がある町丁目', '',
  '| 町丁目 | 候補 |', '|---|---|',
  ...[...new Set(assignments.filter((a) => a.ambiguous).map((a) => a.town))].map((town) => `| ${town} | ${assignments.filter((a) => a.town === town).map((a) => a.area.name).join(' / ')} |`), '',
  '## 公式町名表とABRの差', '',
  'ABRの240町字に対し、公式収集一覧に同じ町字が直接現れないものは日ノ出町（丁目なし）、米原（丁目なし）、みのり町。日ノ出町と米原の丁目別行は収録済みだが、丁目なし町字やみのり町へ地区を推測して付けない。公式表の皆生（丁目なし）と蚊屋はABRで町字IDが一意に対応せず、公式の読みだけを用いた。公式町名表の全行を収録したことと、ABRの全住所に地区を確定できたことは区別する。', '',
];
writeFileSync(join(OUTDIR, 'coverage.md'), md.join('\n'));
const exmd = [
  '# 通常曜日表との相違日', '',
  '公式HTMLの通常規則とPDFの実日付の相違。休止・振替の因果関係は推測せず、両方の日付集合を記録する。PDFが収録の正典。電池類・蛍光管等の年4回の日程は、この表から除き日程本体に収録する。', '',
  `合計 ${exceptions.length} course×日。`, '',
  '| course | 日付 | 通常表 | 公式PDF |', '|---|---|---|---|',
  ...exceptions.map((e) => `| ${e.course} | ${e.date} | ${e.nominal.join(', ') || '収集なし'} | ${e.actual.join(', ') || '収集なし'} |`), '',
];
writeFileSync(join(OUTDIR, 'exceptions.md'), exmd.join('\n'));
console.log(`self-check ${courses.length * dates.length} day slots; ${exceptions.length} exceptions to nominal HTML rules`);
