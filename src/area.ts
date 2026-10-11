import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box2, CollisionWorld, Poly2 } from './collision';
import { AreaGraph, RoadKind } from './areatraffic';
import { addFacadeDetail } from './look';
import { mat, textSprite } from './placeholders';

/**
 * Phase 5: a real-road-layout area streamed in tiles made by tools/osm-import. Tiles load within about
 * 600 m of the player and unload once they are further than 700 m. Each tile brings its mesh (GLB), its
 * building colliders, potholes and lane-warden posts. Areas sit far east of Harbour Bend (AREA_OFFSET)
 * so both can live in one scene. Buildings and businesses are anonymous PLACEHOLDER blocks.
 */
export const AREA_OFFSET = { x: 6000, z: 0 };
export const LOAD_RADIUS = 600;
export const UNLOAD_RADIUS = 700;

export interface AreaManifest {
  format: number;
  id: string;
  name: string;
  fixture: boolean;
  tileSize: number;
  bounds: [number, number, number, number];
  spawn: { x: number; z: number; heading: number };
  attribution: string;
  licence: string;
  graph: string;
  tiles: { key: string; ix: number; iz: number; bounds: [number, number, number, number]; glb: string; json: string }[];
}

export interface TileRoad { id: number; type: RoadKind; name: string | null; width: number; lanes: number; oneway: boolean; bridge: boolean; rough: boolean; pts: [number, number][] }
export interface TileJson {
  key: string;
  bounds: [number, number, number, number];
  roads: TileRoad[];
  buildings: { pts: [number, number][]; h: number }[];
  areas: { kind: string; pts: [number, number][] }[];
  potholes: { x: number; z: number; r: number; rough: boolean }[];
  posts: { x: number; z: number }[];
}

export interface Pothole { x: number; z: number; r: number; cooldown: number }

interface LoadedTile {
  key: string;
  json: TileJson;
  group: THREE.Group;
  colliders: Poly2[];
}

/** Distance from a point to a rectangle (0 inside). */
function rectDist(x: number, z: number, [x0, z0, x1, z1]: [number, number, number, number]): number {
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

const potholeGeo = new THREE.CylinderGeometry(1, 1, 0.03, 12);
const potholeMat = new THREE.MeshStandardMaterial({ color: '#16120f', roughness: 1 });
const POLE_GEO = new THREE.CylinderGeometry(1, 1, 1, 8);
const LAMP_HEAD_GEO = new THREE.SphereGeometry(1, 10, 6);
const KIOSK_TABLE_GEO = new THREE.BoxGeometry(1, 1, 1);
const UMBRELLA_GEO = new THREE.ConeGeometry(1, 1, 12, 1, true);
const UMBRELLA_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide });
/** Geometry shared by every tile: never disposed when a tile unloads. */
const SHARED_GEOS = new Set<THREE.BufferGeometry>([potholeGeo, POLE_GEO, LAMP_HEAD_GEO, KIOSK_TABLE_GEO, UMBRELLA_GEO]);

export class AreaStreamer {
  readonly tiles = new Map<string, LoadedTile>();
  private loading = new Set<string>();
  /** Colliders survive unloading (switched off) so reloading a tile doesn't grow the collision world. */
  private colliderCache = new Map<string, Poly2[]>();
  private loader = new GLTFLoader();
  private root = new THREE.Group();
  private extras: THREE.Object3D[] = [];
  private walls: Box2[] = [];
  /** Called when a tile finishes loading (the minimap paints it). */
  onTile: ((t: TileJson) => void) | null = null;
  loadsDone = 0;
  unloadsDone = 0;

  private constructor(readonly base: string, readonly manifest: AreaManifest, readonly graph: AreaGraph, scene: THREE.Scene, private world: CollisionWorld, groundTex: THREE.Texture | null) {
    this.root.position.set(AREA_OFFSET.x, 0, AREA_OFFSET.z);
    scene.add(this.root);
    // Ground under the whole area, and walls round its edge.
    const [x0, z0, x1, z1] = manifest.bounds;
    const m = 30;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 2 * m, z1 - z0 + 2 * m), groundTex ? new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }) : mat('#9c5d3c', 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    ground.receiveShadow = true;
    this.root.add(ground);
    this.extras.push(ground);
    const ox = AREA_OFFSET.x, oz = AREA_OFFSET.z;
    this.walls.push(
      world.add(ox + x0 - m - 1, ox + x0 - m, oz + z0 - m - 1, oz + z1 + m + 1, 40),
      world.add(ox + x1 + m, ox + x1 + m + 1, oz + z0 - m - 1, oz + z1 + m + 1, 40),
      world.add(ox + x0 - m - 1, ox + x1 + m + 1, oz + z0 - m - 1, oz + z0 - m, 40),
      world.add(ox + x0 - m - 1, ox + x1 + m + 1, oz + z1 + m, oz + z1 + m + 1, 40),
    );
  }

  /** Fetch an area's manifest and road graph. `url` is the manifest's URL. */
  static async load(url: string, scene: THREE.Scene, world: CollisionWorld, groundTex: THREE.Texture | null): Promise<AreaStreamer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Area manifest ${url}: HTTP ${res.status}`);
    const manifest = (await res.json()) as AreaManifest;
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    const g = await fetch(base + manifest.graph);
    if (!g.ok) throw new Error(`Area graph: HTTP ${g.status}`);
    return new AreaStreamer(base, manifest, (await g.json()) as AreaGraph, scene, world, groundTex);
  }

  /** Game position of the area's spawn point. */
  get spawn(): { x: number; z: number; heading: number } {
    const s = this.manifest.spawn;
    return { x: s.x + AREA_OFFSET.x, z: s.z + AREA_OFFSET.z, heading: s.heading };
  }

  /** True if a game position is inside the area (with a margin). */
  contains(x: number, z: number, margin = 0): boolean {
    const [x0, z0, x1, z1] = this.manifest.bounds;
    const lx = x - AREA_OFFSET.x, lz = z - AREA_OFFSET.z;
    return lx > x0 - margin && lx < x1 + margin && lz > z0 - margin && lz < z1 + margin;
  }

  /** Load tiles near the player (game coordinates) and unload far ones. */
  update(x: number, z: number): void {
    const lx = x - AREA_OFFSET.x, lz = z - AREA_OFFSET.z;
    for (const t of this.manifest.tiles) {
      const d = rectDist(lx, lz, t.bounds);
      if (d <= LOAD_RADIUS && !this.tiles.has(t.key) && !this.loading.has(t.key)) void this.loadTile(t);
      else if (d > UNLOAD_RADIUS && this.tiles.has(t.key)) this.unloadTile(t.key);
    }
  }

  /** Wait until every tile that should be loaded around this point is in. */
  async settle(x: number, z: number): Promise<void> {
    this.update(x, z);
    while (this.loading.size) await new Promise((r) => setTimeout(r, 20));
  }

  get pending(): number {
    return this.loading.size;
  }

  private async loadTile(t: AreaManifest['tiles'][number]): Promise<void> {
    this.loading.add(t.key);
    try {
      const [json, gltf] = await Promise.all([
        fetch(this.base + t.json).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<TileJson>;
        }),
        // A tile mesh is a .glb file, or (for hosts that don't serve .glb) the same bytes base64-encoded in a .json file.
        t.glb.endsWith('.json')
          ? fetch(this.base + t.glb).then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const { glb } = (await r.json()) as { glb: string };
            const bytes = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0));
            return this.loader.parseAsync(bytes.buffer, this.base);
          })
          : this.loader.loadAsync(this.base + t.glb),
      ]);
      if (!this.loading.has(t.key)) return; // area was disposed meanwhile
      const group = new THREE.Group();
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          (m.material as THREE.MeshStandardMaterial).vertexColors = true;
          addFacadeDetail(m.material as THREE.MeshStandardMaterial); // windows on the extruded buildings
        }
      });
      group.add(gltf.scene);
      // Potholes: dark discs, instanced.
      if (json.potholes.length) {
        const im = new THREE.InstancedMesh(potholeGeo, potholeMat, json.potholes.length);
        const tmp = new THREE.Object3D();
        json.potholes.forEach((p, i) => {
          tmp.position.set(p.x, 0.09, p.z);
          tmp.scale.set(p.r, 1, p.r * 0.8);
          tmp.updateMatrix();
          im.setMatrixAt(i, tmp.matrix);
        });
        im.instanceMatrix.needsUpdate = true;
        im.receiveShadow = true;
        group.add(im);
      }
      const street = this.streetProps(json, group);
      const kiosks = street.list;
      // Lane warden posts (fictional): a small booth with a sign.
      for (const p of json.posts) {
        const booth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 1.4), mat('#e9e8e2'));
        booth.position.set(p.x, 1.2, p.z);
        booth.castShadow = true;
        group.add(booth);
        const sign = textSprite('LANE WARDENS · FICTIONAL', '#f5c518', 0.45);
        sign.position.set(p.x, 3, p.z);
        group.add(sign);
      }
      this.root.add(group);
      let colliders = this.colliderCache.get(t.key);
      if (colliders) for (const c of colliders) c.off = false;
      else {
        colliders = json.buildings.map((b) => this.world.addPoly(b.pts.map(([x, z]) => [x + AREA_OFFSET.x, z + AREA_OFFSET.z] as [number, number]), b.h));
        for (const k of kiosks) colliders.push(this.world.addPoly([[-0.7, -0.5], [0.7, -0.5], [0.7, 0.5], [-0.7, 0.5]].map(([dx, dz]) => [k.x + dx + AREA_OFFSET.x, k.z + dz + AREA_OFFSET.z] as [number, number]), 1.1));
        for (const p of json.posts) colliders.push(this.world.addPoly([[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]].map(([dx, dz]) => [p.x + dx + AREA_OFFSET.x, p.z + dz + AREA_OFFSET.z] as [number, number]), 2.4));
        this.colliderCache.set(t.key, colliders);
      }
      // Kiosks are street furniture: a fast car smashes through them (they're back when the tile reloads).
      kiosks.forEach((_, k) => {
        const c = colliders![json.buildings.length + k];
        if (!c) return;
        c.off = false;
        c.smash = () => {
          c.off = true;
          street.hide(k);
        };
      });
      this.tiles.set(t.key, { key: t.key, json, group, colliders });
      this.loadsDone++;
      this.onTile?.(json);
    } catch (err) {
      console.warn(`Tile ${t.key} could not be loaded`, err);
    } finally {
      this.loading.delete(t.key);
    }
  }

  /**
   * Street furniture for a tile (PLACEHOLDER shapes, placed from the road data so every load is the same):
   * lamps along expressways and inner streets, and roadside kiosks (a table under an umbrella) on inner
   * and market streets. Returns the kiosk spots, which get colliders.
   */
  private streetProps(json: TileJson, group: THREE.Group): { list: { x: number; z: number }[]; hide: (k: number) => void } {
    const lamps: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];
    const kiosks: { x: number; z: number; c: number }[] = [];
    const tmp = new THREE.Object3D();
    const hash = (n: number) => {
      const v = Math.sin(n * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    const clear = (x: number, z: number, r: number) => !json.buildings.some((b) => {
      let inside = false;
      for (let i = 0, j = b.pts.length - 1; i < b.pts.length; j = i++) {
        const [xi, zi] = b.pts[i], [xj, zj] = b.pts[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = true !== inside;
      }
      if (inside) return true;
      return b.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < r);
    });
    /** True if (x, z) is clear of every road surface in the tile (so no lamp or kiosk stands in a road). */
    const offRoad = (x: number, z: number, margin: number) => !json.roads.some((rd) => {
      for (let i = 1; i < rd.pts.length; i++) {
        const [ax, az] = rd.pts[i - 1], [bx, bz] = rd.pts[i];
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
        if (Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < rd.width / 2 + margin) return true;
      }
      return false;
    });
    for (const r of json.roads) {
      if (r.type === 'brt' || r.type === 'service') continue;
      const spacing = r.type === 'expressway' ? 40 : 34;
      let carry = 0, n = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        for (let d = spacing - carry; d < len; d += spacing) {
          n++;
          const side = n % 2 ? 1 : -1;
          const off = r.width / 2 + 1.4;
          const x = ax + dx * d - dz * off * side, z = az + dz * d + dx * off * side;
          const h = hash(r.id * 7.31 + n);
          if (r.type !== 'market' && clear(x, z, 0.6) && offRoad(x, z, 0.4)) {
            tmp.position.set(x, 3.5, z);
            tmp.rotation.set(0, 0, 0);
            tmp.scale.set(0.12, 7, 0.12);
            tmp.updateMatrix();
            lamps.push(tmp.matrix.clone());
            tmp.position.set(x + dz * side * 0.35, 7.05, z - dx * side * 0.35); // lamp head on top of the pole, leaning over the road
            tmp.rotation.set(0, Math.atan2(dx, dz), 0);
            tmp.scale.set(0.45, 0.16, 0.28);
            tmp.updateMatrix();
            heads.push(tmp.matrix.clone());
          }
          if ((r.type === 'inner' || r.type === 'market') && h < (r.type === 'market' ? 0.6 : 0.22)) {
            const kx = x + dx * 6, kz = z + dz * 6;
            if (clear(kx, kz, 1.4) && offRoad(kx, kz, 1.0)) kiosks.push({ x: kx, z: kz, c: Math.floor(h * 1000) % 5 });
          }
        }
        carry = (carry + len) % spacing;
      }
    }
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, list: THREE.Matrix4[], shadow = false, colours?: THREE.Color[]): THREE.InstancedMesh | null => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(g, m, list.length);
      list.forEach((mx, i) => {
        im.setMatrixAt(i, mx);
        if (colours) im.setColorAt(i, colours[i]);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); // cull by where the instances are, not the unit shape
      im.castShadow = shadow;
      group.add(im);
      return im;
    };
    inst(POLE_GEO, mat('#5b6066', 0.6), lamps);
    inst(LAMP_HEAD_GEO, mat('#f3ecd8', 0.4), heads);
    // Kiosks: table, round umbrella in one of five colours, pole.
    const tables: THREE.Matrix4[] = [], poles: THREE.Matrix4[] = [];
    const tops: THREE.Matrix4[] = [];
    const topColours: THREE.Color[] = [];
    const palette = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#e67e22'].map((c) => new THREE.Color(c));
    for (const k of kiosks) {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(k.x, 0.45, k.z);
      tmp.scale.set(1.4, 0.9, 1.0);
      tmp.updateMatrix();
      tables.push(tmp.matrix.clone());
      tmp.position.set(k.x, 1.2, k.z);
      tmp.scale.set(0.05, 2.4, 0.05);
      tmp.updateMatrix();
      poles.push(tmp.matrix.clone());
      tmp.position.set(k.x, 2.3, k.z);
      tmp.scale.set(1.5, 0.45, 1.5);
      tmp.updateMatrix();
      tops.push(tmp.matrix.clone());
      topColours.push(palette[k.c]);
    }
    const kioskMeshes = [inst(KIOSK_TABLE_GEO, mat('#7a5a2b', 0.85), tables, true), inst(POLE_GEO, mat('#3a3a3a', 0.6), poles), inst(UMBRELLA_GEO, UMBRELLA_MAT, tops, true, topColours)];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    // A car smashing through a kiosk hides its table, pole and umbrella.
    const hide = (k: number) => {
      for (const im of kioskMeshes) {
        if (!im) continue;
        im.setMatrixAt(k, zero);
        im.instanceMatrix.needsUpdate = true;
      }
    };
    return { list: kiosks, hide };
  }

  private unloadTile(key: string): void {
    const t = this.tiles.get(key);
    if (!t) return;
    t.group.removeFromParent();
    t.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !SHARED_GEOS.has(m.geometry)) m.geometry.dispose();
    });
    for (const c of t.colliders) c.off = true;
    this.tiles.delete(key);
    this.unloadsDone++;
  }

  /** Roads in loaded tiles, in game coordinates. */
  *roads(): Generator<TileRoad> {
    for (const t of this.tiles.values()) yield* t.json.roads;
  }

  /** The road (if any) under a game position, and how far from its centre line. */
  roadAt(x: number, z: number): { road: TileRoad; dist: number } | null {
    const lx = x - AREA_OFFSET.x, lz = z - AREA_OFFSET.z;
    let best: { road: TileRoad; dist: number } | null = null;
    for (const r of this.roads()) {
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / l2)) : 0;
        const d = Math.hypot(lx - (ax + dx * t), lz - (az + dz * t));
        if (d <= r.width / 2 && (!best || d < best.dist || (r.type === 'brt' && best.road.type !== 'brt'))) best = { road: r, dist: d };
      }
    }
    return best;
  }

  /** Potholes and warden posts in loaded tiles, in game coordinates. */
  potholes(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const t of this.tiles.values()) for (const p of t.json.potholes) out.push({ x: p.x + AREA_OFFSET.x, z: p.z + AREA_OFFSET.z, r: p.r });
    return out;
  }

  posts(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const t of this.tiles.values()) for (const p of t.json.posts) out.push({ x: p.x + AREA_OFFSET.x, z: p.z + AREA_OFFSET.z });
    return out;
  }

  dispose(): void {
    for (const key of [...this.tiles.keys()]) this.unloadTile(key);
    this.loading.clear();
    for (const w of this.walls) w.off = true;
    for (const e of this.extras) e.removeFromParent();
    this.root.removeFromParent();
  }
}
