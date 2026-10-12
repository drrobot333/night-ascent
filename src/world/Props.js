import * as THREE from 'three';
import { makeRandom } from '../core/noise.js';

function textTexture(lines, opts = {}) {
  const w = opts.w || 512, h = opts.h || 128;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = opts.bg || '#5a4530';
  ctx.fillRect(0, 0, w, h);
  // wood grain
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.06})`;
    ctx.fillRect(0, Math.random() * h, w, 1 + Math.random() * 3);
  }
  ctx.fillStyle = opts.fg || '#f1ead9';
  ctx.font = `${opts.weight || 600} ${opts.size || 54}px 'Noto Sans KR', 'Malgun Gothic', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (opts.size || 54) * 1.2));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.9 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x4b3827, roughness: 0.9 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x2b2019, roughness: 0.95 });
const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xe8552f, emissive: 0x5a1a08, emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 0.6 });

export function makeCairn(rng) {
  const g = new THREE.Group();
  const levels = 6;
  let y = 0;
  for (let i = 0; i < levels; i++) {
    const r = 0.42 - i * 0.055;
    const h = 0.16 - i * 0.012;
    const geo = new THREE.SphereGeometry(1, 10, 7);
    const m = new THREE.Mesh(geo, stoneMat);
    m.scale.set(r * (0.9 + rng() * 0.3), h, r * (0.9 + rng() * 0.3));
    m.position.set((rng() - 0.5) * 0.08, y + h, (rng() - 0.5) * 0.08);
    m.rotation.y = rng() * Math.PI;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    y += h * 1.7;
  }
  // a tied ribbon marker
  const rib = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.3), ribbonMat);
  rib.position.set(0.1, y + 0.1, 0.2);
  rib.rotation.y = 0.6;
  g.add(rib);
  g.userData.height = y;
  return g;
}

const flipArrows = (t) => t.replace(/[→←]/g, (c) => (c === '→' ? '←' : '→'));

export function makeSignpost(text, sub) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), woodMat);
  post.position.y = 1.1; post.castShadow = true; post.receiveShadow = true;
  g.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.32, 0.05), [
    darkWood, darkWood, darkWood, darkWood,
    new THREE.MeshStandardMaterial({ map: textTexture([text], { size: 60 }), roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ map: textTexture([flipArrows(text)], { size: 60 }), roughness: 0.85 }),
  ]);
  board.position.set(0, 1.85, 0); board.castShadow = true; board.receiveShadow = true;
  g.add(board);
  if (sub) {
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.05), [
      darkWood, darkWood, darkWood, darkWood,
      new THREE.MeshStandardMaterial({ map: textTexture([sub], { size: 44, bg: '#4a3826' }), roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: textTexture([flipArrows(sub)], { size: 44, bg: '#4a3826' }), roughness: 0.85 }),
    ]);
    b2.position.set(0, 1.5, 0); b2.castShadow = true;
    g.add(b2);
  }
  return g;
}

export function makeBattery() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.45, metalness: 0.3 }));
  body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 0.3, metalness: 0.8 }));
  cap.position.y = 0.115;
  g.add(cap);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.05, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xf0b35a, roughness: 0.5 }));
  band.position.y = 0.04;
  g.add(band);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), new THREE.MeshStandardMaterial({ color: 0x55ff88, emissive: 0x44ff77, emissiveIntensity: 3 }));
  led.position.set(0, -0.03, 0.078);
  g.add(led);
  g.userData.led = led;
  return g;
}

export function makeShelter() {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x5c4a39, roughness: 0.9 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8, metalness: 0.2 });
  const W = 7, D = 5.2, H = 2.9;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wall);
  body.position.y = H / 2; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // log texture lines
  for (let i = 0; i < 7; i++) {
    const ln = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.04, D + 0.04), darkWood);
    ln.position.y = 0.4 * (i + 0.5);
    g.add(ln);
  }
  // gable roof
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(W + 1.0, 0.12, 3.6), roofM);
  roofL.position.set(0, H + 0.95, -D / 4 - 0.15); roofL.rotation.x = Math.PI / 5.2; roofL.castShadow = true; roofL.receiveShadow = true;
  const roofR = roofL.clone(); roofR.position.z = D / 4 + 0.15; roofR.rotation.x = -Math.PI / 5.2;
  g.add(roofL, roofR);
  // gable ends: a triangular prism spanning the width
  const tri = new THREE.Shape();
  tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, 1.85); tri.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(tri, { depth: W, bevelEnabled: false });
  gableGeo.rotateY(Math.PI / 2);
  gableGeo.translate(-W / 2, H, 0);
  const gable = new THREE.Mesh(gableGeo, wall);
  gable.castShadow = true; gable.receiveShadow = true;
  g.add(gable);
  // door (front = +z)
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.1), darkWood);
  door.position.set(0, 1.05, D / 2 + 0.03);
  g.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.8, roughness: 0.3 }));
  knob.position.set(0.35, 1.0, D / 2 + 0.1);
  g.add(knob);
  // windows with warm light
  const winMat = new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 2.6, roughness: 0.2 });
  const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.06), winMat);
  win1.position.set(-2.1, 1.7, D / 2 + 0.03);
  const win2 = win1.clone(); win2.position.x = 2.1;
  g.add(win1, win2);
  // window frames
  const frameM = new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.9 });
  for (const wx of [-2.1, 2.1]) {
    const fv = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.84, 0.1), frameM); fv.position.set(wx, 1.7, D / 2 + 0.05);
    const fh = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.06, 0.1), frameM); fh.position.set(wx, 1.7, D / 2 + 0.05);
    g.add(fv, fh);
  }
  // porch lamp
  const lampHousing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), frameM);
  lampHousing.position.set(0, 2.55, D / 2 + 0.2);
  g.add(lampHousing);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffd090, emissive: 0xffb050, emissiveIntensity: 6 }));
  bulb.position.set(0, 2.45, D / 2 + 0.2);
  g.add(bulb);
  const porch = new THREE.PointLight(0xffb060, 60, 26, 2);
  porch.position.set(0, 2.4, D / 2 + 0.5);
  porch.castShadow = false;
  g.add(porch);
  const inner = new THREE.PointLight(0xffa040, 25, 14, 2);
  inner.position.set(0, 1.7, D / 2 + 0.9);
  g.add(inner);
  // chimney + sign
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), stoneMat);
  chimney.position.set(2.2, H + 1.3, -0.6);
  g.add(chimney);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.06), [
    darkWood, darkWood, darkWood, darkWood,
    new THREE.MeshStandardMaterial({ map: textTexture(['정상 대피소'], { size: 64, bg: '#3f2e1f' }), roughness: 0.85 }),
    darkWood,
  ]);
  sign.position.set(0, 2.45 + 0.4, D / 2 + 0.04);
  g.add(sign);
  // summit stone
  const stone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.8 }));
  stone.position.set(5.2, 0.7, 2.5); stone.castShadow = true; stone.receiveShadow = true;
  const stoneFace = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2), new THREE.MeshStandardMaterial({ map: textTexture(['정 상', '1,247m'], { size: 70, bg: '#6d6a66', fg: '#f3eee4', w: 256, h: 512 }), roughness: 0.8 }));
  stoneFace.position.set(5.2, 0.75, 2.71);
  g.add(stone, stoneFace);
  g.userData.doorOffset = new THREE.Vector3(0, 0, D / 2 + 1.2);
  return g;
}

/**
 * Places checkpoints (cairns), signposts, batteries and the summit shelter along the trail.
 */
export class Props {
  constructor(terrain) {
    this.terrain = terrain;
    const trail = terrain.trail;
    const rng = makeRandom(terrain.seed + 555);
    this.group = new THREE.Group();
    this.checkpoints = [];   // {pos, s, index}
    this.batteries = [];     // {mesh, pos, taken}
    const total = trail.length;

    // --- cairns every ~75m, offset to the side of the path ---
    const spacing = 75;
    const nCp = Math.floor(total / spacing);
    for (let i = 1; i <= nCp; i++) {
      const s = i * spacing;
      const idx = trail.indexAtDistance(s);
      const p = trail.pointAt(idx), dir = trail.dirAt(idx);
      const side = (i % 2 === 0 ? 1 : -1);
      const x = p.x + -dir.z * side * 1.9, z = p.z + dir.x * side * 1.9;
      const y = terrain.heightAt(x, z);
      const cairn = makeCairn(rng);
      cairn.position.set(x, y - 0.05, z);
      cairn.rotation.y = rng() * Math.PI * 2;
      this.group.add(cairn);
      const remain = Math.max(0, total - s);
      this.checkpoints.push({ pos: new THREE.Vector3(p.x, p.y, p.z), s, index: i, remain, mesh: cairn });
      if (i % 3 === 0) {
        const sx = p.x + -dir.z * -side * 2.1, sz = p.z + dir.x * -side * 2.1;
        const sy = terrain.heightAt(sx, sz);
        const km = (remain / 1000).toFixed(1);
        const sign = makeSignpost(`정상 ${km}km →`, `등산로 ${i}`);
        sign.position.set(sx, sy, sz);
        sign.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
        this.group.add(sign);
      }
    }
    // trailhead sign
    {
      const p = trail.pointAt(6), dir = trail.dirAt(6);
      const sx = p.x + -dir.z * 2.2, sz = p.z + dir.x * 2.2;
      const sign = makeSignpost(`정상 ${(total / 1000).toFixed(1)}km →`, '야간 산행 주의');
      sign.position.set(sx, terrain.heightAt(sx, sz), sz);
      sign.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
      this.group.add(sign);
    }

    // --- batteries ---
    const batSpots = [0.12, 0.31, 0.44, 0.54, 0.64, 0.73, 0.86];
    for (const f of batSpots) {
      const s = total * f + (rng() - 0.5) * 20;
      const idx = trail.indexAtDistance(s);
      const p = trail.pointAt(idx), dir = trail.dirAt(idx);
      const side = rng() < 0.5 ? -1 : 1;
      const off = 0.8 + rng() * 1.8;
      const x = p.x + -dir.z * side * off, z = p.z + dir.x * side * off;
      const y = terrain.heightAt(x, z) + 0.12;
      const mesh = makeBattery();
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.PI / 2 * (rng() < 0.5 ? 1 : 0), rng() * Math.PI * 2, 0);
      this.group.add(mesh);
      this.batteries.push({ mesh, pos: new THREE.Vector3(x, y, z), taken: false, id: this.batteries.length });
    }

    // --- shelter ---
    const shelter = makeShelter();
    const end = trail.end, edir = trail.endDir;
    // place it ahead of the trail end, facing back down the path
    const sx = end.x + edir.x * 7.5, sz = end.z + edir.z * 7.5;
    shelter.position.set(sx, trail.end.y - 0.02, sz);
    shelter.rotation.y = Math.atan2(edir.x, edir.z) + Math.PI;
    this.group.add(shelter);
    this.shelter = shelter;
    const doorLocal = shelter.userData.doorOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), shelter.rotation.y);
    this.doorPos = new THREE.Vector3(sx, trail.end.y, sz).add(doorLocal);
    this.summitPos = this.doorPos.clone();

    this._buildTrailFurniture(rng);
  }

  /** log steps on steep pitches, rope railings along them, reflective marker posts every 25m */
  _buildTrailFurniture(rng) {
    const trail = this.terrain.trail, terrain = this.terrain;
    const dummy = new THREE.Object3D();
    const stepMats = [], postMats = [], markerMats = [];
    const ropes = new THREE.Group();
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.95 });
    const ropeGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 5);
    let lastPost = null, lastPostS = -99, runLen = 0;
    const addRope = (a, b) => {
      const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= 0.1;
      for (const [p0, p1] of [[a, mid], [mid, b]]) {
        const m = new THREE.Mesh(ropeGeo, ropeMat);
        m.position.copy(p0).add(p1).multiplyScalar(0.5);
        m.scale.y = p0.distanceTo(p1);
        m.lookAt(p1); m.rotateX(Math.PI / 2);
        ropes.add(m);
      }
    };
    for (let s = 3; s < trail.length - 12; s += 0.75) {
      const i = trail.indexAtDistance(s), i2 = trail.indexAtDistance(s + 3);
      const slope = (trail.points[i2 * 3 + 1] - trail.points[i * 3 + 1]) / 3;
      const p = trail.pointAt(i), d = trail.dirAt(i);
      const yaw = Math.atan2(d.x, d.z);
      const steep = Math.abs(slope) > 0.24;
      if (steep) {
        dummy.position.set(p.x + (rng() - 0.5) * 0.2, p.y + 0.03, p.z + (rng() - 0.5) * 0.2);
        dummy.rotation.set(0, yaw + (rng() - 0.5) * 0.1, 0);
        dummy.scale.set(0.85 + rng() * 0.3, 1, 1);
        dummy.updateMatrix(); stepMats.push(dummy.matrix.clone());
        runLen += 0.75;
        if (runLen > 4 && s - lastPostS >= 2.4) {
          const px = p.x + d.z * 1.35, pz = p.z - d.x * 1.35; // left side of the path
          const py = terrain.heightAt(px, pz);
          if (Math.abs(py - p.y) < 1.6) {
            dummy.position.set(px, py + 0.5, pz); dummy.rotation.set((rng() - 0.5) * 0.1, yaw, (rng() - 0.5) * 0.1); dummy.scale.set(1, 1, 1);
            dummy.updateMatrix(); postMats.push(dummy.matrix.clone());
            const top = new THREE.Vector3(px, py + 0.95, pz);
            if (lastPost && s - lastPostS < 3.5) addRope(lastPost, top);
            lastPost = top; lastPostS = s;
          }
        }
      } else { runLen = 0; lastPost = null; }
    }
    // marker posts (red band + reflective tape) every 25m on the right
    for (let s = 12; s < trail.length - 15; s += 25) {
      const i = trail.indexAtDistance(s);
      const p = trail.pointAt(i), d = trail.dirAt(i);
      const mx = p.x + -d.z * 1.7, mz = p.z + d.x * 1.7;
      const my = terrain.heightAt(mx, mz);
      dummy.position.set(mx, my, mz); dummy.rotation.set(0, Math.atan2(d.x, d.z), 0); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); markerMats.push(dummy.matrix.clone());
    }
    const mk = (geo, mat, mats, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
      mats.forEach((m, k) => im.setMatrixAt(k, m));
      im.count = mats.length; im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false;
      this.group.add(im);
    };
    mk(new THREE.BoxGeometry(2.4, 0.16, 0.34), darkWood, stepMats);
    mk(new THREE.CylinderGeometry(0.05, 0.065, 1.0, 7), woodMat, postMats);
    const markerPost = new THREE.BoxGeometry(0.1, 1.1, 0.1); markerPost.translate(0, 0.55, 0);
    mk(markerPost, woodMat, markerMats);
    const band = new THREE.BoxGeometry(0.11, 0.14, 0.11); band.translate(0, 1.0, 0);
    mk(band, new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.6 }), markerMats, false);
    const tape = new THREE.BoxGeometry(0.115, 0.06, 0.115); tape.translate(0, 0.86, 0);
    mk(tape, new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0x8a5a14, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.7 }), markerMats, false);
    this.group.add(ropes);
  }

  update(t) {
    for (const b of this.batteries) {
      if (b.taken) continue;
      b.mesh.position.y = b.pos.y + Math.sin(t * 2 + b.id) * 0.03;
      b.mesh.userData.led.material.emissiveIntensity = 2 + Math.sin(t * 5 + b.id) * 1.5;
    }
  }

  /** next checkpoint info for a progress distance s */
  nextCheckpoint(s) {
    for (const c of this.checkpoints) if (c.s > s + 2) return c;
    return null;
  }

  lastCheckpointBefore(s) {
    let best = null;
    for (const c of this.checkpoints) if (c.s <= s) best = c;
    return best;
  }
}
