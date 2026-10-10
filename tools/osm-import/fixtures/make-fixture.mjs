#!/usr/bin/env node
/**
 * Writes fixture-town.osm: a SYNTHETIC test extract for the importer and the streaming tests.
 * It is NOT real geography and must never ship as a Lagos area: every street and place is invented
 * ("Fixture ..."). It covers every road type, rough surfaces, a market, buildings with and without
 * levels, a named shop (whose name must be dropped), water (including a multipolygon) and a beach.
 *   node tools/osm-import/fixtures/make-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAT0 = 6.5, LON0 = 3.37;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
let nid = 1;
let wid = 1;
const nodes = [];
const ways = [];
const rels = [];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** x metres east, y metres north of the fixture origin. */
function node(x, y) {
  const id = nid++;
  nodes.push(`  <node id="${id}" lat="${(LAT0 + y / M_PER_DEG_LAT).toFixed(7)}" lon="${(LON0 + x / M_PER_DEG_LON).toFixed(7)}"/>`);
  return id;
}
function way(refs, tags) {
  const id = wid++;
  ways.push(`  <way id="${id}">\n${refs.map((r) => `    <nd ref="${r}"/>`).join('\n')}\n${Object.entries(tags).map(([k, v]) => `    <tag k="${esc(k)}" v="${esc(v)}"/>`).join('\n')}\n  </way>`);
  return id;
}
function closed(pts, tags) {
  const ids = pts.map(([x, y]) => node(x, y));
  return way([...ids, ids[0]], tags);
}
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// Shared junction nodes on a grid of streets north of the expressway.
const XS = [-300, -150, 0, 150, 300];
const YS = [60, 210, 360];
const J = {};
for (const x of XS) for (const y of YS) J[`${x},${y}`] = node(x, y);
for (const x of [-150, 0, 150]) J[`${x},0`] = node(x, 0);
const line = (pts) => pts.map(([x, y]) => J[`${x},${y}`] ?? node(x, y));

// Expressway (east-west), partly a bridge over the creek, with the BRT corridor beside it
way(line([[-450, 0], [-150, 0], [0, 0], [150, 0], [450, 0]]), { highway: 'trunk', lanes: '4', name: 'Fixture Expressway', oneway: 'no' });
way(line([[-450, 20], [0, 20], [450, 20]]), { highway: 'busway', name: 'Fixture BRT Corridor' });
way(line([[-450, -18], [450, -18]]), { highway: 'service', service: 'alley', name: 'Fixture Service Lane' });
// Streets linking the expressway to the grid
for (const x of [-150, 150]) way(line([[x, 0], [x, 60]]), { highway: 'tertiary', name: `Fixture Link ${x < 0 ? 'West' : 'East'}` });
// Grid
for (const y of YS) way(line(XS.map((x) => [x, y])), { highway: 'residential', name: `Fixture Street ${y}` });
for (const x of XS) {
  const tags = { highway: 'residential', name: `Fixture Avenue ${x}` };
  if (x === -300) tags.surface = 'unpaved';
  if (x === 300) tags.smoothness = 'bad';
  way(line(YS.map((y) => [x, y])), tags);
}
way(line([[0, 210], [0, 360]]), { highway: 'residential', oneway: 'yes', name: 'Fixture One Way' });
// Market with two lanes inside it
closed(rect(-130, 230, 110, 110), { amenity: 'marketplace', name: 'Real Market Name To Drop' });
way([node(-120, 285), node(-30, 285)], { highway: 'service', name: 'Fixture Market Lane' });
way([node(-75, 240), node(-75, 330)], { highway: 'living_street' });
// Things the importer must skip
way([node(-200, 100), node(-200, 180)], { highway: 'footway' });
way([node(200, 100), node(260, 100)], { highway: 'service', service: 'parking_aisle' });

// Buildings
let k = 0;
for (const [bx, by] of [[-280, 80], [-240, 80], [-120, 80], [-80, 80], [40, 80], [80, 80], [180, 80], [220, 80], [-280, 230], [40, 230], [180, 230], [220, 230], [-280, 380], [-80, 380], [40, 380], [180, 380]]) {
  const tags = { building: ['house', 'residential', 'apartments', 'commercial', 'yes'][k % 5] };
  if (k % 4 === 1) tags['building:levels'] = String(2 + (k % 3));
  if (k === 7) tags.height = '24';
  closed(rect(bx, by, 26, 18 + (k % 3) * 6), tags);
  k++;
}
closed(rect(100, 100, 30, 20), { building: 'retail', shop: 'supermarket', name: 'Real Shop Name To Drop', brand: 'Real Brand To Drop' });
closed(rect(-20, 100, 24, 30), { building: 'church', amenity: 'place_of_worship', name: 'Real Church Name To Drop' });

// Water: a lagoon edge south of the service lane (multipolygon of two ways) and a pond
const w1 = [node(-450, -40), node(450, -40), node(450, -200)];
const w2 = [w1[2], node(-450, -200), w1[0]];
const wa = way(w1, {});
const wb = way(w2, {});
rels.push(`  <relation id="1">\n    <member type="way" ref="${wa}" role="outer"/>\n    <member type="way" ref="${wb}" role="outer"/>\n    <tag k="type" v="multipolygon"/>\n    <tag k="natural" v="water"/>\n  </relation>`);
closed(rect(240, 250, 40, 40), { natural: 'water' });
closed(rect(-450, -60, 900, 18), { natural: 'beach' });
closed(rect(60, 380, 80, 40), { leisure: 'park' });

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- SYNTHETIC TEST FIXTURE for tools/osm-import. Not real geography; do not ship as a game area. -->
<osm version="0.6" generator="gangs-of-lagos make-fixture.mjs">
${nodes.join('\n')}
${ways.join('\n')}
${rels.join('\n')}
</osm>
`;
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixture-town.osm');
writeFileSync(out, xml);
console.log(`wrote ${out}: ${nodes.length} nodes, ${ways.length} ways, ${rels.length} relations`);
