import * as THREE from 'three';
import { Humanoid } from './Humanoid.js';
import { clamp, damp } from '../core/noise.js';

const LINES = {
  idle: ['조용하다…', '정상까지 얼마 안 남았겠지?', '불 아껴. 배터리 생각보다 빨리 닳아.', '바람 소리 말고는 아무것도 안 들려.', '말뚝이랑 리본만 따라가면 돼.', '누가 우릴 보고 있는 것 같아…', '괜찮아. 계속 가자.'],
  stalk: ['…뭔가 있어.', '잠깐. 들었어?', '저쪽… 나무 사이에.', '발소리였어. 우리 발소리 아니야.'],
  retreat: ['갔다… 간 것 같아.', '빛을 싫어하나 봐.', '숨 좀 돌리자… 아직 가지 마.'],
  far: ['어디 가? 같이 가!', '너무 멀어! 기다려!', '불빛 밖으로 나가지 마!'],
  gotLamp: ['내가 앞장설게. 바로 뒤에 붙어.', '알았어. 뒤 잘 봐.'],
  gaveLamp: ['조심해서 비춰. 뒤도 가끔 봐.', '네가 들어. 난 네 옆에 있을게.'],
  wait: ['빨리 와! 여기 혼자 못 있겠어.', '뭐 해? 서둘러!'],
  dark: ['불이… 불이 왜 꺼져!', '어두워… 아무것도 안 보여.'],
  needLight: ['발밑 좀 비춰줘!', '안 보여… 여기, 내 발 쪽!', '비춰주면 바로 건널게.', '발 디딜 데가 안 보여!'],
  thanks: ['고마워. 간다.', '됐어, 보여.', '오케이.'],
  crossing: ['내가 먼저 건널게. 잠깐만 기다려.', '발밑 보면서 갈게… 뒤는 네가 봐.'],
  assist: ['네 발밑 비추고 있어. 천천히 와.', '보여? 거기 밟고 와.', '됐어, 이제 건너.'],
  crossed: ['됐다. 가자.', '휴… 건넜다.'],
  leverGo: ['레버는 저 안쪽이야. 내가 갈게… 나 계속 비춰줘.', '케이블 따라가면 레버야. 내가 다녀올게. 빛 끊지 마.'],
  leverYou: ['네가 가. 레버 쪽 비추고 있을게.', '내가 비출 테니까 케이블 따라가서 당겨.'],
  leverDone: ['됐다! 열렸어!', '열렸어. 빨리 와.'],
  winchGo: ['내가 돌릴게. 돌리는 동안 주변 좀 봐줘.', '윈치 잡을게. 뭐 오면 바로 말해줘.'],
  winchYou: ['네가 돌려. 내가 지킬게.', '돌려. 뒤는 내가 본다.'],
  winchDone: ['됐어, 치웠다!', '넘어가자!'],
  seen: ['그래, 거기! 계속 비춰!', '맞아 거기야! 비춰!'],
  pingAck: ['응, 봤어.', '저기? 알았어.', '…아무것도 안 보이는데.'],
  pingCreature: ['…저거 뭐야.', '뭐야 저게… 비춰! 비춰!'],
};

/**
 * The AI partner for solo play. Follows when you hold the lamp, leads when they do.
 * Obeys the hazard rule, runs the dark errands, cranks, and calls out directions.
 */
export class Companion {
  constructor(terrain, forest) {
    this.terrain = terrain;
    this.forest = forest;
    this.trail = terrain.trail;
    this.hazards = null;
    this.quests = null;
    this.model = new Humanoid({ jacket: 0xb8312c, pants: 0x262a33, hat: 0x3a3028 });
    this.root = this.model.root;
    this.position = this.root.position;
    this.hasLamp = false;
    this.state = 'FOLLOW';
    this.velocity = new THREE.Vector3();
    this.lookTarget = null;
    this.reactTimer = 0;
    this.idleTimer = 12;
    this.farTimer = 0;
    this.say = null;
    this._lastSaid = 0;
    this._v = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._feet = new THREE.Vector3();
    this._lookPoint = new THREE.Vector3();
    this.headYaw = 0; this.headPitch = 0;
    this.yaw = 0;
    this.speed = 0;
    this.id = 1;
    this._crossingZone = null;
    this._askedLight = false;
    this._stuck = 0; this._detour = 0;
    this.errand = null;        // {quest, phase}
    this.working = false;      // cranking / pulling right now
    this.workTimer = 0;
    this.pingPoint = null; this.pingTimer = 0;
    this._calledOut = false;
    this.onWork = null;        // (quest, dt) => void  — host applies progress
  }

  teleport(x, z, yaw = 0) {
    this.position.set(x, this.terrain.heightAt(x, z), z);
    this.yaw = yaw; this.model.setYaw(yaw);
    this.velocity.set(0, 0, 0);
    this.errand = null; this.working = false;
  }

  speak(kind, force = false) {
    const now = performance.now() / 1000;
    if (!force && now - this._lastSaid < 4) return;
    const arr = LINES[kind]; if (!arr || !this.say) return;
    this._lastSaid = now;
    this.say(arr[Math.floor(Math.random() * arr.length)]);
  }

  /** direction word relative to the player's facing */
  _dirWord(player, pos) {
    const dx = pos.x - player.position.x, dz = pos.z - player.position.z;
    const ang = Math.atan2(-dx, -dz) - player.yaw;
    const a = Math.atan2(Math.sin(ang), Math.cos(ang));
    const deg = a * 180 / Math.PI;
    if (Math.abs(deg) < 30) return '앞에!';
    if (Math.abs(deg) > 140) return '뒤! 뒤에 있어!';
    return deg > 0 ? '왼쪽! 왼쪽!' : '오른쪽! 오른쪽!';
  }

  ping(point, creature) {
    this.pingPoint = point.clone(); this.pingTimer = 2.5;
    const near = creature && creature.root.visible && creature.position.distanceTo(point) < 7;
    this.speak(near ? 'pingCreature' : 'pingAck', true);
  }

  update(dt, t, player, creature, lamp) {
    const pp = player.position;
    const toP = this._v.set(pp.x - this.position.x, 0, pp.z - this.position.z);
    const distP = toP.length();
    const target = this._target;
    let wantSpeed = 0;
    let moveDir = null;
    let headPitchOverride = null;
    this.lookTarget = null;
    this.working = false;
    this.pingTimer = Math.max(0, this.pingTimer - dt);

    const hz = this.hazards, qs = this.quests;
    const myNear = this.trail.nearest(this.position.x, this.position.z);
    const pNear = this.trail.nearest(pp.x, pp.z);
    const myZone = hz ? hz.zoneAt(this.position.x, this.position.z) : null;
    const playerZone = hz ? hz.zoneAt(pp.x, pp.z) : null;
    const feetLit = lamp ? lamp.litFactor(this._feet.set(this.position.x, this.position.y + 0.15, this.position.z)) : 1;
    let assistZone = null;
    if (hz) for (const zn of hz.zones) if (myNear.s > zn.s1 + 0.5 && pNear.s < zn.s1 - 0.5 && pNear.s > zn.s0 - 8) { assistZone = zn; break; }

    const steerTo = (x, z, speed, minDist = 0.4) => {
      const dx = x - this.position.x, dz = z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > minDist) { moveDir = { x: dx / d, z: dz / d }; wantSpeed = speed; return false; }
      return true;
    };

    // ---------------- errands: lever / winch ----------------
    const quest = qs ? qs.questAhead(Math.max(myNear.s, pNear.s), 32) : null;
    if (quest && !quest.done && Math.hypot(quest.gatePos.x - pp.x, quest.gatePos.z - pp.z) < 30) {
      if (!this.errand || this.errand.quest !== quest) this.errand = { quest, phase: 'decide', said: false };
    } else if (this.errand && (this.errand.quest.done || !quest)) {
      this.errand = null;
    }
    let errandActive = false;
    if (this.errand) {
      const q = this.errand.quest;
      const dq = Math.hypot(q.pos.x - this.position.x, q.pos.z - this.position.z);
      if (!this.hasLamp) {
        // I'm the one who goes into the dark
        errandActive = true;
        if (!this.errand.said) { this.errand.said = true; this.speak(q.type === 'lever' ? 'leverGo' : 'winchGo', true); }
        if (dq > 1.6) steerTo(q.pos.x, q.pos.z, 1.9, 1.5);
        else {
          this.working = true;
          if (this.onWork) this.onWork(q, dt);
          this.lookTarget = this._lookPoint.set(q.pos.x, q.pos.y + 1.0, q.pos.z);
        }
      } else {
        // I hold the lamp: stand near the obstacle and light the way / keep watch
        errandActive = true;
        if (!this.errand.said) { this.errand.said = true; this.speak(q.type === 'lever' ? 'leverYou' : 'winchYou', true); }
        const gx = q.gatePos.x, gz = q.gatePos.z;
        if (Math.hypot(gx - this.position.x, gz - this.position.z) > 3.5) steerTo(gx, gz, 1.6, 3.0);
        else if (q.type === 'lever') this.lookTarget = this._lookPoint.set(q.pos.x, q.pos.y + 0.8, q.pos.z);
        else { headPitchOverride = -0.1; }
      }
    }

    if (!errandActive) {
      if (!this.hasLamp) {
        // ---------------- FOLLOW ----------------
        const zone = myZone || (playerZone && myNear.s <= playerZone.s1 ? playerZone : null);
        if (zone) {
          const exitIdx = this.trail.indexAtDistance(zone.s1 + 3);
          const ex = this.trail.pointAt(exitIdx, this._lookPoint);
          if (myNear.s > zone.s1) {
            if (pNear.s < zone.s1 - 0.5) steerTo(ex.x, ex.z, 1.2, 0.6);
            else steerTo(pp.x + (-Math.sin(player.yaw)) * 2.4 - Math.cos(player.yaw) * 1.5, pp.z + (-Math.cos(player.yaw)) * 2.4 + Math.sin(player.yaw) * 1.5, 2.0, 0.5);
          } else if (myZone) {
            if (feetLit > 0.12) { steerTo(ex.x, ex.z, 0.9, 0.3); if (this._askedLight) { this._askedLight = false; this.speak('thanks', true); } }
            else { if (Math.random() < dt * 0.35) { this.speak('needLight'); this._askedLight = true; } }
          } else {
            const entIdx = this.trail.indexAtDistance(zone.s0 - 1);
            const en = this.trail.pointAt(entIdx, this._lookPoint);
            if (feetLit > 0.12 || Math.hypot(en.x - this.position.x, en.z - this.position.z) > 1.0) steerTo(en.x, en.z, 1.4, 0.6);
            if (myNear.s > zone.s0 - 2 && feetLit > 0.12) steerTo(ex.x, ex.z, 0.9, 0.3);
          }
          if (myZone && this._crossingZone !== zone) this._crossingZone = zone;
          if (!myZone && myNear.s > zone.s1 && this._crossingZone === zone) { this._crossingZone = null; this.speak('crossed'); }
          this.state = 'FOLLOW';
        } else {
          const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
          const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
          target.set(pp.x + fx * 2.4 - rx * 1.5, 0, pp.z + fz * 2.4 - rz * 1.5);
          const dx = target.x - this.position.x, dz = target.z - this.position.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.5) { moveDir = { x: dx / d, z: dz / d }; wantSpeed = clamp(d * 1.4, 0.8, distP > 10 ? 5.0 : 3.6); }
          if (distP > 14) { this.farTimer += dt; if (this.farTimer > 3) { this.speak('far'); this.farTimer = 0; } }
          else this.farTimer = 0;
          this.state = 'FOLLOW';
        }
      } else {
        // ---------------- LEAD ----------------
        if (assistZone) {
          this.state = 'ASSIST';
          this.lookTarget = this._lookPoint.set(pp.x, pp.y + 0.1, pp.z);
          if (Math.random() < dt * 0.12) this.speak('assist');
        } else if (myZone) {
          this.state = 'CROSS';
          const exitIdx = this.trail.indexAtDistance(myZone.s1 + 2.5);
          const ex = this.trail.pointAt(exitIdx, this._lookPoint);
          steerTo(ex.x, ex.z, 0.85, 0.3);
          headPitchOverride = -1.05;
          if (this._crossingZone !== myZone) { this._crossingZone = myZone; this.speak('crossing', true); }
        } else {
          if (this.state !== 'WAIT' && distP > 8) { this.state = 'WAIT'; this.speak('wait'); }
          if (this.state === 'WAIT' && distP < 4.5) this.state = 'LEAD';
          if (this.state === 'ASSIST' || this.state === 'CROSS') this.state = 'LEAD';
          if (this.state === 'LEAD') {
            const aheadIdx = Math.min(this.trail.count - 1, myNear.idx + 10);
            const ap = this.trail.pointAt(aheadIdx, this._lookPoint);
            if (aheadIdx < this.trail.count - 1) steerTo(ap.x, ap.z, distP > 5.5 ? 1.1 : 1.7, 0.3);
            const nextZone = hz ? hz.zoneAhead(myNear.s, 2.5) : null;
            if (nextZone && distP > 4) { moveDir = null; wantSpeed = 0; }
            const nextQ = qs ? qs.questAhead(myNear.s, 6) : null;
            if (nextQ && !nextQ.done && myNear.s > nextQ.s - 6) { moveDir = null; wantSpeed = 0; }
          }
        }
      }
    }

    // ---------------- creature reaction & callouts ----------------
    const creatureThreat = creature && creature.root.visible && (creature.state === 'APPROACH' || creature.state === 'LUNGE' || (creature.state === 'STALK' && creature.visibleFactor > 0.5));
    const dc = creatureThreat ? Math.hypot(creature.position.x - this.position.x, creature.position.z - this.position.z) : 999;
    if (creatureThreat && dc < 26) {
      this.reactTimer += dt;
      if (this.reactTimer > (creature.state === 'LUNGE' ? 0.3 : 1.0)) {
        this.lookTarget = creature.position;
        headPitchOverride = null;
        if (this.hasLamp && !this.working) { moveDir = null; wantSpeed = 0; }
        if (!this._calledOut) {
          this._calledOut = true;
          if (this.say) { const now = performance.now() / 1000; this._lastSaid = now; this.say(this._dirWord(player, creature.position)); }
        } else if (lamp && !this.hasLamp && creature.cover > 0.6 && Math.random() < dt * 0.5) this.speak('seen');
      }
    } else { this.reactTimer = 0; this._calledOut = false; }
    if (!this.lookTarget && this.pingTimer > 0 && this.pingPoint) this.lookTarget = this.pingPoint;

    // ---------------- motion (with a simple unstick detour) ----------------
    if (this.working) { moveDir = null; wantSpeed = 0; }
    if (moveDir && wantSpeed > 0.5 && this.speed < 0.25) this._stuck += dt; else this._stuck = Math.max(0, this._stuck - dt);
    if (this._stuck > 0.8) { this._detour = 1.2; this._stuck = 0; this._detourSign = Math.random() < 0.5 ? -1 : 1; }
    if (this._detour > 0 && moveDir) {
      this._detour -= dt;
      const sx = -moveDir.z * this._detourSign, sz = moveDir.x * this._detourSign;
      moveDir = { x: (moveDir.x + sx * 1.2) / 1.6, z: (moveDir.z + sz * 1.2) / 1.6 };
    }
    const accel = 10;
    const tx = moveDir ? moveDir.x * wantSpeed : 0, tz = moveDir ? moveDir.z * wantSpeed : 0;
    this.velocity.x = damp(this.velocity.x, tx, accel, dt);
    this.velocity.z = damp(this.velocity.z, tz, accel, dt);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.forest.collide(this.position, 0.4);
    if (distP < 1.1 && distP > 0.01) { this.position.x -= toP.x / distP * (1.1 - distP); this.position.z -= toP.z / distP * (1.1 - distP); }
    this.position.y = damp(this.position.y, this.terrain.heightAt(this.position.x, this.position.z), 20, dt);
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    // ---------------- facing ----------------
    let wantYaw;
    if (this.lookTarget && (this.hasLamp || this.working)) wantYaw = Math.atan2(-(this.lookTarget.x - this.position.x), -(this.lookTarget.z - this.position.z));
    else if (this.speed > 0.3) wantYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
    else wantYaw = Math.atan2(-(pp.x - this.position.x), -(pp.z - this.position.z));
    let dy = wantYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 5);
    this.model.setYaw(this.yaw);

    // ---------------- head / lamp aim ----------------
    let hy = 0, hp = -0.12;
    if (this.lookTarget) {
      const lx = this.lookTarget.x - this.position.x, lz = this.lookTarget.z - this.position.z;
      const ly = Math.atan2(-lx, -lz);
      let rel = ly - this.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      hy = clamp(rel, -1.2, 1.2);
      const horiz = Math.hypot(lx, lz);
      const dh = this.lookTarget.y - (this.position.y + 1.6);
      hp = clamp(Math.atan2(dh, Math.max(0.5, horiz)), -1.05, 0.6);
    } else if (headPitchOverride !== null) {
      hy = Math.sin(t * 1.2) * 0.1; hp = headPitchOverride;
      if (this.errand && this.hasLamp) hy = Math.sin(t * 0.9) * 1.1; // keeping watch: wide sweeps
    } else if (this.hasLamp) {
      hy = Math.sin(t * 0.45) * 0.35 + Math.sin(t * 1.7) * 0.06;
      hp = -0.18 + Math.sin(t * 0.8) * 0.08;
      if (this.state === 'WAIT') { hy = 0; hp = 0; }
    } else {
      const ly = Math.atan2(-(pp.x - this.position.x), -(pp.z - this.position.z));
      let rel = ly - this.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      hy = clamp(rel, -1.0, 1.0) * (0.4 + 0.3 * Math.sin(t * 0.3));
      if (myZone) hp = -0.6;
    }
    this.headYaw = hy; this.headPitch = hp;
    // cranking animation: lean in and pump the arms
    const workAnim = this.working ? { headYaw: hy, headPitch: -0.4 } : { headYaw: hy, headPitch: hp };
    this.model.update(dt, t, this.working ? 0 : this.speed, workAnim);
    if (this.working) {
      const ph = t * 7;
      this.model.armL.sh.rotation.x = -1.1 + Math.sin(ph) * 0.4;
      this.model.armR.sh.rotation.x = -1.1 + Math.sin(ph + Math.PI) * 0.4;
      this.model.armL.el.rotation.x = -0.8; this.model.armR.el.rotation.x = -0.8;
      this.model.body.rotation.x = 0.25;
    }

    // ---------------- idle chatter ----------------
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) { this.idleTimer = 20 + Math.random() * 25; if (!creatureThreat && !myZone && !errandActive) this.speak('idle'); }
    if (lamp && lamp.effective <= 0 && Math.random() < dt * 0.15) this.speak('dark');
  }

  onCreatureEvent(type) {
    if (type === 'stalk') this.speak('stalk');
    else if (type === 'retreat') this.speak('retreat');
  }
  onQuestDone(q) { this.speak(q.type === 'lever' ? 'leverDone' : 'winchDone', true); this.errand = null; }
}
