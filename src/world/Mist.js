import * as THREE from 'three';
import { makeRandom } from '../core/noise.js';

function softTexture() {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rng = makeRandom(9);
  ctx.clearRect(0, 0, S, S);
  // a few overlapping soft blobs -> wispy, not a perfect disc
  for (let i = 0; i < 6; i++) {
    const cx = S / 2 + (rng() - 0.5) * S * 0.35, cy = S / 2 + (rng() - 0.5) * S * 0.3;
    const r = S * (0.25 + rng() * 0.2);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

/**
 * Lit mist: camera-facing planes with a standard material so the headlamp
 * actually illuminates the fog around the beam (cheap volumetric feel).
 */
export class Mist {
  constructor(terrain, count = 70) {
    this.terrain = terrain;
    this.count = count;
    this.radius = 42;
    const tex = softTexture();
    this.mat = new THREE.MeshStandardMaterial({
      map: tex, alphaMap: tex, transparent: true, opacity: 0.16, depthWrite: false,
      color: new THREE.Color(0.75, 0.8, 0.9), roughness: 1, metalness: 0, side: THREE.DoubleSide,
    });
    // fade out when a sheet passes close to the camera: otherwise it fills the screen
    // right next to the lamp and the whole view flashes white
    this.mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n diffuseColor.a *= smoothstep(2.5, 9.0, length(vViewPosition));'
      );
    };
    this.geo = new THREE.PlaneGeometry(11, 7);
    this.group = new THREE.Group();
    this.items = [];
    const rng = makeRandom(77);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.renderOrder = 5;
      const it = { mesh: m, vx: (rng() - 0.5) * 0.5, vz: (rng() - 0.5) * 0.5, phase: rng() * 10, h: 0.4 + rng() * 2.8, s: 0.7 + rng() * 1.0 };
      m.scale.setScalar(it.s);
      this.items.push(it);
      this.group.add(m);
    }
    this._seeded = false;
  }

  _respawn(it, center, rng = Math.random, anywhere = true) {
    const a = rng() * Math.PI * 2;
    const r = anywhere ? Math.sqrt(rng()) * this.radius : this.radius * (0.85 + rng() * 0.15);
    it.mesh.position.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
  }

  update(dt, t, camera) {
    const c = camera.position;
    if (!this._seeded) { this._seeded = true; for (const it of this.items) this._respawn(it, c); }
    const windX = 0.35 + Math.sin(t * 0.1) * 0.2, windZ = 0.15 + Math.cos(t * 0.07) * 0.2;
    for (const it of this.items) {
      const m = it.mesh;
      m.position.x += (it.vx + windX) * dt;
      m.position.z += (it.vz + windZ) * dt;
      const dx = m.position.x - c.x, dz = m.position.z - c.z;
      if (dx * dx + dz * dz > this.radius * this.radius) {
        // wrap to the opposite side
        m.position.x = c.x - dx * 0.95; m.position.z = c.z - dz * 0.95;
      }
      const gy = this.terrain.heightAt(m.position.x, m.position.z);
      m.position.y = gy + it.h + Math.sin(t * 0.3 + it.phase) * 0.3;
      m.quaternion.copy(camera.quaternion);
      m.rotation.z += Math.sin(t * 0.05 + it.phase) * 0.4;
    }
  }
}
