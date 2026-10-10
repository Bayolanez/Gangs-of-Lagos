import * as THREE from 'three';
import { AREA_COLOUR, areaKind, buildingColour, buildingHeight, hash01, isRough, ROAD_TYPES, roadLanes, roadType, roadWidth } from './classify.mjs';
import { toUtm31N } from './utm.mjs';

/**
 * Builds a streamed game area from parsed OSM data:
 *  - projects to UTM 31N metres around an origin (game x = east, game z = south, 1 unit = 1 m);
 *  - keeps public roads (with their names), turns buildings into anonymous extruded blocks
 *    (business and home names are dropped: they stay fictional in the game);
 *  - classifies roads into expressway, BRT corridor, service lane, inner street and market road;
 *  - places potholes on rough surfaces plus seeded random ones on inner streets;
 *  - cuts everything into square tiles and makes one vertex-coloured mesh per tile.
 */

const r2 = (v) => Math.round(v * 100) / 100;
const PAVE = [0.64, 0.62, 0.57];
const MARK = [0.85, 0.70, 0.23];
const WHITE = [0.91, 0.91, 0.89];
const KERB = [0.75, 0.73, 0.68];

// ---------- Geometry helpers ----------

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function centroid(pts) {
  let x = 0, z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

/** Clip a polygon to an axis-aligned rectangle (Sutherland-Hodgman). */
function clipPoly(pts, x0, z0, x1, z1) {
  const edges = [
    (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= z0, (p) => p[1] <= z1,
  ];
  const cut = [
    (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z0]; },
    (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z1]; },
  ];
  let out = pts;
  for (let k = 0; k < 4 && out.length; k++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const cin = edges[k](cur), pin = edges[k](prev);
      if (cin) {
        if (!pin) out.push(cut[k](prev, cur));
        out.push(cur);
      } else if (pin) out.push(cut[k](prev, cur));
    }
  }
  return out.length >= 3 ? out : [];
}

/** Clip a polyline to a rectangle; returns the pieces inside it (Liang-Barsky per segment). */
function clipLine(pts, x0, z0, x1, z1) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
      if (Math.abs(p) < 1e-12) {
        if (q < 0) ok = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!ok || t0 > t1) {
      if (cur) pieces.push(cur);
      cur = null;
      continue;
    }
    const s = [ax + dx * t0, az + dz * t0], e = [ax + dx * t1, az + dz * t1];
    if (!cur) cur = [s];
    cur.push(e);
    if (t1 < 1) {
      pieces.push(cur);
      cur = null;
    }
  }
  if (cur) pieces.push(cur);
  return pieces.filter((p) => p.length >= 2);
}

function lineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Point and direction at distance d along a polyline. */
function along(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const l = Math.hypot(bx - ax, bz - az);
    if (d <= l || i === pts.length - 1) {
      const t = l > 0 ? Math.min(1, d / l) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: l ? (bx - ax) / l : 1, dz: l ? (bz - az) / l : 0 };
    }
    d -= l;
  }
  return { x: pts[0][0], z: pts[0][1], dx: 1, dz: 0 };
}

/** Join multipolygon member ways into closed rings of node ids. */
function joinRings(wayRefs) {
  const pending = wayRefs.map((r) => [...r]);
  const rings = [];
  while (pending.length) {
    let ring = pending.shift();
    let grew = true;
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < pending.length; i++) {
        const w = pending[i], end = ring[ring.length - 1];
        if (w[0] === end) ring = ring.concat(w.slice(1));
        else if (w[w.length - 1] === end) ring = ring.concat([...w].reverse().slice(1));
        else continue;
        pending.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  return rings;
}

// ---------- Mesh builder ----------

class Mesh {
  positions = [];
  normals = [];
  colors = [];
  indices = [];

  vert(x, y, z, n, c) {
    this.positions.push(r2(x), Math.round(y * 1000) / 1000, r2(z));
    this.normals.push(...n);
    this.colors.push(...c);
    return this.positions.length / 3 - 1;
  }

  /** Flat polygon at height y (triangulated, facing up). */
  flat(pts, y, c) {
    if (pts.length < 3) return;
    const ring = polyArea(pts) < 0 ? [...pts].reverse() : pts;
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const base = this.positions.length / 3;
    for (const [x, z] of ring) this.vert(x, y, z, [0, 1, 0], c);
    // Shape space is (x, z) with z pointing south; flip winding so faces point up (+y).
    for (const [a, b, d] of tris) this.indices.push(base + a, base + d, base + b);
  }

  quad(a, b, cc, d, n, c) {
    const i = this.vert(...a, n, c), j = this.vert(...b, n, c), k = this.vert(...cc, n, c), l = this.vert(...d, n, c);
    this.indices.push(i, j, k, i, k, l);
  }

  /** A strip of the given width along a polyline at height y, with rounded joints. */
  ribbon(pts, width, y, c, joints = true) {
    const h = width / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 0.05) continue;
      const nx = (-(bz - az) / l) * h, nz = ((bx - ax) / l) * h;
      this.quad([ax - nx, y, az - nz], [ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [0, 1, 0], c);
    }
    if (!joints) return;
    for (let i = 1; i < pts.length - 1; i++) this.disc(pts[i][0], pts[i][1], h, y, c);
  }

  disc(x, z, r, y, c) {
    const n = 8, base = this.vert(x, y, z, [0, 1, 0], c);
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.vert(x + Math.cos(a) * r, y, z - Math.sin(a) * r, [0, 1, 0], c);
    }
    for (let k = 0; k < n; k++) this.indices.push(base, base + 1 + k, base + 2 + k);
  }

  /** Dashed centre line. */
  dashes(pts, y, c, dash = 3, gap = 6, w = 0.15) {
    const len = lineLength(pts);
    for (let d = gap / 2; d + dash < len; d += dash + gap) {
      const p = along(pts, d), q = along(pts, d + dash);
      this.ribbon([[p.x, p.z], [q.x, q.z]], w, y, c, false);
    }
  }

  /** Extruded building: walls and a flat roof. */
  building(pts, h, c) {
    const ring = polyArea(pts) < 0 ? [...pts].reverse() : pts; // counter-clockwise in (x, z)
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 0.01) continue;
      // Outward normal for a CCW ring in (x, z): rotate the edge clockwise.
      const n = [(bz - az) / l, 0, -(bx - ax) / l];
      const shade = c.map((v) => v * (0.82 + 0.18 * Math.abs(n[0])));
      this.quad([ax, 0, az], [ax, h, az], [bx, h, bz], [bx, 0, bz], n, shade);
    }
    this.flat(ring, h, c.map((v) => v * 0.8));
  }
}

// ---------- Main ----------

/**
 * osm: { nodes, ways, relations } from parseOsm. opts: { id, name, tileSize, origin?, bbox?, fixture? }.
 * Returns { manifest, graph, tiles: [{ key, json, mesh }] }.
 */
export function buildArea(osm, opts) {
  const tileSize = opts.tileSize ?? 400;
  const inBbox = (n) => !opts.bbox || (n.lat >= opts.bbox[0] && n.lon >= opts.bbox[1] && n.lat <= opts.bbox[2] && n.lon <= opts.bbox[3]);
  const used = opts.bbox ? osm.ways.filter((w) => w.refs.some((r) => osm.nodes.has(r) && inBbox(osm.nodes.get(r)))) : osm.ways;
  const wayById = new Map(osm.ways.map((w) => [w.id, w]));

  // Origin: given, or the middle of the data.
  let lat0 = opts.origin?.[0], lon0 = opts.origin?.[1];
  // With a box, its centre is the origin (ways that run outside the box mustn't pull it away).
  if (lat0 === undefined && opts.bbox) {
    lat0 = (opts.bbox[0] + opts.bbox[2]) / 2;
    lon0 = (opts.bbox[1] + opts.bbox[3]) / 2;
  }
  if (lat0 === undefined) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const w of used) for (const r of w.refs) {
      const n = osm.nodes.get(r);
      if (!n) continue;
      a = Math.min(a, n.lat); c = Math.max(c, n.lat); b = Math.min(b, n.lon); d = Math.max(d, n.lon);
    }
    if (!Number.isFinite(a)) throw new Error('No ways with coordinates in the input.');
    lat0 = (a + c) / 2;
    lon0 = (b + d) / 2;
  }
  const o = toUtm31N(lat0, lon0);
  const proj = new Map();
  const P = (id) => {
    let p = proj.get(id);
    if (!p) {
      const n = osm.nodes.get(id);
      if (!n) return null;
      const u = toUtm31N(n.lat, n.lon);
      p = [r2(u.e - o.e), r2(-(u.n - o.n))];
      proj.set(id, p);
    }
    return p;
  };
  const ringPts = (refs) => {
    const pts = refs.map(P).filter(Boolean);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts;
  };

  // ---- Polygons: closed ways and multipolygon outer rings
  const polygons = []; // { tags, pts, id }
  for (const w of used) if (w.refs.length >= 4 && w.refs[0] === w.refs[w.refs.length - 1] && !w.tags.highway) polygons.push({ id: `w${w.id}`, tags: w.tags, pts: ringPts(w.refs) });
  for (const rel of osm.relations) {
    if (rel.tags.type !== 'multipolygon') continue;
    const outers = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => wayById.get(m.ref)?.refs).filter(Boolean);
    joinRings(outers).forEach((ring, i) => polygons.push({ id: `r${rel.id}-${i}`, tags: rel.tags, pts: ringPts(ring) }));
  }
  const markets = polygons.filter((p) => areaKind(p.tags) === 'market' && p.pts.length >= 3);

  // ---- Roads
  const roads = [];
  for (const w of used) {
    let type = roadType(w.tags);
    if (!type) continue;
    let pts = w.refs.map(P).filter(Boolean);
    if (pts.length < 2) continue;
    if (w.tags.oneway === '-1') pts = pts.reverse();
    if (type === 'inner' || type === 'service') {
      const mid = along(pts, lineLength(pts) / 2);
      if (markets.some((m) => pointInPoly(mid.x, mid.z, m.pts))) type = 'market';
    }
    roads.push({
      id: w.id,
      type,
      name: w.tags.name ?? null,
      width: r2(roadWidth(type, w.tags)),
      lanes: roadLanes(type, w.tags),
      oneway: ['yes', '1', 'true', '-1'].includes(w.tags.oneway) || w.tags.junction === 'roundabout',
      bridge: !!w.tags.bridge && w.tags.bridge !== 'no',
      rough: isRough(w.tags),
      refs: w.tags.oneway === '-1' ? [...w.refs].reverse() : w.refs,
      pts,
    });
  }

  // ---- Road graph: split ways at shared nodes
  const uses = new Map();
  for (const r of roads) r.refs.forEach((id, i) => {
    if (!osm.nodes.has(id)) return;
    uses.set(id, (uses.get(id) ?? 0) + (i === 0 || i === r.refs.length - 1 ? 2 : 1));
  });
  const nodeIndex = new Map();
  const gNodes = [];
  const gi = (id) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = gNodes.length;
      nodeIndex.set(id, i);
      gNodes.push(P(id));
    }
    return i;
  };
  const gEdges = [];
  for (const r of roads) {
    const refs = r.refs.filter((id) => osm.nodes.has(id));
    let start = 0;
    for (let i = 1; i < refs.length; i++) {
      if (i < refs.length - 1 && (uses.get(refs[i]) ?? 0) < 2) continue;
      const pts = refs.slice(start, i + 1).map(P);
      if (lineLength(pts) > 0.5) gEdges.push({ a: gi(refs[start]), b: gi(refs[i]), type: r.type, w: r.width, lanes: r.lanes, oneway: r.oneway, road: r.id, pts });
      start = i;
    }
  }

  // ---- Potholes: rough surfaces, plus seeded random ones on inner streets
  const potholes = [];
  for (const r of roads) {
    if (r.type === 'expressway' || r.type === 'brt') continue;
    const len = lineLength(r.pts);
    const add = (d, k) => {
      const p = along(r.pts, d);
      const lat = (hash01(`${r.id}:lat:${k}`) - 0.5) * r.width * 0.6;
      potholes.push({ x: r2(p.x - p.dz * lat), z: r2(p.z + p.dx * lat), r: r2(0.45 + hash01(`${r.id}:r:${k}`) * 0.45), rough: r.rough });
    };
    if (r.rough) {
      let k = 0;
      for (let d = 8 + hash01(`${r.id}:s`) * 12; d < len - 4; d += 18 + hash01(`${r.id}:g:${k}`) * 14) add(d, k++);
    } else if (r.type === 'inner' || r.type === 'market') {
      for (let s = 0; s * 100 < len; s++) if (hash01(`${r.id}:seg:${s}`) < 0.45) add(Math.min(len - 2, s * 100 + hash01(`${r.id}:d:${s}`) * 100), 1000 + s);
    }
  }

  // ---- Lane wardens beside BRT corridors (fictional): one post every ~300 m
  const posts = [];
  for (const r of roads) {
    if (r.type !== 'brt') continue;
    const len = lineLength(r.pts);
    for (let d = 60; d < len; d += 300) {
      const p = along(r.pts, d), off = r.width / 2 + 2.5;
      posts.push({ x: r2(p.x - p.dz * off), z: r2(p.z + p.dx * off) });
    }
  }

  // ---- Buildings (names dropped) and ground areas
  const buildings = [];
  const areas = [];
  for (const poly of polygons) {
    if (poly.pts.length < 3) continue;
    const a = Math.abs(polyArea(poly.pts));
    if (poly.tags.building && poly.tags.building !== 'no' && !poly.tags['building:part']) {
      if (a < 6 || a > 40000) continue;
      const rnd = hash01(poly.id);
      buildings.push({ pts: poly.pts, h: r2(buildingHeight(poly.tags, rnd)), c: buildingColour(poly.tags, hash01(`${poly.id}:c`)) });
    } else {
      const kind = areaKind(poly.tags);
      if (kind) areas.push({ kind, pts: poly.pts });
    }
  }

  // ---- Extent and tiles
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const grow = (x, z) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  };
  for (const r of roads) for (const [x, z] of r.pts) grow(x, z);
  for (const b of buildings) for (const [x, z] of b.pts) grow(x, z);
  if (!Number.isFinite(minX)) throw new Error('No roads or buildings found in the input.');
  if (opts.bbox) {
    const lo = toUtm31N(opts.bbox[0], opts.bbox[1]), hi = toUtm31N(opts.bbox[2], opts.bbox[3]);
    minX = Math.max(minX, lo.e - o.e); maxX = Math.min(maxX, hi.e - o.e);
    minZ = Math.max(minZ, -(hi.n - o.n)); maxZ = Math.min(maxZ, -(lo.n - o.n));
  }
  const ix0 = Math.floor(minX / tileSize), ix1 = Math.floor(maxX / tileSize);
  const iz0 = Math.floor(minZ / tileSize), iz1 = Math.floor(maxZ / tileSize);

  const tiles = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const x0 = ix * tileSize, z0 = iz * tileSize, x1 = x0 + tileSize, z1 = z0 + tileSize;
      const inTile = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
      const mesh = new Mesh();
      const tRoads = [];
      const tAreas = [];
      for (const ar of areas) {
        const pts = clipPoly(ar.pts, x0, z0, x1, z1);
        if (!pts.length) continue;
        mesh.flat(pts, ar.kind === 'water' ? 0.008 : 0.012, AREA_COLOUR[ar.kind]);
        tAreas.push({ kind: ar.kind, pts: pts.map(([x, z]) => [r2(x), r2(z)]) });
      }
      for (const r of roads) {
        for (const pts of clipLine(r.pts, x0, z0, x1, z1)) {
          const T = ROAD_TYPES[r.type];
          if (r.type === 'inner' || r.type === 'market' || r.type === 'expressway') mesh.ribbon(pts, r.width + 4, 0.02, PAVE); // pavements
          mesh.ribbon(pts, r.width, T.y, r.rough && r.type !== 'market' ? [0.48, 0.32, 0.22] : T.colour);
          if (r.type === 'brt') {
            for (const s of [-1, 1]) {
              const off = pts.map((p, i) => {
                const q = pts[Math.min(i + 1, pts.length - 1)], pp = pts[Math.max(i - 1, 0)];
                const dx = q[0] - pp[0], dz = q[1] - pp[1], l = Math.hypot(dx, dz) || 1;
                return [p[0] - (dz / l) * s * (r.width / 2 + 0.15), p[1] + (dx / l) * s * (r.width / 2 + 0.15)];
              });
              mesh.ribbon(off, 0.3, 0.15, KERB); // kerbs
            }
            mesh.dashes(pts, T.y + 0.01, WHITE, 2, 4, 0.12);
          } else if (!r.oneway && r.width >= 6 && !r.rough) mesh.dashes(pts, T.y + 0.01, MARK);
          tRoads.push({ id: r.id, type: r.type, name: r.name, width: r.width, lanes: r.lanes, oneway: r.oneway, bridge: r.bridge, rough: r.rough, pts: pts.map(([x, z]) => [r2(x), r2(z)]) });
        }
      }
      const tBuildings = buildings.filter((b) => inTile(...centroid(b.pts)));
      for (const b of tBuildings) mesh.building(b.pts, b.h, b.c);
      const tPotholes = potholes.filter((p) => inTile(p.x, p.z));
      const tPosts = posts.filter((p) => inTile(p.x, p.z));
      if (!tRoads.length && !tBuildings.length && !tAreas.length) continue;
      const key = `${ix}_${iz}`;
      tiles.push({
        key,
        mesh,
        json: {
          key, ix, iz, bounds: [x0, z0, x1, z1],
          roads: tRoads,
          buildings: tBuildings.map((b) => ({ pts: b.pts, h: b.h })),
          areas: tAreas,
          potholes: tPotholes,
          posts: tPosts,
        },
      });
    }
  }

  // Player start: the middle of the longest inner street near the origin.
  const mid = (r) => along(r.pts, lineLength(r.pts) / 2);
  const inside = (r) => {
    const p = mid(r);
    return p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ;
  };
  const streets = roads.filter((r) => (r.type === 'inner' || r.type === 'service') && inside(r));
  const startRoad = (streets.length ? streets : roads).reduce((best, r) => (Math.hypot(mid(r).x, mid(r).z) < Math.hypot(mid(best).x, mid(best).z) ? r : best));
  const sp = mid(startRoad);
  const side = startRoad.width / 2 + 1.5;

  const count = (t) => roads.filter((r) => r.type === t).length;
  const manifest = {
    format: 1,
    id: opts.id,
    name: opts.name,
    fixture: !!opts.fixture,
    origin: { lat: lat0, lon: lon0, utmZone: '31N', e: r2(o.e), n: r2(o.n) },
    tileSize,
    bounds: [r2(minX), r2(minZ), r2(maxX), r2(maxZ)],
    spawn: { x: r2(sp.x - sp.dz * side), z: r2(sp.z + sp.dx * side), heading: r2(Math.atan2(sp.dz, sp.dx)) },
    attribution: '© OpenStreetMap contributors',
    licence: 'Map data from OpenStreetMap, available under the Open Database License (ODbL) 1.0. The derived tiles may carry share-alike obligations: confirm before release.',
    source: opts.source ?? null,
    stats: {
      roads: roads.length, expressway: count('expressway'), brt: count('brt'), service: count('service'), inner: count('inner'), market: count('market'),
      buildings: buildings.length, potholes: potholes.length, roughPotholes: potholes.filter((p) => p.rough).length, wardenPosts: posts.length, graphNodes: gNodes.length, graphEdges: gEdges.length,
    },
    graph: 'graph.json',
    tiles: tiles.map((t) => ({ key: t.key, ix: t.json.ix, iz: t.json.iz, bounds: t.json.bounds, glb: `tiles/${t.key}.glb`, json: `tiles/${t.key}.json` })),
  };
  // Traffic only drives inside the area: keep road graph edges that lie within its bounds.
  const inBounds = ([x, z]) => x >= minX - 10 && x <= maxX + 10 && z >= minZ - 10 && z <= maxZ + 10;
  const keptEdges = gEdges.filter((e) => e.pts.every(inBounds));
  manifest.stats.graphEdges = keptEdges.length;
  const graph = { nodes: gNodes, edges: keptEdges.map((e) => ({ ...e, pts: e.pts.map(([x, z]) => [r2(x), r2(z)]) })) };
  return { manifest, graph, tiles };
}
