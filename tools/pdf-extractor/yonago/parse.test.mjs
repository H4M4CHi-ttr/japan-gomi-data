import test from 'node:test';
import assert from 'node:assert/strict';
import { expandTown, parseIndex, parseAreas } from './parse.mjs';

test('丁目の範囲と列挙を展開し、重複と未知表記を拒否する', () => {
  assert.deepEqual(expandTown('皆生１～５丁目'), [1, 2, 3, 4, 5].map((n) => `皆生${n}丁目`));
  assert.deepEqual(expandTown('皆生温泉1、2、4丁目'), [1, 2, 4].map((n) => `皆生温泉${n}丁目`));
  assert.throws(() => expandTown('皆生5～2丁目'));
  assert.throws(() => expandTown('皆生1、1丁目'));
  assert.throws(() => expandTown('皆生、皆生温泉'));
});

function indexFixture() {
  return '<table><thead><tr><th>可燃物</th></tr></thead><tbody>' +
    Array.from({ length: 24 }, (_, i) => {
      const names = i < 6 ? [`地区${i*2}`, `地区${i*2+1}`] : [`地区${i+6}`];
      return `<tr><th>${names.join('<br>')}<br><a href="/secure/60812/R8_fixture_${String.fromCharCode(97+i)}.pdf">PDF</a></th>` +
        '<td>月・木曜日</td><td>第1・3月曜日</td>' +
        `<td>${i === 23 ? '第2・4木曜日<br>発泡：第2・4金曜日' : '第2・4月曜日'}</td>` +
        '<td>第1・3金曜日</td><td>第2・4金曜日</td>' +
        (i === 0 ? '<td rowspan="24">6月<br>9月<br>12月<br>3月<br>の第1土曜日</td>' : '') + '</tr>';
    }).join('') + '</tbody></table>';
}

test('24行のrowspanと30地区を保持し、淀江型の発泡スチロールを別規則にする', () => {
  const courses = parseIndex(indexFixture());
  assert.equal(courses.length, 24);
  assert.equal(courses.flatMap((c) => c.names).length, 30);
  assert.deepEqual(courses[23].baseRules.find((r) => r.category === 'plastic').days, ['FR']);
  assert.deepEqual(courses[23].baseRules.find((r) => r.category === 'glass_bottle').days, ['TH']);
  assert.throws(() => parseIndex(indexFixture().replace('月・木曜日', '月・不明曜日')));
  assert.throws(() => parseIndex(indexFixture().replace('地区0<br>地区1', '地区1<br>地区1')));
});

test('町名表のrowspanを復元し、複数地区を単一の割当にしない', () => {
  const courses = Array.from({ length: 30 }, (_, i) => ({ course: `c${i}`, names: [`地区${i}`] }));
  const html = Array.from({ length: 10 }, (_, group) => '<table><thead><tr><th>町名</th><th>収集地区</th></tr></thead><tbody>' +
    Array.from({ length: 3 }, (_, j) => {
      const i = group*3+j;
      return '<tr>' + (j === 0 ? '<td rowspan="3">あ</td>' : '') +
        `<td>あ${i}</td><td>町${i}</td><td>${i === 0 ? '地区0／地区1' : `地区${i}`}</td></tr>`;
    }).join('') + '</tbody></table>').join('');
  const { assignments } = parseAreas(html, courses);
  assert.equal(assignments.length, 31);
  assert.deepEqual(assignments.filter((a) => a.town === '町0').map((a) => a.area.name), ['町0（地区0地区）', '町0（地区1地区）']);
  assert.ok(assignments.filter((a) => a.town === '町0').every((a) => a.area.note.includes('境界')));
  assert.throws(() => parseAreas(html.replace('地区29', '未知地区'), courses));
});
