import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';

/**
 * "그것" — tall, pale-faced, long-limbed. Lives in the dark; light only slows it.
 * States: HIDDEN -> STALK -> APPROACH -> LUNGE / RETREAT (+ GRAB for the death cinematic).
 * The host simulates it; clients only render.
 */
export class Creature {
  constructor(terrain, forest) {
    this.terrain = terrain;
    this.forest = forest;
    this.root = new THREE.Group();
    this.position = this.root.position;
    this.state = 'HIDDEN';
    this.timer = 6;
    this.litTime = 0;
    this.unlitTime = 0;
    this.targetId = 0;
    this.yaw = 0;
    this.aggression = 0.4;
    this.visibleFactor = 0;
    this.cover = 0;
    this.events = [];
    this.grabbed = false;
    this.cooldown = 0;
    this.pressure = false;
    this._tmp = new THREE.Vector3();

    const black = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1, metalness: 0 });
    const pale = new THREE.MeshStandardMaterial({ color: 0x9a8f85, roughness: 0.85, metalness: 0 });
    const pit = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 });
    const body = new THREE.Group();
    body.position.y = 1.95;
    this.body = body;
    this.root.add(body);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.15, 4, 8), black);
    torso.scale.set(1, 1, 0.5); torso.position.y = 0.6; torso.castShadow = true;
    body.add(torso);
    // ribs: thin dark rings hint at the body shape when lit from the side
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.19 + i * 0.01, 0.012, 5, 12), black);
      rib.rotation.x = Math.PI / 2; rib.scale.set(1, 0.55, 1); rib.position.y = 0.55 + i * 0.16; body.add(rib);
    }
    const neck = new THREE.Group(); neck.position.y = 1.32; body.add(neck);
    this.neck = neck;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), pale);
    head.scale.set(0.8, 1.4, 0.85); head.position.y = 0.17; head.castShadow = true;
    neck.add(head);
    this.head = head;
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.03), pit);
    jaw.position.set(0, 0.07, -0.11); neck.add(jaw);
    this.jaw = jaw;
    this.eyes = [];
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff4a30, emissiveIntensity: 4, roughness: 0.3 });
    for (const s of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), pit);
      socket.position.set(0.05 * s, 0.22, -0.1); neck.add(socket);
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), eyeM);
      e.position.set(0.05 * s, 0.22, -0.125); neck.add(e); this.eyes.push(e);
    }
    this.eyeM = eyeM;
    const mkLimb = (x, y, len, r, withHand) => {
      const g = new THREE.Group(); g.position.set(x, y, 0);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 6), black);
      up.position.y = -len / 2 - r; up.castShadow = true; g.add(up);
      const joint = new THREE.Group(); joint.position.y = -len - r * 2; g.add(joint);
      const lo = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.85, len, 3, 6), black);
      lo.position.y = -len / 2 - r; lo.castShadow = true; joint.add(lo);
      if (withHand) {
        for (let f = 0; f < 3; f++) {
          const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.28, 4), black);
          fin.position.set((f - 1) * 0.03, -len - r * 2 - 0.12, 0); fin.rotation.z = (f - 1) * 0.15; joint.add(fin);
        }
      }
      body.add(g);
      return { g, joint };
    };
    this.armL = mkLimb(-0.27, 1.15, 0.95, 0.035, true);
    this.armR = mkLimb(0.27, 1.15, 0.95, 0.035, true);
    this.legL = mkLimb(-0.1, 0.0, 0.95, 0.05, false);
    this.legR = mkLimb(0.1, 0.0, 0.95, 0.05, false);
    this.root.visible = false;
  }

  _spawnNear(target, lamp, d) {
    const beam = lamp.getBeam(new THREE.Vector3(), new THREE.Vector3());
    let best = null, bestScore = -1;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = target.x + Math.cos(a) * d, z = target.z + Math.sin(a) * d;
      if (!this.terrain.inBounds(x, z)) continue;
      const y = this.terrain.heightAt(x, z);
      const p = new THREE.Vector3(x, y + 1.6, z);
      const lit = lamp.litFactor(p);
      const dirx = x - beam.pos.x, dirz = z - beam.pos.z;
      const dl = Math.hypot(dirx, dirz) || 1;
      const behind = -(dirx / dl * beam.dir.x + dirz / dl * beam.dir.z);
      const score = (1 - lit) * 2 + behind + Math.random() * 0.5;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  update(dt, t, actors, lamp, progress, active) {
    this.aggression = 0.4 + progress * 0.6;
    this.timer -= dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.state === 'GRAB') { this.animate(dt, t, 0); return; }
    const head = this._tmp.copy(this.position); head.y += 3.1;
    const litNow = this.root.visible ? lamp.litFactor(head) : 0;
    if (litNow > 0.35) { this.litTime += dt; this.unlitTime = 0; } else { this.litTime = 0; this.unlitTime += dt; }

    let target = null, tScore = -1;
    for (const a of actors) {
      const p = new THREE.Vector3(a.pos.x, a.pos.y + 1.2, a.pos.z);
      const lit = lamp.litFactor(p);
      const s = (1 - lit) + (a.isHolder ? 0 : 0.35) + (lamp.effective <= 0 ? 0.5 : 0) + (a.busy ? 0.6 : 0);
      if (s > tScore) { tScore = s; target = { ...a, lit }; }
    }
    if (!target) return;
    this.targetId = target.id;
    const toT = new THREE.Vector3(target.pos.x - this.position.x, 0, target.pos.z - this.position.z);
    const dist = toT.length();
    const lampOff = lamp.effective <= 0.05;
    const ag = this.aggression;

    switch (this.state) {
      case 'HIDDEN': {
        this.root.visible = false;
        this.visibleFactor = 0;
        if (this.pressure) { this.timer = Math.min(this.timer, 1.5); this.cooldown = 0; }
        if (active && this.timer <= 0 && this.cooldown <= 0) {
          const sp = this._spawnNear(target.pos, lamp, 20 + Math.random() * 10);
          if (sp) {
            this.position.set(sp.x, sp.y - 1.6, sp.z);
            this.state = 'STALK';
            this.timer = (5 + Math.random() * 7) * (1 - ag * 0.5);
            this.root.visible = true;
            this.events.push({ type: 'stalk' });
          } else this.timer = 2;
        }
        break;
      }
      case 'STALK': {
        this.visibleFactor = damp(this.visibleFactor, 0.7, 2, dt);
        const want = 14 + 6 * (1 - ag);
        const tangent = new THREE.Vector3(-toT.z, 0, toT.x).normalize();
        const radial = toT.clone().normalize().multiplyScalar(clamp((dist - want) * 0.3, -1, 1));
        const move = tangent.multiplyScalar(0.7 * (Math.sin(t * 0.3) > 0 ? 1 : -1)).add(radial).normalize().multiplyScalar(1.3 * dt);
        this.position.add(move);
        if (litNow > 0.35 && this.litTime > 1.0) { this.state = 'RETREAT'; this.timer = 2.5; this.events.push({ type: 'retreat' }); }
        else if (this.timer <= 0 || (target.lit < 0.2 && this.unlitTime > 2.2) || lampOff || this.pressure) {
          this.state = 'APPROACH'; this.timer = 22; this.events.push({ type: 'approach' });
        }
        if (Math.random() < dt * 0.3) this.events.push({ type: 'twig', pos: this.position.clone() });
        if (Math.random() < dt * 0.1) this.events.push({ type: 'whisper', pos: this.position.clone() });
        break;
      }
      case 'APPROACH': {
        this.visibleFactor = damp(this.visibleFactor, 1, 2, dt);
        // light slows it, it doesn't stop it
        const speed = (2.0 + ag * 1.6 + (lampOff ? 1.4 : 0)) * (litNow > 0.35 ? 0.25 : 1);
        if (dist > 0.5) this.position.add(toT.clone().normalize().multiplyScalar(speed * dt));
        if (litNow > 0.35 && this.litTime > 1.6) { this.state = 'RETREAT'; this.timer = 2.5; this.events.push({ type: 'retreat' }); }
        else if (dist < 8 && target.lit < 0.35) { this.state = 'LUNGE'; this.timer = 3; this.events.push({ type: 'lunge', pos: this.position.clone() }); }
        else if (this.timer <= 0) { this.state = 'RETREAT'; this.timer = 2; }
        if (Math.random() < dt * 0.5) this.events.push({ type: 'breath', pos: this.position.clone() });
        break;
      }
      case 'LUNGE': {
        this.visibleFactor = 1;
        const speed = 9;
        if (dist > 0.6) this.position.add(toT.clone().normalize().multiplyScalar(speed * dt));
        if (dist < 1.3) { this.events.push({ type: 'grab', targetId: target.id }); this.state = 'GRAB'; this.timer = 12; this.cooldown = 6; }
        else if (litNow > 0.5 && this.litTime > 0.9) { this.state = 'RETREAT'; this.timer = 3; this.events.push({ type: 'retreat' }); }
        else if (this.timer <= 0) { this.state = 'RETREAT'; this.timer = 2; }
        break;
      }
      case 'RETREAT': {
        this.visibleFactor = damp(this.visibleFactor, 0, 1.5, dt);
        this.position.add(toT.clone().normalize().multiplyScalar(-6 * dt));
        if (this.timer <= 0 || dist > 40) {
          this.state = 'HIDDEN';
          this.root.visible = false;
          this.timer = (9 + Math.random() * 10) * (1.1 - ag * 0.7);
        }
        break;
      }
    }

    if (this.root.visible) {
      const lim = this.terrain.half - 8;
      this.position.x = clamp(this.position.x, -lim, lim);
      this.position.z = clamp(this.position.z, -lim, lim);
      this.position.y = this.terrain.heightAt(this.position.x, this.position.z);
      const wantYaw = Math.atan2(-toT.x, -toT.z);
      let dy = wantYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 7);
    }
    this.cover = damp(this.cover, litNow > 0.3 && this.state !== 'LUNGE' ? 1 : 0, 6, dt);
    this.animate(dt, t, litNow);
  }

  /** death cinematic pose: standing right in front of the victim, reaching */
  setGrab(pos, yaw) {
    this.state = 'GRAB';
    this.root.visible = true;
    this.visibleFactor = 1; this.cover = 0;
    this.position.copy(pos); this.yaw = yaw;
  }

  /** jump-scare: pose it so that its face lands exactly at `headTarget` (world), facing yaw */
  poseGrabAt(feetPos, yaw, headTarget, t) {
    this.setGrab(feetPos, yaw);
    this.animate(0, t, 0);
    this.root.updateMatrixWorld(true);
    const hw = new THREE.Vector3();
    this.head.getWorldPosition(hw);
    this.position.add(headTarget.clone().sub(hw));
    this.root.updateMatrixWorld(true);
  }
  release() { this.state = 'HIDDEN'; this.root.visible = false; this.timer = 20; this.cooldown = 10; }

  animate(dt, t, litNow = 0) {
    this.root.rotation.y = this.yaw;
    const st = this.state;
    const moving = st === 'APPROACH' || st === 'LUNGE' || st === 'RETREAT' || st === 'STALK';
    const fast = st === 'LUNGE' || st === 'RETREAT';
    const ph = t * (fast ? 16 : 6);
    const sw = moving ? (fast ? 1.0 : 0.4) : 0;
    const c = this.cover;
    const grab = st === 'GRAB' ? 1 : 0;
    const lunge = st === 'LUNGE' ? 1 : 0;
    // legs: digitigrade, knees bent backwards
    this.legL.g.rotation.x = -0.35 + Math.sin(ph) * sw;
    this.legR.g.rotation.x = -0.35 + Math.sin(ph + Math.PI) * sw;
    this.legL.joint.rotation.x = 0.6 + Math.max(0, -Math.sin(ph - 0.6)) * sw;
    this.legR.joint.rotation.x = 0.6 + Math.max(0, -Math.sin(ph + Math.PI - 0.6)) * sw;
    // arms: hang long; cover the face when lit; reach when grabbing / lunging
    const reach = Math.max(grab, lunge * 0.7);
    this.armL.g.rotation.x = lerp(lerp(Math.sin(ph + Math.PI) * sw * 0.4, -2.7, c), -1.7, reach);
    this.armR.g.rotation.x = lerp(lerp(Math.sin(ph) * sw * 0.4, -2.7, c), -1.7, reach);
    this.armL.g.rotation.z = lerp(0.1, 0.45, c) - reach * 0.25;
    this.armR.g.rotation.z = lerp(-0.1, -0.45, c) + reach * 0.25;
    this.armL.joint.rotation.x = lerp(-0.2, -0.9, c) - reach * 0.4;
    this.armR.joint.rotation.x = lerp(-0.2, -0.9, c) - reach * 0.4;
    // body: leans into the run, twitches
    const j = st === 'LUNGE' ? 0.07 : grab ? 0.05 : 0.03;
    this.body.position.x = (Math.random() - 0.5) * j;
    this.body.position.y = 1.95 - lunge * 0.5 + (Math.random() - 0.5) * j + (moving ? Math.abs(Math.sin(ph)) * 0.06 : 0);
    this.body.rotation.x = lunge * 0.9 + grab * 1.15 + Math.sin(t * 1.3) * 0.03;
    if (grab) this.body.position.y = 1.35 + (Math.random() - 0.5) * 0.04;
    this.body.rotation.z = Math.sin(t * 0.9) * 0.06 + (Math.random() - 0.5) * 0.02;
    // head: tilted, snapping
    const snap = Math.random() < dt * 1.5 ? (Math.random() - 0.5) * 0.9 : 0;
    this.neck.rotation.z = damp(this.neck.rotation.z, Math.sin(t * 0.7) * 0.35 + snap, 8, dt);
    this.neck.rotation.x = lerp(0.15, -0.6, c) - lunge * 0.6 - grab * 1.35;
    this.neck.rotation.y = grab ? Math.sin(t * 9) * 0.08 : 0;
    // mouth gapes open when it has you
    this.jaw.scale.set(1 + grab * 0.5, 1 + grab * 4.0, 1);
    this.jaw.position.y = 0.07 + grab * 0.03;
    this.jaw.position.z = -0.11 - grab * 0.02;
    this.eyeM.emissiveIntensity = lerp(0, 5, this.visibleFactor) * (1 - c * 0.9) * (0.7 + 0.3 * Math.sin(t * 9)) + grab * 6;
  }

  pack() {
    return { x: +this.position.x.toFixed(2), y: +this.position.y.toFixed(2), z: +this.position.z.toFixed(2), yaw: +this.yaw.toFixed(3), st: this.state, v: +this.visibleFactor.toFixed(2), c: +this.cover.toFixed(2), vis: this.root.visible };
  }
  unpack(d) {
    this._netTarget = this._netTarget || new THREE.Vector3();
    this._netTarget.set(d.x, d.y, d.z);
    this.yaw = d.yaw; this.state = d.st; this.visibleFactor = d.v; this.cover = d.c; this.root.visible = d.vis;
    if (!this._netInit) { this._netInit = true; this.position.copy(this._netTarget); }
  }
  netUpdate(dt, t) {
    if (this._netTarget) this.position.lerp(this._netTarget, Math.min(1, dt * 12));
    this.animate(dt, t);
  }
}
