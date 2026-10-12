import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';

/**
 * First-person hiker controller: pointer-lock look, terrain-following walk,
 * sprint/stamina, head bob, trunk collisions, footstep events.
 */
export class PlayerController {
  constructor(camera, terrain, forest, canvas) {
    this.camera = camera;
    this.terrain = terrain;
    this.forest = forest;
    this.canvas = canvas;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eyeHeight = 1.68;
    this.keys = {};
    this.enabled = false;
    this.locked = false;
    this.stamina = 1;
    this.sprinting = false;
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.speed = 0;
    this.onFootstep = null;
    this.onKey = null;
    this.sensitivity = 0.0021;
    this.fearShake = 0;
    this._lastStepSide = 0;
    this._tmp = new THREE.Vector3();
    this._bobY = 0;
    this._pitchLean = 0;
    this.camera.rotation.order = 'YXZ';

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (this.enabled && this.onKey) this.onKey(e.code);
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = clamp(this.pitch, -1.35, 1.35);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    window.addEventListener('blur', () => { this.keys = {}; });
  }

  requestLock() {
    try { this.canvas.requestPointerLock(); } catch (e) { /* ignore */ }
  }

  teleport(x, z, yaw = 0) {
    this.position.set(x, this.terrain.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.bobPhase = 0;
  }

  get forward() { return this._tmp.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt, slowFactor = 1) {
    const k = this.keys;
    let ix = 0, iz = 0;
    if (this.enabled && this.locked) {
      if (k.KeyW || k.ArrowUp) iz += 1;
      if (k.KeyS || k.ArrowDown) iz -= 1;
      if (k.KeyA || k.ArrowLeft) ix -= 1;
      if (k.KeyD || k.ArrowRight) ix += 1;
    }
    const wantSprint = (k.ShiftLeft || k.ShiftRight) && iz > 0 && this.stamina > 0.05;
    this.sprinting = !!wantSprint;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len; iz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, -cos); right = (cos, -sin)
    const dx = (-sin * iz + cos * ix), dz = (-cos * iz - sin * ix);
    const baseSpeed = this.sprinting ? 4.6 : 2.4;
    // slope: slower uphill, slightly faster downhill
    const ahead = this.terrain.heightAt(this.position.x + dx * 1.2, this.position.z + dz * 1.2) - this.position.y;
    const slopeF = ahead > 0 ? clamp(1 - ahead * 0.55, 0.3, 1) : clamp(1 - ahead * 0.12, 1, 1.25);
    const target = baseSpeed * slopeF * slowFactor;
    const accel = (ix || iz) ? 14 : 18;
    this.velocity.x = damp(this.velocity.x, dx * target, accel, dt);
    this.velocity.z = damp(this.velocity.z, dz * target, accel, dt);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    // world bounds
    const lim = this.terrain.half - 10;
    this.position.x = clamp(this.position.x, -lim, lim);
    this.position.z = clamp(this.position.z, -lim, lim);
    this.forest.collide(this.position, 0.45);
    const gy = this.terrain.heightAt(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, gy, 25, dt);

    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = sp;
    // stamina
    if (this.sprinting && sp > 1) this.stamina = clamp(this.stamina - dt * 0.14, 0, 1);
    else this.stamina = clamp(this.stamina + dt * (sp > 0.5 ? 0.06 : 0.12), 0, 1);

    // head bob + footsteps
    const stride = this.sprinting ? 1.9 : 1.4;
    const prev = this.bobPhase;
    this.bobPhase += (sp / stride) * Math.PI * 2 * dt;
    this.bobAmt = damp(this.bobAmt, clamp(sp / 2.4, 0, 1.6), 8, dt);
    const stepNow = Math.floor(this.bobPhase / Math.PI), stepPrev = Math.floor(prev / Math.PI);
    if (stepNow !== stepPrev && sp > 0.4 && this.onFootstep) {
      this.onFootstep({ sprint: this.sprinting, onTrail: this.terrain.trailMaskAt(this.position.x, this.position.z) > 0.4, speed: sp });
    }
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.bobAmt;
    const bobX = Math.sin(this.bobPhase * 0.5) * 0.02 * this.bobAmt;
    // breathing + fear shake
    const t = performance.now() / 1000;
    const breathe = Math.sin(t * 1.3) * 0.004 * (1 + (1 - this.stamina) * 3);
    const shake = this.fearShake;
    const sx = (Math.sin(t * 23.1) + Math.sin(t * 17.7)) * 0.004 * shake;
    const sy = (Math.sin(t * 19.3) + Math.sin(t * 29.1)) * 0.004 * shake;

    this.camera.position.set(
      this.position.x + bobX * cos,
      this.position.y + this.eyeHeight + bobY + breathe,
      this.position.z - bobX * sin,
    );
    this.camera.rotation.set(this.pitch + sy + Math.sin(this.bobPhase) * 0.004 * this.bobAmt, this.yaw + sx, Math.sin(this.bobPhase * 0.5) * 0.012 * this.bobAmt);
  }
}
