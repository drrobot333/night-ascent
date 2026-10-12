import * as THREE from 'three';
import { damp } from '../core/noise.js';

function capsule(r, len, mat, seg = 8) {
  const g = new THREE.CapsuleGeometry(r, len, 3, seg);
  g.translate(0, -len / 2 - r, 0); // pivot at the top end
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/**
 * A procedurally animated hiker. Faces -Z. Root is at the feet.
 * `head` holds a `lampMount` where the Headlamp group can be attached.
 */
export class Humanoid {
  constructor({ jacket = 0xb8312c, pants = 0x2a2d35, skin = 0xd9b38c, hat = 0x3a3028 } = {}) {
    this.root = new THREE.Group();
    this.yaw = 0;
    this.phase = 0;
    this.speed = 0;
    this.gait = 0;
    this._lookYaw = 0; this._lookPitch = 0;

    const jacketM = new THREE.MeshStandardMaterial({ color: jacket, roughness: 0.8 });
    const pantsM = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
    const skinM = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
    const hatM = new THREE.MeshStandardMaterial({ color: hat, roughness: 0.95 });
    const packM = new THREE.MeshStandardMaterial({ color: 0x1f2a24, roughness: 0.9 });
    const bootM = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.9 });

    // body
    this.body = new THREE.Group();
    this.body.position.y = 0.95;
    this.root.add(this.body);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 4, 10), jacketM);
    torso.scale.set(1, 1, 0.7);
    torso.position.y = 0.33; torso.castShadow = true; torso.receiveShadow = true;
    this.body.add(torso);
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.12, 3, 10), pantsM);
    hips.scale.set(1, 1, 0.75); hips.position.y = 0.02; hips.castShadow = true;
    this.body.add(hips);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.2), packM);
    pack.position.set(0, 0.32, 0.22); pack.castShadow = true; pack.receiveShadow = true;
    this.body.add(pack);
    const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.03), packM); strapL.position.set(-0.1, 0.38, -0.12);
    const strapR = strapL.clone(); strapR.position.x = 0.1;
    this.body.add(strapL, strapR);

    // head
    this.neck = new THREE.Group();
    this.neck.position.y = 0.6;
    this.body.add(this.neck);
    this.head = new THREE.Group();
    this.head.position.y = 0.08;
    this.neck.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), skinM);
    skull.position.y = 0.1; skull.castShadow = true;
    this.head.add(skull);
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hatM);
    beanie.position.y = 0.11; beanie.castShadow = true;
    this.head.add(beanie);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.018, 6, 16), hatM);
    brim.rotation.x = Math.PI / 2; brim.position.y = 0.085;
    this.head.add(brim);
    this.lampMount = new THREE.Group();
    this.lampMount.position.set(0, 0.13, -0.11);
    this.head.add(this.lampMount);
    // a headband so the lamp looks worn
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 20), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }));
    band.rotation.x = Math.PI / 2; band.position.y = 0.13;
    this.head.add(band);

    // arms
    const mkArm = (side) => {
      const sh = new THREE.Group(); sh.position.set(0.25 * side, 0.52, 0);
      const up = capsule(0.055, 0.26, jacketM); sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.33; sh.add(el);
      const lo = capsule(0.048, 0.24, jacketM); el.add(lo);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), skinM); hand.position.y = -0.34; hand.castShadow = true; el.add(hand);
      this.body.add(sh);
      return { sh, el };
    };
    this.armL = mkArm(-1); this.armR = mkArm(1);

    // legs
    const mkLeg = (side) => {
      const hip = new THREE.Group(); hip.position.set(0.11 * side, 0.0, 0);
      const th = capsule(0.075, 0.33, pantsM); hip.add(th);
      const kn = new THREE.Group(); kn.position.y = -0.46; hip.add(kn);
      const sh = capsule(0.062, 0.3, pantsM); kn.add(sh);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.26), bootM); boot.position.set(0, -0.44, -0.04); boot.castShadow = true; kn.add(boot);
      this.body.add(hip);
      return { hip, kn };
    };
    this.legL = mkLeg(-1); this.legR = mkLeg(1);

    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.position = this.root.position;
    this.targetLook = { yaw: 0, pitch: 0 };
  }

  setYaw(y) { this.yaw = y; }

  /** @param speed horizontal speed in m/s */
  update(dt, t, speed, { headYaw = 0, headPitch = 0 } = {}) {
    this.speed = speed;
    const moving = speed > 0.08;
    this.gait = damp(this.gait, moving ? Math.min(1, speed / 1.6) : 0, 8, dt);
    const stride = 1.35;
    this.phase += dt * (speed / stride) * Math.PI * 2 * 0.55;
    const p = this.phase;
    const g = this.gait;
    const run = Math.max(0, (speed - 2.2) / 3);
    const swing = (0.55 + run * 0.4) * g;
    // legs
    this.legL.hip.rotation.x = Math.sin(p) * swing;
    this.legR.hip.rotation.x = Math.sin(p + Math.PI) * swing;
    this.legL.kn.rotation.x = -Math.max(0, Math.sin(p - 0.6)) * (0.9 + run * 0.6) * g;
    this.legR.kn.rotation.x = -Math.max(0, Math.sin(p + Math.PI - 0.6)) * (0.9 + run * 0.6) * g;
    // arms (counter swing), relaxed when idle
    this.armL.sh.rotation.x = Math.sin(p + Math.PI) * swing * 0.8 + 0.1;
    this.armR.sh.rotation.x = Math.sin(p) * swing * 0.8 + 0.1;
    this.armL.sh.rotation.z = 0.12; this.armR.sh.rotation.z = -0.12;
    this.armL.el.rotation.x = 0.35 + Math.max(0, Math.sin(p + Math.PI)) * 0.5 * g + run * 0.8;
    this.armR.el.rotation.x = 0.35 + Math.max(0, Math.sin(p)) * 0.5 * g + run * 0.8;
    // body bob, lean, breathing
    const breathe = Math.sin(t * 1.4) * 0.006;
    this.body.position.y = 0.95 + Math.abs(Math.sin(p)) * 0.04 * g + breathe;
    this.body.rotation.x = -(0.05 * g + run * 0.15);
    this.body.rotation.z = Math.sin(p) * 0.03 * g;
    // head look (clamped so the neck doesn't break)
    this._lookYaw = damp(this._lookYaw, THREE.MathUtils.clamp(headYaw, -1.2, 1.2), 10, dt);
    this._lookPitch = damp(this._lookPitch, THREE.MathUtils.clamp(headPitch, -1.1, 0.8), 10, dt);
    this.neck.rotation.y = this._lookYaw;
    this.neck.rotation.x = this._lookPitch;
    this.root.rotation.y = this.yaw;
  }
}
