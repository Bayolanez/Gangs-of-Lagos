import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Bayo's model kit (public/models/): stylized, code-built GLB models.
 *  - blk-king.glb:   BLK KNG, the main player
 *  - green-suit.glb: Green Suit, a second playable look and Remi in the Night Exit briefing
 *  - royale-gt.glb:  Royale GT, an original luxury coupe (made-up maker and badge): the Coastal Run prize
 *  - eko-k7.glb:     EKO K7, an original carbine from a fictional Lagos maker: the rifle's look
 *  - eko-twin.glb:   EKO Twin, an original sawn-off double-barrel from the same maker: the shotgun's look
 *  - lagos-house.glb: the Modern Lagos House (from Bayo's own asset sheet): the crew house (lagoshouse.ts)
 * Each loads once. Hosts that don't serve .glb get the same bytes as base64 in a .glb.json file.
 */
export type ModelName = 'blk-king' | 'green-suit' | 'royale-gt' | 'eko-k7' | 'eko-twin' | 'lagos-house' | 'cartel-boss';

const loader = new GLTFLoader();
const cache = new Map<ModelName, Promise<THREE.Group>>();
/** Models that have finished loading (for code that can't wait). */
export const loaded = new Map<ModelName, THREE.Group>();

export function loadModel(base: string, name: ModelName): Promise<THREE.Group> {
  let p = cache.get(name);
  if (p) return p;
  const url = `${base}models/${name}.glb`;
  p = loader
    .loadAsync(url)
    .catch(async () => {
      const r = await fetch(`${url}.json`);
      if (!r.ok) throw new Error(`${name} model not found (HTTP ${r.status})`);
      const { glb } = (await r.json()) as { glb: string };
      const bytes = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0));
      return loader.parseAsync(bytes.buffer, base);
    })
    .then((g) => {
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      loaded.set(name, g.scene);
      return g.scene;
    });
  p.catch(() => cache.delete(name));
  cache.set(name, p);
  return p;
}

// ---------- Royale GT ----------
const WHEEL_R = 0.355;
const MAX_STEER = 0.55;

/** The Royale GT's visual: faces +X like the game's vehicles, spins and steers its wheels, brake lights. */
export class RoyaleVisual {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  private spinners: THREE.Object3D[];
  private steerers: THREE.Object3D[];
  private wheel: THREE.Object3D | null;
  private wheelRest: number;
  private tail: THREE.MeshStandardMaterial[] = [];
  private tailBase: number[] = [];
  private roll = 0;
  private steerNow = 0;

  constructor(scene: THREE.Group) {
    this.model = scene.clone(true);
    this.model.rotation.y = Math.PI / 2; // +Z forward -> +X forward
    this.root.name = 'royale-gt';
    this.root.add(this.model);
    const get = (n: string) => this.model.getObjectByName(n) ?? null;
    this.spinners = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(get).filter(Boolean) as THREE.Object3D[];
    this.steerers = ['wheel_FL_steer', 'wheel_FR_steer'].map(get).filter(Boolean) as THREE.Object3D[];
    this.wheel = get('steering_wheel');
    this.wheelRest = this.wheel?.rotation.z ?? 0;
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (o.name !== 'taillight_led' && o.name !== 'taillight_lens')) return;
      // Own material per car, so one car braking doesn't light up every Royale.
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = m;
      this.tail.push(m);
      this.tailBase.push(m.emissiveIntensity);
    });
  }

  /** speed in m/s, steer -1..1 (positive = right, as the game steers). */
  animate(dt: number, speed: number, steer: number): void {
    this.roll += (speed / WHEEL_R) * dt;
    for (const w of this.spinners) w.rotation.x = this.roll;
    this.steerNow += (-steer * MAX_STEER - this.steerNow) * Math.min(1, dt * 10);
    for (const s of this.steerers) s.rotation.y = this.steerNow;
    if (this.wheel) this.wheel.rotation.z = this.wheelRest - this.steerNow * 3;
  }

  setBrakeLights(on: boolean): void {
    this.tail.forEach((m, i) => (m.emissiveIntensity = on ? Math.max(2.5, this.tailBase[i] * 2.5) : this.tailBase[i]));
  }

  get wheelFL(): THREE.Object3D | null {
    return this.spinners[0] ?? null;
  }
}

// ---------- EKO K7 and EKO Twin ----------
/**
 * A gun model for a hand: the grip at the origin, the muzzle along the hand's -Y and the top of the gun
 * along +X (the game's weapon convention, see weapons.ts). Reloads: the EKO K7 drops its magazine and
 * racks the charging handle; the EKO Twin breaks open on its hinge, ejects both shells and loads two more.
 */
export class EkoK7 {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  private mag: THREE.Object3D | null;
  private ch: THREE.Object3D | null;
  private magRest: { p: THREE.Vector3; rx: number } | null;
  private chRest: THREE.Vector3 | null;
  private barrels: THREE.Object3D | null;
  private shells: THREE.Object3D[];
  private shellRest: THREE.Vector3[];
  private t = -1;
  private dur = 2.2;

  constructor(scene: THREE.Group) {
    this.model = scene.clone(true);
    this.root.name = 'eko-k7';
    const get = (n: string) => this.model.getObjectByName(n) ?? null;
    const grip = get('grip_point');
    this.mag = get('magazine');
    this.ch = get('charging_handle');
    this.magRest = this.mag ? { p: this.mag.position.clone(), rx: this.mag.rotation.x } : null;
    this.chRest = this.ch ? this.ch.position.clone() : null;
    this.barrels = get('barrels');
    this.shells = ['shell_L', 'shell_R'].map(get).filter(Boolean) as THREE.Object3D[];
    this.shellRest = this.shells.map((o) => o.position.clone());
    if (this.barrels) this.root.name = 'eko-twin';
    // Put the grip on the origin...
    const offset = new THREE.Group();
    offset.add(this.model);
    if (grip) {
      this.model.updateMatrixWorld(true);
      grip.matrixWorld.clone().invert().decompose(offset.position, offset.quaternion, offset.scale);
    }
    // ...then turn the gun (muzzle +Z, top +Y) into the hand frame (muzzle -Y, top +X).
    const turn = new THREE.Group();
    turn.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)));
    turn.add(offset);
    this.root.add(turn);
    this.root.userData.update = (dt: number) => this.update(dt);
    this.root.userData.startReload = (s: number) => this.startReload(s);
  }

  startReload(seconds = 2.2): void {
    this.dur = seconds;
    this.t = 0;
  }

  get reloading(): boolean {
    return this.t >= 0;
  }

  /** How far the barrels are broken open (radians; tests check the EKO Twin opens on reload). */
  get barrelsOpen(): number {
    return this.barrels?.rotation.x ?? 0;
  }

  /** Magazine position (tests check it drops on reload). */
  get magY(): number {
    return this.mag?.position.y ?? 0;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / this.dur;
    const ease = (x: number) => x * x * (3 - 2 * x);
    if (this.barrels) {
      // Break-action: open, eject, load two, close.
      const open = k < 0.13 ? ease(k / 0.13) : k < 0.77 ? 1 : k < 0.87 ? 1 - ease((k - 0.77) / 0.1) : 0;
      this.barrels.rotation.x = open * 0.62;
      this.shells.forEach((sh, i) => {
        const u = k - 0.13 - i * 0.02;
        let z = 0, vis = true;
        if (u > 0 && u < 0.17) z = -u * 1.5;
        else if (u >= 0.17 && u < 0.33) vis = false;
        else if (u >= 0.33 && u < 0.53) z = -0.07 * (1 - ease((u - 0.33) / 0.2));
        sh.position.set(this.shellRest[i].x, this.shellRest[i].y, this.shellRest[i].z + z);
        sh.visible = vis;
      });
      if (k >= 1) this.t = -1;
      return;
    }
    const out = k < 0.2 ? ease(k / 0.2) : k < 0.45 ? 1 : k < 0.65 ? 1 - ease((k - 0.45) / 0.2) : 0;
    if (this.mag && this.magRest) {
      this.mag.position.set(this.magRest.p.x, this.magRest.p.y - out * 0.22, this.magRest.p.z + out * 0.03);
      this.mag.rotation.x = this.magRest.rx + out * 0.25;
    }
    if (this.ch && this.chRest) {
      const pull = k > 0.72 && k < 0.92 ? Math.sin(((k - 0.72) / 0.2) * Math.PI) : 0;
      this.ch.position.set(this.chRest.x, this.chRest.y, this.chRest.z - pull * 0.07);
    }
    if (k >= 1) this.t = -1;
  }
}
