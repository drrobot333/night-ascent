import * as THREE from 'three';
import { makeRandom } from '../core/noise.js';
import { makeSignpost } from './Props.js';

/**
 * Hazard sections of the trail where you can only move while your own feet
 * are lit. The lamp holder has to light the partner's footing, then look down
 * and cross on their own while the partner waits in the dark.
 */
const TYPES = ['stream', 'scree', 'logs', 'stream', 'scree', 'logs'];
const NAMES = { stream: '계곡 징검다리', scree: '너덜지대', logs: '썩은 통나무' };

export class Hazards {
  constructor(terrain) {
    this.terrain = terrain;
    const trail = terrain.trail;
    const rng = makeRandom(terrain.seed + 909);
    this.group = new THREE.Group();
    this.zones = [];
    this.waterTime = { value: 0 };
    const fracs = [0.17, 0.36, 0.5, 0.68, 0.76, 0.9];
    fracs.forEach((f, i) => {
      const len = 13 + rng() * 4;
      const s0 = trail.length * f;
      const zone = { s0, s1: s0 + len, type: TYPES[i], name: NAMES[TYPES[i]], index: i, radius: 5.5 };
      this.zones.push(zone);
      this._build(zone, rng);
    });
  }

  /** a ground-conforming sheet (water, mud) laid along the trail between s0..s1 */
  _groundSheet(zone, width, material, sink = 0.06) {
    const trail = this.terrain.trail, terrain = this.terrain;
    const len = zone.s1 - zone.s0 + 2;
    const nu = Math.ceil(len), nv = Math.ceil(width / 1.5);
    const geo = new THREE.PlaneGeometry(len, width, nu, nv);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + len / 2;           // 0..len along the trail
      const v = pos.getY(i);                     // -width/2..width/2 across
      const idx = trail.indexAtDistance(zone.s0 - 1 + u);
      const p = trail.pointAt(idx), d = trail.dirAt(idx);
      const x = p.x + -d.z * v, z = p.z + d.x * v;
      pos.setXYZ(i, x, terrain.heightAt(x, z) - sink, z);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    return m;
  }

  _build(zone, rng) {
    const trail = this.terrain.trail, terrain = this.terrain;
    const i0 = trail.indexAtDistance(zone.s0), i1 = trail.indexAtDistance(zone.s1);
    const mid = trail.indexAtDistance((zone.s0 + zone.s1) / 2);
    const pm = trail.pointAt(mid), dm = trail.dirAt(mid);
    const yawAlong = Math.atan2(dm.x, dm.z);

    // warning sign at the entrance, on the right side of the path
    const pe = trail.pointAt(i0), de = trail.dirAt(i0);
    const sx = pe.x + -de.z * -2.1, sz = pe.z + de.x * -2.1;
    const sign = makeSignpost('위험 구간', '발밑을 비추고 건너시오');
    sign.position.set(sx, terrain.heightAt(sx, sz), sz);
    sign.rotation.y = Math.atan2(de.x, de.z) + Math.PI / 2;
    this.group.add(sign);

    const stone = new THREE.MeshStandardMaterial({ color: 0x6f6d68, roughness: 0.85 });
    if (zone.type === 'stream') {
      // dark water sheet crossing the path, stepping stones along it
      const water = this._groundSheet(zone, 22, new THREE.MeshStandardMaterial({ color: 0x0a1118, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.9 }), 0.05);
      this.group.add(water);
      zone.water = water;
      for (let s = zone.s0 + 1; s < zone.s1; s += 0.9 + rng() * 0.3) {
        const idx = trail.indexAtDistance(s);
        const p = trail.pointAt(idx), d = trail.dirAt(idx);
        const off = (rng() - 0.5) * 0.8;
        const x = p.x + -d.z * off, z = p.z + d.x * off;
        const rock = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 6), stone);
        rock.scale.set(1 + rng() * 0.4, 0.3, 0.9 + rng() * 0.4);
        rock.position.set(x, terrain.heightAt(x, z) - 0.02, z);
        rock.rotation.y = rng() * Math.PI;
        rock.castShadow = true; rock.receiveShadow = true;
        this.group.add(rock);
      }
      // reeds at the water's edge
    } else if (zone.type === 'scree') {
      const geo = new THREE.DodecahedronGeometry(0.35, 0);
      const rocks = new THREE.InstancedMesh(geo, stone, 140);
      const dummy = new THREE.Object3D();
      for (let k = 0; k < 140; k++) {
        const s = zone.s0 - 1 + rng() * (zone.s1 - zone.s0 + 2);
        const idx = trail.indexAtDistance(s);
        const p = trail.pointAt(idx), d = trail.dirAt(idx);
        const off = (rng() - 0.5) * 5;
        const x = p.x + -d.z * off, z = p.z + d.x * off;
        const sc = 0.4 + rng() * 1.1;
        dummy.position.set(x, terrain.heightAt(x, z) - sc * 0.12, z);
        dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        dummy.scale.set(sc, sc * 0.7, sc);
        dummy.updateMatrix();
        rocks.setMatrixAt(k, dummy.matrix);
      }
      rocks.castShadow = true; rocks.receiveShadow = true;
      this.group.add(rocks);
    } else {
      // mud + rotten logs laid across the path
      const mud = this._groundSheet(zone, 6, new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.35, metalness: 0.05 }), 0.04);
      this.group.add(mud);
      const wood = new THREE.MeshStandardMaterial({ color: 0x3a2d22, roughness: 0.95 });
      for (let s = zone.s0 + 1; s < zone.s1; s += 1.3 + rng() * 0.5) {
        const idx = trail.indexAtDistance(s);
        const p = trail.pointAt(idx), d = trail.dirAt(idx);
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.14 + rng() * 0.08, 0.16 + rng() * 0.08, 3.2 + rng() * 1.5, 8), wood);
        log.position.set(p.x, p.y + 0.1, p.z);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = Math.atan2(d.x, d.z) + (rng() - 0.5) * 0.5;
        log.castShadow = true; log.receiveShadow = true;
        this.group.add(log);
      }
    }
  }

  /** zone containing world position, or null */
  zoneAt(x, z) {
    const near = this.terrain.trail.nearest(x, z, 2);
    if (near.d > 5.5) return null;
    for (const zn of this.zones) if (near.s >= zn.s0 && near.s <= zn.s1) return zn;
    return null;
  }

  /** next zone ahead of a trail distance s (within lookahead meters) */
  zoneAhead(s, lookahead = 10) {
    for (const zn of this.zones) if (zn.s0 > s && zn.s0 - s < lookahead) return zn;
    return null;
  }

  update(t) {
    for (const zn of this.zones) if (zn.water) zn.water.material.roughness = 0.1 + Math.sin(t * 1.3 + zn.index) * 0.04;
  }
}
