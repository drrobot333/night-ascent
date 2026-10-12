import * as THREE from 'three';
import { Terrain } from './world/Terrain.js';
import { Forest } from './world/Forest.js';
import { Props } from './world/Props.js';
import { Hazards } from './world/Hazards.js';
import { Quests } from './world/Quests.js';
import { Sky } from './world/Sky.js';
import { Mist } from './world/Mist.js';
import { Headlamp } from './entities/Headlamp.js';
import { Humanoid } from './entities/Humanoid.js';
import { PlayerController } from './entities/PlayerController.js';
import { Companion } from './entities/Companion.js';
import { Creature } from './entities/Creature.js';
import { AudioEngine } from './audio/Audio.js';
import { Net } from './net/Net.js';
import { UI } from './ui/UI.js';
import { PostFX } from './render/PostFX.js';
import { clamp, damp, smoothstep } from './core/noise.js';

const NET_RATE = 1 / 20;

function pingTexture() {
  const S = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = 'rgba(255,200,120,1)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, 20, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,220,160,1)'; ctx.beginPath(); ctx.arc(S / 2, S / 2, 5, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(cv);
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ui = new UI();
    this.audio = new AudioEngine();
    this.net = null;
    this.mode = 'menu';        // menu | intro | playing | paused | dead | won
    this.sessionType = 'solo'; // solo | host | guest
    this.quality = this.ui.quality;
    this.style = this.ui.style;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.fear = 0;
    this.blackout = 1;
    this.flash = 0;
    this.deaths = 0;
    this.startTime = 0;
    this.lampHolder = 0;
    this.handoffCooldown = 0;
    this.lastCheckpoint = null;
    this.progress = 0;
    this.netAcc = 0;
    this.remote = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, got: false, use: false };
    this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };
    this._pendingEvents = [];
    this._stepFlag = false;
    this._seenZones = new Set();
    this._myZone = null;
    this.working = null;
    this._clankTimer = 0;
    this.partnerDark = 0;
    this.grabCine = null;
    this._tutorialTimers = [];

    this._setupRenderer();
    this._bindUI();
  }

  // ------------------------------------------------------------ setup
  _setupRenderer() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 900);
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const retro = this.style !== 'clean';
    let iw = w, ih = h, pr = 1;
    if (retro) {
      ih = this.style === 'retro240' ? 240 : 360;
      iw = Math.round(ih * (w / h));
    } else {
      const dpr = window.devicePixelRatio || 1;
      pr = this.quality === 'high' ? Math.min(dpr, 2) : this.quality === 'low' ? Math.min(dpr, 1) : Math.min(dpr, 1.5);
    }
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(iw, ih, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.canvas.classList.toggle('pixel', retro);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.post) { this.post.setSize(iw, ih); this.post.setRetro(retro); }
  }

  async build() {
    const ui = this.ui;
    ui.setLoading('산을 만드는 중…');
    await this._frame();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x04050a, 0.028);

    this.terrain = new Terrain(20251012);
    this.scene.add(this.terrain.mesh);
    ui.setLoading('숲을 심는 중…'); await this._frame();
    this.forest = new Forest(this.terrain, this.quality);
    this.scene.add(this.forest.group);
    ui.setLoading('길을 내는 중…'); await this._frame();
    this.props = new Props(this.terrain);
    this.scene.add(this.props.group);
    this.hazards = new Hazards(this.terrain);
    this.scene.add(this.hazards.group);
    this.quests = new Quests(this.terrain, this.forest);
    this.scene.add(this.quests.group);
    this.quests.onComplete = (q) => this._onQuestDone(q);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.mist = new Mist(this.terrain, this.quality === 'low' ? 40 : 70);
    this.scene.add(this.mist.group);

    this.moon = new THREE.DirectionalLight(0x8fa3c9, 0.10);
    this.moon.position.copy(this.sky.moonDir).multiplyScalar(200);
    this.scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0x1b2236, 0x05060a, 0.16);
    this.scene.add(this.hemi);

    ui.setLoading('장비를 챙기는 중…'); await this._frame();
    this.lamp = new Headlamp(this.quality);
    this.player = new PlayerController(this.camera, this.terrain, this.forest, this.canvas);
    this.player.onFootstep = (e) => {
      this._stepFlag = true;
      if (this._myZone && this._myZone.type === 'stream') e.surface = 'water';
      this.audio.footstep(e);
    };
    this.player.onKey = (code) => this._onKey(code);
    this.player.onLockChange = (locked) => this._onLockChange(locked);
    this.myHead = new THREE.Group();
    this.scene.add(this.myHead);
    this.companion = new Companion(this.terrain, this.forest);
    this.companion.hazards = this.hazards;
    this.companion.quests = this.quests;
    this.companion.say = (t) => this.ui.say('동반자', t);
    this.companion.onWork = (q, dt) => { if (this.sessionType !== 'guest') this._work(q, dt, false); };
    this.scene.add(this.companion.root);
    this.remoteModel = new Humanoid({ jacket: 0xd97a2b, pants: 0x2b2f3a, hat: 0x2a2a2a });
    this.remoteModel.root.visible = false;
    this.scene.add(this.remoteModel.root);
    this.creature = new Creature(this.terrain, this.forest);
    this.scene.add(this.creature.root);
    this.pingSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pingTexture(), color: 0xffd090, transparent: true, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    this.pingSprite.scale.set(0.9, 0.9, 1); this.pingSprite.visible = false; this.pingSprite.renderOrder = 20;
    this.scene.add(this.pingSprite);
    this.pingTimer = 0;

    this.post = new PostFX(this.renderer, this.scene, this.camera, this.quality);
    this._resize();
    this._setLampHolder(0);
    this._placeAtStart();
    ui.hideLoading();
    ui.showMenu();
    this.mode = 'menu';
    this.clock.start();
    this._loop();
  }

  _frame() { return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }

  // ------------------------------------------------------------ UI wiring
  _bindUI() {
    const ui = this.ui;
    ui.on('btn-solo', () => { this._initAudio(); this.startSolo(); });
    ui.on('btn-host', () => { this._initAudio(); this.startHost(); });
    ui.on('btn-join', () => { this._initAudio(); ui.showJoinPanel(); });
    ui.on('btn-join-go', () => this.startJoin(ui.el.joinCode.value.trim()));
    ui.el.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.startJoin(ui.el.joinCode.value.trim()); });
    ui.on('btn-join-cancel', () => ui.resetMenuPanels());
    ui.on('btn-host-cancel', () => { if (this.net) this.net.close(); this.net = null; ui.resetMenuPanels(); });
    ui.on('btn-retry', () => this.respawn());
    ui.on('btn-quit', () => this.toMenu());
    ui.on('btn-win-menu', () => this.toMenu());
    ui.on('btn-intro-go', () => this._startPlaying());
    ui.el.quality.addEventListener('change', () => { this.quality = ui.quality; ui.setMenuStatus('그래픽(숲 밀도) 설정은 페이지를 새로 고치면 적용됩니다.'); this._resize(); });
    ui.el.style.addEventListener('change', () => { this.style = ui.style; this._resize(); });
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'playing' || this.mode === 'paused') { this._initAudio(); this.player.requestLock(); }
    });
    ui.el.pause.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this._initAudio(); this.player.requestLock();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'playing') this._pause(); });
  }

  _initAudio() { this.audio.init(); this.audio.resume(); }

  _onLockChange(locked) {
    if (this.mode === 'playing' && !locked) this._pause();
    else if (this.mode === 'paused' && locked) { this.mode = 'playing'; this.ui.showPause(false); this.player.enabled = true; }
  }
  _pause() { if (this.mode !== 'playing') return; this.mode = 'paused'; this.player.enabled = false; this.ui.showPause(true); }

  _onKey(code) {
    if (this.mode !== 'playing') return;
    if (code === 'KeyF') {
      if (this._iHoldLamp()) { this.lamp.toggle(); this.audio.lampClick(); if (this.sessionType === 'host') this._netSendState(true); }
      else if (this.sessionType === 'guest') this.net.send({ t: 'lampToggle' });
    }
    if (code === 'KeyE') this._interact();
    if (code === 'KeyQ') this._ping();
  }

  // ------------------------------------------------------------ session starts
  startSolo() {
    this.sessionType = 'solo';
    this.companion.root.visible = true;
    this.remoteModel.root.visible = false;
    this.ui.setNet('');
    this._beginRun();
  }

  async startHost() {
    this.sessionType = 'host';
    this.ui.showHostPanel(null);
    this.net = new Net();
    try {
      const code = await this.net.host();
      this.ui.showHostPanel(code);
    } catch (e) {
      this.ui.resetMenuPanels(); this.ui.setMenuStatus('브로커 연결 실패. 네트워크를 확인해 주세요.'); this.net = null; return;
    }
    this.net.onConnect = () => {
      this.ui.setMenuStatus('친구가 접속했습니다. 출발!');
      this.companion.root.visible = false;
      this.remoteModel.root.visible = true;
      this.net.send({ t: 'welcome', seed: this.terrain.seed });
      setTimeout(() => this._beginRun(), 600);
    };
    this.net.onMessage = (m) => this._onNetMessage(m);
    this.net.onDisconnect = () => this._onPeerLost();
  }

  async startJoin(code) {
    if (!code || code.length < 4) { this.ui.setMenuStatus('코드 4자리를 입력해 주세요.'); return; }
    this.sessionType = 'guest';
    this.ui.setMenuStatus('접속 중…');
    this.net = new Net();
    this.net.onMessage = (m) => this._onNetMessage(m);
    this.net.onDisconnect = () => this._onPeerLost();
    try {
      await this.net.join(code);
    } catch (e) {
      this.ui.setMenuStatus('접속 실패. 코드를 확인하거나 방장이 대기 중인지 확인해 주세요.'); this.net = null; return;
    }
    this.ui.setMenuStatus('연결됨. 출발!');
    this.companion.root.visible = false;
    this.remoteModel.root.visible = true;
    setTimeout(() => this._beginRun(), 600);
  }

  _onPeerLost() {
    if (this.mode === 'menu') { this.ui.setMenuStatus('연결이 끊어졌습니다.'); return; }
    this.ui.setNet('연결 끊김', 'bad');
    this.ui.say(null, '친구와의 연결이 끊어졌습니다. 메뉴로 돌아갑니다.', 4000);
    setTimeout(() => this.toMenu(), 3500);
  }

  _beginRun() {
    this.ui.hideMenu();
    this.deaths = 0;
    this.startTime = this.time;
    this.lamp.battery = 1; this.lamp.on = true; this.lamp.dim = 1;
    for (const b of this.props.batteries) { b.taken = false; b.mesh.visible = true; }
    this.quests.reset();
    this._seenZones.clear();
    this.creature.release(); this.creature.timer = 25;
    this.lastCheckpoint = null;
    this._setLampHolder(0);
    this._placeAtStart();
    this.fear = 0;
    this.blackout = 1;
    this.partnerDark = 0;
    this.mode = 'intro';
    this.ui.showIntro(true);
    if (this.sessionType !== 'guest') this.ui.setNet(this.sessionType === 'host' ? '방장 · 연결됨' : '', 'ok');
    else this.ui.setNet('게스트 · 연결됨', 'ok');
  }

  _startPlaying() {
    if (this.mode !== 'intro') return;
    this._initAudio();
    this.ui.showIntro(false);
    this.ui.showHUD();
    this.mode = 'playing';
    this.player.enabled = true;
    this.player.requestLock();
    setTimeout(() => { if (this.mode === 'playing' && !this.player.locked) this._pause(); }, 400);
    for (const tm of this._tutorialTimers) clearTimeout(tm);
    const say = (who, text, dur, delay) => this._tutorialTimers.push(setTimeout(() => { if (this.mode === 'playing' || this.mode === 'paused') this.ui.say(who, text, dur); }, delay));
    if (this.sessionType === 'solo') {
      say('동반자', '저기 리본이랑 빨간 말뚝 보이지? 저거 따라가면 돼. 랜턴은 네가 들어.', 5000, 1200);
      say(null, '<b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>E</b> 랜턴 건네기 · <b>Q</b> 가리키기', 5500, 7000);
      say('동반자', '돌탑 지날 때마다 체크포인트야. 나 어둠 속에 오래 두지 마.', 4500, 13500);
    } else if (this.sessionType === 'host') {
      say(null, '랜턴은 당신에게 있습니다. <b>E</b>로 건넬 수 있고, <b>Q</b>로 위치를 가리킬 수 있습니다.', 5500, 1200);
      say(null, '리본과 빨간 말뚝을 따라 오르세요. 돌탑이 체크포인트입니다.', 5000, 7500);
    } else {
      say(null, '친구가 랜턴을 들고 있습니다. 빛 안에 머무르고, 소리가 나면 <b>Q</b>로 가리키세요.', 5500, 1200);
      say(null, '위험 구간에서는 친구가 당신의 발밑을 비춰줘야 움직일 수 있습니다.', 5000, 7500);
    }
  }

  _placeAtStart() {
    const t = this.terrain.trail;
    const p0 = t.pointAt(4), d0 = t.dirAt(4);
    const yaw = Math.atan2(-d0.x, -d0.z);
    this.player.teleport(p0.x, p0.z, yaw);
    this.companion.teleport(p0.x - d0.z * 1.4 + d0.x * 1.2, p0.z + d0.x * 1.4 + d0.z * 1.2, yaw);
    this.remote.pos.set(p0.x - d0.z * 1.4, this.terrain.heightAt(p0.x, p0.z), p0.z + d0.x * 1.4);
  }

  toMenu() {
    if (this.net) { this.net.close(); this.net = null; }
    this.mode = 'menu';
    this.player.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMenu();
    this.ui.prompt(null); this.ui.hold(null);
    this.companion.root.visible = true;
    this.remoteModel.root.visible = false;
    this.creature.release();
    this.grabCine = null;
    this.lamp.dim = 1;
    this._setLampHolder(0);
    this._placeAtStart();
    this.fear = 0;
  }

  // ------------------------------------------------------------ lamp ownership
  _iHoldLamp() { return this.lampHolder === 0; }

  _setLampHolder(h) {
    this.lampHolder = h;
    this.lamp.group.removeFromParent();
    if (h === 0) {
      this.myHead.add(this.lamp.group);
      this.lamp.setOwnView(true);
    } else {
      const model = this.sessionType === 'solo' ? this.companion.model : this.remoteModel;
      model.lampMount.add(this.lamp.group);
      this.lamp.setOwnView(false);
    }
    this.companion.hasLamp = (h === 1 && this.sessionType === 'solo');
    this.handoffCooldown = 1.0;
  }

  _partnerPos() { return this.sessionType === 'solo' ? this.companion.position : this.remote.pos; }

  _interact() {
    if (this.handoffCooldown > 0) return;
    const near = this._nearbyBattery();
    if (near && this._iHoldLamp()) {
      this._takeBattery(near);
      if (this.sessionType === 'host') this._netSendState(true);
      else if (this.sessionType === 'guest') this.net.send({ t: 'battery', id: near.id });
      return;
    }
    if (this.quests.interactableNear(this.player.position.x, this.player.position.z)) return; // hold-to-use handled in update
    const pp = this._partnerPos();
    const d = Math.hypot(pp.x - this.player.position.x, pp.z - this.player.position.z);
    if (d < 2.6) {
      if (this.sessionType === 'guest') { this.net.send({ t: 'handoff' }); return; }
      this._doHandoff();
      if (this.sessionType === 'host') this._netSendState(true);
    }
  }

  _doHandoff() {
    const newHolder = this.lampHolder === 0 ? 1 : 0;
    this._setLampHolder(newHolder);
    this.audio.handoff();
    if (this.sessionType === 'solo') this.companion.speak(newHolder === 1 ? 'gotLamp' : 'gaveLamp', true);
  }

  _nearbyBattery() {
    for (const b of this.props.batteries) {
      if (b.taken) continue;
      if (this.player.position.distanceTo(b.pos) < 2.2) return b;
    }
    return null;
  }

  _takeBattery(b) {
    b.taken = true; b.mesh.visible = false;
    this.lamp.addBattery(0.5);
    this.audio.pickup();
    this.ui.say(null, '배터리를 교체했다.', 2200);
  }

  // ------------------------------------------------------------ pings & quests
  _pingPoint(out) {
    const fwd = this.tmp.b.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const o = this.camera.position;
    for (let d = 1; d < 45; d += 0.5) {
      const x = o.x + fwd.x * d, y = o.y + fwd.y * d, z = o.z + fwd.z * d;
      if (y <= this.terrain.heightAt(x, z) + 0.05) return out.set(x, this.terrain.heightAt(x, z) + 0.3, z);
    }
    return out.set(o.x + fwd.x * 30, o.y + fwd.y * 30, o.z + fwd.z * 30);
  }

  _ping(fromNet = null) {
    const p = fromNet ? this.tmp.c.set(fromNet.x, fromNet.y, fromNet.z) : this._pingPoint(this.tmp.c);
    this.pingSprite.position.copy(p); this.pingSprite.visible = true; this.pingTimer = 3;
    this.audio.ping();
    if (fromNet) { this.ui.say('친구', '저기!', 1800); return; }
    this.ui.say('나', '저기!', 1400);
    if (this.sessionType === 'solo') this.companion.ping(p, this.creature);
    else if (this.net) this.net.send({ t: 'ping', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
  }

  _work(q, dt, byMe) {
    if (this.sessionType === 'guest') return;
    if (q.type === 'winch') { this._clankTimer -= dt; if (this._clankTimer <= 0) { this._clankTimer = 0.42; this.audio.clank(); } }
    this.quests.work(q, dt);
  }

  _onQuestDone(q) {
    if (q.type === 'lever') { this.audio.lever(); setTimeout(() => this.audio.creak(), 300); }
    else this.audio.creak();
    this.ui.say(null, q.type === 'lever' ? '철문이 열렸다.' : '나무가 치워졌다.', 2600);
    if (this.sessionType === 'solo') this.companion.onQuestDone(q);
    if (this.sessionType === 'host') this._netSendState(true);
  }

  // ------------------------------------------------------------ network
  _onNetMessage(m) {
    if (!m || !m.t) return;
    if (m.t === 'ping') { this._ping(m); return; }
    if (this.sessionType === 'host') {
      if (m.t === 'in') {
        this.remote.pos.set(m.x, m.y, m.z); this.remote.yaw = m.yaw; this.remote.pitch = m.p; this.remote.speed = m.s; this.remote.got = true; this.remote.use = !!m.use;
        if (m.step) this.audio.footstep({ sprint: m.sprint, onTrail: true }, this.remote.pos);
      } else if (m.t === 'handoff') {
        const d = Math.hypot(this.remote.pos.x - this.player.position.x, this.remote.pos.z - this.player.position.z);
        if (d < 3 && this.handoffCooldown <= 0) { this._doHandoff(); this._netSendState(true); }
      } else if (m.t === 'lampToggle') {
        if (this.lampHolder === 1) { this.lamp.toggle(); this.audio.lampClick(); this._netSendState(true); }
      } else if (m.t === 'battery') {
        const b = this.props.batteries[m.id];
        if (b && !b.taken && this.lampHolder === 1) { b.taken = true; b.mesh.visible = false; this.lamp.addBattery(0.5); this.audio.pickup(); this._netSendState(true); }
      }
    } else if (this.sessionType === 'guest') {
      if (m.t === 'st') {
        this.remote.pos.set(m.hx, m.hy, m.hz); this.remote.yaw = m.hyaw; this.remote.pitch = m.hp; this.remote.speed = m.hs; this.remote.got = true;
        if (m.step) this.audio.footstep({ sprint: m.sprint, onTrail: true }, this.remote.pos);
        const myHolder = m.lh === 0 ? 1 : 0;
        if (myHolder !== this.lampHolder) { this._setLampHolder(myHolder); this.audio.handoff(); }
        if (m.lon !== this.lamp.on) { this.lamp.on = m.lon; this.audio.lampClick(); }
        this.lamp.battery = m.bat;
        for (let i = 0; i < m.bt.length; i++) { const b = this.props.batteries[i]; if (b) { if (m.bt[i] && !b.taken) this.audio.pickup(); b.taken = !!m.bt[i]; b.mesh.visible = !b.taken; } }
        if (m.qs) m.qs.forEach((qq, i) => { const q = this.quests.list[i]; const wasDone = q && q.done; this.quests.setState(i, !!qq[0], qq[1]); if (q && q.done && !wasDone) this._onQuestDone(q); });
        this.creature.unpack(m.cr);
        this.progress = m.pr;
        if (m.ev) for (const e of m.ev) this._creatureEvent(e, true);
      } else if (m.t === 'dead') {
        this._die(m.who === 1 ? 'me' : 'partner', true);
      } else if (m.t === 'respawn') {
        this.ui.hideDeath(); this.mode = 'playing'; this.blackout = 1; this.fear = 0; this.creature.release(); this.grabCine = null; this.lamp.dim = 1; this.ui.showHUD();
        this.player.teleport(m.x, m.z, m.yaw); this.player.enabled = true; this.player.requestLock();
      } else if (m.t === 'won') {
        this._win(true);
      }
    }
  }

  _netSendState(force = false) {
    if (!this.net || !this.net.connected) return;
    const p = this.player, l = this.lamp;
    const msg = {
      t: 'st', hx: +p.position.x.toFixed(2), hy: +p.position.y.toFixed(2), hz: +p.position.z.toFixed(2), hyaw: +p.yaw.toFixed(3), hp: +p.pitch.toFixed(3), hs: +p.speed.toFixed(2),
      lh: this.lampHolder, lon: l.on, bat: +l.battery.toFixed(3), bt: this.props.batteries.map(b => b.taken ? 1 : 0),
      qs: this.quests.list.map(q => [q.done ? 1 : 0, +q.progress.toFixed(3)]),
      cr: this.creature.pack(), pr: +this.progress.toFixed(3), step: this._stepFlag, sprint: p.sprinting,
    };
    if (this._pendingEvents.length) { msg.ev = this._pendingEvents; this._pendingEvents = []; }
    this._stepFlag = false;
    this.net.send(msg);
  }

  _netSendInput() {
    if (!this.net || !this.net.connected) return;
    const p = this.player;
    this.net.send({ t: 'in', x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2), yaw: +p.yaw.toFixed(3), p: +p.pitch.toFixed(3), s: +p.speed.toFixed(2), step: this._stepFlag, sprint: p.sprinting, use: !!this.working });
    this._stepFlag = false;
  }

  // ------------------------------------------------------------ creature events
  _creatureEvent(e, fromNet = false) {
    const pos = e.pos ? (e.pos.isVector3 ? e.pos : new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z)) : this.creature.position;
    switch (e.type) {
      case 'twig': this.audio.twig(pos); break;
      case 'whisper': this.audio.whisper(pos); break;
      case 'breath': this.audio.breath(pos); break;
      case 'stalk': this.audio.twig(pos); break;
      case 'approach': this.audio.growl(pos); break;
      case 'lunge': this.audio.stinger(); this.audio.growl(pos, true); break;
      case 'retreat': break;
      case 'grab': if (!fromNet) this._onGrab(e.targetId); break;
    }
    if (this.sessionType === 'solo') this.companion.onCreatureEvent(e.type);
    if (this.sessionType === 'host' && !fromNet && e.type !== 'grab') {
      const packed = { type: e.type };
      if (e.pos) packed.pos = { x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1) };
      this._pendingEvents.push(packed);
    }
  }

  _onGrab(targetId) {
    if (this.sessionType === 'host') this.net.send({ t: 'dead', who: targetId });
    this._die(targetId === 0 ? 'me' : 'partner');
  }

  _die(who, fromNet = false) {
    if (this.mode !== 'playing') return;
    this.mode = 'dead';
    this.deaths++;
    this.player.enabled = false;
    this.player.keys = {};
    this.working = null; this.ui.hold(null);
    this.audio.grab();
    this.flash = who === 'me' ? 0.6 : 0.3;
    this.fear = 1;
    this.blackout = 0;
    if (who === 'me') {
      this.grabCine = { t: 0, faceAt: 0, faced: false };
      this._faceSlam();
    } else {
      // it takes your partner first... then turns to you
      const pp = this._partnerPos();
      const p = this.player.position;
      this.creature.setGrab(new THREE.Vector3(pp.x, pp.y, pp.z), Math.atan2(-(p.x - pp.x), -(p.z - pp.z)));
      this.grabCine = { t: 0, partner: true, faceAt: 0.8, faced: false };
    }
    const title = who === 'me' ? '붙잡혔다' : '동반자를 잃었다';
    const text = who === 'me'
      ? '어둠 속에서 차가운 손이 당신을 끌고 갔다.<br/>마지막으로 본 것은 멀어지는 불빛이었다.'
      : '비명은 짧았다. 불빛을 돌렸을 때는<br/>이미 아무도 없었다. 혼자 오를 수는 없다.';
    setTimeout(() => {
      if (this.mode !== 'dead') return;
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.showDeath(title, text + (this.sessionType === 'guest' ? '<br/><span style="color:#8d8a84;font-size:12px">방장이 다시 시작하길 기다리는 중…</span>' : ''));
      document.getElementById('btn-retry').style.display = this.sessionType === 'guest' ? 'none' : '';
      this.creature.release();
    }, who === 'me' ? 1900 : 2700);
  }

  /** jump-scare: the view is wrenched toward it and its face fills the screen */
  _faceSlam() {
    const p = this.player.position;
    const c = this.creature.position;
    const yaw = this.creature.root.visible && c.distanceTo(p) < 14
      ? Math.atan2(-(c.x - p.x), -(c.z - p.z)) : this.player.yaw;
    this.player.yaw = yaw; this.player.pitch = 0.08;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const cx = p.x + fx * 2.0, cz = p.z + fz * 2.0;
    const eye = new THREE.Vector3(p.x, p.y + this.player.eyeHeight, p.z);
    const fwd = new THREE.Vector3(fx * Math.cos(0.08), Math.sin(0.08), fz * Math.cos(0.08));
    const headTarget = eye.add(fwd.multiplyScalar(0.5));
    this.creature.poseGrabAt(new THREE.Vector3(cx, this.terrain.heightAt(cx, cz), cz), Math.atan2(-(p.x - cx), -(p.z - cz)), headTarget, this.time);
    this.grabCine.yaw = yaw; this.grabCine.pitch = 0.08; this.grabCine.faced = true;
    this.flash = 0.45;
    this.lamp.dim = 0.08;
    this.ui.el.hud.classList.add('hidden');
    this.audio.scream();
  }

  respawn() {
    if (this.sessionType === 'guest') return;
    this.ui.hideDeath();
    const cp = this.lastCheckpoint;
    const trail = this.terrain.trail;
    const idx = cp ? trail.indexAtDistance(cp.s) : 4;
    const p = trail.pointAt(idx), d = trail.dirAt(idx);
    const yaw = Math.atan2(-d.x, -d.z);
    this.player.teleport(p.x, p.z, yaw);
    this.companion.teleport(p.x - d.z * 1.4, p.z + d.x * 1.4, yaw);
    this.creature.release();
    this.grabCine = null;
    this.lamp.dim = 1; this.ui.showHUD();
    this.lamp.on = true; if (this.lamp.battery < 0.25) this.lamp.battery = 0.25;
    this._setLampHolder(0);
    this.mode = 'playing';
    this.blackout = 1; this.fear = 0.3;
    this.player.enabled = true;
    this.player.requestLock();
    if (this.sessionType === 'host') {
      const rx = p.x - d.z * 1.4, rz = p.z + d.x * 1.4;
      this.net.send({ t: 'respawn', x: rx, z: rz, yaw });
      this._netSendState(true);
    }
    if (this.sessionType === 'solo') setTimeout(() => this.companion.speak('retreat', true), 1500);
  }

  _win(fromNet = false) {
    if (this.mode !== 'playing') return;
    this.mode = 'won';
    this.player.enabled = false;
    this.audio.doorKnock();
    setTimeout(() => this.audio.win(), 900);
    if (this.sessionType === 'host' && !fromNet) this.net.send({ t: 'won' });
    const secs = Math.round(this.time - this.startTime);
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    setTimeout(() => {
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.showWin(`소요 시간 ${mm}:${ss} · 붙잡힌 횟수 ${this.deaths} · 남은 배터리 ${Math.round(this.lamp.battery * 100)}%`);
    }, 2500);
  }

  // ------------------------------------------------------------ main loop
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    const t = this.time;

    if (this.mode === 'menu' || this.mode === 'intro') this._updateMenu(dt, t);
    else this._updatePlay(dt, t);

    this.sky.update(t, this.camera.position);
    this.mist.update(dt, t, this.camera);
    this.forest.update(t);
    this.props.update(t);
    this.hazards.update(t);
    this.quests.update(dt, t);
    this.lamp.update(dt, t, this.mode === 'playing' && (this.sessionType !== 'guest'));
    this.moon.position.copy(this.camera.position).add(this.tmp.a.copy(this.sky.moonDir).multiplyScalar(200));
    this.moon.target.position.copy(this.camera.position); this.moon.target.updateMatrixWorld();
    if (this.pingTimer > 0) { this.pingTimer -= dt; this.pingSprite.material.opacity = Math.min(1, this.pingTimer) * (0.6 + 0.4 * Math.sin(t * 12)); if (this.pingTimer <= 0) this.pingSprite.visible = false; }

    const fwd = this.tmp.b.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const up = this.tmp.c.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.audio.setListener(this.camera.position, fwd, up);
    this.audio.setFear(this.mode === 'playing' || this.mode === 'dead' ? this.fear : 0.05);
    this.audio.update(dt);

    this.blackout = damp(this.blackout, 0, 1.6, dt);
    this.flash = damp(this.flash, 0, 4, dt);
    const dead = this.mode === 'dead';
    const gc = this.grabCine;
    const cineBlack = dead && gc && gc.faced ? smoothstep(gc.faceAt + 0.9, gc.faceAt + 1.35, gc.t) : 0;
    this.post.update(t, this.mode === 'menu' || this.mode === 'intro' ? 0.15 : this.fear, dead ? cineBlack : this.blackout, this.flash);
    this.post.render(dt);
  }

  _updateMenu(dt, t) {
    const trail = this.terrain.trail;
    const s = 12 + (Math.sin(t * 0.05) * 0.5 + 0.5) * 30;
    const idx = trail.indexAtDistance(s);
    const p = trail.pointAt(idx), d = trail.dirAt(idx);
    const yawBase = Math.atan2(-d.x, -d.z);
    this.camera.position.set(p.x - d.x * 2.5, p.y + 1.75 + Math.sin(t * 0.7) * 0.02, p.z - d.z * 2.5);
    this.camera.rotation.set(-0.05 + Math.sin(t * 0.21) * 0.06, yawBase + Math.sin(t * 0.17) * 0.5, 0);
    this.myHead.position.copy(this.camera.position);
    this.myHead.quaternion.copy(this.camera.quaternion);
    const cp = trail.pointAt(Math.min(trail.count - 1, idx + 9));
    const cd = trail.dirAt(Math.min(trail.count - 1, idx + 9));
    this.companion.position.set(cp.x + cd.z * 1.6, this.terrain.heightAt(cp.x + cd.z * 1.6, cp.z - cd.x * 1.6), cp.z - cd.x * 1.6);
    this.companion.yaw = yawBase + Math.PI; this.companion.model.setYaw(this.companion.yaw);
    this.companion.model.update(dt, t, 0, { headYaw: Math.sin(t * 0.3) * 0.4, headPitch: 0 });
    this.ui.setFear(0);
  }

  _updatePlay(dt, t) {
    const playing = this.mode === 'playing';
    this.handoffCooldown = Math.max(0, this.handoffCooldown - dt);
    const player = this.player, lamp = this.lamp;
    const trail = this.terrain.trail;
    const holding = this._iHoldLamp();

    // --- death cinematic: wrench the view onto the thing in front of you ---
    if (this.mode === 'dead' && this.grabCine) {
      const gc = this.grabCine;
      gc.t += dt;
      if (!gc.faced && gc.t >= gc.faceAt) this._faceSlam();
      if (gc.faced) {
        // pinned on its face, violently shaking
        player.yaw = gc.yaw; player.pitch = gc.pitch;
        player.fearShake = 2.5;
        player.bobAmt = 0;
      } else if (gc.partner) {
        // look toward where the partner was taken
        const pp = this._partnerPos();
        const wantYaw = Math.atan2(-(pp.x - player.position.x), -(pp.z - player.position.z));
        let dy = wantYaw - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        player.yaw += dy * Math.min(1, dt * 8);
        player.fearShake = 1.2;
      }
    }

    // --- hazard rule: in a danger section you only move while your footing is lit ---
    const myZone = this.hazards.zoneAt(player.position.x, player.position.z);
    this._myZone = myZone;
    let slow = 1, myFeetLit = 1;
    if (myZone) {
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
      myFeetLit = lamp.litFactor(this.tmp.a.set(player.position.x + fx * 0.8, player.position.y + 0.1, player.position.z + fz * 0.8));
      slow = myFeetLit > 0.12 ? 0.45 : 0;
      if (playing && !this._seenZones.has(myZone.index)) {
        this._seenZones.add(myZone.index);
        this.ui.say(null, `위험 구간 · ${myZone.name}<br/><span style="font-size:14px;color:#bdb8ae">발밑이 비춰질 때만 움직일 수 있다</span>`, 4500);
      }
    }

    // --- hold-to-use: lever / winch ---
    const nearQ = playing ? this.quests.interactableNear(player.position.x, player.position.z) : null;
    this.working = null;
    if (nearQ && player.locked && player.keys.KeyE) {
      this.working = nearQ;
      slow = 0;
      if (this.sessionType !== 'guest') this._work(nearQ, dt, true);
      else if (nearQ.type === 'winch') { this._clankTimer -= dt; if (this._clankTimer <= 0) { this._clankTimer = 0.42; this.audio.clank(); } }
    }
    // host also applies the guest's effort
    if (this.sessionType === 'host' && this.remote.use) {
      const rq = this.quests.interactableNear(this.remote.pos.x, this.remote.pos.z);
      if (rq) this._work(rq, dt, false);
    }

    if (playing) player.fearShake = this.fear;
    player.update(dt, playing ? slow : 0);
    this.myHead.position.copy(this.camera.position);
    this.myHead.quaternion.copy(this.camera.quaternion);

    // --- partner ---
    let partnerPos;
    let partnerBusy = false;
    if (this.sessionType === 'solo') {
      if (playing) this.companion.update(dt, t, player, this.creature, lamp);
      partnerPos = this.companion.position;
      partnerBusy = this.companion.working;
    } else {
      const rm = this.remoteModel;
      if (this.remote.got) {
        rm.position.lerp(this.remote.pos, Math.min(1, dt * 14));
        let dy = this.remote.yaw - rm.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        rm.setYaw(rm.yaw + dy * Math.min(1, dt * 12));
        rm.update(dt, t, this.remote.speed, { headYaw: 0, headPitch: this.remote.pitch });
      }
      partnerPos = rm.position;
      partnerBusy = this.remote.use;
    }

    // --- progress / checkpoints ---
    const nearMe = trail.nearest(player.position.x, player.position.z);
    const nearP = trail.nearest(partnerPos.x, partnerPos.z);
    const sPlayer = nearMe.s;
    if (this.sessionType !== 'guest') this.progress = clamp(Math.max(nearMe.s, nearP.s) / trail.length, 0, 1);
    if (playing && this.sessionType !== 'guest') {
      const cp = this.props.lastCheckpointBefore(sPlayer);
      if (cp && (!this.lastCheckpoint || cp.s > this.lastCheckpoint.s)) {
        this.lastCheckpoint = cp;
        this.audio.checkpoint();
        this.ui.say(null, `돌탑 ${cp.index} · 체크포인트 · 정상까지 ${Math.round(cp.remain)}m`, 2600);
      }
    }

    // --- objective + waypoint marker ---
    const remain = Math.max(0, trail.length - sPlayer);
    const qAhead = this.quests.questAhead(sPlayer, 70);
    const next = this.props.nextCheckpoint(sPlayer);
    let wpPos, wpText;
    if (qAhead && (!next || qAhead.s < next.s + 10)) { wpPos = qAhead.gatePos; wpText = `${qAhead.name} ${Math.round(Math.hypot(qAhead.gatePos.x - player.position.x, qAhead.gatePos.z - player.position.z))}m`; }
    else if (next) { wpPos = next.pos; wpText = `돌탑 ${next.index} · ${Math.round(next.s - sPlayer)}m`; }
    else { wpPos = this.props.doorPos; wpText = `대피소 ${Math.round(player.position.distanceTo(this.props.doorPos))}m`; }
    this.ui.setObjective('정상 대피소에서 구조 요청', `다음: ${wpText} · 정상까지 ${Math.round(remain)}m`);
    this._updateWaypoint(wpPos, wpText);

    // --- reach the shelter ---
    if (playing && this.sessionType !== 'guest') {
      const dDoor = Math.hypot(player.position.x - this.props.doorPos.x, player.position.z - this.props.doorPos.z);
      const dDoorP = Math.hypot(partnerPos.x - this.props.doorPos.x, partnerPos.z - this.props.doorPos.z);
      if (dDoor < 2.6 && dDoorP < 7) this._win();
    }

    // --- creature ---
    if (this.sessionType !== 'guest') {
      if (playing) {
        const actors = [
          { id: 0, pos: player.position, isHolder: this.lampHolder === 0, busy: !!this.working },
          { id: 1, pos: partnerPos, isHolder: this.lampHolder === 1, busy: partnerBusy },
        ];
        const active = sPlayer > 30;
        this.creature.pressure = (this.working && this.working.type === 'winch') || (partnerBusy && !!this.quests.questAhead(sPlayer, 40) && this.quests.questAhead(sPlayer, 40).type === 'winch');
        this.creature.update(dt, t, actors, lamp, this.progress, active);
        for (const e of this.creature.events) this._creatureEvent(e);
        this.creature.events.length = 0;
      } else if (this.mode === 'dead') this.creature.animate(dt, t, 0);
    } else {
      this.creature.netUpdate(dt, t);
    }

    // --- fear ---
    const myLit = lamp.litFactor(this.tmp.a.set(player.position.x, player.position.y + 1.2, player.position.z));
    const inLight = holding ? lamp.effective : Math.max(myLit, lamp.effective * 0.25 * (player.position.distanceTo(partnerPos) < 5 ? 1 : 0));
    const cDist = this.creature.root.visible ? this.creature.position.distanceTo(player.position) : 999;
    let fearTarget = 0.08;
    fearTarget += (1 - clamp(inLight, 0, 1)) * 0.35;
    if (this.creature.root.visible) fearTarget += smoothstep(30, 6, cDist) * 0.5 * this.creature.visibleFactor;
    if (this.creature.state === 'LUNGE') fearTarget += 0.35;
    if (lamp.effective <= 0) fearTarget += 0.2;
    if (this.working) fearTarget += 0.15;
    if (this.mode === 'dead') fearTarget = 1;
    this.fear = damp(this.fear, clamp(fearTarget, 0, 1), fearTarget > this.fear ? 1.8 : 0.6, dt);
    this.ui.setFear(this.fear);

    // --- partner status (co-op awareness) ---
    const partnerLit = this.lampHolder === 1 ? 1 : lamp.litFactor(this.tmp.b.set(partnerPos.x, partnerPos.y + 1.2, partnerPos.z));
    if (partnerLit > 0.3 || lamp.effective <= 0) this.partnerDark = 0; else this.partnerDark += dt;
    const pName = this.sessionType === 'solo' ? '동반자' : '친구';
    if (lamp.effective <= 0) this.ui.setPartnerStatus(`${pName} · 랜턴 꺼짐`, 'dark');
    else if (this.lampHolder === 1) this.ui.setPartnerStatus(`${pName} · 랜턴 들고 있음`, 'light');
    else if (this.partnerDark > 1.5) this.ui.setPartnerStatus(`${pName} · 어둠 속 ${Math.floor(this.partnerDark)}초`, 'dark');
    else this.ui.setPartnerStatus(`${pName} · 빛 안`, 'light');

    // --- HUD ---
    this.ui.setBattery(lamp.battery, lamp.on, holding);
    this.ui.setStamina(player.stamina);
    const pd = player.position.distanceTo(partnerPos);
    if (playing) {
      const bat = this._nearbyBattery();
      const partnerZone = this.hazards.zoneAt(partnerPos.x, partnerPos.z);
      const partnerFeetLit = partnerZone ? lamp.litFactor(this.tmp.b.set(partnerPos.x, partnerPos.y + 0.15, partnerPos.z)) : 1;
      if (this.working) { this.ui.prompt(null); this.ui.hold(this.working.type === 'lever' ? '레버 당기는 중' : '윈치 돌리는 중', this.working.progress); }
      else {
        this.ui.hold(null);
        if (nearQ) this.ui.prompt(`<b>E</b> 길게 누르기 · ${nearQ.type === 'lever' ? '레버 당기기' : '윈치 돌리기'}`);
        else if (bat && holding) this.ui.prompt('<b>E</b> 배터리 집기');
        else if (bat && !holding) this.ui.prompt('배터리 · 랜턴을 든 사람이 집어야 한다');
        else if (pd < 2.6 && this.handoffCooldown <= 0) this.ui.prompt(holding ? '<b>E</b> 랜턴 건네기' : '<b>E</b> 랜턴 받기');
        else if (myZone && myFeetLit <= 0.12) this.ui.prompt(holding ? '발밑이 보이지 않는다 · 아래를 보며 천천히 건너라' : '발밑이 보이지 않는다 · 파트너가 발밑을 비춰줘야 한다');
        else if (myZone) this.ui.prompt('천천히… 발밑을 보며');
        else if (partnerZone && holding && partnerFeetLit <= 0.12) this.ui.prompt('파트너의 발밑을 비춰라');
        else if (partnerBusy && holding) this.ui.prompt('파트너가 작업 중 · 주변을 비추며 지켜라');
        else if (qAhead && !qAhead.done && qAhead.s - sPlayer < 12 && sPlayer < qAhead.s) this.ui.prompt(qAhead.type === 'lever' ? '철문이 잠겨 있다 · 케이블을 따라가면 레버가 있다' : '나무가 길을 막고 있다 · 옆의 윈치를 돌려라');
        else this.ui.prompt(null);
      }
    } else { this.ui.hold(null); }
    this._updatePartnerIndicator(partnerPos, pd);

    // --- network tick ---
    if (this.net && this.net.connected) {
      this.netAcc += dt;
      this.net.tick(performance.now());
      if (this.netAcc >= NET_RATE) {
        this.netAcc = 0;
        if (this.sessionType === 'host') this._netSendState();
        else this._netSendInput();
      }
      const rtt = Math.round(this.net.rtt);
      this.ui.setNet(`${this.sessionType === 'host' ? '방장' : '게스트'} · ${rtt}ms`, rtt > 250 ? 'bad' : 'ok');
    }
  }

  _project(pos, yOff) {
    const v = this.tmp.a.set(pos.x, pos.y + yOff, pos.z).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const onScreen = v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.92;
    let x, y;
    if (onScreen) { x = (v.x * 0.5 + 0.5) * w; y = (-v.y * 0.5 + 0.5) * h; }
    else {
      const sgn = v.z < 1 ? 1 : -1;
      const ang = Math.atan2(v.y * sgn, v.x * sgn);
      x = w / 2 + Math.cos(ang) * (w / 2 - 60); y = h / 2 - Math.sin(ang) * (h / 2 - 70);
    }
    return { x, y, onScreen };
  }

  _updatePartnerIndicator(partnerPos, dist) {
    if (dist < 6) { this.ui.partnerIndicator(false); return; }
    const p = this._project(partnerPos, 1.5);
    this.ui.partnerIndicator(true, p.x, p.y - 30, dist);
  }

  _updateWaypoint(pos, text) {
    if (!pos) { this.ui.waypoint(false); return; }
    const d = this.player.position.distanceTo(pos);
    if (d < 4) { this.ui.waypoint(false); return; }
    const p = this._project(pos, 1.2);
    this.ui.waypoint(true, p.x, p.y, text);
  }
}
