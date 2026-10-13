import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CACHE = join(HERE, 'cache');
export const OUTDIR = join(HERE, '../../../municipalities/tottori/yonago');
export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度ごみ分別収集カレンダー';
export const INDEX_URL = 'https://www.city.yonago.lg.jp/item/60812.htm';
export const AREAS_URL = 'https://www.city.yonago.lg.jp/47585.htm';
export const RIGHTS_URL = 'https://www.city.yonago.lg.jp/1085.htm';
export const BATTERY_URL = 'https://www.city.yonago.lg.jp/47983.htm';
export const CAT_ORDER = ['burnable', 'non_burnable', 'oversized', 'beverage_can', 'glass_bottle', 'plastic', 'pet_bottle', 'paper', 'hazardous'];
