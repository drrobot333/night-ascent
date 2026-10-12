import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // push to far plane
}`;

const frag = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;

float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.1; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.08, 0.55, h));

  // clouds (slow drifting, high)
  vec3 cp = vec3(d.x, d.z, 0.0) / max(h + 0.25, 0.05);
  float cl = fbm(cp * 1.6 + vec3(uTime * 0.008, uTime * 0.004, 0.0));
  float cloud = smoothstep(0.42, 0.72, cl) * smoothstep(-0.02, 0.2, h);

  // stars
  vec3 sp = d * 420.0;
  float st = hash(floor(sp));
  float tw = 0.6 + 0.4 * sin(uTime * (1.5 + st * 3.0) + st * 40.0);
  float star = step(0.9978, st) * tw * (st - 0.9978) / 0.0022;
  star *= smoothstep(0.0, 0.18, h) * (1.0 - cloud);
  col += vec3(0.9, 0.93, 1.0) * star * 0.9;

  // moon (behind thin clouds)
  float m = max(dot(d, uMoonDir), 0.0);
  float disc = smoothstep(0.9993, 0.9996, m);
  float glow = pow(m, 300.0) * 0.5 + pow(m, 18.0) * 0.06 + pow(m, 4.0) * 0.015;
  vec3 moonCol = vec3(0.78, 0.84, 1.0);
  col += moonCol * (disc * 0.9 + glow) * (1.0 - cloud * 0.85);
  col += moonCol * cloud * pow(m, 6.0) * 0.08; // cloud lit by moon
  col = mix(col, col * 0.55 + vec3(0.012, 0.014, 0.02), cloud * 0.9);

  // horizon haze
  col += uHorizon * (1.0 - smoothstep(-0.05, 0.12, h)) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor() {
    this.moonDir = new THREE.Vector3(-0.35, 0.42, -0.84).normalize();
    this.uniforms = {
      uTime: { value: 0 },
      uMoonDir: { value: this.moonDir },
      uHorizon: { value: new THREE.Color(0.030, 0.036, 0.055) },
      uZenith: { value: new THREE.Color(0.003, 0.004, 0.010) },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }
  update(t, cameraPos) {
    this.uniforms.uTime.value = t;
    this.mesh.position.copy(cameraPos);
  }
}
