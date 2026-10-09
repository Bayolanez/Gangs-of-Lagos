import { CollisionWorld } from './collision';
import { ResidentDef } from './district';
import { HumanRig } from './human';

/**
 * Ambient resident (ported from GOLNPC): wanders near home, pauses, avoids getting stuck,
 * and turns to face the player while greeting. The words come from the dialogue data, not from here.
 */
export class Resident {
  x: number;
  z: number;
  heading: number;
  readonly radius = 0.35;
  readonly rig: HumanRig;
  private homeX: number;
  private homeZ: number;
  private dirX = 1;
  private dirZ = 0;
  private idle = true;
  private stateTimer: number;
  private stuck = 0;
  talkTimer = 0;
  line = '';
  wanderRadius = 9;
  walkSpeed = 1.25;
  /** Running out of the way of a vehicle (Milestone 2). */
  fleeTimer = 0;
  private fleeX = 0;
  private fleeZ = 0;
  /** Seconds before this resident will shout at a driver again. */
  barkCooldown = 0;

  constructor(readonly def: ResidentDef, private rand: () => number) {
    this.x = def.x;
    this.z = def.z;
    this.homeX = def.x;
    this.homeZ = def.z;
    this.heading = rand() * Math.PI * 2;
    this.stateTimer = 0.5 + rand() * 2.5;
    this.rig = new HumanRig({ shirt: def.shirt, pants: '#2b2b2b', headwrap: def.headwrap, tray: def.tray });
    this.sync();
  }

  get name(): string {
    return this.def.name;
  }

  greet(line: string, faceX: number, faceZ: number): void {
    this.line = line;
    this.talkTimer = 4.5;
    this.heading = Math.atan2(faceZ - this.z, faceX - this.x);
  }

  /** Run in direction (dx, dz) for a moment: dodging a fast car or scattering at a horn. */
  flee(dx: number, dz: number, seconds: number): void {
    const l = Math.hypot(dx, dz) || 1;
    this.fleeX = dx / l;
    this.fleeZ = dz / l;
    this.fleeTimer = Math.max(this.fleeTimer, seconds);
  }

  private pickWander(): void {
    this.idle = this.rand() < 0.3;
    this.stateTimer = 2.5 + this.rand() * 3.5;
    const a = this.rand() * Math.PI * 2;
    this.dirX = Math.cos(a);
    this.dirZ = Math.sin(a);
    const hx = this.homeX - this.x, hz = this.homeZ - this.z, hd = Math.hypot(hx, hz);
    if (hd > this.wanderRadius) {
      this.dirX = hx / hd;
      this.dirZ = hz / hd;
      this.idle = false;
    }
    this.stuck = 0;
  }

  update(dt: number, world: CollisionWorld, blockers: { x: number; z: number; r: number }[]): void {
    let speed = 0;
    this.barkCooldown = Math.max(0, this.barkCooldown - dt);
    if (this.talkTimer > 0) this.talkTimer -= dt;
    let dirX = 0, dirZ = 0, pace = 0;
    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      dirX = this.fleeX;
      dirZ = this.fleeZ;
      pace = 4.2;
      this.idle = false;
      if (this.fleeTimer <= 0) this.stateTimer = 0.5;
    } else if (this.talkTimer <= 0) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.pickWander();
      if (!this.idle) {
        dirX = this.dirX;
        dirZ = this.dirZ;
        pace = this.walkSpeed;
      }
    }
    if (pace > 0) {
      const ox = this.x, oz = this.z;
      this.x += dirX * pace * dt;
      this.z += dirZ * pace * dt;
      world.resolveCircle(this, this.radius);
      for (const b of blockers) {
        const dx = this.x - b.x, dz = this.z - b.z, d = Math.hypot(dx, dz), min = this.radius + b.r;
        if (d < min && d > 1e-4) {
          this.x += (dx / d) * (min - d);
          this.z += (dz / d) * (min - d);
        }
      }
      const moved = Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-4);
      speed = moved;
      this.stuck = moved < 0.3 ? this.stuck + dt : 0;
      if (this.stuck > 0.8 && this.fleeTimer <= 0) this.pickWander();
      if (this.stuck > 0.4 && this.fleeTimer > 0) {
        // Blocked while fleeing: try the other way along the wall.
        [this.fleeX, this.fleeZ] = [-this.fleeZ, this.fleeX];
        this.stuck = 0;
      }
      const target = Math.atan2(dirZ, dirX);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 8);
    }
    this.rig.animate(dt, speed);
    this.sync();
  }

  sync(): void {
    this.rig.root.position.set(this.x, 0, this.z);
    this.rig.root.rotation.y = -this.heading;
  }
}
