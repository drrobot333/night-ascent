import * as THREE from 'three';
import { clamp, smoothstep } from '../core/noise.js';

/**
 * The hiking trail: a smooth 3D path from trailhead to summit.
 * Provides nearest-point queries via a spatial hash so terrain carving,
 * prop placement and AI can all reason about "distance to the path".
 */
export class Trail {
  constructor(world, noise, rng) {
    this.world = world;
    const { zStart, zEnd } = world;

    // --- horizontal control points: ridge-following with meanders (switchbacks) ---
    const ctrl = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = zStart + (zEnd - zStart) * t;
      let x = world.ridgeX(z);
      if (i > 0 && i < N) {
        x += 62 * Math.sin(i * 1.95 + 0.6) * (0.55 + 0.45 * Math.sin(i * 0.7));
        x += noise.n2(i * 0.37, 4.2) * 14;
      }
      ctrl.push(new THREE.Vector3(x, 0, z));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal', 0.5);
    const approxLen = curve.getLength();
    const count = Math.ceil(approxLen / 0.5);
    const pts = curve.getSpacedPoints(count);

    // --- heights: sample raw terrain, then smooth and limit the slope ---
    const n = pts.length;
    const h = new Float32Array(n);
    for (let i = 0; i < n; i++) h[i] = world.rawHeight(pts[i].x, pts[i].z);
    const smooth = (arr, r, passes) => {
      let a = arr;
      for (let p = 0; p < passes; p++) {
        const b = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let s = 0, c = 0;
          for (let k = -r; k <= r; k++) { const j = clamp(i + k, 0, n - 1); s += a[j]; c++; }
          b[i] = s / c;
        }
        a = b;
      }
      return a;
    };
    let hs = smooth(h, 24, 3);
    // slope limiter (max ~32 degrees along the path)
    const maxStep = 0.5 * Math.tan(32 * Math.PI / 180);
    for (let i = 1; i < n; i++) {
      const d = hs[i] - hs[i - 1];
      if (d > maxStep) hs[i] = hs[i - 1] + maxStep;
      else if (d < -maxStep) hs[i] = hs[i - 1] - maxStep;
    }
    // trail ends at a flat summit shoulder
    for (let i = n - 60; i < n; i++) if (i >= 0) hs[i] = hs[Math.max(0, n - 60)];
    hs = smooth(hs, 10, 2);

    this.points = new Float32Array(n * 3);
    this.dist = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.points[i * 3] = pts[i].x;
      this.points[i * 3 + 1] = hs[i];
      this.points[i * 3 + 2] = pts[i].z;
      if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      this.dist[i] = acc;
    }
    this.count = n;
    this.length = acc;

    // --- spatial hash ---
    this.cell = 8;
    this.hash = new Map();
    for (let i = 0; i < n; i++) {
      const k = this._key(pts[i].x, pts[i].z);
      let arr = this.hash.get(k);
      if (!arr) { arr = []; this.hash.set(k, arr); }
      arr.push(i);
    }

    this.start = this.pointAt(0);
    this.end = this.pointAt(n - 1);
    this.endDir = this.dirAt(n - 1);
  }

  _key(x, z) { return (Math.floor(x / this.cell) * 73856093) ^ (Math.floor(z / this.cell) * 19349663); }

  pointAt(i, out = new THREE.Vector3()) {
    i = clamp(i | 0, 0, this.count - 1);
    return out.set(this.points[i * 3], this.points[i * 3 + 1], this.points[i * 3 + 2]);
  }

  dirAt(i, out = new THREE.Vector3()) {
    const a = clamp(i - 4, 0, this.count - 1), b = clamp(i + 4, 0, this.count - 1);
    out.set(this.points[b * 3] - this.points[a * 3], 0, this.points[b * 3 + 2] - this.points[a * 3 + 2]);
    return out.lengthSq() > 0 ? out.normalize() : out.set(0, 0, 1);
  }

  /** index for a distance along the trail (meters) */
  indexAtDistance(s) {
    s = clamp(s, 0, this.length);
    let lo = 0, hi = this.count - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.dist[mid] < s) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** nearest trail sample to (x,z). Searches a growing ring of cells; returns {idx, d, s} */
  nearest(x, z, maxRings = 6) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxRings; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const arr = this.hash.get(((cx + dx) * 73856093) ^ ((cz + dz) * 19349663));
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) {
            const j = arr[i];
            const ddx = this.points[j * 3] - x, ddz = this.points[j * 3 + 2] - z;
            const d = ddx * ddx + ddz * ddz;
            if (d < bestD) { bestD = d; best = j; }
          }
        }
      }
      // once we found something and the ring is beyond the best distance, stop
      if (best >= 0 && (r * this.cell) > Math.sqrt(bestD) + this.cell) break;
    }
    if (best < 0) return { idx: 0, d: 1e9, s: 0 };
    return { idx: best, d: Math.sqrt(bestD), s: this.dist[best] };
  }

  distanceTo(x, z) { return this.nearest(x, z).d; }

  /** 0..1 blend weight for "this point is on the trail" */
  trailMask(x, z, inner = 1.9, outer = 5.5) {
    const d = this.distanceTo(x, z);
    return 1 - smoothstep(inner, outer, d);
  }
}
