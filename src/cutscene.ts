import * as THREE from 'three';
import { HumanLook, HumanRig } from './human';
import type { Player } from './player';
import type { Pose } from './poses';
import { BlkKingRig } from './blkking';
import { loaded, ModelName } from './models';

/**
 * Short mission introductions, played in the game engine with what the project has: the procedural
 * person rigs, gesture poses (poses.ts), camera moves and subtitled lines. There are no motion-capture
 * or keyframed animation clips. Every shot is data (public/data/missions.json), so a new mission adds
 * a cutscene without code.
 */
export type V3 = [number, number, number];

export interface CutActor {
  id: string;
  name: string;
  look: HumanLook;
  /** Play this actor with one of Bayo's character models (models.ts) when it has loaded; else the look. */
  model?: ModelName;
  x: number;
  z: number;
  heading: number;
  /** Sitting on a chair (the Chairman behind his desk). */
  seated?: boolean;
}

/** Root height for someone sitting on a chair (seat about 0.46 m). */
const SEAT_Y = -0.36;

export interface CutShot {
  /** Seconds this shot lasts. */
  t: number;
  /** Camera position at the start and end of the shot (a slow move), and what it looks at. */
  cam: V3;
  camTo?: V3;
  look: V3;
  lookTo?: V3;
  fov?: number;
  /** Subtitle: who speaks ('player' is you) and the line. */
  who?: string;
  line?: string;
  /** Gestures by actor id ('player' for you); actors not listed go back to idle. */
  poses?: Record<string, Pose>;
  /** Actors turning to a new heading (radians) during the shot. */
  face?: Record<string, number>;
  /** Sit down (true) or stand up (false) from this shot on, by actor id ('player' for you). */
  sit?: Record<string, boolean>;
}

export interface CutsceneDef {
  /** Where you stand during the scene (you are put back on your feet here). */
  player: { x: number; z: number; heading: number };
  actors: CutActor[];
  shots: CutShot[];
}

const ease = (u: number) => u * u * (3 - 2 * u);
const lerp3 = (a: V3, b: V3, u: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);

export class Cutscene {
  t = 0;
  shot = 0;
  done = false;
  private shotT = 0;
  private cast = new Map<string, { rig: HumanRig | BlkKingRig; heading: number; target: number; seated: boolean }>();
  private playerSeated = false;
  private playerHeading = 0;
  private playerTarget = 0;

  constructor(private scene: THREE.Scene, readonly def: CutsceneDef, private player: Player) {}

  /** Seconds the whole scene runs. */
  get length(): number {
    return this.def.shots.reduce((a, s) => a + s.t, 0);
  }

  /** Put the cast and the player in place. */
  begin(): void {
    for (const a of this.def.actors) {
      const scene = a.model && loaded.get(a.model);
      let rig: HumanRig | BlkKingRig;
      try {
        rig = scene ? new BlkKingRig(scene, { name: a.name, hideProp: true }) : new HumanRig(a.look);
      } catch (e) {
        console.warn(`${a.name}: model could not be used; using the look instead.`, e);
        rig = new HumanRig(a.look);
      }
      rig.root.name = `cut-${a.id}`;
      rig.root.position.set(a.x, 0, a.z);
      rig.root.rotation.y = -a.heading;
      this.scene.add(rig.root);
      this.cast.set(a.id, { rig, heading: a.heading, target: a.heading, seated: !!a.seated });
      rig.seated = !!a.seated;
    }
    const p = this.def.player;
    this.player.x = p.x;
    this.player.z = p.z;
    this.player.y = 0;
    this.player.vy = 0;
    this.player.heading = this.playerHeading = this.playerTarget = p.heading;
    this.player.visible = true;
    this.player.sync();
    this.enterShot();
  }

  /** The subtitle for the current shot. */
  get line(): { who: string; text: string } | null {
    const s = this.def.shots[this.shot];
    if (!s?.line) return null;
    const who = s.who === 'player' ? 'You' : this.def.actors.find((a) => a.id === s.who)?.name ?? s.who ?? '';
    return { who, text: s.line };
  }

  /** Actor rigs by id (tests check their gestures). */
  actor(id: string): HumanRig | BlkKingRig | undefined {
    return this.cast.get(id)?.rig;
  }

  private enterShot(): void {
    const s = this.def.shots[this.shot];
    if (!s) return;
    for (const [id, c] of this.cast) {
      c.rig.pose = s.poses?.[id] ?? 'none';
      if (s.face?.[id] !== undefined) c.target = s.face[id];
      if (s.sit?.[id] !== undefined) c.rig.seated = c.seated = s.sit[id];
    }
    if (s.sit?.player !== undefined) this.player.rig.seated = this.playerSeated = s.sit.player;
    this.player.rig.pose = s.poses?.player ?? 'none';
    if (s.face?.player !== undefined) this.playerTarget = s.face.player;
  }

  /** Advance the scene and drive the camera. Returns false once it has finished. */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    if (this.done) return false;
    this.t += dt;
    this.shotT += dt;
    let s = this.def.shots[this.shot];
    while (s && this.shotT >= s.t) {
      this.shotT -= s.t;
      this.shot++;
      s = this.def.shots[this.shot];
      if (s) this.enterShot();
    }
    if (!s) {
      this.done = true;
      return false;
    }
    // Camera: a slow move within the shot; a hard cut between shots.
    const u = ease(Math.min(1, this.shotT / s.t));
    camera.position.copy(lerp3(s.cam, s.camTo ?? s.cam, u));
    camera.lookAt(lerp3(s.look, s.lookTo ?? s.look, u));
    const fov = s.fov ?? 45;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Cast: turn smoothly, idle-breathe and gesture.
    const turn = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, dt * 5);
    for (const c of this.cast.values()) {
      c.heading = turn(c.heading, c.target);
      c.rig.root.rotation.y = -c.heading;
      c.rig.root.position.y = c.seated ? SEAT_Y : 0;
      c.rig.animate(dt, 0);
    }
    this.playerHeading = turn(this.playerHeading, this.playerTarget);
    this.player.heading = this.playerHeading;
    this.player.sync();
    if (this.playerSeated) this.player.rig.root.position.y = SEAT_Y;
    this.player.rig.animate(dt, 0, false);
    return true;
  }

  /** Remove the cast and return the player's figure to normal. */
  end(): void {
    for (const c of this.cast.values()) c.rig.root.removeFromParent();
    this.cast.clear();
    this.player.rig.pose = 'none';
    this.player.rig.seated = this.playerSeated = false;
    this.done = true;
  }
}
