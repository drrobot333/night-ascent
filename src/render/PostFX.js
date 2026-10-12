import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFear: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.55 },
    uAberration: { value: 0.0035 },
    uBlackout: { value: 0 },
    uFlash: { value: 0 },
    uRetro: { value: 1 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uFear, uGrain, uVignette, uAberration, uBlackout, uFlash, uRetro;
    uniform vec2 uResolution;
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float bayer2(float a, float b) { return a < 0.5 ? (b < 0.5 ? 0.0 : 3.0) : (b < 0.5 ? 2.0 : 1.0); }
    float bayer4(vec2 p) {
      vec2 q = floor(mod(p, 4.0));
      float hi = bayer2(mod(q.x, 2.0), mod(q.y, 2.0));
      float lo = bayer2(floor(q.x / 2.0), floor(q.y / 2.0));
      return (hi * 4.0 + lo + 0.5) / 16.0;
    }
    void main() {
      vec2 uv = vUv;
      // VHS-style tracking jitter: a rare horizontal band shifts sideways
      if (uRetro > 0.5) {
        float band = step(0.992, hash12(vec2(floor(uv.y * 48.0), floor(uTime * 9.0))));
        uv.x += band * (hash12(vec2(floor(uTime * 9.0), 3.0)) - 0.5) * 0.02;
      }
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // chromatic aberration grows with fear
      float ab = uAberration * (1.0 + uFear * 2.5) * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      // grade: cool shadows, slightly warm mids, gentle contrast
      vec3 shadowTint = vec3(0.90, 0.96, 1.10);
      col = mix(col * shadowTint, col, smoothstep(0.0, 0.35, luma));
      col = (col - 0.5) * 1.06 + 0.5;
      col = mix(col, vec3(luma), uFear * 0.25);
      // vignette (tightens with fear)
      float vig = smoothstep(0.95, 0.2, r2 * (1.0 + uFear * 1.6));
      col *= mix(1.0 - uVignette, 1.0, vig);
      // film grain (brighter in the dark, more with fear)
      float g = hash12(uv * uResolution + vec2(uTime * 61.0, uTime * 37.0)) - 0.5;
      col += g * uGrain * (1.0 + uFear * 1.5) * (1.0 - smoothstep(0.0, 0.6, luma) * 0.7);
      // retro: coarse color quantization with ordered dithering + faint scanlines
      if (uRetro > 0.5) {
        float levels = 20.0;
        float dith = (bayer4(gl_FragCoord.xy) - 0.5) / levels;
        col = floor(col * levels + dith * levels + 0.5) / levels;
        col *= 0.94 + 0.06 * mod(floor(gl_FragCoord.y), 2.0);
      }
      // flash (grab) & blackout
      col = mix(col, vec3(0.9, 0.85, 0.8), uFlash);
      col *= 1.0 - uBlackout;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 'medium') {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    const size = renderer.getSize(new THREE.Vector2());
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), quality === 'low' ? 0.35 : 0.45, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setSize(size.x, size.y);
  }
  setCamera(camera) { this.renderPass.camera = camera; }
  setRetro(on) { this.grade.uniforms.uRetro.value = on ? 1 : 0; this.grade.uniforms.uGrain.value = on ? 0.055 : 0.045; }
  setSize(w, h) {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uResolution.value.set(w * pr, h * pr);
  }
  update(t, fear, blackout = 0, flash = 0) {
    const u = this.grade.uniforms;
    u.uTime.value = t; u.uFear.value = fear; u.uBlackout.value = blackout; u.uFlash.value = flash;
  }
  render(dt) { this.composer.render(dt); }
}
