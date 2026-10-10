#!/usr/bin/env node
/**
 * tools/osm-import: OpenStreetMap extract -> streamed game tiles.
 *
 *   node tools/osm-import/import.mjs --in area.osm --id lagos-island --name "Lagos Island" \
 *       [--bbox south,west,north,east] [--origin lat,lon] [--tile 400] [--out public/areas/<id>] [--fixture]
 *
 * Writes <out>/manifest.json, <out>/graph.json and <out>/tiles/<x>_<z>.glb + .json, and (unless --fixture)
 * lists the area in <out>/../index.json so the game offers it. See tools/osm-import/README.md.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildArea } from './lib/build.mjs';
import { writeGlb } from './lib/glb.mjs';
import { parseOsm } from './lib/osm.mjs';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else {
      out[k] = next;
      i++;
    }
  }
  return out;
}

const a = args(process.argv.slice(2));
if (!a.in || !a.id) {
  console.error('Usage: node tools/osm-import/import.mjs --in <extract.osm|overpass.json> --id <area-id> [--name "Area name"] [--bbox s,w,n,e] [--origin lat,lon] [--tile 400] [--out dir] [--fixture]');
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(a.id)) {
  console.error('--id must be lower-case letters, digits and dashes');
  process.exit(2);
}
const nums = (s, n) => {
  const v = String(s).split(',').map(Number);
  if (v.length !== n || v.some((x) => !Number.isFinite(x))) throw new Error(`Expected ${n} comma-separated numbers, got "${s}"`);
  return v;
};

const out = resolve(a.out ?? join('public', 'areas', a.id));
const osm = parseOsm(readFileSync(a.in, 'utf8'));
const { manifest, graph, tiles } = buildArea(osm, {
  id: a.id,
  name: a.name ?? a.id,
  tileSize: a.tile ? Number(a.tile) : 400,
  bbox: a.bbox ? nums(a.bbox, 4) : undefined,
  origin: a.origin ? nums(a.origin, 2) : undefined,
  fixture: !!a.fixture,
  source: basename(a.in),
});

if (existsSync(join(out, 'tiles'))) rmSync(join(out, 'tiles'), { recursive: true });
mkdirSync(join(out, 'tiles'), { recursive: true });
let bytes = 0;
for (const t of tiles) {
  const glb = writeGlb(t.mesh, `tile_${t.key}`);
  writeFileSync(join(out, 'tiles', `${t.key}.glb`), glb);
  const json = JSON.stringify(t.json);
  writeFileSync(join(out, 'tiles', `${t.key}.json`), json);
  bytes += glb.length + json.length;
}
writeFileSync(join(out, 'graph.json'), JSON.stringify(graph));
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

if (!a.fixture) {
  // List the area for the game's title screen.
  const indexPath = join(dirname(out), 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { areas: [] };
  index.areas = (index.areas ?? []).filter((x) => x.id !== a.id);
  index.areas.push({ id: a.id, name: manifest.name, manifest: `${basename(out)}/manifest.json` });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

const s = manifest.stats;
console.log(`${manifest.name}: ${tiles.length} tiles of ${manifest.tileSize} m, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`roads ${s.roads} (expressway ${s.expressway}, BRT ${s.brt}, service ${s.service}, inner ${s.inner}, market ${s.market}) · buildings ${s.buildings} · potholes ${s.potholes} (${s.roughPotholes} on rough surfaces) · warden posts ${s.wardenPosts}`);
console.log(`written to ${out}`);
console.log('Map data © OpenStreetMap contributors (ODbL). Check the licence terms before release: see tools/osm-import/README.md.');
