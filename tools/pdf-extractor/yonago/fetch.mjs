import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { CACHE, INDEX_URL, AREAS_URL, RIGHTS_URL, BATTERY_URL } from './sources.mjs';

const force = process.argv.includes('--force');
const html = await cachedFetch(INDEX_URL, join(CACHE, 'index.html'), { force });
for (const [file, url] of [['areas.html', AREAS_URL], ['rights.html', RIGHTS_URL], ['battery.html', BATTERY_URL]]) {
  await cachedFetch(url, join(CACHE, file), { force });
}
const links = parse(html).querySelectorAll('a').filter((a) => /\/R8_[^/]+\.pdf$/i.test(a.getAttribute('href') ?? ''));
if (links.length !== 24) throw new Error(`公式カレンダーが ${links.length} 本 (期待24)`);
const manifest = [];
for (const a of links) {
  const url = new URL(a.getAttribute('href'), INDEX_URL).href;
  const file = url.split('/').pop();
  if (manifest.some((m) => m.file === file)) throw new Error(`重複 PDF: ${file}`);
  const buf = await cachedFetch(url, join(CACHE, file), { encoding: null, force });
  manifest.push({ file, url, sha256: createHash('sha256').update(buf).digest('hex') });
  console.log(`fetched ${file}: ${buf.length} bytes`);
}
writeFileSync(join(CACHE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
