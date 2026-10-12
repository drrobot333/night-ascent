import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom, clamp, smoothstep } from '../core/noise.js';

function addColor(geo, color, jitter = 0, rng = Math.random) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (rng() - 0.5) * jitter;
    arr[i * 3] = color.r * j; arr[i * 3 + 1] = color.g * j; arr[i * 3 + 2] = color.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function jitterVerts(geo, amt, rng) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + (rng() - 0.5) * amt, p.getY(i) + (rng() - 0.5) * amt * 0.5, p.getZ(i) + (rng() - 0.5) * amt);
  }
  geo.computeVertexNormals();
  return geo;
}

function pineGeometry(rng) {
  const parts = [];
  const trunkC = new THREE.Color(0.14, 0.095, 0.07);
  const needleC = new THREE.Color(0.075, 0.13, 0.07);
  const trunk = new THREE.CylinderGeometry(0.14, 0.34, 8, 7, 1);
  trunk.translate(0, 4, 0);
  parts.push(addColor(trunk, trunkC, 0.3, rng));
  const tiers = [[2.6, 3.4, 4.4], [2.25, 3.2, 6.4], [1.8, 3.0, 8.3], [1.25, 2.6, 10.0], [0.7, 2.2, 11.4]];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 9, 1, true);
    cone.translate(0, y + h / 2 - 0.8, 0);
    jitterVerts(cone, 0.35, rng);
    parts.push(addColor(cone, needleC, 0.5, rng));
  }
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

function deadTreeGeometry(rng) {
  const parts = [];
  const c = new THREE.Color(0.17, 0.15, 0.13);
  const trunk = new THREE.CylinderGeometry(0.08, 0.3, 9, 6, 1);
  trunk.translate(0, 4.5, 0);
  parts.push(addColor(trunk, c, 0.35, rng));
  for (let i = 0; i < 4; i++) {
    const br = new THREE.CylinderGeometry(0.03, 0.08, 2.2 + rng() * 1.5, 4, 1);
    br.translate(0, 1.2, 0);
    br.rotateZ(0.7 + rng() * 0.6);
    br.rotateY(rng() * Math.PI * 2);
    br.translate(0, 4.5 + rng() * 3.5, 0);
    parts.push(addColor(br, c, 0.35, rng));
  }
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

function rockGeometry(rng, noise) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = noise.n3(v.x * 1.6, v.y * 1.6, v.z * 1.6) * 0.28 + noise.n3(v.x * 4, v.y * 4, v.z * 4) * 0.08;
    v.multiplyScalar(1 + n);
    v.y *= 0.7;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return addColor(g, new THREE.Color(0.36, 0.36, 0.34), 0.3, rng);
}

function grassTexture() {
  const S = 128;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const rng = makeRandom(42);
  for (let i = 0; i < 22; i++) {
    const x0 = 10 + rng() * (S - 20);
    const w = 3 + rng() * 4;
    const h = S * (0.55 + rng() * 0.45);
    const lean = (rng() - 0.5) * 40;
    const shade = 120 + rng() * 80;
    ctx.fillStyle = `rgb(${shade * 0.75 | 0},${shade | 0},${shade * 0.55 | 0})`;
    ctx.beginPath();
    ctx.moveTo(x0 - w, S);
    ctx.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.5, x0 + lean, S - h);
    ctx.quadraticCurveTo(x0 + lean * 0.3 + w * 0.3, S - h * 0.5, x0 + w, S);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tuftGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const pl = new THREE.PlaneGeometry(1.1, 0.75, 1, 2);
    pl.translate(0, 0.375, 0);
    pl.rotateY(i * Math.PI / 3);
    parts.push(pl);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

/**
 * Forest: instanced pines, dead trees, rocks, grass tufts and bushes.
 * Also builds a collision hash of trunks for the player.
 */
export class Forest {
  constructor(terrain, quality = 'medium') {
    this.terrain = terrain;
    const rng = makeRandom(terrain.seed + 101);
    const noise = terrain.noise;
    const trail = terrain.trail;
    const half = terrain.half - 14;
    this.group = new THREE.Group();
    this.colliders = [];
    this.colCell = 6;
    this.colHash = new Map();
    this.time = { value: 0 };

    const counts = quality === 'high' ? { pine: 4200, dead: 420, rock: 700, grass: 9000, bush: 2200 }
      : quality === 'low' ? { pine: 2200, dead: 240, rock: 400, grass: 3500, bush: 900 }
        : { pine: 3200, dead: 320, rock: 550, grass: 6500, bush: 1500 };

    const summit = terrain.summit;
    const nrm = new THREE.Vector3();
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // ---------- pines ----------
    const pineGeo = pineGeometry(rng);
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const pines = new THREE.InstancedMesh(pineGeo, treeMat, counts.pine);
    pines.castShadow = true; pines.receiveShadow = true;
    let placed = 0, tries = 0;
    while (placed < counts.pine && tries < counts.pine * 12) {
      tries++;
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      const near = trail.nearest(x, z, 3);
      if (near.d < 3.6 + rng() * 2.5) continue;
      if (Math.hypot(x - summit.x, z - summit.z) < 16) continue;
      terrain.normalAt(x, z, nrm);
      if (nrm.y < 0.6) continue;
      const density = noise.fbm2(x / 90 + 7, z / 90, 2) * 0.5 + 0.5;
      if (rng() > 0.25 + density * 0.9) continue;
      const y = terrain.heightAt(x, z);
      const s = 0.75 + rng() * 0.7;
      dummy.position.set(x, y - 0.3, z);
      dummy.rotation.set((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08);
      dummy.scale.set(s * (0.9 + rng() * 0.2), s, s * (0.9 + rng() * 0.2));
      dummy.updateMatrix();
      pines.setMatrixAt(placed, dummy.matrix);
      color.setRGB(0.85 + rng() * 0.3, 0.85 + rng() * 0.3, 0.85 + rng() * 0.25);
      pines.setColorAt(placed, color);
      this._addCollider(x, z, 0.32 * s);
      placed++;
    }
    pines.count = placed;
    pines.instanceMatrix.needsUpdate = true;
    pines.frustumCulled = false;
    this.group.add(pines);

    // ---------- dead trees ----------
    const deadGeo = deadTreeGeometry(rng);
    const dead = new THREE.InstancedMesh(deadGeo, treeMat, counts.dead);
    dead.castShadow = true; dead.receiveShadow = true;
    placed = 0; tries = 0;
    while (placed < counts.dead && tries < counts.dead * 20) {
      tries++;
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      const near = trail.nearest(x, z, 3);
      if (near.d < 2.6) continue;
      if (near.d > 40) continue; // keep them where players see them
      if (Math.hypot(x - summit.x, z - summit.z) < 16) continue;
      const y = terrain.heightAt(x, z);
      const s = 0.7 + rng() * 0.8;
      dummy.position.set(x, y - 0.2, z);
      dummy.rotation.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      dead.setMatrixAt(placed, dummy.matrix);
      this._addCollider(x, z, 0.28 * s);
      placed++;
    }
    dead.count = placed; dead.instanceMatrix.needsUpdate = true; dead.frustumCulled = false;
    this.group.add(dead);

    // ---------- rocks ----------
    const rockGeo = rockGeometry(rng, noise);
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, counts.rock);
    rocks.castShadow = true; rocks.receiveShadow = true;
    placed = 0; tries = 0;
    while (placed < counts.rock && tries < counts.rock * 20) {
      tries++;
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      const near = trail.nearest(x, z, 3);
      if (near.d < 1.7 || near.d > 45) continue;
      if (Math.hypot(x - summit.x, z - summit.z) < 12) continue;
      const y = terrain.heightAt(x, z);
      const s = 0.3 + Math.pow(rng(), 2.2) * 1.8;
      dummy.position.set(x, y - s * 0.3, z);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      dummy.scale.set(s * (0.8 + rng() * 0.5), s * (0.6 + rng() * 0.5), s * (0.8 + rng() * 0.5));
      dummy.updateMatrix();
      rocks.setMatrixAt(placed, dummy.matrix);
      if (s > 0.8) this._addCollider(x, z, s * 0.7);
      placed++;
    }
    rocks.count = placed; rocks.instanceMatrix.needsUpdate = true; rocks.frustumCulled = false;
    this.group.add(rocks);

    // ---------- grass & bushes ----------
    const gTex = grassTexture();
    const tuftGeo = tuftGeometry();
    const makeFoliageMat = (col) => {
      const m = new THREE.MeshStandardMaterial({ map: gTex, alphaTest: 0.45, side: THREE.DoubleSide, color: col, roughness: 1, metalness: 0 });
      const time = this.time;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = time;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              float ph = instanceMatrix[3][0] * 0.35 + instanceMatrix[3][2] * 0.27;
              float sway = sin(uTime * 1.4 + ph) * 0.5 + sin(uTime * 2.9 + ph * 1.7) * 0.25;
              float w = uv.y * uv.y;
              transformed.x += sway * 0.12 * w;
              transformed.z += cos(uTime * 1.1 + ph) * 0.06 * w;
            }`);
      };
      return m;
    };
    const grassMat = makeFoliageMat(new THREE.Color(0.30, 0.32, 0.20));
    const bushMat = makeFoliageMat(new THREE.Color(0.17, 0.23, 0.14));

    const grass = new THREE.InstancedMesh(tuftGeo, grassMat, counts.grass);
    grass.receiveShadow = true;
    placed = 0; tries = 0;
    while (placed < counts.grass && tries < counts.grass * 10) {
      tries++;
      // sample near the trail so the budget goes where players look
      const idx = Math.floor(rng() * trail.count);
      const px = trail.points[idx * 3], pz = trail.points[idx * 3 + 2];
      const ang = rng() * Math.PI * 2, rad = 1.2 + Math.pow(rng(), 0.7) * 14;
      const x = px + Math.cos(ang) * rad, z = pz + Math.sin(ang) * rad;
      if (!terrain.inBounds(x, z)) continue;
      const near = trail.nearest(x, z, 2);
      if (near.d < 1.1) continue;
      const y = terrain.heightAt(x, z);
      const s = 0.5 + rng() * 0.9;
      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.set(s, s * (0.7 + rng() * 0.6), s);
      dummy.updateMatrix();
      grass.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    grass.count = placed; grass.instanceMatrix.needsUpdate = true; grass.frustumCulled = false;
    this.group.add(grass);

    const bush = new THREE.InstancedMesh(tuftGeo, bushMat, counts.bush);
    bush.receiveShadow = true;
    placed = 0; tries = 0;
    while (placed < counts.bush && tries < counts.bush * 10) {
      tries++;
      const idx = Math.floor(rng() * trail.count);
      const px = trail.points[idx * 3], pz = trail.points[idx * 3 + 2];
      const ang = rng() * Math.PI * 2, rad = 3 + rng() * 30;
      const x = px + Math.cos(ang) * rad, z = pz + Math.sin(ang) * rad;
      if (!terrain.inBounds(x, z)) continue;
      const near = trail.nearest(x, z, 3);
      if (near.d < 2.2) continue;
      const y = terrain.heightAt(x, z);
      const s = 1.6 + rng() * 2.2;
      dummy.position.set(x, y - 0.1, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.set(s, s * 0.8, s);
      dummy.updateMatrix();
      bush.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    bush.count = placed; bush.instanceMatrix.needsUpdate = true; bush.frustumCulled = false;
    this.group.add(bush);

    // ---------- hanging ribbons on trees near the trail (Korean hiking-club ribbons) ----------
    const ribbonCols = [0xd9342b, 0xf0b35a, 0x3a7bd5, 0xffffff, 0x2fa84f, 0xf26ca7];
    const ribGeo = new THREE.PlaneGeometry(0.06, 0.45, 1, 3);
    ribGeo.translate(0, -0.225, 0);
    const ribbons = new THREE.Group();
    for (let i = 0; i < 260; i++) {
      const idx = Math.floor(rng() * trail.count);
      const px = trail.points[idx * 3], pz = trail.points[idx * 3 + 2];
      const ang = rng() * Math.PI * 2, rad = 1.8 + rng() * 2.0;
      const x = px + Math.cos(ang) * rad, z = pz + Math.sin(ang) * rad;
      const y = terrain.heightAt(x, z) + 1.5 + rng() * 0.6;
      const m = new THREE.Mesh(ribGeo, new THREE.MeshStandardMaterial({ color: ribbonCols[i % ribbonCols.length], side: THREE.DoubleSide, roughness: 0.7 }));
      m.position.set(x, y, z);
      m.rotation.y = rng() * Math.PI * 2;
      m.rotation.z = (rng() - 0.5) * 0.3;
      m.userData.phase = rng() * 10;
      ribbons.add(m);
    }
    this.ribbons = ribbons;
    this.group.add(ribbons);
  }

  _addCollider(x, z, r) {
    const c = { x, z, r, active: true };
    this.colliders.push(c);
    const k = Math.floor(x / this.colCell) * 73856093 ^ Math.floor(z / this.colCell) * 19349663;
    let arr = this.colHash.get(k);
    if (!arr) { arr = []; this.colHash.set(k, arr); }
    arr.push(c);
    return c;
  }
  addCollider(x, z, r) { return this._addCollider(x, z, r); }

  /** push a circle of radius pr at (pos.x,pos.z) out of trunks; mutates pos */
  collide(pos, pr = 0.45) {
    const cx = Math.floor(pos.x / this.colCell), cz = Math.floor(pos.z / this.colCell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = this.colHash.get((cx + dx) * 73856093 ^ (cz + dz) * 19349663);
      if (!arr) continue;
      for (const c of arr) {
        if (!c.active) continue;
        const ox = pos.x - c.x, oz = pos.z - c.z;
        const d = Math.hypot(ox, oz), min = c.r + pr;
        if (d < min && d > 1e-4) {
          const push = (min - d) / d;
          pos.x += ox * push; pos.z += oz * push;
        }
      }
    }
  }

  update(t) {
    this.time.value = t;
    const r = this.ribbons.children;
    for (let i = 0; i < r.length; i++) {
      const m = r[i];
      m.rotation.z = Math.sin(t * 1.7 + m.userData.phase) * 0.25;
      m.rotation.x = Math.sin(t * 1.1 + m.userData.phase * 1.3) * 0.2;
    }
  }
}
