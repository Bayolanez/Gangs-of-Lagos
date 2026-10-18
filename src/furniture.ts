import * as THREE from 'three';
import { mat } from './placeholders';

/**
 * Furniture and fittings for the Crews buildings, built in code: rounded edges, frames, handles and
 * canvas textures (wood grain, tiles, fabric, posters) instead of plain boxes. Every piece is original.
 * Builders return a group at the origin: +X is the piece's right, -Z its back, +Z its front, y up.
 */

// ---------- Shared shapes ----------
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 18);
const SPH = new THREE.SphereGeometry(1, 16, 12);
const CAP = new THREE.CapsuleGeometry(0.5, 1, 6, 12);
const TOR = new THREE.TorusGeometry(1, 0.12, 8, 24);

type V3 = [number, number, number];
function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: V3, scale: V3, rot: V3 = [0, 0, 0], shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...pos);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rot);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
const box = (g: THREE.Object3D, m: THREE.Material, pos: V3, size: V3, rot?: V3) => add(g, BOX, m, pos, size, rot);
const cyl = (g: THREE.Object3D, m: THREE.Material, pos: V3, r: number, h: number, rot?: V3) => add(g, CYL, m, pos, [r, h, r], rot);

// ---------- Canvas textures ----------
const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const k = `${key}|${repeat}`;
  let t = texCache.get(k);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  texCache.set(k, t);
  return t;
}
/** Seeded noise so textures look the same every run. */
function rnd(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Warm wooden floorboards. */
export function woodFloor(repeat: [number, number]): THREE.MeshStandardMaterial {
  const map = canvasTex('wood', 256, 256, (x) => {
    const r = rnd(7);
    for (let i = 0; i < 8; i++) {
      const base = 120 + Math.floor(r() * 30);
      x.fillStyle = `rgb(${base + 30}, ${base - 10}, ${base - 50})`;
      x.fillRect(0, i * 32, 256, 32);
      for (let k = 0; k < 14; k++) {
        x.strokeStyle = `rgba(70, 40, 20, ${0.08 + r() * 0.12})`;
        x.beginPath();
        const y = i * 32 + r() * 32;
        x.moveTo(0, y);
        x.bezierCurveTo(80, y + r() * 6 - 3, 170, y + r() * 6 - 3, 256, y);
        x.stroke();
      }
      x.fillStyle = 'rgba(40, 22, 10, 0.55)';
      x.fillRect(0, i * 32, 256, 2);
      x.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
    }
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.55 });
}

/** Square tiles with grout. */
export function tiles(a: string, b: string, repeat: [number, number]): THREE.MeshStandardMaterial {
  const map = canvasTex(`tiles-${a}-${b}`, 128, 128, (x) => {
    x.fillStyle = '#c8ccd0';
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      x.fillStyle = (i + j) % 2 ? a : b;
      x.fillRect(i * 32 + 1.5, j * 32 + 1.5, 29, 29);
    }
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.25 });
}

/** Ribbed rubber gym flooring. */
export function rubber(repeat: [number, number]): THREE.MeshStandardMaterial {
  const map = canvasTex('rubber', 128, 128, (x) => {
    x.fillStyle = '#2b2d31';
    x.fillRect(0, 0, 128, 128);
    const r = rnd(3);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(${r() < 0.5 ? 255 : 0}, ${r() < 0.5 ? 255 : 0}, 255, 0.05)`;
      x.fillRect(r() * 128, r() * 128, 2, 2);
    }
    x.strokeStyle = 'rgba(0,0,0,0.5)';
    x.strokeRect(0.5, 0.5, 127, 127);
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
}

/** Painted plaster with a little texture. */
export function plaster(colour: string, repeat: [number, number] = [4, 1]): THREE.MeshStandardMaterial {
  const map = canvasTex(`plaster-${colour}`, 128, 128, (x) => {
    x.fillStyle = colour;
    x.fillRect(0, 0, 128, 128);
    const r = rnd(11);
    for (let i = 0; i < 1400; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      x.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 2);
    }
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
}

/** A woven rug: stripes in the crew's colour. */
export function rugMaterial(colour: string): THREE.MeshStandardMaterial {
  const map = canvasTex(`rug-${colour}`, 128, 96, (x) => {
    x.fillStyle = '#efe6d2';
    x.fillRect(0, 0, 128, 96);
    x.fillStyle = colour;
    for (const y of [8, 40, 72]) x.fillRect(0, y, 128, 14);
    x.fillStyle = '#2a2622';
    for (let i = 0; i < 128; i += 8) {
      x.fillRect(i, 26, 4, 4);
      x.fillRect(i + 4, 60, 4, 4);
    }
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 1 });
}

/** A framed poster: bold shapes in a colour (original art, no text). */
export function posterMaterial(colour: string, seed: number): THREE.MeshStandardMaterial {
  const map = canvasTex(`poster-${colour}-${seed}`, 96, 128, (x) => {
    const r = rnd(seed + 5);
    x.fillStyle = '#1b1233';
    x.fillRect(0, 0, 96, 128);
    x.fillStyle = colour;
    x.beginPath();
    x.arc(48, 52, 30, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#ffb43c';
    for (let i = 0; i < 6; i++) x.fillRect(8 + r() * 70, 90 + i * 5, 10 + r() * 30, 3);
    x.strokeStyle = '#fbefe2';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(10, 118);
    x.lineTo(86, 118);
    x.stroke();
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.7 });
}

// ---------- Bedroom ----------
export function bed(blanket: string): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#5a3b24', 0.6), dark = mat('#3e2716', 0.6);
  box(g, wood, [0, 0.25, 0], [1.5, 0.3, 2.1]);
  for (const x of [-0.7, 0.7]) for (const z of [-1, 1]) box(g, dark, [x, 0.08, z], [0.08, 0.16, 0.08]);
  box(g, dark, [0, 0.7, -1.06], [1.56, 1.1, 0.08]); // headboard
  box(g, wood, [0, 1.27, -1.06], [1.6, 0.06, 0.12]);
  box(g, mat('#f4f1ea', 0.9), [0, 0.5, 0.02], [1.4, 0.2, 2.0]); // mattress
  for (const x of [-0.35, 0.35]) add(g, CAP, mat('#ffffff', 0.9), [x, 0.66, -0.78], [0.22, 0.4, 0.22], [0, 0, Math.PI / 2]);
  const bl = mat(blanket, 0.95);
  box(g, bl, [0, 0.63, 0.32], [1.46, 0.07, 1.4]);
  box(g, bl, [0, 0.62, -0.38], [1.46, 0.09, 0.14], [0.2, 0, 0]); // folded edge
  return g;
}

export function nightstand(glow: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#5a3b24', 0.6);
  box(g, wood, [0, 0.3, 0], [0.5, 0.6, 0.45]);
  for (const y of [0.18, 0.42]) {
    box(g, mat('#4a301c', 0.6), [0, y, 0.23], [0.44, 0.2, 0.02]);
    box(g, mat('#c9a24a', 0.3, 0.8), [0, y, 0.25], [0.12, 0.02, 0.02]);
  }
  cyl(g, mat('#2a2a2a', 0.4, 0.6), [0, 0.68, 0], 0.07, 0.16);
  cyl(g, mat('#2a2a2a', 0.4, 0.6), [0, 0.82, 0], 0.012, 0.18);
  add(g, new THREE.CylinderGeometry(0.08, 0.16, 0.18, 18, 1, true), new THREE.MeshStandardMaterial({ color: '#f3e3c3', side: THREE.DoubleSide, roughness: 0.9 }), [0, 0.95, 0], [1, 1, 1]);
  add(g, SPH, glow, [0, 0.92, 0], [0.05, 0.05, 0.05], [0, 0, 0], false);
  return g;
}

export function wardrobe(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#6a4a30', 0.6);
  box(g, wood, [0, 1.1, 0], [1.2, 2.2, 0.6]);
  box(g, mat('#3e2716', 0.6), [0, 0.03, 0], [1.24, 0.06, 0.64]);
  box(g, mat('#3e2716', 0.6), [0, 2.21, 0], [1.26, 0.04, 0.66]);
  box(g, mat('#2a1a0e', 0.6), [0, 1.15, 0.305], [0.02, 2.0, 0.01]);
  for (const x of [-0.08, 0.08]) cyl(g, mat('#c9a24a', 0.3, 0.8), [x, 1.2, 0.33], 0.015, 0.3);
  return g;
}

/** A framed picture on a wall (faces +Z). */
export function picture(m: THREE.Material, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, mat('#1e1b18', 0.5), [0, 0, 0], [w + 0.08, h + 0.08, 0.04]);
  add(g, new THREE.PlaneGeometry(w, h), m, [0, 0, 0.022], [1, 1, 1], [0, 0, 0], false);
  return g;
}

// ---------- Bathroom ----------
export function toilet(): THREE.Group {
  const g = new THREE.Group();
  const white = mat('#f6f6f4', 0.15);
  add(g, new THREE.CylinderGeometry(0.2, 0.15, 0.4, 20), white, [0, 0.2, 0.08], [1, 1, 1.25]);
  add(g, TOR, white, [0, 0.41, 0.1], [0.19, 0.24, 0.6], [Math.PI / 2, 0, 0]);
  box(g, white, [0, 0.62, -0.2], [0.44, 0.42, 0.18]);
  box(g, white, [0, 0.84, -0.2], [0.47, 0.04, 0.21]);
  cyl(g, mat('#c8ccd0', 0.2, 0.9), [0.12, 0.88, -0.2], 0.02, 0.03);
  return g;
}

export function basin(): THREE.Group {
  const g = new THREE.Group();
  const white = mat('#f6f6f4', 0.15), chrome = mat('#d8dde2', 0.15, 0.95);
  add(g, new THREE.CylinderGeometry(0.1, 0.13, 0.78, 16), white, [0, 0.39, 0], [1, 1, 1]);
  add(g, new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), white, [0, 0.88, 0.02], [0.3, -0.14, 0.24]);
  box(g, white, [0, 0.89, 0.02], [0.62, 0.04, 0.5]);
  cyl(g, chrome, [0, 0.98, -0.16], 0.02, 0.18);
  box(g, chrome, [0, 1.06, -0.09], [0.03, 0.03, 0.14]);
  // Mirror above (on the wall behind).
  box(g, mat('#2a2a2a', 0.4), [0, 1.65, -0.24], [0.66, 0.86, 0.03]);
  box(g, new THREE.MeshStandardMaterial({ color: '#bcd2dc', roughness: 0.05, metalness: 0.9 }), [0, 1.65, -0.22], [0.58, 0.78, 0.01]);
  return g;
}

export function shower(curtain: string): THREE.Group {
  const g = new THREE.Group();
  const chrome = mat('#d8dde2', 0.15, 0.95);
  box(g, mat('#e7eef1', 0.3), [0, 0.06, 0], [1.6, 0.12, 1.6]);
  cyl(g, mat('#3a3d42', 0.4), [0, 0.125, 0], 0.06, 0.01);
  cyl(g, chrome, [0.6, 1.2, -0.72], 0.02, 2.2);
  box(g, chrome, [0.48, 2.25, -0.72], [0.26, 0.03, 0.03]);
  cyl(g, chrome, [0.35, 2.22, -0.72], 0.09, 0.03);
  // Curtain on a rail across the front.
  cyl(g, chrome, [0, 2.3, 0.78], 0.015, 1.6, [0, 0, Math.PI / 2]);
  const cm = new THREE.MeshStandardMaterial({ color: curtain, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 6; i++) add(g, new THREE.PlaneGeometry(0.2, 2.0), cm, [-0.75 + i * 0.16, 1.28, 0.78 + (i % 2 ? 0.04 : -0.04)], [1, 1, 1], [0, (i % 2 ? 0.35 : -0.35), 0], false);
  return g;
}

export function towelRail(colour: string): THREE.Group {
  const g = new THREE.Group();
  const chrome = mat('#d8dde2', 0.15, 0.95);
  cyl(g, chrome, [0, 1.2, 0.06], 0.015, 0.7, [0, 0, Math.PI / 2]);
  box(g, mat(colour, 0.95), [0, 0.98, 0.07], [0.5, 0.46, 0.04]);
  return g;
}

// ---------- Gym ----------
export function benchPress(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#3a3d42', 0.4, 0.6), pad = mat('#1a1b1e', 0.7), chrome = mat('#c8ccd0', 0.2, 0.9);
  box(g, pad, [0, 0.48, 0.1], [0.36, 0.1, 1.3]);
  for (const z of [-0.4, 0.6]) box(g, steel, [0, 0.22, z], [0.3, 0.44, 0.06]);
  for (const x of [-0.55, 0.55]) {
    box(g, steel, [x, 0.6, -0.55], [0.06, 1.2, 0.06]);
    box(g, steel, [x, 0.03, -0.55], [0.06, 0.06, 0.5]);
    box(g, steel, [x * 0.9, 1.0, -0.5], [0.12, 0.04, 0.12]);
  }
  cyl(g, chrome, [0, 1.06, -0.5], 0.022, 1.9, [0, 0, Math.PI / 2]);
  for (const x of [-0.78, 0.78]) {
    cyl(g, mat('#1e1e20', 0.6), [x, 1.06, -0.5], 0.23, 0.06, [0, 0, Math.PI / 2]);
    cyl(g, mat('#b71c1c', 0.6), [x * 0.9, 1.06, -0.5], 0.17, 0.05, [0, 0, Math.PI / 2]);
  }
  return g;
}

export function punchingBag(): THREE.Group {
  const g = new THREE.Group();
  add(g, CAP, mat('#7a1e1e', 0.7), [0, 1.3, 0], [0.56, 0.7, 0.56]);
  box(g, mat('#1e1e20', 0.6), [0, 1.3, 0], [0.57, 0.08, 0.57]);
  cyl(g, mat('#888c90', 0.3, 0.9), [0, 2.35, 0], 0.012, 0.9);
  cyl(g, mat('#3a3d42', 0.4, 0.6), [0, 3.0, 0], 0.08, 0.06);
  return g;
}

export function dumbbellRack(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#3a3d42', 0.4, 0.6), chrome = mat('#c8ccd0', 0.2, 0.9), rub = mat('#1e1e20', 0.6);
  for (const y of [0.35, 0.7]) box(g, steel, [0, y, 0], [1.6, 0.04, 0.4], [-0.15, 0, 0]);
  for (const x of [-0.78, 0.78]) box(g, steel, [x, 0.4, 0], [0.05, 0.8, 0.45]);
  for (let i = 0; i < 5; i++) for (const y of [0.4, 0.75]) {
    const x = -0.6 + i * 0.3;
    cyl(g, chrome, [x, y, 0], 0.02, 0.22, [Math.PI / 2, 0, 0]);
    for (const z of [-0.1, 0.1]) cyl(g, rub, [x, y, z], 0.05 + i * 0.006, 0.06, [Math.PI / 2, 0, 0]);
  }
  return g;
}

export function treadmill(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#3a3d42', 0.4, 0.6), belt = mat('#151618', 0.9);
  box(g, steel, [0, 0.12, 0], [0.8, 0.2, 1.8]);
  box(g, belt, [0, 0.23, 0.05], [0.6, 0.02, 1.6]);
  for (const x of [-0.37, 0.37]) box(g, steel, [x, 0.75, -0.8], [0.05, 1.1, 0.05], [0.12, 0, 0]);
  box(g, steel, [0, 1.3, -0.86], [0.8, 0.25, 0.12], [0.3, 0, 0]);
  box(g, new THREE.MeshBasicMaterial({ color: '#3ff0ff' }), [0, 1.33, -0.79], [0.4, 0.1, 0.01], [0.3, 0, 0]);
  return g;
}

// ---------- Living room ----------
export function sofa(colour: string, width: number): THREE.Group {
  const g = new THREE.Group();
  const fab = mat(colour, 0.95), wood = mat('#2a1a0e', 0.6);
  box(g, fab, [0, 0.25, 0], [width, 0.3, 0.9]);
  const n = Math.max(2, Math.round(width / 0.9));
  for (let i = 0; i < n; i++) {
    const w = (width - 0.36) / n;
    box(g, fab, [-width / 2 + 0.18 + w * (i + 0.5), 0.47, 0.06], [w - 0.03, 0.16, 0.72]);
    box(g, fab, [-width / 2 + 0.18 + w * (i + 0.5), 0.78, -0.3], [w - 0.03, 0.5, 0.18], [-0.12, 0, 0]);
  }
  for (const x of [-width / 2 + 0.09, width / 2 - 0.09]) box(g, fab, [x, 0.45, 0], [0.18, 0.5, 0.9]);
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) for (const z of [-0.35, 0.35]) box(g, wood, [x, 0.05, z], [0.06, 0.1, 0.06]);
  return g;
}

export function coffeeTable(): THREE.Group {
  const g = new THREE.Group();
  box(g, new THREE.MeshStandardMaterial({ color: '#9ec3d0', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.6 }), [0, 0.42, 0], [1.1, 0.03, 0.6]);
  for (const x of [-0.5, 0.5]) for (const z of [-0.25, 0.25]) cyl(g, mat('#2a2a2a', 0.3, 0.8), [x, 0.21, z], 0.02, 0.42);
  return g;
}

export function tvUnit(screen: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  box(g, mat('#1c1d22', 0.5), [0, 0.25, 0], [2.0, 0.5, 0.45]);
  for (const x of [-0.5, 0.5]) box(g, mat('#2a2b30', 0.5), [x, 0.25, 0.23], [0.92, 0.42, 0.01]);
  box(g, mat('#0c0d10', 0.3), [0, 1.25, -0.1], [1.7, 0.98, 0.06]);
  add(g, new THREE.PlaneGeometry(1.6, 0.88), screen, [0, 1.25, -0.065], [1, 1, 1], [0, 0, 0], false);
  return g;
}

export function planningTable(mapTex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#5a3b24', 0.55);
  box(g, wood, [0, 0.8, 0], [2.6, 0.06, 1.5]);
  box(g, mat('#3e2716', 0.6), [0, 0.74, 0], [2.4, 0.08, 1.3]);
  for (const x of [-1.15, 1.15]) for (const z of [-0.6, 0.6]) box(g, wood, [x, 0.38, z], [0.08, 0.76, 0.08]);
  add(g, new THREE.PlaneGeometry(2.3, 1.25), new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.9 }), [0, 0.835, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
  // Markers and a cup on the map.
  for (const [x, z, c] of [[-0.5, -0.2, '#c62828'], [0.3, 0.3, '#1f6fd1'], [0.8, -0.3, '#f2b705']] as const) cyl(g, mat(c, 0.5), [x, 0.87, z], 0.035, 0.06);
  cyl(g, mat('#f4f4f2', 0.3), [-1.0, 0.88, 0.45], 0.05, 0.1);
  return g;
}

export function chair(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#4a301c', 0.6);
  box(g, wood, [0, 0.45, 0], [0.45, 0.05, 0.45]);
  box(g, wood, [0, 0.75, -0.2], [0.45, 0.5, 0.05]);
  for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) box(g, wood, [x, 0.22, z], [0.04, 0.45, 0.04]);
  return g;
}

export function plant(): THREE.Group {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.2, 0.15, 0.4, 16), mat('#b5582f', 0.8), [0, 0.2, 0], [1, 1, 1]);
  const leaf = mat('#2e7d32', 0.8);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    add(g, SPH, leaf, [Math.cos(a) * 0.14, 0.62 + (i % 3) * 0.12, Math.sin(a) * 0.14], [0.06, 0.28, 0.12], [Math.sin(a) * 0.5, a, Math.cos(a) * 0.5]);
  }
  return g;
}

/** Ceiling fan: returns the group and the blades to spin. */
export function ceilingFan(): { group: THREE.Group; blades: THREE.Group } {
  const g = new THREE.Group();
  const metal = mat('#d9d4c8', 0.4, 0.4);
  cyl(g, metal, [0, -0.2, 0], 0.02, 0.4);
  cyl(g, metal, [0, -0.42, 0], 0.12, 0.1);
  const blades = new THREE.Group();
  blades.position.y = -0.44;
  for (let i = 0; i < 4; i++) {
    const b = box(blades, mat('#7a5a3a', 0.6), [0, 0, 0], [0.62, 0.015, 0.14]);
    b.position.set(Math.cos((i * Math.PI) / 2) * 0.4, 0, Math.sin((i * Math.PI) / 2) * 0.4);
    b.rotation.y = -(i * Math.PI) / 2;
  }
  g.add(blades);
  return { group: g, blades };
}

/** A ceiling light panel that glows. */
export function ceilingLight(glow: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  box(g, mat('#e6e1d6', 0.6), [0, 0, 0], [1.0, 0.04, 0.4]);
  box(g, glow, [0, -0.025, 0], [0.9, 0.01, 0.32]);
  return g;
}

// ---------- Club ----------
export function barStool(): THREE.Group {
  const g = new THREE.Group();
  const chrome = mat('#c8ccd0', 0.2, 0.9);
  cyl(g, chrome, [0, 0.02, 0], 0.2, 0.04);
  cyl(g, chrome, [0, 0.38, 0], 0.025, 0.72);
  add(g, TOR, chrome, [0, 0.3, 0], [0.16, 0.16, 0.6], [Math.PI / 2, 0, 0]);
  cyl(g, mat('#7a1e3a', 0.6), [0, 0.76, 0], 0.19, 0.08);
  return g;
}

/** DJ booth: returns the group and the two platters to spin. */
export function djBooth(): { group: THREE.Group; platters: THREE.Object3D[] } {
  const g = new THREE.Group();
  box(g, mat('#121218', 0.4), [0, 0.55, 0], [3.6, 1.1, 1.0]);
  box(g, new THREE.MeshBasicMaterial({ color: '#ff4fa3' }), [0, 0.9, 0.505], [3.4, 0.04, 0.01]);
  box(g, new THREE.MeshBasicMaterial({ color: '#3ff0ff' }), [0, 0.3, 0.505], [3.4, 0.04, 0.01]);
  box(g, mat('#1e1e24', 0.3), [0, 1.13, 0], [3.0, 0.06, 0.8]);
  const platters: THREE.Object3D[] = [];
  for (const x of [-0.9, 0.9]) {
    box(g, mat('#2a2a32', 0.3), [x, 1.18, 0], [0.7, 0.04, 0.6]);
    const p = cyl(g, mat('#0a0a0c', 0.2), [x, 1.22, 0], 0.24, 0.02);
    cyl(p, new THREE.MeshBasicMaterial({ color: '#ffb43c' }), [0, 0.6, 0], 0.25, 0.5);
    platters.push(p);
  }
  box(g, mat('#2a2a32', 0.3), [0, 1.18, 0], [0.6, 0.05, 0.5]);
  for (let i = 0; i < 6; i++) box(g, new THREE.MeshBasicMaterial({ color: i % 2 ? '#3ff0ff' : '#5dff9a' }), [-0.2 + i * 0.08, 1.21, 0.1], [0.03, 0.01, 0.12]);
  return { group: g, platters };
}

export function speaker(h = 2.2): THREE.Group {
  const g = new THREE.Group();
  box(g, mat('#0c0c10', 0.6), [0, h / 2, 0], [1.0, h, 0.8]);
  const cone = mat('#202024', 0.5);
  for (let i = 0; i < Math.floor(h / 0.75); i++) {
    const y = 0.45 + i * 0.7;
    cyl(g, cone, [0, y, 0.41], 0.3, 0.02, [Math.PI / 2, 0, 0]);
    cyl(g, mat('#3a3a40', 0.3, 0.6), [0, y, 0.42], 0.1, 0.03, [Math.PI / 2, 0, 0]);
  }
  return g;
}

export function boothSeat(colour: string, w: number): THREE.Group {
  const g = sofa(colour, w);
  box(g, mat('#121218', 0.4), [0, 0.42, 1.0], [w * 0.6, 0.05, 0.7]);
  cyl(g, mat('#c8ccd0', 0.2, 0.9), [0, 0.21, 1.0], 0.05, 0.42);
  return g;
}

/** A glowing neon tube along x. */
export function neon(colour: string, len: number): THREE.Mesh {
  const m = new THREE.Mesh(CYL, new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(2.2) }));
  m.scale.set(0.03, len, 0.03);
  m.rotation.z = Math.PI / 2;
  return m;
}

// ---------- Outside ----------
/** A window with a frame, sill, glass and burglar bars (faces +Z). */
export function windowUnit(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const frame = mat('#f2efe8', 0.6), bars = mat('#2a2a2a', 0.4, 0.6);
  box(g, new THREE.MeshStandardMaterial({ color: '#2a4a5c', roughness: 0.1, metalness: 0.3 }), [0, 0, 0], [w, h, 0.04]);
  for (const x of [-w / 2, w / 2, 0]) box(g, frame, [x, 0, 0.03], [0.06, h + 0.06, 0.06]);
  for (const y of [-h / 2, h / 2]) box(g, frame, [0, y, 0.03], [w + 0.06, 0.06, 0.06]);
  box(g, frame, [0, -h / 2 - 0.06, 0.08], [w + 0.2, 0.06, 0.18]);
  for (let i = 1; i < 5; i++) cyl(g, bars, [-w / 2 + (w * i) / 5, 0, 0.12], 0.012, h);
  for (const y of [-h / 4, h / 4]) cyl(g, bars, [0, y, 0.12], 0.012, w, [0, 0, Math.PI / 2]);
  return g;
}

/** A front door in a frame with a handle (faces +Z). */
export function doorUnit(colour: string, w = 1.2, h = 2.2): THREE.Group {
  const g = new THREE.Group();
  const frame = mat('#f2efe8', 0.6);
  box(g, mat(colour, 0.5), [0, h / 2, 0], [w, h, 0.06]);
  for (const [y, hh] of [[h * 0.72, h * 0.36], [h * 0.28, h * 0.4]] as const) box(g, mat(colour, 0.45), [0, y, 0.04], [w * 0.75, hh, 0.02]);
  for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) box(g, frame, [x, h / 2, 0.02], [0.1, h + 0.1, 0.1]);
  box(g, frame, [0, h + 0.05, 0.02], [w + 0.2, 0.1, 0.1]);
  cyl(g, mat('#c9a24a', 0.3, 0.8), [w * 0.36, h * 0.48, 0.08], 0.03, 0.08, [Math.PI / 2, 0, 0]);
  return g;
}

/** Water tank on a stand (a common Lagos rooftop sight). */
export function waterTank(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#3a3d42', 0.5, 0.5);
  for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) box(g, steel, [x, 0.6, z], [0.06, 1.2, 0.06]);
  box(g, steel, [0, 1.22, 0], [1.2, 0.06, 1.2]);
  cyl(g, mat('#1c1c1c', 0.7), [0, 1.85, 0], 0.62, 1.2);
  cyl(g, mat('#1c1c1c', 0.7), [0, 2.48, 0], 0.3, 0.08);
  return g;
}

export function acUnit(): THREE.Group {
  const g = new THREE.Group();
  box(g, mat('#e6e3dc', 0.5), [0, 0, 0], [0.8, 0.55, 0.32]);
  cyl(g, mat('#3a3d42', 0.6), [-0.12, 0, 0.17], 0.18, 0.02, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) box(g, mat('#b0aca4', 0.5), [0.26, -0.15 + i * 0.1, 0.17], [0.2, 0.02, 0.01]);
  return g;
}

/** Gun-shop pegboard with original weapon silhouettes (faces +Z). */
export function gunWall(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, mat('#3a2e22', 0.8), [0, 0, 0], [w, h, 0.04]);
  const metal = mat('#1c1d20', 0.4, 0.7), wood = mat('#6a4a30', 0.6);
  const rows = Math.floor(h / 0.45);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < Math.floor(w / 1.1); i++) {
      const x = -w / 2 + 0.6 + i * 1.1, y = -h / 2 + 0.3 + r * 0.45;
      box(g, metal, [x, y, 0.05], [0.8, 0.07, 0.04]);
      box(g, wood, [x - 0.36, y - 0.04, 0.05], [0.2, 0.1, 0.04]);
      box(g, metal, [x + 0.05, y - 0.08, 0.05], [0.06, 0.14, 0.04]);
    }
  }
  return g;
}

/** Glass-topped shop counter. */
export function glassCounter(w: number): THREE.Group {
  const g = new THREE.Group();
  box(g, mat('#2a2b30', 0.5), [0, 0.4, 0], [w, 0.8, 0.7]);
  box(g, new THREE.MeshStandardMaterial({ color: '#bcd2dc', roughness: 0.05, transparent: true, opacity: 0.4 }), [0, 0.95, 0], [w, 0.3, 0.7]);
  box(g, mat('#c8a24a', 0.3, 0.6), [0, 1.11, 0], [w + 0.04, 0.03, 0.74]);
  box(g, new THREE.MeshBasicMaterial({ color: '#fff2c8' }), [0, 0.81, 0], [w - 0.1, 0.01, 0.6]);
  return g;
}
