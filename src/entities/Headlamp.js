import * as THREE from 'three';
import { clamp, smoothstep } from '../core/noise.js';

const coneVert = /* glsl */`
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const coneFrag = /* glsl */`
precision highp float;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWorldPos;
uniform float uLength;
uniform float uIntensity;
uniform float uTime;
uniform vec3 uColor;
void main() {
  float t = clamp(-vLocal.z / uLength, 0.0, 1.0);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - abs(dot(normalize(vNormalW), v)), 1.6);
  float a = pow(1.0 - t, 2.2) * smoothstep(0.0, 0.05, t);
  a *= mix(0.35, 1.0, fres);
  // fade the sheet out when it passes right next to the camera
  a *= smoothstep(0.6, 4.5, distance(cameraPosition, vWorldPos));
  // subtle drifting dust/haze modulation
  float n = sin(vWorldPos.x * 3.1 + uTime * 0.7) * sin(vWorldPos.y * 2.7 - uTime * 0.5) * sin(vWorldPos.z * 2.3 + uTime * 0.3);
  a *= 0.85 + 0.15 * n;
  gl_FragColor = vec4(uColor * a * uIntensity, a * uIntensity);
}`;

function glareTexture() {
  const S = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,245,220,1)');
  g.addColorStop(0.12, 'rgba(255,230,190,0.8)');
  g.addColorStop(0.4, 'rgba(255,200,140,0.18)');
  g.addColorStop(1, 'rgba(255,180,120,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

/**
 * The single headlamp. Attach `group` to whichever head carries it.
 */
export class Headlamp {
  constructor(quality = 'medium') {
    this.group = new THREE.Group();
    this.group.name = 'headlamp';
    this.on = true;
    this.battery = 1.0;
    this.baseIntensity = 17;
    this.flicker = 1;
    this.ownView = true;
    this.dim = 1;
    this._dropout = 0;

    const light = new THREE.SpotLight(0xffe4b8, this.baseIntensity, 62, 0.5, 0.62, 1.2);
    light.position.set(0, 0, 0);
    light.castShadow = true;
    const shadowSize = quality === 'high' ? 2048 : quality === 'low' ? 1024 : 2048;
    light.shadow.mapSize.set(shadowSize, shadowSize);
    light.shadow.camera.near = 0.4;
    light.shadow.camera.far = 50;
    light.shadow.camera.fov = 60;
    light.shadow.bias = -0.00035;
    light.shadow.normalBias = 0.03;
    light.shadow.radius = 4;
    this.light = light;
    this.target = new THREE.Object3D();
    this.target.position.set(0, 0, -1);
    this.group.add(this.target);
    light.target = this.target;
    this.group.add(light);

    // soft near fill so the holder's hands/ground aren't pitch black at the beam edge
    this.fill = new THREE.PointLight(0xffd9a8, 0.6, 4.5, 2);
    this.fill.position.set(0, -0.1, -0.2);
    this.group.add(this.fill);

    // volumetric cone
    const len = 26, rad = Math.tan(0.5) * len;
    const cg = new THREE.ConeGeometry(rad, len, 40, 1, true);
    cg.translate(0, -len / 2, 0);
    cg.rotateX(Math.PI / 2);
    this.coneUniforms = { uLength: { value: len }, uIntensity: { value: 0.22 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.85, 0.62) } };
    const cm = new THREE.ShaderMaterial({
      vertexShader: coneVert, fragmentShader: coneFrag, uniforms: this.coneUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.cone = new THREE.Mesh(cg, cm);
    this.cone.renderOrder = 6;
    this.cone.frustumCulled = false;
    this.group.add(this.cone);

    // lamp body (visible on the partner's forehead)
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.05), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5 }));
    this.body.position.set(0, 0, 0.01);
    this.group.add(this.body);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0b0, emissiveIntensity: 20 }));
    this.lens.position.set(0, 0, -0.016);
    this.lens.rotation.y = Math.PI;
    this.group.add(this.lens);

    // glare sprite (seen through fog from far away)
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTexture(), color: 0xffe2b8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false }));
    this.glare.scale.set(0.7, 0.7, 1);
    this.glare.position.set(0, 0, -0.05);
    this.group.add(this.glare);
  }

  setOwnView(own) {
    this.ownView = own;
    this.body.visible = !own;
    this.lens.visible = !own;
    this.glare.visible = !own;
    this.coneUniforms.uIntensity.value = own ? 0.035 : 0.17;
  }

  toggle() { this.on = !this.on; return this.on; }

  addBattery(v) { this.battery = clamp(this.battery + v, 0, 1); if (this.battery > 0.02 && !this.on) this.on = true; }

  /** world position & forward direction of the beam */
  getBeam(pos = new THREE.Vector3(), dir = new THREE.Vector3()) {
    this.group.getWorldPosition(pos);
    this.target.getWorldPosition(dir).sub(pos).normalize();
    return { pos, dir };
  }

  /** is world point p inside the beam (cheap, no occlusion)? returns 0..1 light factor */
  litFactor(p, _pos = new THREE.Vector3(), _dir = new THREE.Vector3()) {
    if (!this.on || this.battery <= 0) return 0;
    const { pos, dir } = this.getBeam(_pos, _dir);
    const dx = p.x - pos.x, dy = p.y - pos.y, dz = p.z - pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.01) return 1;
    if (d > 38) return 0;
    const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
    const ang = Math.acos(clamp(cos, -1, 1));
    const edge = 1 - smoothstep(this.light.angle * 0.55, this.light.angle, ang);
    const dist = 1 - smoothstep(22, 38, d);
    return edge * dist * this.effective;
  }

  get effective() {
    return this.on ? this.flicker * (0.45 + 0.55 * smoothstep(0, 0.3, this.battery)) : 0;
  }

  update(dt, t, drain = true) {
    this.coneUniforms.uTime.value = t;
    if (this.on && drain) {
      this.battery = clamp(this.battery - dt * 0.0026, 0, 1);
      if (this.battery <= 0) this.on = false;
    }
    // flicker: occasional micro-flicker always, dropouts when low
    let f = 1 - Math.abs(Math.sin(t * 37.1) * Math.sin(t * 11.7)) * 0.03;
    if (this.battery < 0.18) {
      if (this._dropout > 0) { this._dropout -= dt; f *= 0.08 + Math.random() * 0.3; }
      else if (Math.random() < dt * (1.5 + (0.18 - this.battery) * 25)) this._dropout = 0.04 + Math.random() * 0.18;
    }
    this.flicker = f;
    const eff = this.effective;
    this.light.intensity = this.baseIntensity * eff * this.dim;
    this.fill.intensity = 0.6 * eff * this.dim;
    this.cone.visible = eff > 0.01;
    this.glare.material.opacity = eff * 0.9;
    this.lens.material.emissiveIntensity = 20 * eff;
    this.light.visible = eff > 0;
  }
}
