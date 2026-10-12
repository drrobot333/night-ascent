import * as THREE from 'three';
import { makeRandom } from '../core/noise.js';
import { makeSignpost } from './Props.js';

const metal = new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.55, metalness: 0.7 });
const rust = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.8, metalness: 0.3 });
const wood = new THREE.MeshStandardMaterial({ color: 0x4b3827, roughness: 0.9 });
const bark = new THREE.MeshStandardMaterial({ color: 0x2e241b, roughness: 0.95 });
const reflect = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0x7a4a10, emissiveIntensity: 0.5, roughness: 0.25, metalness: 0.6 });
const redPaint = new THREE.MeshStandardMaterial({ color: 0xb8312c, roughness: 0.6 });

/**
 * Co-op obstacles that block the trail:
 *  - 'lever': an iron gate; its lever sits 15m off the path in the dark, cable on the ground leads to it.
 *  - 'winch': a fallen trunk; cranking the winch takes seconds during which you can't look around.
 * The simulation (progress/done) is owned by the host; visuals animate from state.
 */
export class Quests {
  constructor(terrain, forest) {
    this.terrain = terrain;
    this.forest = forest;
    this.trail = terrain.trail;
    this.group = new THREE.Group();
    this.list = [];
    this.onComplete = null;
    const rng = makeRandom(terrain.seed + 4242);
    const defs = [[0.27, 'lever'], [0.6, 'winch'], [0.82, 'lever']];
    defs.forEach(([f, type], i) => {
      const s = this.trail.length * f;
      const q = { type, index: i, s, done: false, progress: 0, duration: type === 'lever' ? 2.6 : 9, colliders: [], anim: 0 };
      q.name = type === 'lever' ? '잠긴 철문' : '쓰러진 나무';
      if (type === 'lever') this._buildLever(q, rng); else this._buildWinch(q, rng);
      this.list.push(q);
    });
  }

  _blockTrail(q, idx) {
    const p = this.trail.pointAt(idx), d = this.trail.dirAt(idx);
    for (let k = -2; k <= 2; k++) {
      const x = p.x + -d.z * k * 0.9, z = p.z + d.x * k * 0.9;
      q.colliders.push(this.forest.addCollider(x, z, 0.55));
    }
  }

  _buildLever(q, rng) {
    const trail = this.trail, terrain = this.terrain;
    const idx = trail.indexAtDistance(q.s);
    const p = trail.pointAt(idx), d = trail.dirAt(idx);
    const yaw = Math.atan2(d.x, d.z);
    q.gatePos = p.clone();
    // gate: two posts + swinging bars
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z); g.rotation.y = yaw;
    for (const sx of [-2.4, 2.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 0.16), metal); post.position.set(sx, 0.85, 0); post.castShadow = true; g.add(post);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.22), rust); cap.position.set(sx, 1.72, 0); g.add(cap);
    }
    const bars = new THREE.Group(); bars.position.set(-2.4, 0, 0);
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.08, 0.08), rust); bar.position.set(2.4, 0.45 + i * 0.5, 0); bar.castShadow = true; bars.add(bar);
    }
    const diag = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.06, 0.06), rust); diag.position.set(2.4, 0.95, 0.02); diag.rotation.z = 0.2; bars.add(diag);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.09), reflect); tape.position.set(2.4, 1.2, 0); bars.add(tape);
    g.add(bars);
    q.bars = bars;
    const sign = makeSignpost('통행 금지', '레버로 개방 →');
    sign.position.set(-3.2, 0, 0.6); sign.rotation.y = 0; g.add(sign);
    this.group.add(g);
    this._blockTrail(q, idx);

    // lever location: off-trail into the woods, pick the gentler side
    const nrm = new THREE.Vector3();
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 24; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const back = -4 + rng() * 6;
      const out = 13 + rng() * 5;
      const x = p.x + -d.z * side * out + d.x * back, z = p.z + d.x * side * out + d.z * back;
      if (!terrain.inBounds(x, z)) continue;
      terrain.normalAt(x, z, nrm);
      const dh = Math.abs(terrain.heightAt(x, z) - p.y);
      const score = nrm.y * 3 - dh * 0.4 + rng() * 0.3;
      if (score > bestScore) { bestScore = score; best = { x, z, side }; }
    }
    const lx = best.x, lz = best.z, ly = terrain.heightAt(lx, lz);
    q.pos = new THREE.Vector3(lx, ly, lz);
    q.leverPos = q.pos;
    const lv = new THREE.Group(); lv.position.set(lx, ly, lz);
    lv.rotation.y = Math.atan2(p.x - lx, p.z - lz); // faces the gate
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), metal); box.position.y = 0.55; box.castShadow = true; lv.add(box);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.42), reflect); stripe.position.y = 0.95; lv.add(stripe);
    const pivot = new THREE.Group(); pivot.position.set(0, 1.1, 0.0); lv.add(pivot);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), metal); handle.position.y = 0.35; pivot.add(handle);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), redPaint); knob.position.y = 0.72; pivot.add(knob);
    pivot.rotation.x = -0.9;
    q.handle = pivot;
    this.group.add(lv);
    // cable from the gate post to the lever, lying on the ground
    const segs = 14;
    const cable = new THREE.Group();
    let prev = new THREE.Vector3(p.x + -d.z * best.side * 2.4, p.y + 0.05, p.z + d.x * best.side * 2.4);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const cx = prev.x + (lx - prev.x) * (1 / (segs - i + 1)), cz = prev.z + (lz - prev.z) * (1 / (segs - i + 1));
      const cur = new THREE.Vector3(cx, terrain.heightAt(cx, cz) + 0.05, cz);
      const len = prev.distanceTo(cur);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 5), metal);
      m.position.copy(prev).add(cur).multiplyScalar(0.5);
      m.lookAt(cur); m.rotateX(Math.PI / 2);
      cable.add(m);
      if (i % 4 === 0) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), reflect); r.position.copy(cur); r.position.y += 0.06; cable.add(r); }
      prev = cur;
    }
    this.group.add(cable);
  }

  _buildWinch(q, rng) {
    const trail = this.trail, terrain = this.terrain;
    const idx = trail.indexAtDistance(q.s);
    const p = trail.pointAt(idx), d = trail.dirAt(idx);
    const yaw = Math.atan2(d.x, d.z);
    q.gatePos = p.clone();
    // the trunk across the path
    const trunk = new THREE.Group();
    trunk.position.set(p.x, p.y + 0.45, p.z); trunk.rotation.y = yaw;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 7.5, 12), bark);
    log.rotation.z = Math.PI / 2; log.castShadow = true; log.receiveShadow = true; trunk.add(log);
    for (let i = 0; i < 5; i++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.1, 1.2 + rng(), 6), bark);
      br.position.set(-3 + rng() * 6, 0.3, 0); br.rotation.z = (rng() - 0.5) * 1.2; br.rotation.x = (rng() - 0.5) * 1.5; trunk.add(br);
    }
    this.group.add(trunk);
    q.trunk = trunk;
    q.trunkDir = d.clone();
    this._blockTrail(q, idx);
    // winch beside the path, 2.6m to the right, a bit before the trunk
    const side = rng() < 0.5 ? -1 : 1;
    const wx = p.x + -d.z * side * 3.1 - d.x * 2.0, wz = p.z + d.x * side * 3.1 - d.z * 2.0;
    const wy = terrain.heightAt(wx, wz);
    q.pos = new THREE.Vector3(wx, wy, wz);
    q.winchPos = q.pos;
    const w = new THREE.Group(); w.position.set(wx, wy, wz); w.rotation.y = yaw;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), wood); base.position.y = 0.25; base.castShadow = true; w.add(base);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.5), metal); frame.position.set(0, 0.8, 0); w.add(frame);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 14), rust); drum.rotation.z = Math.PI / 2; drum.position.set(0, 1.0, 0); w.add(drum);
    const crank = new THREE.Group(); crank.position.set(0.3, 1.0, 0); w.add(crank);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), metal); arm.position.y = 0.2; crank.add(arm);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8), redPaint); grip.rotation.z = Math.PI / 2; grip.position.set(0.12, 0.4, 0); crank.add(grip);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 0.62), reflect); tape.position.y = 0.52; w.add(tape);
    q.crank = crank; q.drum = drum;
    this.group.add(w);
    const sign = makeSignpost('쓰러진 나무', '윈치로 당기시오');
    sign.position.set(p.x + -d.z * -side * 2.4 - d.x * 2.5, terrain.heightAt(p.x + -d.z * -side * 2.4 - d.x * 2.5, p.z + d.x * -side * 2.4 - d.z * 2.5), p.z + d.x * -side * 2.4 - d.z * 2.5);
    sign.rotation.y = yaw + Math.PI;
    this.group.add(sign);
    // cable from winch to trunk
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 5), metal);
    q.cable = c; this.group.add(c);
  }

  /** nearest unfinished interactable within r of (x,z) */
  interactableNear(x, z, r = 2.3) {
    for (const q of this.list) {
      if (q.done) continue;
      if (Math.hypot(q.pos.x - x, q.pos.z - z) < r) return q;
    }
    return null;
  }

  /** quest whose blocker is within `ahead` meters ahead of trail distance s */
  questAhead(s, ahead = 40) {
    for (const q of this.list) if (!q.done && q.s > s - 3 && q.s - s < ahead) return q;
    return null;
  }

  /** advance a quest by dt of effort; returns true on completion */
  work(q, dt) {
    if (q.done) return false;
    q.progress = Math.min(1, q.progress + dt / q.duration);
    if (q.progress >= 1) { this.complete(q); return true; }
    return false;
  }

  complete(q) {
    if (q.done) return;
    q.done = true; q.progress = 1;
    for (const c of q.colliders) c.active = false;
    if (this.onComplete) this.onComplete(q);
  }

  setState(i, done, progress) {
    const q = this.list[i]; if (!q) return;
    q.progress = progress;
    if (done && !q.done) this.complete(q);
  }

  reset() {
    for (const q of this.list) { q.done = false; q.progress = 0; q.anim = 0; for (const c of q.colliders) c.active = true; }
  }

  update(dt, t) {
    for (const q of this.list) {
      if (q.type === 'lever') {
        q.anim += ((q.done ? 1 : 0) - q.anim) * Math.min(1, dt * 1.5);
        q.bars.rotation.y = -q.anim * 1.5;
        q.handle.rotation.x = -0.9 + q.progress * 1.8;
      } else {
        // the trunk gets dragged sideways off the path as the winch turns
        const slide = q.progress * 5.5;
        const p = q.gatePos, d = q.trunkDir;
        q.trunk.position.set(p.x + -d.z * -slide, p.y + 0.45 - q.progress * 0.2, p.z + d.x * -slide);
        q.trunk.rotation.y = Math.atan2(d.x, d.z) + q.progress * 0.5;
        q.crank.rotation.x = q.progress * 40;
        q.drum.rotation.x = q.progress * 40;
        // cable
        const a = new THREE.Vector3(q.pos.x, q.pos.y + 1.0, q.pos.z), b = q.trunk.position;
        q.cable.position.copy(a).add(b).multiplyScalar(0.5);
        q.cable.scale.y = a.distanceTo(b);
        q.cable.lookAt(b); q.cable.rotateX(Math.PI / 2);
      }
    }
  }
}
