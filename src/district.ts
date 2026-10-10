import * as THREE from 'three';
import { Box2, CollisionWorld } from './collision';
import { addFacadeDetail } from './look';
import { Batcher, mat, rng, textSprite } from './placeholders';
import { RANGE } from './range';
import { gridGraph, RoadGraph } from './traffic';

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
/** Height of the invisible boundary walls (maps and landing checks skip boxes of exactly this height). */
export const BOUNDARY_H = 40;

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
  /** How far from home they wander (metres). Shopkeepers stay close. */
  wander?: number;
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

/** Harbour Bend General Hospital (fictional, Phase 4): where you wake up after going down. */
export const HOSPITAL = { name: 'Harbour Bend General Hospital', wake: { x: -54, z: -80, heading: 0 }, fee: 1000 };

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

/**
 * Lagoon Point Airfield (fictional, Phase 6): an island east of Marina Point, reached by the Lagoon
 * Point Causeway (Marina Boulevard, z = 40). Runway along x; apron, hangar, terminal, tower, helipad.
 */
export const AIRFIELD = {
  name: 'Lagoon Point Airfield',
  minX: 560, maxX: 1180, minZ: -110, maxZ: 110,
  runway: { x0: 600, x1: 1150, z: -30, w: 24 },
  pad: { x: 730, z: 45 },
  plane: { x: 628, z: -30, heading: 0 },
};
/** The jetty on Marina Point's west quay (Phase 6) where the speedboat moors. */
export const JETTY = { x0: 196, x1: 220, z0: -62.5, z1: -57.5, boat: { x: 203, z: -54.5, heading: Math.PI } };
export const CAUSEWAY = { x0: 360, x1: 560, z: 40 };

/** Open water for boats (and where planes ditch): the lagoon east of Harbour Bend, minus land. */
export function isWater(x: number, z: number): boolean {
  if (x <= SHORE + 0.9 || x > SHORE + 3200 || Math.abs(z) > 1600) return false;
  if (x >= MARINA.minX - 0.5 && x <= MARINA.maxX + 0.5 && z >= MARINA.minZ - 0.5 && z <= MARINA.maxZ + 0.5) return false;
  if (x >= AIRFIELD.minX - 0.5 && x <= AIRFIELD.maxX + 0.5 && z >= AIRFIELD.minZ - 0.5 && z <= AIRFIELD.maxZ + 0.5) return false;
  if (x >= JETTY.x0 - 0.5 && x <= JETTY.x1 && z >= JETTY.z0 - 0.5 && z <= JETTY.z1 + 0.5) return false;
  return true;
}

export interface DistrictInfo {
  playerStart: { x: number; z: number; heading: number };
  carSpawn: { x: number; z: number; heading: number };
  danfoSpawn: { x: number; z: number; heading: number };
  residents: ResidentDef[];
  instances: number;
  /** Where Dapo parks his car when he isn't racing. */
  rivalParking: { x: number; z: number; heading: number };
  /** Opens the Old Ferry Bridge to Marina Point (removes the barrier and its colliders). */
  openBridge(): void;
  /** Phase 6: rooftop helipads on two Marina Point towers (roof height y). */
  helipads: { x: number; z: number; y: number }[];
}

/**
 * Marina Point (Milestone 3): a fictional commercial island across the Old Ferry Bridge.
 * Roads: two north-south streets and three cross streets; Marina Boulevard (z = 40) carries
 * on from the bridge and has a planted median.
 */
export const MARINA = { minX: 220, maxX: 360, minZ: -140, maxZ: 160, X: [232, 312], Z: [-100, 40, 120] };

/** Junctions and road segments for AI traffic. The bridge link only exists once it is open. */
export function roadGraph(bridgeOpen: boolean): RoadGraph {
  const g = gridGraph(ROAD_LINES);
  const base = g.nodes.length;
  for (const x of MARINA.X) for (const z of MARINA.Z) g.nodes.push({ x, z });
  const m = (xi: number, zi: number) => base + xi * MARINA.Z.length + zi;
  for (let xi = 0; xi < MARINA.X.length; xi++) {
    for (let zi = 0; zi < MARINA.Z.length; zi++) {
      if (zi < MARINA.Z.length - 1) g.edges.push([m(xi, zi), m(xi, zi + 1)]);
      if (xi < MARINA.X.length - 1) g.edges.push([m(xi, zi), m(xi + 1, zi)]);
    }
  }
  if (bridgeOpen) {
    const west = g.nodes.findIndex((n) => n.x === ROAD_LINES[ROAD_LINES.length - 1] && n.z === BRIDGE_Z);
    g.edges.push([west, m(0, MARINA.Z.indexOf(BRIDGE_Z))]);
  }
  return g;
}

export function buildDistrict(scene: THREE.Scene, world: CollisionWorld): DistrictInfo {
  const b = new Batcher();
  /** Building walls: their own batch with window detail drawn by the facade shader. */
  const walls = new Batcher(() => addFacadeDetail(new THREE.MeshStandardMaterial({ roughness: 0.9 })));
  const wallBox = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    walls.add('box', color, x, y, z, sx, sy, sz);
    world.add(x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2, y + sy / 2);
  };
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

  const water = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshStandardMaterial({ color: '#1f5966', roughness: 0.18, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(SHORE + 1600, -2, 0);
  scene.add(water);
  box(C.concrete, SHORE + 0.4, -1, 0, 0.8, 2.2, 2 * HALF, false);
  for (let i = 0; i < 18; i++) {
    const h = range(25, 90);
    const w = range(12, 26);
    box('#6f7c86', 1480 + range(-20, 20), h / 2 - 2, (-HALF + i * 24) * 1.8, w, h, w, false); // distant skyline across the lagoon
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
    wallBox(pick(WALLS), cx, h / 2, cz, w, h, d);
    // Parapet round the roof edge (windows come from the facade shader).
    if (floors > 2) for (const [px, pz, psx, psz] of [[cx, cz - d / 2 + 0.15, w, 0.3], [cx, cz + d / 2 - 0.15, w, 0.3], [cx - w / 2 + 0.15, cz, 0.3, d], [cx + w / 2 - 0.15, cz, 0.3, d]]) b.add('box', '#cfc8b8', px, h + 0.45, pz, psx, 0.9, psz, 0, 0, 0, false);

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
    // Ngozi's Tailoring (Milestone 3): kiosk on the market's far side, open towards the stalls
    box('#e9cfc0', -75, 1.5, 109.5, 10, 3, 5);
    b.add('box', '#8e44ad', -75, 3.05, 106.3, 10.4, 0.1, 1.6, 0, 0, 0, false);
    b.add('box', '#c79a5b', -75, 0.5, 106.8, 6, 1, 0.6, 0, 0, 0, false);
    label("NGOZI'S TAILORING", -75, 3.75, 106.2, 0.7, '#ffffff');
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

  /**
   * Harbour Bend Range (fictional, Phase 4): open-air range shooting west. Rail along the firing line,
   * berm at the back, side walls, a canopy over the booth and Sade's arms counter. PLACEHOLDER art.
   */
  const shootingRange = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    sidewalkRing(minX, minZ, maxX, maxZ);
    const cz = (minZ + maxZ) / 2, wallZ = maxZ - 6, line = RANGE.lineX;
    flat('#8a7f6a', (minX + line) / 2, cz, line - minX - 7, 2 * wallZ, 0.035);
    flat('#8d8a82', (line + maxX - 4) / 2, cz, maxX - 4 - line, 2 * wallZ, 0.036);
    box('#7a6a4f', minX + 5.5, 3, cz, 3, 6, 2 * wallZ); // berm
    for (const s of [-1, 1]) box('#cfc6b0', (minX + 4 + maxX - 4) / 2, 1.75, cz + s * wallZ, maxX - minX - 8, 3.5, 0.6);
    box('#d9b23a', line - 0.15, 0.45, cz, 0.25, 0.9, 2 * wallZ - 0.6); // firing-line rail
    for (const z of RANGE.lanes) {
      flat(C.white, (minX + line) / 2, z, line - minX - 10, 0.12, 0.04);
      label(`LANE ${RANGE.lanes.indexOf(z) + 1}`, line - 0.4, 0.6, z + 2.2, 0.35, '#f0f0eb');
    }
    for (const s of [-1, 1]) {
      for (const x of [line + 0.4, maxX - 4.6]) box(C.concrete, x, 1.9, cz + s * (wallZ - 0.8), 0.3, 3.8, 0.3);
    }
    b.add('box', C.zincAlu, (line + maxX - 4) / 2, 3.9, cz, maxX - 4 - line + 1, 0.12, 2 * wallZ);
    // Arms counter (north-east corner): Sade stands behind it.
    box('#5d4a3a', -54, 0.55, -24.6, 6, 1.1, 1.0);
    box('#d9c7a8', -54, 1.6, -27.1, 7, 3.2, 1.0);
    b.add('box', '#c0392b', -54, 3.4, -25.2, 7.2, 0.12, 3, 0, 0, 0, false);
    label('ARMS COUNTER', -54, 2.9, -24.0, 0.55, '#ffffff');
    label('HARBOUR BEND RANGE', maxX - 3, 5, cz, 1.3);
    label('Fictional · placeholder', maxX - 3, 4.1, cz, 0.45, '#f0f0eb');
  };

  /** Harbour Bend General Hospital (fictional): PLACEHOLDER block with an entrance canopy facing the road. */
  const hospital = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    sidewalkRing(minX, minZ, maxX, maxZ);
    const cz = (minZ + maxZ) / 2;
    flat('#8d8a82', maxX - 10, cz, 13, maxZ - minZ - 7, 0.035);
    box('#eef0ee', minX + 30, 7, cz, 44, 14, 50);
    for (let f = 0; f < 4; f++) b.add('box', C.glass, minX + 30, f * 3.4 + 2, cz, 44.06, 1.2, 50.06, 0, 0, 0, false);
    b.add('box', '#2e86c1', minX + 52.1, 10.5, cz, 0.2, 3, 3, 0, 0, 0, false);
    label('H', minX + 52.4, 10.5, cz, 2.6, '#ffffff');
    for (const s of [-1, 1]) box(C.concrete, maxX - 9, 1.7, cz + s * 5, 0.35, 3.4, 0.35);
    b.add('box', '#d9dde0', maxX - 11.5, 3.45, cz, 6, 0.15, 11);
    label('HARBOUR BEND GENERAL HOSPITAL', maxX - 12, 5.4, cz, 0.9);
    label('Fictional · placeholder', maxX - 12, 4.5, cz, 0.45, '#f0f0eb');
  };

  const XS: [number, number][] = [[-HALF, -126], [-114, -46], [-34, 34], [46, 114]];
  const ZS: [number, number][] = [[-HALF, -126], [-114, -46], [-34, 34], [46, 114], [126, HALF]];
  XS.forEach(([x0, x1], xi) =>
    ZS.forEach(([z0, z1], zi) => {
      if (xi === 1 && zi === 3) market(x0, z0, x1, z1);
      else if (xi === 1 && zi === 2) shootingRange(x0, z0, x1, z1);
      else if (xi === 1 && zi === 1) hospital(x0, z0, x1, z1);
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
  // Barrier at the far end: separate meshes and colliders so it can be removed when the bridge opens.
  const gate = new THREE.Group();
  const gateBoxes: Box2[] = [];
  for (let z = -ROAD_W / 2 + 1; z < ROAD_W / 2; z += 2) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 2), mat(Math.round(z / 2) % 2 ? C.red : C.white));
    m.position.set(SHORE + len - 3, 0.7, BRIDGE_Z + z);
    m.castShadow = true;
    gate.add(m);
    gateBoxes.push(world.add(SHORE + len - 3.4, SHORE + len - 2.6, BRIDGE_Z + z - 1, BRIDGE_Z + z + 1, 1.4));
  }
  const closedSign = textSprite('BRIDGE CLOSED FOR REPAIRS', '#f0f0eb', 0.9);
  closedSign.position.set(SHORE + len - 3.8, 2.4, BRIDGE_Z);
  gate.add(closedSign);
  scene.add(gate);
  const openBridge = () => {
    gate.visible = false;
    for (const g of gateBoxes) g.off = true;
  };
  label('OLD FERRY BRIDGE', SHORE + 3, 3.8, BRIDGE_Z, 1.1);

  // --- Marina Point (Milestone 3): PLACEHOLDER commercial island across the bridge ---
  const mp = MARINA;
  const mground = new THREE.Mesh(new THREE.PlaneGeometry(mp.maxX - mp.minX, mp.maxZ - mp.minZ), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  mground.rotation.x = -Math.PI / 2;
  mground.position.set((mp.minX + mp.maxX) / 2, 0, (mp.minZ + mp.maxZ) / 2);
  mground.receiveShadow = true;
  scene.add(mground);
  const mcz = (mp.minZ + mp.maxZ) / 2;
  for (const x of mp.X) flat(C.asphalt, x, mcz, ROAD_W, mp.maxZ - mp.minZ, 0.02);
  for (const z of mp.Z) {
    const x0 = z === BRIDGE_Z ? mp.minX : mp.X[0] - ROAD_W / 2;
    flat(C.asphalt, (x0 + mp.maxX) / 2, z, mp.maxX - x0, ROAD_W, 0.025);
  }
  const nearM = (v: number, lines: number[]) => lines.some((l) => Math.abs(v - l) < ROAD_W / 2 + 2);
  for (const x of mp.X) for (let z = mp.minZ + 4.5; z < mp.maxZ; z += 9) if (!nearM(z, mp.Z)) flat(C.yellow, x, z, 0.14, 4.2, 0.035);
  for (const z of mp.Z) if (z !== BRIDGE_Z) for (let x = mp.X[0] + 4.5; x < mp.maxX; x += 9) if (!nearM(x, mp.X)) flat(C.yellow, x, z, 4.2, 0.14, 0.04);
  for (const x of mp.X) {
    for (const z of mp.Z) {
      for (const sd of [-1, 1]) {
        const off = ROAD_W / 2 + 2.8;
        for (let i = -4; i <= 4; i++) {
          flat(C.white, x + i * 1.25, z + sd * off, 0.65, 3.8, 0.04);
          flat(C.white, x + sd * off, z + i * 1.25, 3.8, 0.65, 0.045);
        }
      }
    }
  }
  // Marina Boulevard: planted median between junctions (cars can only cross at junctions)
  for (const [a, c] of [[mp.X[0] + 14, mp.X[1] - 14], [mp.X[1] + 14, mp.maxX - 4]]) {
    box('#b9b2a2', (a + c) / 2, 0.15, BRIDGE_Z, c - a, 0.3, 1.4);
    b.add('box', '#4a7232', (a + c) / 2, 0.32, BRIDGE_Z, c - a - 0.4, 0.06, 1.0, 0, 0, 0, false);
    for (let x = a + 4; x < c - 2; x += 10) palm(x, BRIDGE_Z);
  }
  // Waterfront promenade (west) and quay (east)
  flat(C.pave, mp.minX + 3, mcz, 6, mp.maxZ - mp.minZ, 0.03);
  flat(C.pave, mp.maxX - 2, mcz, 4, mp.maxZ - mp.minZ, 0.03);
  for (let z = mp.minZ + 8; z < mp.maxZ; z += 16) if (Math.abs(z - BRIDGE_Z) > 9) palm(mp.minX + 3, z);
  for (let z = mp.minZ + 2; z < mp.maxZ; z += 4) {
    if (Math.abs(z - BRIDGE_Z) > ROAD_W / 2) b.add('cyl', C.concrete, mp.minX + 0.3, 0.55, z, 0.14, 1.1, 0.14, 0, 0, 0, false);
    b.add('cyl', C.concrete, mp.maxX - 0.3, 0.55, z, 0.14, 1.1, 0.14, 0, 0, 0, false);
  }
  box(C.concrete, mp.minX - 0.4, -1, mcz, 0.8, 2.2, mp.maxZ - mp.minZ, false);
  box(C.concrete, mp.maxX + 0.4, -1, mcz, 0.8, 2.2, mp.maxZ - mp.minZ, false);
  label('WELCOME TO MARINA POINT', mp.minX + 4, 6.2, BRIDGE_Z, 1.3);

  /** Glass towers filling a block (PLACEHOLDER offices and flats). */
  const tower = (x0: number, z0: number, x1: number, z1: number, minF: number, maxF: number) => {
    const floors = minF + Math.floor(rand() * (maxF - minF + 1));
    const h = floors * FLOOR + 0.4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    wallBox(pick(['#d9dde0', '#c9d3d6', '#e6e1d6', '#b8c4c9']), cx, h / 2, cz, w, h, d);
    for (let f = 0; f < floors; f++) pick([0, 1]); // keeps the district's random layout unchanged (glass bands replaced by the facade shader)
    b.add('box', '#9aa0a6', cx, h + 0.6, cz, w * 0.4, 1.2, d * 0.4);
    return { cx, cz, h, w };
  };
  const helipads: { x: number; z: number; y: number }[] = [];
  const towerBlock = (x0: number, z0: number, x1: number, z1: number, minF: number, maxF: number) => {
    sidewalkRing(x0, z0, x1, z1);
    const i = 4.2;
    if (x1 - x0 > 46) {
      const mid = (x0 + x1) / 2;
      tower(x0 + i, z0 + i, mid - 2, z1 - i, minF, maxF);
      tower(mid + 2, z0 + i, x1 - i, z1 - i, minF, maxF);
    } else tower(x0 + i, z0 + i, x1 - i, z1 - i, minF, maxF);
  };
  const offices = (x0: number, z0: number, x1: number, z1: number) => {
    sidewalkRing(x0, z0, x1, z1);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    flat(C.pave, cx, cz, x1 - x0 - 7, z1 - z0 - 7, 0.035);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tx = cx + sx * 18, tz = cz + sz * 36;
      const t = tower(tx - 11, tz - 13, tx + 11, tz + 13, 10, 18);
      if (helipads.length < 2) {
        // Rooftop helipad beside the plant room (Phase 6)
        const px = t.cx + sx * t.w * 0.3;
        helipads.push({ x: px, z: t.cz, y: t.h });
        b.add('cyl', '#3a3d40', px, t.h + 0.03, t.cz, 7, 0.06, 7, 0, 0, 0, false);
        b.add('cyl', '#f5c518', px, t.h + 0.05, t.cz, 6.2, 0.04, 6.2, 0, 0, 0, false);
        b.add('cyl', '#3a3d40', px, t.h + 0.07, t.cz, 5.6, 0.04, 5.6, 0, 0, 0, false);
        for (const dz of [-1, 1]) b.add('box', '#f0f0eb', px, t.h + 0.09, t.cz + dz * 0.9, 2.4, 0.02, 0.35, 0, 0, 0, false);
        b.add('box', '#f0f0eb', px, t.h + 0.09, t.cz, 0.35, 0.02, 1.8, 0, 0, 0, false);
      }
    }
    box(C.concrete, cx, 0.4, cz, 6, 0.8, 6);
    b.add('cyl', '#5d8fc4', cx, 0.85, cz, 4.6, 0.1, 4.6, 0, 0, 0, false); // fountain pool
    label('MARINA POINT TOWERS', cx, 4.5, cz + 5, 1.1);
  };
  const shopStrip = (x0: number, z0: number, x1: number, z1: number) => {
    sidewalkRing(x0, z0, x1, z1);
    // Roadside kiosks facing the boulevard (PLACEHOLDER)
    const names = ['PHONE ACCESSORIES', 'PROVISIONS', 'BARBING SALON', 'PRINTING'];
    names.forEach((n, k) => {
      const kx = x0 + 9 + k * 9;
      const colour = BRIGHT[(k * 3) % BRIGHT.length];
      box(pick(WALLS), kx, 1.5, z0 + 9, 7, 3, 6);
      b.add('box', colour, kx, 3.05, z0 + 5.4, 7.4, 0.1, 1.8, 0, 0, 0, false);
      b.add('box', '#7e8285', kx, 1.2, z0 + 5.95, 5, 2.2, 0.08, 0, 0, 0, false);
      label(n, kx, 3.7, z0 + 5.6, 0.55, '#f0f0eb');
    });
    // Marina Threads boutique: glass front
    const bx2 = x1 - 14;
    box('#efe9dc', bx2, 2.4, z0 + 11, 20, 4.8, 10);
    b.add('box', '#9fd3e6', bx2, 1.8, z0 + 5.95, 17, 3, 0.1, 0, 0, 0, false);
    b.add('box', '#5b2a86', bx2, 4.2, z0 + 5.9, 20, 0.8, 0.2, 0, 0, 0, false);
    label('MARINA THREADS', bx2, 4.25, z0 + 5.6, 0.75, '#ffffff');
    // Flats behind
    building(x0 + 4.2, z1 - 26, x0 + 30, z1 - 4.2, [0, 1]);
    building(x0 + 34, z1 - 26, x1 - 4.2, z1 - 4.2, [0, 1]);
  };
  const fuelStation = (x0: number, z0: number, x1: number, z1: number) => {
    sidewalkRing(x0, z0, x1, z1);
    flat('#8d8a82', (x0 + x1) / 2, z1 - 17, x1 - x0 - 7, 27, 0.035);
    for (const px2 of [x0 + 6, x1 - 6]) for (const pz of [z1 - 26, z1 - 8]) box(C.white, px2, 2.75, pz, 0.4, 5.5, 0.4);
    b.add('box', '#1f6b8b', (x0 + x1) / 2, 5.6, z1 - 17, x1 - x0 - 8, 0.5, 21);
    b.add('box', '#f2c21a', (x0 + x1) / 2, 5.6, z1 - 6.4, x1 - x0 - 8, 0.52, 0.1, 0, 0, 0, false);
    for (const ix of [x0 + 14, x0 + 26]) {
      box(C.concrete, ix, 0.15, z1 - 17, 1.4, 0.3, 6);
      for (const pz of [-1.6, 1.6]) box('#e9e8e2', ix, 0.9, z1 - 17 + pz, 0.8, 1.5, 0.6);
    }
    box('#e6e1d6', (x0 + x1) / 2 + 4, 1.8, z1 - 46, 22, 3.6, 12);
    label('LAGOON FUEL', (x0 + x1) / 2, 6.6, z1 - 6.2, 1.2);
    label('Fictional brand · placeholder', (x0 + x1) / 2, 5.0, z1 - 6.2, 0.45, '#f0f0eb');
    tower(x0 + 4.2, z0 + 4.2, x1 - 4.2, z0 + 40, 2, 4);
  };
  const gardens = (x0: number, z0: number, x1: number, z1: number) => {
    sidewalkRing(x0, z0, x1, z1);
    flat('#4a7232', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 - 7, z1 - z0 - 7, 0.035);
    for (let x = x0 + 9; x < x1 - 4; x += 13) for (let z = z0 + 20; z < z1 - 4; z += 15) palm(x, z);
    for (const z of [z0 + 30, z0 + 50]) box(C.wood, x1 - 8, 0.25, z, 0.7, 0.45, 4);
    box('#c0392b', x0 + 30, 1.3, z1 - 10, 4, 2.6, 3); // grill kiosk
    label('MARINA GARDENS', (x0 + x1) / 2, 4, z0 + 4, 1.0);
  };
  const MXS: [number, number][] = [[mp.X[0] + ROAD_W / 2, mp.X[1] - ROAD_W / 2], [mp.X[1] + ROAD_W / 2, mp.maxX - 4]];
  const MZS: [number, number][] = [[mp.minZ, mp.Z[0] - ROAD_W / 2], [mp.Z[0] + ROAD_W / 2, mp.Z[1] - ROAD_W / 2], [mp.Z[1] + ROAD_W / 2, mp.Z[2] - ROAD_W / 2], [mp.Z[2] + ROAD_W / 2, mp.maxZ]];
  MXS.forEach(([x0, x1], xi) =>
    MZS.forEach(([z0, z1], zi) => {
      if (xi === 0 && zi === 1) offices(x0, z0, x1, z1);
      else if (xi === 0 && zi === 2) shopStrip(x0, z0, x1, z1);
      else if (xi === 1 && zi === 1) fuelStation(x0, z0, x1, z1);
      else if (xi === 1 && zi === 2) gardens(x0, z0, x1, z1);
      else towerBlock(x0, z0, x1, z1, 3, 9);
    }),
  );

  // --- Bounds: invisible walls + visible barriers where roads leave the district ---
  const wall = (minX: number, maxX: number, minZ: number, maxZ: number) => world.add(minX, maxX, minZ, maxZ, BOUNDARY_H);
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
  // Marina Point: sea walls (gap for the bridge), and barriers where its roads end
  wall(mp.minX - 0.8, mp.minX, mp.minZ - 1, JETTY.z0);
  wall(mp.minX - 0.8, mp.minX, JETTY.z1, BRIDGE_Z - ROAD_W / 2);
  wall(mp.minX - 0.8, mp.minX, BRIDGE_Z + ROAD_W / 2, mp.maxZ + 1);
  wall(mp.maxX, mp.maxX + 1, mp.minZ - 1, CAUSEWAY.z - ROAD_W / 2);
  wall(mp.maxX, mp.maxX + 1, CAUSEWAY.z + ROAD_W / 2, mp.maxZ + 1);
  wall(mp.minX - 1, mp.maxX + 1, mp.minZ - 1, mp.minZ);
  wall(mp.minX - 1, mp.maxX + 1, mp.maxZ, mp.maxZ + 1);
  for (const x of mp.X) for (const z of [mp.minZ + 0.8, mp.maxZ - 0.8]) box(C.red, x, 0.6, z, ROAD_W, 1.2, 0.6);
  for (const z of mp.Z) if (z !== CAUSEWAY.z) box(C.red, mp.maxX - 0.8, 0.6, z, 0.6, 1.2, ROAD_W);

  // --- Phase 6: the jetty on Marina Point's west quay (PLACEHOLDER timber deck with rails)
  flat(C.wood, (JETTY.x0 + JETTY.x1) / 2, (JETTY.z0 + JETTY.z1) / 2, JETTY.x1 - JETTY.x0, JETTY.z1 - JETTY.z0, 0.06);
  for (let x = JETTY.x0 + 1; x < JETTY.x1; x += 3) for (const z of [JETTY.z0, JETTY.z1]) b.add('cyl', C.wood, x, -0.9, z, 0.3, 2.2, 0.3);
  wall(JETTY.x0, JETTY.x1, JETTY.z0 - 0.3, JETTY.z0);
  wall(JETTY.x0, JETTY.x1, JETTY.z1, JETTY.z1 + 0.3);
  wall(JETTY.x0 - 0.4, JETTY.x0, JETTY.z0, JETTY.z1);
  for (const z of [JETTY.z0 - 0.15, JETTY.z1 + 0.15]) b.add('box', C.wood, (JETTY.x0 + JETTY.x1) / 2, 0.55, z, JETTY.x1 - JETTY.x0, 0.12, 0.12, 0, 0, 0, false);
  label('MARINA JETTY', JETTY.x0 + 2, 2.2, (JETTY.z0 + JETTY.z1) / 2, 0.7);

  // --- Phase 6: Lagoon Point Causeway (Marina Boulevard to the airfield)
  {
    const cl = CAUSEWAY.x1 - CAUSEWAY.x0, cx = (CAUSEWAY.x0 + CAUSEWAY.x1) / 2, cz = CAUSEWAY.z;
    box(C.asphalt, cx, -0.1, cz, cl, 0.24, ROAD_W, false);
    for (let x = CAUSEWAY.x0 + 4.5; x < CAUSEWAY.x1; x += 9) flat(C.yellow, x, cz, 4.2, 0.14, 0.04);
    for (const sd of [-1, 1]) {
      box(C.concrete, cx, 0.5, cz + sd * (ROAD_W / 2 + 0.2), cl, 1, 0.4);
      wall(CAUSEWAY.x0, CAUSEWAY.x1, cz + sd * (ROAD_W / 2 + 0.2) - 0.3, cz + sd * (ROAD_W / 2 + 0.2) + 0.3);
    }
    for (let x = CAUSEWAY.x0 + 10; x < CAUSEWAY.x1; x += 20) box(C.concrete, x, -2.6, cz, 1.6, 4.8, 7, false);
    label('LAGOON POINT CAUSEWAY', CAUSEWAY.x0 + 6, 3.8, cz, 1.0);
  }

  // --- Phase 6: Lagoon Point Airfield (fictional): island, runway, apron, hangar, terminal, tower, helipad
  {
    const A = AIRFIELD;
    const ax = (A.minX + A.maxX) / 2, az = (A.minZ + A.maxZ) / 2;
    const ag = new THREE.Mesh(new THREE.PlaneGeometry(A.maxX - A.minX, A.maxZ - A.minZ), new THREE.MeshStandardMaterial({ color: '#6f8a4a', roughness: 1 }));
    ag.rotation.x = -Math.PI / 2;
    ag.position.set(ax, 0, az);
    ag.receiveShadow = true;
    scene.add(ag);
    const R = A.runway;
    flat(C.asphalt, (R.x0 + R.x1) / 2, R.z, R.x1 - R.x0, R.w, 0.03);
    for (let x = R.x0 + 30; x < R.x1 - 20; x += 24) flat(C.white, x, R.z, 12, 0.5, 0.04); // centre line
    for (const x of [R.x0 + 6, R.x1 - 6]) for (let k = -4; k <= 4; k++) if (k) flat(C.white, x, R.z + k * 2.4, 9, 1.0, 0.045); // thresholds
    flat(C.asphalt, ax - 210, 40, 360, ROAD_W, 0.025); // road from the causeway
    flat(C.concrete, 690, 45, 180, 50, 0.028); // apron
    flat(C.asphalt, 610, 5, 14, 60, 0.03); // taxiway to the runway
    // Hangar, terminal and tower (placeholder buildings)
    wallBox('#b7b1a3', 640, 5, 88, 46, 10, 30);
    b.add('box', C.zincAlu, 640, 10.3, 88, 47, 0.3, 31);
    box('#7e8285', 640, 3.5, 72.9, 30, 7, 0.2, false); // hangar door
    wallBox('#e6e1d6', 715, 4, 92, 56, 8, 20);
    label(A.name.toUpperCase(), 715, 9.5, 81.5, 1.2);
    label('Fictional · placeholder', 715, 8.4, 81.5, 0.45, '#f0f0eb');
    b.add('cyl', '#d9dde0', 770, 9, 88, 6, 18, 6);
    world.add(767, 773, 85, 91, 18);
    b.add('cyl', C.glass, 770, 19.5, 88, 8, 3, 8);
    b.add('cyl', '#9aa0a6', 770, 21.2, 88, 8.6, 0.4, 8.6);
    // Helipad
    const P = A.pad;
    b.add('cyl', '#3a3d40', P.x, 0.04, P.z, 14, 0.06, 14, 0, 0, 0, false);
    b.add('cyl', '#f5c518', P.x, 0.06, P.z, 12.4, 0.04, 12.4, 0, 0, 0, false);
    b.add('cyl', '#3a3d40', P.x, 0.08, P.z, 11.4, 0.04, 11.4, 0, 0, 0, false);
    for (const dz of [-1.8, 1.8]) b.add('box', '#f0f0eb', P.x, 0.1, P.z + dz, 4.8, 0.02, 0.7, 0, 0, 0, false);
    b.add('box', '#f0f0eb', P.x, 0.1, P.z, 0.7, 0.02, 3.6, 0, 0, 0, false);
    // Edge: sea walls with a gap for the causeway, windsock post
    wall(A.minX - 0.8, A.minX, A.minZ, CAUSEWAY.z - ROAD_W / 2);
    wall(A.minX - 0.8, A.minX, CAUSEWAY.z + ROAD_W / 2, A.maxZ);
    wall(A.maxX, A.maxX + 0.8, A.minZ, A.maxZ);
    wall(A.minX, A.maxX, A.minZ - 0.8, A.minZ);
    wall(A.minX, A.maxX, A.maxZ, A.maxZ + 0.8);
    box(C.concrete, A.minX - 0.4, -1, az, 0.8, 2.2, A.maxZ - A.minZ, false);
    b.add('cyl', '#9a9da0', 800, 3, -60, 0.15, 6, 0.15);
    b.add('cyl', '#e67e22', 800.9, 5.6, -60, 0.5, 1.8, 0.5, 0, 0, Math.PI / 2);
  }

  for (const st of BUS_STOPS) shelter(st);

  // Street lamps along Harbour Bend's roads (PLACEHOLDER: round poles with an arm and a lamp head).
  const lamp = (x: number, z: number, dx: number, dz: number) => {
    b.add('cyl', '#5b6066', x, 3.6, z, 0.14, 7.2, 0.14);
    b.add('cyl', '#5b6066', x + dx * 0.9, 7.15, z + dz * 0.9, 0.08, 1.9, 0.08, dz !== 0 ? Math.PI / 2 : 0, 0, dx !== 0 ? Math.PI / 2 : 0);
    b.add('sph', '#f3ecd8', x + dx * 1.8, 7.0, z + dz * 1.8, 0.45, 0.18, 0.3, 0, 0, 0, false);
    world.add(x - 0.1, x + 0.1, z - 0.1, z + 0.1, 7.2);
  };
  const clearOfJunctions = (v: number) => !ROAD_LINES.some((l) => Math.abs(v - l) < ROAD_W / 2 + 8);
  for (const x of ROAD_LINES) {
    for (let z = -HALF + 15; z < HALF - 10; z += 32) {
      if (!clearOfJunctions(z)) continue;
      lamp(x - ROAD_W / 2 - 1.3, z, 1, 0);
      lamp(x + ROAD_W / 2 + 1.3, z + 16, -1, 0);
    }
  }
  for (const z of ROAD_LINES) {
    for (let x = -HALF + 15; x < SHORE - 18; x += 32) {
      if (!clearOfJunctions(x) || (z === BRIDGE_Z && x > 110)) continue;
      lamp(x, z - ROAD_W / 2 - 1.3, 0, 1);
      lamp(x + 16, z + ROAD_W / 2 + 1.3, 0, -1);
    }
  }

  const instances = b.build(scene) + walls.build(scene);

  return {
    playerStart: { x: -30, z: -20, heading: Math.PI },
    carSpawn: { x: -31.5, z: -14, heading: Math.PI / 2 }, // on the square's paving, clear of the traffic lane
    danfoSpawn: { x: 25, z: 57, heading: -Math.PI / 2 },
    instances,
    rivalParking: { x: 330, z: 60, heading: 0 },
    openBridge,
    helipads,
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
      { name: 'Ngozi', voice: 'tailor', x: -75, z: 103.6, shirt: '#8e44ad', headwrap: '#f1c40f', wander: 2 },
      // Harbour Bend Range (Phase 4)
      { name: 'Coach Kola', voice: 'range', x: -53, z: 7, shirt: '#e67e22', wander: 2 },
      { name: 'Sade', voice: 'armourer', x: -54, z: -25.9, shirt: '#2b2d31', headwrap: '#c0392b', wander: 0.4 },
      // Marina Point
      { name: 'Mr Femi', voice: 'attendant', x: 326, z: 30, shirt: '#1f6b8b', wander: 3 },
      { name: 'Funmi', voice: 'tailor', x: 292, z: 49.5, shirt: '#5b2a86', headwrap: '#e8e1cf', wander: 3 },
      { name: 'Dapo', voice: 'rival', x: 324, z: 53, shirt: '#2a2d33', wander: 3 },
      { name: 'Tunde', voice: 'office', x: 272, z: -42, shirt: '#e9e8e2' },
      { name: 'Kemi', voice: 'youth', x: 340, z: 92, shirt: '#e67e22' },
      // Phase 6: the airfield and the jetty
      { name: 'Captain Ade', voice: 'pilot', x: 705, z: 52, shirt: '#f0efe9', wander: 3 },
      { name: 'Ebi', voice: 'boatman', x: 224, z: -67, shirt: '#16a085', wander: 2 },
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
