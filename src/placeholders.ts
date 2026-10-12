import * as THREE from 'three';

/**
 * PLACEHOLDER ART. Everything visible is built from boxes, cylinders and spheres with flat colours.
 * Replace these helpers' callers with real models later; nothing here is final art.
 */
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
const SPH = new THREE.SphereGeometry(0.5, 14, 10);
const materials = new Map<string, THREE.MeshStandardMaterial>();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function mat(color: string, roughness = 0.85, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.set(key, m);
  }
  return m;
}

type Shape = 'box' | 'cyl' | 'sph';

export function part(
  parent: THREE.Object3D,
  shape: Shape,
  color: string | THREE.Material,
  pos: [number, number, number],
  size: [number, number, number],
  rot: [number, number, number] = [0, 0, 0],
  castShadow = true,
): THREE.Mesh {
  const geo = shape === 'box' ? BOX : shape === 'cyl' ? CYL : SPH;
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color) : color);
  m.position.set(...pos);
  m.scale.set(...size);
  m.rotation.set(...rot);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/**
 * Collects many boxes/cylinders/spheres and turns them into a few instanced meshes
 * (one per shape and shadow mode) with per-instance colour.
 */
export class Batcher {
  private items: { shape: Shape; shadow: boolean; m: THREE.Matrix4; c: THREE.Color }[] = [];
  private tmp = new THREE.Object3D();
  /** After build: where each item ended up, so single items can be hidden (broken props). */
  private slots: { mesh: THREE.InstancedMesh; i: number }[] = [];
  /** While set, the index of every item added is collected here (to group a prop's parts). */
  capture: number[] | null = null;

  /** material: optional factory for this batch's material (e.g. building walls with facade detail). */
  constructor(private material: (() => THREE.Material) | null = null) {}

  add(shape: Shape, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0, shadow = true): number {
    this.capture?.push(this.items.length);
    this.tmp.position.set(x, y, z);
    this.tmp.rotation.set(rx, ry, rz);
    this.tmp.scale.set(sx, sy, sz);
    this.tmp.updateMatrix();
    this.items.push({ shape, shadow, m: this.tmp.matrix.clone(), c: new THREE.Color(color) });
    return this.items.length - 1;
  }

  /** Hide (true) or show again (false) one item after build. */
  setHidden(index: number, hidden: boolean): void {
    const s = this.slots[index];
    if (!s) return;
    s.mesh.setMatrixAt(s.i, hidden ? ZERO : this.items[index].m);
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  build(scene: THREE.Object3D): number {
    const groups = new Map<string, (typeof this.items[number] & { idx: number })[]>();
    this.items.forEach((it, idx) => {
      const k = `${it.shape}|${it.shadow}`;
      const g = groups.get(k);
      if (g) g.push({ ...it, idx });
      else groups.set(k, [{ ...it, idx }]);
    });
    for (const [k, list] of groups) {
      const [shape, shadow] = k.split('|');
      const geo = shape === 'box' ? BOX : shape === 'cyl' ? CYL : SPH;
      const im = new THREE.InstancedMesh(geo, this.material ? this.material() : new THREE.MeshStandardMaterial({ roughness: 0.88 }), list.length);
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, it.c);
        this.slots[it.idx] = { mesh: im, i };
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadow === 'true';
      im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
    return this.items.length;
  }
}

/** A camera-facing text sign (canvas texture on a sprite). */
export function textSprite(text: string, color = '#ffcf5a', heightM = 1.6): THREE.Sprite {
  const pad = 30;
  const font = '800 64px "Barlow Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = w;
  c.height = 104;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Lagos-dusk style: ink edge, then the letters with a soft glow in their own colour.
  g.lineJoin = 'round';
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(27,18,51,0.92)';
  g.strokeText(text, w / 2, 54);
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.fillStyle = color;
  g.fillText(text, w / 2, 54);
  g.shadowBlur = 0;
  g.fillText(text, w / 2, 54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set((heightM * w) / 104, heightM, 1);
  return s;
}

/** Simple deterministic RNG (mulberry32) so the district is the same every session. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
