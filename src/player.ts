import * as THREE from 'three';
import { CollisionWorld } from './collision';
import { HumanRig } from './human';

/** On-foot player: camera-relative walk/sprint/jump with collision against buildings, vehicles and people. */
export class Player {
  x: number;
  z: number;
  y = 0;
  vy = 0;
  heading: number;
  speed = 0;
  readonly radius = 0.35;
  readonly rig = new HumanRig({ shirt: '#f5c518', pants: '#1f2430', stripe: true });
  walkSpeed = 3.2;
  sprintSpeed = 6.6;

  constructor(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.sync();
  }

  get visible(): boolean {
    return this.rig.root.visible;
  }
  set visible(v: boolean) {
    this.rig.root.visible = v;
  }

  /** move.x = right, move.y = forward, relative to camYaw. */
  update(dt: number, move: { x: number; y: number }, sprint: boolean, jump: boolean, camYaw: number,
    world: CollisionWorld, vehicles: { pushOut(p: { x: number; z: number }, r: number): boolean }[], people: { x: number; z: number }[]): void {
    const len = Math.hypot(move.x, move.y);
    let vx = 0;
    let vz = 0;
    if (len > 0.05) {
      const fx = Math.cos(camYaw), fz = Math.sin(camYaw);
      const rx = Math.cos(camYaw + Math.PI / 2), rz = Math.sin(camYaw + Math.PI / 2);
      let dx = fx * move.y + rx * move.x;
      let dz = fz * move.y + rz * move.x;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const sp = (sprint ? this.sprintSpeed : this.walkSpeed) * Math.min(1, len);
      vx = dx * sp;
      vz = dz * sp;
      const target = Math.atan2(dz, dx);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 12);
    }
    this.speed = Math.hypot(vx, vz);
    this.x += vx * dt;
    this.z += vz * dt;

    if (jump && this.y <= 0) this.vy = 4.6;
    this.vy -= 12 * dt;
    this.y = Math.max(0, this.y + this.vy * dt);
    if (this.y === 0 && this.vy < 0) this.vy = 0;

    world.resolveCircle(this, this.radius);
    for (const v of vehicles) v.pushOut(this, this.radius);
    for (const p of people) {
      const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz), min = this.radius + 0.35;
      if (d < min && d > 1e-4) {
        this.x += (dx / d) * (min - d);
        this.z += (dz / d) * (min - d);
      }
    }
    this.rig.animate(dt, this.speed, this.y > 0.05);
    this.sync();
  }

  sync(): void {
    this.rig.root.position.set(this.x, this.y, this.z);
    this.rig.root.rotation.y = -this.heading;
  }

  facing(): THREE.Vector2 {
    return new THREE.Vector2(Math.cos(this.heading), Math.sin(this.heading));
  }
}
