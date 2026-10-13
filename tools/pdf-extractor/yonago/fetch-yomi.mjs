import { writeAbrTownJson } from '../../_lib/abr.mjs';
import { CACHE } from './sources.mjs';

await writeAbrTownJson({ pref: '31', lgPrefix: '312029', cacheDir: CACHE, force: process.argv.includes('--force'), label: '米子市' });
