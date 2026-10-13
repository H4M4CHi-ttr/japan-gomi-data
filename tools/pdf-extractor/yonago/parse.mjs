import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { normJa, parseWeeklyJa, parseMonthlyNthJa } from '../../_lib/jp.mjs';

const text = (cell) => normJa(cell.structuredText);

function tableRows(table, width) {
  const spans = [];
  return table.querySelectorAll('tbody tr').map((tr, i) => {
    const row = [];
    for (let col = 0; col < width; col++) if (spans[col]?.end >= i) row[col] = spans[col].cell;
    for (const cell of tr.children.filter((c) => ['TD', 'TH'].includes(c.tagName))) {
      let col = 0;
      while (row[col]) col++;
      const colspan = Number(cell.getAttribute('colspan') ?? 1);
      const rowspan = Number(cell.getAttribute('rowspan') ?? 1);
      for (let n = 0; n < colspan; n++) {
        row[col + n] = cell;
        spans[col + n] = { cell, end: i + rowspan - 1 };
      }
    }
    assert.equal(row.length, width, `表の列数が変わった: ${row.length}`);
    assert.ok(Array.from({ length: width }, (_, col) => row[col]).every(Boolean), '表の欠落セル');
    return row;
  });
}

function rule(category, value, weekly = false) {
  const v = text(value);
  if (weekly) {
    assert.match(v, /^[日月火水木金土]・[日月火水木金土]曜日$/);
    return { category, pattern: 'weekly', days: parseWeeklyJa(v) };
  }
  return { category, pattern: 'monthly_nth', ...parseMonthlyNthJa(v) };
}

export function parseIndex(html) {
  const tables = parse(html).querySelectorAll('table').filter((t) => t.text.includes('可燃物'));
  assert.equal(tables.length, 1, '公式の曜日一覧表が一意でない');
  const rows = tableRows(tables[0], 7);
  assert.equal(rows.length, 24, '公式カレンダーは24本');
  const districts = new Set();
  const courses = rows.map((cells) => {
    const link = cells[0].querySelector('a');
    const url = new URL(link.getAttribute('href'), 'https://www.city.yonago.lg.jp').href;
    const file = url.split('/').pop();
    assert.match(file, /^R8_[a-z_]+\.pdf$/);
    const course = file.slice(3, -4);
    const names = cells[0].structuredText.split('\n').map((v) => v.trim()).filter((v) => v && v !== 'PDF');
    for (const name of names) {
      assert.ok(!districts.has(name), `地区の重複: ${name}`);
      districts.add(name);
    }
    const canFoam = text(cells[3]).split('発泡：');
    assert.ok(canFoam.length <= 2, '発泡スチロール表記が不明');
    const baseRules = [rule('burnable', cells[1], true), rule('non_burnable', cells[2]), rule('oversized', cells[2])];
    for (const category of ['beverage_can', 'glass_bottle']) baseRules.push({ category, pattern: 'monthly_nth', ...parseMonthlyNthJa(canFoam[0]) });
    baseRules.push({ category: 'plastic', pattern: 'monthly_nth', ...parseMonthlyNthJa(canFoam[1] ?? canFoam[0]) });
    baseRules.push(rule('pet_bottle', cells[4]), rule('paper', cells[5]));
    assert.equal(text(cells[6]), '6月9月12月3月の第1土曜日');
    return { course, names, file, url, baseRules };
  });
  assert.equal(districts.size, 30, '地区は30');
  return courses;
}

export function expandTown(value) {
  const token = normJa(value);
  const m = /^(.*?)(\d+(?:[～〜、]\d+)*)丁目$/.exec(token);
  if (!m) {
    assert.ok(!/[～〜、]/.test(token), `未知の町名範囲: ${token}`);
    return [token];
  }
  const nums = m[2].split('、').flatMap((part) => {
    const range = part.split(/[～〜]/).map(Number);
    if (range.length === 1) return range;
    const [first, last] = range;
    assert.ok(range.length === 2 && first >= 1 && last >= first && last <= 20, `丁目範囲: ${part}`);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  });
  assert.equal(new Set(nums).size, nums.length, '丁目の重複');
  return nums.map((n) => `${m[1]}${n}丁目`);
}

export function parseAreas(html, courses, towns = []) {
  const byDistrict = new Map(courses.flatMap((c) => c.names.map((n) => [n, c.course])));
  const tables = parse(html).querySelectorAll('table').filter((t) => t.text.includes('収集地区') && t.text.includes('町名'));
  assert.equal(tables.length, 10, '五十音別の町名表は10');
  const rows = tables.flatMap((t) => tableRows(t, 4)).map((cells) => ({ yomi: text(cells[1]), town: text(cells[2]), districts: text(cells[3]) }));
  const assignments = [];
  for (const row of rows) {
    const choices = row.districts.split('／').map((choice) => {
      const m = /^([^（]+)(?:（([^）]+)）)?$/.exec(choice);
      assert.ok(m && byDistrict.has(m[1]), `未知の地区: ${choice}`);
      return { district: m[1], qualifier: m[2], course: byDistrict.get(m[1]) };
    });
    for (const town of expandTown(row.town)) {
      for (const choice of choices) {
        const ambiguous = choices.length > 1;
        const name = ambiguous ? `${town}（${choice.district}地区${choice.qualifier ? '・' + choice.qualifier : ''}）` : town;
        const area = { name };
        if (ambiguous) area.note = `公式一覧は${row.districts}。地区境界は公開資料で特定できず、居住地の収集地区確認が必要。`;
        const chome = /^(.*?)(\d+)丁目$/.exec(town);
        const abr = towns.filter((t) => t.oaza === (chome?.[1] ?? town) && t.chome_number === (chome ? Number(chome[2]) : null));
        if (abr.length === 1) {
          if (abr[0].kana) area.yomi = abr[0].kana;
          area.machiaza_id = `${abr[0].lg}-${abr[0].id}`;
        } else if (!chome && row.yomi) area.yomi = row.yomi;
        assignments.push({ course: choice.course, district: choice.district, town, area, ambiguous });
      }
    }
  }
  assert.equal(new Set(rows.map((r) => r.town)).size, rows.length, '公式町名行の重複');
  assert.equal(new Set(assignments.map((a) => a.area.name)).size, assignments.length, '展開した area の重複');
  assert.equal(new Set(assignments.map((a) => a.district)).size, 30, '30地区に町名が対応すること');
  return { rows, assignments };
}
