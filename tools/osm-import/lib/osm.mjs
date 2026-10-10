/**
 * Reads an OpenStreetMap extract: OSM XML (.osm, e.g. from the OSM "Export" button, JOSM or
 * `osmium cat area.osm.pbf -o area.osm`) or Overpass JSON (`[out:json]; ... out body; >; out skel qt;`).
 * Returns plain maps; no dependencies.
 */

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = unescape(m[2]);
  return out;
}

function parseXml(text) {
  const nodes = new Map();
  const ways = [];
  const relations = [];
  // Elements are either self-closing (<node .../>) or have children (<way ...> ... </way>).
  const re = /<(node|way|relation)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of text.matchAll(re)) {
    const [, kind, head, , body = ''] = m;
    const a = attrs(head);
    const tags = {};
    for (const t of body.matchAll(/<tag\b([^>]*)\/>/g)) {
      const ta = attrs(t[1]);
      if (ta.k !== undefined) tags[ta.k] = ta.v ?? '';
    }
    if (kind === 'node') nodes.set(Number(a.id), { lat: Number(a.lat), lon: Number(a.lon), tags });
    else if (kind === 'way') ways.push({ id: Number(a.id), refs: [...body.matchAll(/<nd\b[^>]*ref="(-?\d+)"/g)].map((r) => Number(r[1])), tags });
    else {
      const members = [...body.matchAll(/<member\b([^>]*)\/>/g)].map((r) => {
        const ma = attrs(r[1]);
        return { type: ma.type, ref: Number(ma.ref), role: ma.role ?? '' };
      });
      relations.push({ id: Number(a.id), members, tags });
    }
  }
  return { nodes, ways, relations };
}

function parseJson(text) {
  const data = JSON.parse(text);
  const nodes = new Map();
  const ways = [];
  const relations = [];
  let synthetic = -1;
  for (const e of data.elements ?? []) {
    if (e.type === 'node') nodes.set(e.id, { lat: e.lat, lon: e.lon, tags: e.tags ?? {} });
    else if (e.type === 'way') {
      let refs = e.nodes ?? [];
      // `out geom` gives coordinates inline; make nodes for them when ids are missing.
      if (e.geometry && (!refs.length || refs.some((r) => !nodes.has(r)))) {
        refs = e.geometry.map((g, i) => {
          const id = e.nodes?.[i] ?? synthetic--;
          if (!nodes.has(id)) nodes.set(id, { lat: g.lat, lon: g.lon, tags: {} });
          return id;
        });
      }
      ways.push({ id: e.id, refs, tags: e.tags ?? {} });
    } else if (e.type === 'relation') {
      relations.push({ id: e.id, members: (e.members ?? []).map((m) => ({ type: m.type, ref: m.ref, role: m.role ?? '' })), tags: e.tags ?? {} });
    }
  }
  return { nodes, ways, relations };
}

export function parseOsm(text) {
  const t = text.trimStart();
  if (t.startsWith('{')) return parseJson(t);
  if (t.startsWith('<')) return parseXml(t);
  throw new Error('Input is neither OSM XML nor Overpass JSON. Convert .pbf files first: osmium cat area.osm.pbf -o area.osm');
}
