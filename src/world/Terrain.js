import * as THREE from 'three';
import { makeNoise, makeRandom, clamp, lerp, smoothstep } from '../core/noise.js';
import { Trail } from './Trail.js';

/**
 * Procedural mountain: a forested spur rising ~230m, with a switchback trail
 * carved into the hillside and a flat shoulder at the summit for the shelter.
 */
export class Terrain {
  constructor(seed = 1337) {
    this.seed = seed;
    this.size = 720;
    this.segments = 360;           // 2m cells
    this.half = this.size / 2;
    this.noise = makeNoise(seed);
    this.rng = makeRandom(seed + 7);

    const zStart = -335, zEnd = 325;
    const noise = this.noise;

    const ridgeX = (z) => 42 * Math.sin(z / 150) + 24 * Math.sin(z / 63 + 1.3);
    const rawHeight = (x, z) => {
      const t = clamp((z + 350) / 700, 0, 1);
      let rise = 235 * Math.pow(t, 1.45);
      const plateau = 235 * Math.pow(0.95, 1.45);
      rise = lerp(rise, plateau, smoothstep(0.91, 0.975, t));
      const d = x - ridgeX(z);
      const drop = -0.0038 * d * d;
      const n = 30 * noise.fbm2(x / 210, z / 210, 3) + 7 * noise.n2(x / 52, z / 52) + 1.6 * noise.n2(x / 13, z / 13) + 0.35 * noise.n2(x / 3.4, z / 3.4);
      return rise + drop + n;
    };
    this.world = { zStart, zEnd, ridgeX, rawHeight };

    this.trail = new Trail(this.world, noise, this.rng);
    this.summit = this.trail.end.clone();

    this._buildHeightGrid();
    this._buildGeometry();
  }

  // ---------------- height field ----------------
  _buildHeightGrid() {
    const seg = this.segments, n = seg + 1, size = this.size, half = this.half;
    const heights = new Float32Array(n * n);
    const trailMask = new Float32Array(n * n);
    const trail = this.trail;
    const summit = this.summit;
    const endIdx = trail.count - 1;
    for (let iz = 0; iz < n; iz++) {
      const z = -half + (iz / seg) * size;
      for (let ix = 0; ix < n; ix++) {
        const x = -half + (ix / seg) * size;
        let h = this.world.rawHeight(x, z);
        const near = trail.nearest(x, z, 2);
        let mask = 0;
        if (near.d < 7) {
          const ty = trail.points[near.idx * 3 + 1];
          const w = 1 - smoothstep(1.9, 6.5, near.d);
          // slight groove in the middle of the path
          const groove = near.d < 1.8 ? -0.12 * (1 - (near.d / 1.8) ** 2) : 0;
          h = lerp(h, ty + groove, w);
          mask = 1 - smoothstep(2.1, 4.6, near.d);
        }
        // summit shoulder: flatten a disc around the shelter
        const ds = Math.hypot(x - summit.x, z - summit.z);
        if (ds < 22) {
          const w = 1 - smoothstep(9, 22, ds);
          h = lerp(h, trail.points[endIdx * 3 + 1], w);
        }
        heights[iz * n + ix] = h;
        trailMask[iz * n + ix] = mask;
      }
    }
    this.heights = heights;
    this.trailMask = trailMask;
    this.n = n;
  }

  heightAt(x, z) {
    const seg = this.segments, n = this.n;
    const fx = clamp((x + this.half) / this.size * seg, 0, seg - 1e-6);
    const fz = clamp((z + this.half) / this.size * seg, 0, seg - 1e-6);
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const h = this.heights;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.8;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  trailMaskAt(x, z) {
    const seg = this.segments, n = this.n;
    const ix = clamp(Math.round((x + this.half) / this.size * seg), 0, seg);
    const iz = clamp(Math.round((z + this.half) / this.size * seg), 0, seg);
    return this.trailMask[iz * n + ix];
  }

  inBounds(x, z, margin = 12) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  // ---------------- textures ----------------
  _makeDetailTextures() {
    const noise = this.noise;
    // albedo detail: grayscale speckle + leaf litter blotches
    const S = 512;
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S * 8, v = y / S * 8; // 8 periods per tile (tile = 6m -> 0.75m features)
        // tileable via sampling on a torus
        const a = Math.cos(u * Math.PI * 2 / 8) , b = Math.sin(u * Math.PI * 2 / 8);
        const c = Math.cos(v * Math.PI * 2 / 8) , e = Math.sin(v * Math.PI * 2 / 8);
        const n1 = noise.n3(a * 2.5, b * 2.5, c * 2.5 + e * 2.5) * 0.5 + 0.5;
        const n2 = noise.n3(a * 9 + 3.1, b * 9, c * 9 + e * 9) * 0.5 + 0.5;
        const n3 = noise.n3(a * 24 + 7.7, b * 24, c * 24 + e * 24) * 0.5 + 0.5;
        let g = 0.55 + 0.25 * n1 + 0.15 * n2 + 0.12 * n3;
        // warm/cool subtle tint variation
        const r = g * (1.0 + 0.08 * (n2 - 0.5)), gg = g, bb = g * (1.0 - 0.10 * (n2 - 0.5));
        const i = (y * S + x) * 4;
        d[i] = clamp(r, 0, 1) * 255; d[i + 1] = clamp(gg, 0, 1) * 255; d[i + 2] = clamp(bb, 0, 1) * 255; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(cv);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;

    // normal map from a tileable height field
    const N = 512;
    const hv = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const a = Math.cos(u * Math.PI * 2), b = Math.sin(u * Math.PI * 2);
      const c = Math.cos(v * Math.PI * 2), e = Math.sin(v * Math.PI * 2);
      let h = 0;
      h += noise.n3(a * 3, b * 3, c * 3 + e * 3) * 1.0;
      h += noise.n3(a * 8 + 5, b * 8, c * 8 + e * 8) * 0.5;
      h += noise.n3(a * 20 + 9, b * 20, c * 20 + e * 20) * 0.25;
      h += noise.n3(a * 48 + 13, b * 48, c * 48 + e * 48) * 0.12;
      hv[y * N + x] = h;
    }
    const cv2 = document.createElement('canvas'); cv2.width = cv2.height = N;
    const ctx2 = cv2.getContext('2d');
    const img2 = ctx2.createImageData(N, N);
    const d2 = img2.data;
    const strength = 2.2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const l = hv[y * N + ((x - 1 + N) % N)], r = hv[y * N + ((x + 1) % N)];
      const u = hv[((y - 1 + N) % N) * N + x], dn = hv[((y + 1) % N) * N + x];
      const nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * N + x) * 4;
      d2[i] = (nx / len * 0.5 + 0.5) * 255; d2[i + 1] = (ny / len * 0.5 + 0.5) * 255; d2[i + 2] = (nz / len * 0.5 + 0.5) * 255; d2[i + 3] = 255;
    }
    ctx2.putImageData(img2, 0, 0);
    const normalMap = new THREE.CanvasTexture(cv2);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = 8;
    return { map, normalMap };
  }

  // ---------------- mesh ----------------
  _buildGeometry() {
    const seg = this.segments, n = this.n, size = this.size, half = this.half;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const noise = this.noise;
    const cGrass = new THREE.Color(0.26, 0.25, 0.15);
    const cLitter = new THREE.Color(0.30, 0.22, 0.13);
    const cDirt = new THREE.Color(0.50, 0.40, 0.28);
    const cRock = new THREE.Color(0.38, 0.38, 0.36);
    const cMoss = new THREE.Color(0.18, 0.24, 0.13);
    const tmp = new THREE.Color();
    const nrm = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // PlaneGeometry (after rotation) row/col ordering matches our grid: ix along x, iz along z
      const ix = Math.round((x + half) / size * seg), iz = Math.round((z + half) / size * seg);
      const h = this.heights[iz * n + ix];
      pos.setY(i, h);
      const mask = this.trailMask[iz * n + ix];
      this.normalAt(x, z, nrm);
      const slope = 1 - nrm.y;
      const v1 = noise.n2(x / 17 + 100, z / 17) * 0.5 + 0.5;
      const v2 = noise.n2(x / 4.3 + 50, z / 4.3) * 0.5 + 0.5;
      tmp.copy(cGrass).lerp(cLitter, v1);
      tmp.lerp(cMoss, smoothstep(0.55, 0.9, v2) * 0.5);
      tmp.lerp(cRock, smoothstep(0.22, 0.45, slope));
      tmp.lerp(cDirt, mask * (0.75 + 0.25 * v2));
      // darker, wetter look in valleys
      const valley = smoothstep(80, 0, h);
      tmp.multiplyScalar(1 - 0.15 * valley);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const { map, normalMap } = this._makeDetailTextures();
    const rep = size / 6;
    map.repeat.set(rep, rep);
    normalMap.repeat.set(rep, rep);
    const mat = new THREE.MeshStandardMaterial({
      map, normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.94, metalness: 0.0, vertexColors: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain';
    this.mesh = mesh;
  }
}
