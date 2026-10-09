import * as THREE from 'three';
import { CollisionWorld } from './collision';
import { Batcher, rng, textSprite } from './placeholders';

/**
 * GREY-BOX DISTRICT: "Harbour Bend", a fictional, bounded district (about 340 x 400 m) inspired by
 * Lagos street life. Layout ported from the Unreal reference (GOLDistrict), converted to metres:
 * x runs west->east (lagoon on the east), z runs north->south in screen terms.
 */
export const HALF = 200;
export const SHORE = 140;
export const ROAD_W = 12;
export const ROAD_LINES = [-120, -40, 40, 120];
export const BRIDGE_Z = 40;
const FLOOR = 3.2;

const C = {
  laterite: '#9c5d3c', asphalt: '#38393c', pave: '#a39d91', drain: '#2b2622', concrete: '#8d8a82',
  glass: '#26333b', zinc: '#8e5636', zincAlu: '#9ea3a6', tank: '#141516', yellow: '#d9b23a', white: '#e9e8e2',
  wood: '#6b4a2e', palm: '#3f7a2c', palmDark: '#2f5f22', trunk: '#7a6a55', danfo: '#f2c21a', black: '#111111', red: '#c0392b',
};
const WALLS = ['#e6dcc6', '#d9c7a8', '#cfd6d2', '#e9cfc0', '#d6d0bb', '#f0ebe2', '#c9d3d6', '#e3d3b4', '#bfc8a8'];
const BRIGHT = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#e67e22', '#8e44ad', '#16a085', '#d35400'];

export interface ResidentDef {
  name: string;
  voice: string;
  x: number;
  z: number;
  shirt: string;
  headwrap?: string;
  tray?: boolean;
}

/** Chidi's Workshop (fictional): drive into the bay for repairs and paint. Wrecks are towed here. */
export const WORKSHOP = {
  bay: { x: 57, z: 0, r: 5 },
  tow: { hatchback: { x: 66, z: -14, heading: 0 }, danfo: { x: 66, z: 14, heading: 0 } },
};

export interface BusStop {
  name: string;
  /** Where the bus stops (on the road, right-hand lane). */
  stop: { x: number; z: number };
  shelter: { x: number; z: number };
  /** Shelter runs along x (true) or z (false); back is the side away from the road (+1/-1). */
  alongX: boolean;
  back: number;
}
export const BUS_STOPS: BusStop[] = [
  { name: 'Bus Park', stop: { x: 0, z: 43 }, shelter: { x: 0, z: 48.6 }, alongX: true, back: 1 },
  { name: 'Market Gate', stop: { x: -43, z: 80 }, shelter: { x: -48.6, z: 80 }, alongX: false, back: -1 },
  { name: 'Clock Square', stop: { x: 0, z: -37 }, shelter: { x: 0, z: -31.4 }, alongX: true, back: 1 },
  { name: 'Harbour Road', stop: { x: 123, z: -30 }, shelter: { x: 128.6, z: -30 }, alongX: false, back: 1 },
  { name: 'Old Ferry', stop: { x: 100, z: 37 }, shelter: { x: 100, z: 31.4 }, alongX: true, back: -1 },
];

export interface DistrictInfo {
  playerStart: { x: number; z: number; heading: number };
  carSpawn: { x: number; z: number; heading: number };
  danfoSpawn: { x: number; z: number; heading: number };
  residents: ResidentDef[];
  instances: number;
}

export function buildDistrict(scene: THREE.Scene, world: CollisionWorld): DistrictInfo {
  const b = new Batcher();
  const rand = rng(1407);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const range = (a: number, c: number) => a + rand() * (c - a);

  /** Box helper: centre on the ground plane, size in metres; solid boxes also become colliders. */
  const box = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, solid = true, rx = 0, rz = 0, shadow = true) => {
    b.add('box', color, x, y, z, sx, sy, sz, rx, 0, rz, shadow);
    if (solid) world.add(x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2, y + sy / 2);
  };
  const flat = (color: string, x: number, z: number, sx: number, sz: number, y = 0.01) => b.add('box', color, x, y, z, sx, 0.02, sz, 0, 0, 0, false);
  const label = (text: string, x: number, y: number, z: number, h = 1.6, color = '#f5c518') => {
    const s = textSprite(text, color, h);
    s.position.set(x, y, z);
    scene.add(s);
  };
  const palm = (x: number, z: number) => {
    b.add('cyl', C.trunk, x, 4.2, z, 0.32, 8.4, 0.32);
    world.add(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 8);
    b.add('sph', C.palm, x, 8.6, z, 4.2, 0.8, 4.2);
    b.add('sph', C.palmDark, x, 8.8, z, 2.6, 1.2, 2.6);
  };

  // --- Ground, lagoon, sea wall, far skyline ---
  const groundTex = makeGroundTexture();
  groundTex.repeat.set(70, 80);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SHORE + HALF, 2 * HALF), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((-HALF + SHORE) / 2, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 2 * HALF + 400), new THREE.MeshStandardMaterial({ color: '#1f5966', roughness: 0.18, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(SHORE + 200, -2, 0);
  scene.add(water);
  box(C.concrete, SHORE + 0.4, -1, 0, 0.8, 2.2, 2 * HALF, false);
  for (let i = 0; i < 18; i++) {
    const h = range(25, 90);
    const w = range(12, 26);
    box('#6f7c86', SHORE + 160 + range(-15, 15), h / 2 - 2, -HALF + i * 24, w, h, w, false);
  }

  // --- Roads, centre lines, zebra crossings ---
  const nearLine = (v: number, m: number) => ROAD_LINES.some((l) => Math.abs(v - l) < m);
  for (const x of ROAD_LINES) flat(C.asphalt, x, 0, ROAD_W, 2 * HALF, 0.02);
  for (const z of ROAD_LINES) flat(C.asphalt, (-HALF + SHORE) / 2, z, SHORE + HALF, ROAD_W, 0.025);
  for (const x of ROAD_LINES) for (let z = -HALF + 4.5; z < HALF; z += 9) if (!nearLine(z, ROAD_W / 2 + 2)) flat(C.yellow, x, z, 0.14, 4.2, 0.035);
  for (const z of ROAD_LINES) for (let x = -HALF + 4.5; x < SHORE; x += 9) if (!nearLine(x, ROAD_W / 2 + 2)) flat(C.yellow, x, z, 4.2, 0.14, 0.04);
  for (const x of ROAD_LINES) {
    for (const z of ROAD_LINES) {
      for (const s of [-1, 1]) {
        const off = ROAD_W / 2 + 2.8;
        for (let i = -4; i <= 4; i++) {
          flat(C.white, x + i * 1.25, z + s * off, 0.65, 3.8, 0.04);
          flat(C.white, x + s * off, z + i * 1.25, 3.8, 0.65, 0.045);
        }
      }
    }
  }

  // --- Blocks ---
  const building = (minX: number, minZ: number, maxX: number, maxZ: number, face: [number, number]) => {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const r = rand();
    const floors = r < 0.35 ? 1 : r < 0.65 ? 2 : r < 0.85 ? 3 : 4 + Math.floor(rand() * 4);
    const h = floors * FLOOR + 0.4;
    box(pick(WALLS), cx, h / 2, cz, w, h, d);
    for (let f = 0; f < floors; f++) b.add('box', C.glass, cx, f * FLOOR + 1.9, cz, w + 0.06, 0.95, d + 0.06, 0, 0, 0, false);

    const alongX = face[0] === 0;
    const frontLen = alongX ? w : d;
    const facade = (color: string, along: number, y: number, len: number, height: number, out: number, solid: boolean) => {
      const halfDepth = (alongX ? d : w) / 2;
      if (alongX) box(color, cx + along, y, cz + face[1] * (halfDepth + out / 2), len, height, out, solid, 0, 0, false);
      else box(color, cx + face[0] * (halfDepth + out / 2), y, cz + along, out, height, len, solid, 0, 0, false);
    };
    if (rand() < 0.55) {
      const shop = pick(BRIGHT);
      facade('#7e8285', 0, 1.25, frontLen * 0.8, 2.3, 0.08, false); // roller shutter
      facade(shop, 0, 3.0, frontLen * 0.9, 0.1, 1.6, false); // canopy
      facade(shop, 0, 3.65, frontLen * 0.6, 0.6, 0.1, false); // sign board
      if (rand() < 0.5) facade(rand() < 0.5 ? '#2e7d32' : '#b71c1c', frontLen * 0.3, 0.35, 0.9, 0.7, 0.6, true); // generator
    }
    if (floors <= 2 && rand() < 0.65) {
      const sheet = rand() < 0.6 ? C.zinc : C.zincAlu;
      const ang = (14 * Math.PI) / 180;
      if (w >= d) {
        const hs = d / 2 + 0.4;
        const y = h + (hs / 2) * Math.tan(ang);
        b.add('box', sheet, cx, y, cz - hs / 2, w + 0.8, 0.1, hs * 1.04, -ang, 0, 0);
        b.add('box', sheet, cx, y, cz + hs / 2, w + 0.8, 0.1, hs * 1.04, ang, 0, 0);
      } else {
        const hs = w / 2 + 0.4;
        const y = h + (hs / 2) * Math.tan(ang);
        b.add('box', sheet, cx - hs / 2, y, cz, hs * 1.04, 0.1, d + 0.8, 0, 0, ang);
        b.add('box', sheet, cx + hs / 2, y, cz, hs * 1.04, 0.1, d + 0.8, 0, 0, -ang);
      }
    } else {
      const tanks = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < tanks; i++) b.add('cyl', C.tank, cx + range(-w * 0.3, w * 0.3), h + 0.75, cz + range(-d * 0.3, d * 0.3), 1.3, 1.5, 1.3);
      if (rand() < 0.5) b.add('box', '#d9d7d0', cx + range(-w * 0.3, w * 0.3), h + 0.4, cz + range(-d * 0.3, d * 0.3), 1.1, 0.8, 0.8);
    }
  };

  const sidewalkRing = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, sx = maxX - minX, sz = maxZ - minZ, ring = 3.5;
    flat(C.pave, cx, minZ + ring / 2, sx, ring, 0.03);
    flat(C.pave, cx, maxZ - ring / 2, sx, ring, 0.03);
    flat(C.pave, minX + ring / 2, cz, ring, sz, 0.032);
    flat(C.pave, maxX - ring / 2, cz, ring, sz, 0.032);
    flat(C.drain, cx, minZ + 0.25, sx, 0.45, 0.04);
    flat(C.drain, cx, maxZ - 0.25, sx, 0.45, 0.04);
  };

  const plainBlock = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    sidewalkRing(minX, minZ, maxX, maxZ);
    const inset = 4.2;
    const x0 = minX + inset, x1 = maxX - inset, z0 = minZ + inset, z1 = maxZ - inset;
    for (const row of [0, 1]) {
      let x = x0;
      while (x < x1 - 9) {
        const w = Math.min(range(12, 24), x1 - x);
        const d = range(15, 25);
        if (row === 0) building(x, z0, x + w, z0 + d, [0, -1]);
        else building(x, z1 - d, x + w, z1, [0, 1]);
        x += w + range(1.8, 4.2);
      }
    }
    for (const col of [0, 1]) {
      let z = z0 + 27;
      while (z < z1 - 27 - 9) {
        const w = Math.min(range(12, 22), z1 - 27 - z);
        const d = range(15, 24);
        if (col === 0) building(x0, z, x0 + d, z + w, [-1, 0]);
        else building(x1 - d, z, x1, z + w, [1, 0]);
        z += w + range(1.8, 4.2);
      }
    }
  };

  const market = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    flat(C.pave, (minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ, 0.03);
    let row = 0;
    for (let z = minZ + 10; z < maxZ - 8; z += 11, row++) {
      for (let x = minX + 8; x < maxX - 6; x += 6.5) {
        if (rand() < 0.12) continue;
        box(C.wood, x, 0.45, z, 4.2, 0.9, 2);
        b.add('box', pick(BRIGHT), x, 2.5, z, 5, 0.08, 3.2, row % 2 ? 0.1 : -0.1, 0, 0);
        b.add('cyl', C.wood, x - 2.3, 1.25, z - 1.4, 0.1, 2.5, 0.1);
        b.add('cyl', C.wood, x + 2.3, 1.25, z - 1.4, 0.1, 2.5, 0.1);
        for (let i = 0; i < 3; i++) b.add('box', pick(BRIGHT), x - 1.3 + i * 1.3, 1.05, z, 0.9, 0.3, 0.9, 0, 0, 0, false);
      }
    }
    label('HARBOUR BEND MARKET', (minX + maxX) / 2, 5.2, minZ - 0.4);
  };

  const busPark = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    b.add('box', C.zinc, cx, 4.7, maxZ - 9, maxX - minX - 16, 0.12, 10);
    for (let x = minX + 9; x <= maxX - 9; x += 10) {
      box(C.concrete, x, 2.35, maxZ - 13.5, 0.4, 4.7, 0.4);
      box(C.concrete, x, 2.35, maxZ - 4.5, 0.4, 4.7, 0.4);
    }
    box(C.wood, cx, 0.45, maxZ - 9, maxX - minX - 24, 0.45, 0.6);
    // PLACEHOLDER minibuses: yellow body with two black stripes (static props).
    for (let i = 0; i < 5; i++) {
      for (const z of [cz - 7, cz + 9]) {
        const x = minX + 11 + i * 11.5;
        box(C.danfo, x, 1.4, z, 2.1, 1.9, 4.8);
        b.add('box', C.black, x, 1.0, z, 2.13, 0.12, 4.82, 0, 0, 0, false);
        b.add('box', C.black, x, 1.22, z, 2.13, 0.12, 4.82, 0, 0, 0, false);
        b.add('box', C.glass, x, 1.92, z, 2.14, 0.55, 4.7, 0, 0, 0, false);
        for (const wz of [-1.6, 1.6]) b.add('box', '#151515', x, 0.35, z + wz, 2.2, 0.6, 0.6, 0, 0, 0, false);
      }
    }
    box('#2d7dd2', minX + 5, 1.3, minZ + 7, 3, 2.6, 3);
    label('BUS PARK', cx, 5.2, minZ - 0.4);
  };

  const square = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, sx = maxX - minX, sz = maxZ - minZ;
    flat(C.pave, cx, cz, sx, sz, 0.03);
    flat('#4a7232', cx, cz, sx - 24, sz - 24, 0.04);
    box(C.concrete, cx, 0.4, cz, 9, 0.8, 9);
    box(C.concrete, cx, 1.1, cz, 6, 0.6, 6);
    box('#e8dfc8', cx, 1.4 + 7, cz, 2.6, 14, 2.6);
    for (const s of [-1, 1]) {
      b.add('box', '#f3f0e6', cx + s * 1.32, 13.8, cz, 0.06, 1.5, 1.5, 0, 0, 0, false);
      b.add('box', '#f3f0e6', cx, 13.8, cz + s * 1.32, 1.5, 1.5, 0.06, 0, 0, 0, false);
    }
    b.add('box', '#1f6b4a', cx, 15.9, cz, 3.2, 0.6, 3.2);
    for (const sx2 of [-1, 1]) {
      for (const sz2 of [-1, 1]) {
        palm(cx + sx2 * 23, cz + sz2 * 23);
        box(C.wood, cx + sx2 * 15, 0.25, cz + sz2 * 26, 4, 0.45, 0.7);
      }
    }
    label('HARBOUR BEND SQUARE', minX - 0.4, 4, cz, 1.4);
  };

  /** PLACEHOLDER mechanic's yard: open service bay facing the west road, shed, office, tyre stacks. */
  const workshop = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    sidewalkRing(minX, minZ, maxX, maxZ);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    flat('#6f6c66', cx, cz, maxX - minX - 7, maxZ - minZ - 7, 0.035);
    // Oil stains and the bay outline
    for (let i = 0; i < 9; i++) flat('#45433f', range(minX + 8, maxX - 26), range(minZ + 8, maxZ - 8), range(1, 2.6), range(0.8, 2), 0.04);
    const { x: bx, z: bz } = WORKSHOP.bay;
    for (const s of [-1, 1]) flat(C.yellow, bx, bz + s * 3.6, 9, 0.25, 0.045);
    flat(C.yellow, bx + 4.5, bz, 0.25, 7.4, 0.046);
    // Service canopy over the bay: four posts and a zinc roof
    for (const px of [bx - 6, bx + 6]) for (const pz of [-6.5, 6.5]) box(C.concrete, px, 2.3, bz + pz, 0.35, 4.6, 0.35);
    b.add('box', C.zincAlu, bx, 4.7, bz, 13.5, 0.12, 14);
    // Shed at the back, office in the corner
    box('#b7b1a3', 102, 2.9, 0, 18, 5.8, 44);
    b.add('box', C.zinc, 102, 6.0, 0, 19, 0.14, 45);
    box('#7e8285', 92.9, 2.0, 0, 0.1, 3.8, 14, false); // roller door
    box('#d9c7a8', 84, 1.8, 25, 12, 3.6, 9);
    b.add('box', C.red, 84, 3.9, 20.4, 10, 0.5, 0.1, 0, 0, 0, false);
    // Tyre stacks, oil drums, a stripped car shell (all placeholder)
    for (const [tx, tz] of [[70, 27], [72.6, 27], [75.2, 27], [70, -27], [72.6, -27], [108, 27], [110.5, -27]]) {
      for (let k = 0; k < 3; k++) b.add('cyl', '#151515', tx, 0.25 + k * 0.42, tz, 1.1, 0.4, 1.1);
      world.add(tx - 0.55, tx + 0.55, tz - 0.55, tz + 0.55, 1.3);
    }
    for (const [dx, dz] of [[88, -12], [88.8, -13], [88, -14]]) box('#2e5e8c', dx, 0.55, dz, 0.7, 1.1, 0.7);
    box('#5d4a3a', 80, 0.7, -24, 4.2, 1.1, 1.8);
    b.add('box', '#3a2f26', 80.3, 1.5, -24, 2.2, 0.5, 1.6, 0, 0, 0, false);
    label("CHIDI'S WORKSHOP", bx - 6.4, 5.9, bz, 1.5);
    label('REPAIRS · PAINT · TOWING', bx - 6.4, 4.95, bz, 0.7, '#f0f0eb');
  };

  /** PLACEHOLDER bus shelter: back panel, roof, bench and a sign post. */
  const shelter = (st: BusStop) => {
    const { x, z } = st.shelter;
    const L = 5;
    const along = (dx: number, dz: number, sx: number, sz: number) => (st.alongX ? [x + dx, z + dz * st.back, sx, sz] : [x + dz * st.back, z + dx, sz, sx]);
    const [px, pz, psx, psz] = along(0, 0.9, L, 0.12);
    box('#3c6e8f', px, 1.3, pz, psx, 2.6, psz);
    const [rx, rz, rsx, rsz] = along(0, 0.1, L + 0.6, 2.2);
    b.add('box', '#2b2b2b', rx, 2.65, rz, rsx, 0.1, rsz);
    const [bx2, bz2, bsx, bsz] = along(0, 0.45, L - 1, 0.5);
    box(C.wood, bx2, 0.25, bz2, bsx, 0.5, bsz);
    const [sx, sz] = along(L / 2 + 0.6, -0.6, 0, 0);
    b.add('cyl', '#9a9da0', sx, 1.4, sz, 0.1, 2.8, 0.1);
    world.add(sx - 0.1, sx + 0.1, sz - 0.1, sz + 0.1, 2.8);
    label(`BUS STOP · ${st.name.toUpperCase()}`, sx, 3.2, sz, 0.8);
  };

  const XS: [number, number][] = [[-HALF, -126], [-114, -46], [-34, 34], [46, 114]];
  const ZS: [number, number][] = [[-HALF, -126], [-114, -46], [-34, 34], [46, 114], [126, HALF]];
  XS.forEach(([x0, x1], xi) =>
    ZS.forEach(([z0, z1], zi) => {
      if (xi === 1 && zi === 3) market(x0, z0, x1, z1);
      else if (xi === 2 && zi === 3) busPark(x0, z0, x1, z1);
      else if (xi === 2 && zi === 2) square(x0, z0, x1, z1);
      else if (xi === 3 && zi === 2) workshop(x0, z0, x1, z1);
      else plainBlock(x0, z0, x1, z1);
    }),
  );

  // --- Promenade, Old Ferry Bridge (fictional, closed for repairs) ---
  const px = (126 + SHORE) / 2;
  flat(C.pave, px, 0, SHORE - 126, 2 * HALF, 0.03);
  for (let z = -HALF + 8; z < HALF; z += 16) if (Math.abs(z - BRIDGE_Z) > 9) palm(px, z);
  for (let z = -HALF + 2; z < HALF; z += 4) if (Math.abs(z - BRIDGE_Z) > ROAD_W / 2) b.add('cyl', C.concrete, SHORE - 0.3, 0.55, z, 0.14, 1.1, 0.14, 0, 0, 0, false);
  label('HARBOUR ROAD', 120 - ROAD_W / 2 - 0.6, 3, -60, 1.2);
  const len = 80, bx = SHORE + len / 2;
  box(C.asphalt, bx, -0.1, BRIDGE_Z, len, 0.24, ROAD_W, false);
  box(C.concrete, bx, 0.5, BRIDGE_Z - ROAD_W / 2 - 0.2, len, 1, 0.4);
  box(C.concrete, bx, 0.5, BRIDGE_Z + ROAD_W / 2 + 0.2, len, 1, 0.4);
  for (let x = SHORE + 8; x < SHORE + len; x += 16) box(C.concrete, x, -2.6, BRIDGE_Z, 1.6, 4.8, 7, false);
  for (let z = -ROAD_W / 2 + 1; z < ROAD_W / 2; z += 2) box(Math.round(z / 2) % 2 ? C.red : C.white, SHORE + len - 3, 0.7, BRIDGE_Z + z, 0.8, 1.4, 2);
  label('BRIDGE CLOSED FOR REPAIRS', SHORE + len - 3.8, 2.4, BRIDGE_Z, 0.9, '#f0f0eb');
  label('OLD FERRY BRIDGE', SHORE + 3, 3.8, BRIDGE_Z, 1.1);

  // --- Bounds: invisible walls + visible barriers where roads leave the district ---
  const wall = (minX: number, maxX: number, minZ: number, maxZ: number) => world.add(minX, maxX, minZ, maxZ, 40);
  wall(-HALF - 1, -HALF, -HALF - 1, HALF + 1);
  wall(-HALF - 1, SHORE + 1, -HALF - 1, -HALF);
  wall(-HALF - 1, SHORE + 1, HALF, HALF + 1);
  wall(SHORE + 0.8, SHORE + 1.6, -HALF - 1, BRIDGE_Z - ROAD_W / 2);
  wall(SHORE + 0.8, SHORE + 1.6, BRIDGE_Z + ROAD_W / 2, HALF + 1);
  wall(SHORE, SHORE + len, BRIDGE_Z - ROAD_W / 2 - 0.8, BRIDGE_Z - ROAD_W / 2 - 0.2);
  wall(SHORE, SHORE + len, BRIDGE_Z + ROAD_W / 2 + 0.2, BRIDGE_Z + ROAD_W / 2 + 0.8);
  for (const l of ROAD_LINES) {
    for (const s of [-1, 1]) box(C.red, l, 0.6, s * (HALF - 0.8), ROAD_W, 1.2, 0.6);
    box(C.red, -HALF + 0.8, 0.6, l, 0.6, 1.2, ROAD_W);
  }

  for (const st of BUS_STOPS) shelter(st);

  const instances = b.build(scene);

  return {
    playerStart: { x: -30, z: -20, heading: Math.PI },
    carSpawn: { x: -37, z: -20, heading: Math.PI / 2 },
    danfoSpawn: { x: 25, z: 57, heading: -Math.PI / 2 },
    instances,
    residents: [
      { name: 'Mama Titi', voice: 'trader', x: -80, z: 63, shirt: '#c73e6c', headwrap: '#f2c14e' },
      { name: 'Aunty Bisi', voice: 'trader', x: -63, z: 94, shirt: '#1f9e6e', headwrap: '#7b4fb3' },
      { name: 'Iya Ronke', voice: 'trader', x: -48, z: 56, shirt: '#e2572b', headwrap: '#2d7dd2', tray: true },
      { name: 'Kunle', voice: 'driver', x: -12, z: 69, shirt: '#2d7dd2' },
      { name: 'Emeka', voice: 'driver', x: 16, z: 83, shirt: '#f0efe9' },
      { name: 'Baba Sule', voice: 'elder', x: 10, z: -12, shirt: '#e8e1cf' },
      { name: 'Tobi', voice: 'youth', x: 133, z: 12, shirt: '#3aa6a0' },
      { name: 'Ada', voice: 'youth', x: 60, z: -48, shirt: '#d98a1c' },
      { name: 'Chidi', voice: 'mechanic', x: 74, z: 8, shirt: '#3d4a5c' },
    ],
  };
}

function makeGroundTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9c5d3c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = ['rgba(80,35,18,.45)', 'rgba(190,120,80,.35)', 'rgba(60,50,40,.3)'][i % 3];
    const s = 1 + Math.random() * 2;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
