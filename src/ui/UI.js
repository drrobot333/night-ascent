const $ = (id) => document.getElementById(id);

/** Thin wrapper over the DOM overlays and HUD. */
export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), pause: $('pause'), death: $('death'), win: $('win'), loading: $('loading'), intro: $('intro'),
      loadingText: $('loading-text'), vignette: $('vignette'), objText: $('objective-text'), objDist: $('objective-dist'),
      net: $('net-status'), batFill: $('bat-fill'), batLabel: $('bat-label'), stamina: $('stamina-fill'),
      prompt: $('prompt'), subtitle: $('subtitle'), partner: $('partner-indicator'), partnerDist: $('partner-dist'),
      partnerStatus: $('partner-status'), waypoint: $('waypoint'), waypointText: $('waypoint-text'),
      hold: $('hold'), holdLabel: $('hold-label'), holdFill: $('hold-fill'),
      joinPanel: $('join-panel'), hostPanel: $('host-panel'), hostCode: $('host-code'), hostWait: $('host-wait'),
      joinCode: $('join-code'), menuStatus: $('menu-status'), menuButtons: document.querySelector('.menu-buttons'),
      deathTitle: $('death-title'), deathText: $('death-text'), winStats: $('win-stats'), quality: $('quality'), style: $('style'),
    };
    this._subTimer = null;
  }

  on(id, fn) { $(id).addEventListener('click', fn); }

  setLoading(text) { this.el.loadingText.textContent = text; }
  hideLoading() { this.el.loading.classList.add('hidden'); }

  showMenu() {
    this.el.menu.classList.remove('hidden');
    for (const k of ['hud', 'pause', 'death', 'win', 'intro']) this.el[k].classList.add('hidden');
    this.resetMenuPanels();
  }
  hideMenu() { this.el.menu.classList.add('hidden'); }
  resetMenuPanels() {
    this.el.joinPanel.classList.add('hidden');
    this.el.hostPanel.classList.add('hidden');
    this.el.menuButtons.classList.remove('hidden');
    this.el.menuStatus.textContent = '';
  }
  showJoinPanel() { this.el.menuButtons.classList.add('hidden'); this.el.joinPanel.classList.remove('hidden'); this.el.joinCode.value = ''; this.el.joinCode.focus(); }
  showHostPanel(code) {
    this.el.menuButtons.classList.add('hidden'); this.el.hostPanel.classList.remove('hidden');
    this.el.hostCode.textContent = code || '····';
    this.el.hostWait.textContent = code ? '친구가 접속하길 기다리는 중…' : '브로커에 연결 중…';
  }
  setMenuStatus(t) { this.el.menuStatus.textContent = t; }
  get quality() { return this.el.quality.value; }
  get style() { return this.el.style.value; }

  showIntro(v) { this.el.intro.classList.toggle('hidden', !v); }
  showHUD() { this.el.hud.classList.remove('hidden'); }
  showPause(v) { this.el.pause.classList.toggle('hidden', !v); }
  showDeath(title, text) { this.el.deathTitle.textContent = title; this.el.deathText.innerHTML = text; this.el.death.classList.remove('hidden'); }
  hideDeath() { this.el.death.classList.add('hidden'); }
  showWin(stats) { this.el.winStats.innerHTML = stats; this.el.win.classList.remove('hidden'); }

  setBattery(b, on, holding) {
    const f = this.el.batFill;
    f.style.width = `${Math.round(b * 100)}%`;
    f.classList.toggle('low', on && b < 0.2 && b > 0);
    f.classList.toggle('off', !on || b <= 0);
    this.el.batLabel.textContent = holding ? (on ? '헤드랜턴' : '헤드랜턴 · 꺼짐') : '랜턴 · 동반자';
  }
  setStamina(s) { this.el.stamina.style.width = `${Math.round(s * 100)}%`; this.el.stamina.style.opacity = s < 0.98 ? 1 : 0; }
  setObjective(text, dist) { this.el.objText.textContent = text; this.el.objDist.textContent = dist || ''; }
  setPartnerStatus(text, cls) { const e = this.el.partnerStatus; e.textContent = text; e.className = cls || ''; }
  setNet(text, cls) { const n = this.el.net; n.classList.toggle('hidden', !text); n.textContent = text || ''; n.className = cls ? cls : ''; }
  setFear(f) { this.el.vignette.style.opacity = Math.min(1, f * 1.3).toFixed(2); }

  prompt(html) {
    const p = this.el.prompt;
    if (!html) { p.classList.add('hidden'); return; }
    if (p.innerHTML !== html) p.innerHTML = html;
    p.classList.remove('hidden');
  }

  hold(label, frac) {
    const h = this.el.hold;
    if (label == null) { h.classList.add('hidden'); return; }
    h.classList.remove('hidden');
    this.el.holdLabel.textContent = label;
    this.el.holdFill.style.width = `${Math.round(frac * 100)}%`;
  }

  say(who, text, dur = 3200) {
    const s = this.el.subtitle;
    s.innerHTML = (who ? `<span class="who">${who}</span>` : '') + text;
    s.classList.remove('hidden');
    clearTimeout(this._subTimer);
    this._subTimer = setTimeout(() => s.classList.add('hidden'), dur);
  }

  partnerIndicator(visible, x, y, dist) {
    const p = this.el.partner;
    if (!visible) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    this.el.partnerDist.textContent = `${Math.round(dist)}m`;
  }

  waypoint(visible, x, y, text) {
    const w = this.el.waypoint;
    if (!visible) { w.classList.add('hidden'); return; }
    w.classList.remove('hidden');
    w.style.left = `${x}px`; w.style.top = `${y}px`;
    this.el.waypointText.textContent = text;
  }
}
