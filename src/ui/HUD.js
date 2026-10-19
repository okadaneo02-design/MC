import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

/** In-game heads-up display. Pure DOM; updated once per rendered frame. */
export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.cabFill = $('hud-cab-fill');
    this.cabVal = $('hud-cab-val');
    this.hullFill = $('hud-hull-fill');
    this.hullVal = $('hud-hull-val');
    this.stats = $('hud-stats');
    this.speed = $('hud-speed');
    this.gear = $('hud-gear');
    this.hint = $('hud-hint');
    this.compassStrip = $('compass-strip');
    this.radar = $('radar');
    this.minimap = $('minimap');
    this.mmctx = this.minimap ? this.minimap.getContext('2d') : null;
    this.toastWrap = $('toast-wrap');
    this.prompt = $('interact-prompt');
    this.crosshair = $('crosshair');
    this.bossBar = $('boss-bar');
    this.bossName = $('boss-name');
    this.bossFill = $('boss-fill');

    this._blips = [];
    this._lastStats = '';
    this._buildCompass();
    this.setHint(
      '<b>WASD</b> drive · <b>Shift</b> nitro · <b>Space</b> handbrake · <b>Mouse</b> look · <b>LMB</b> fire cannons · <b>K</b> tools<br>' +
      'Turrets auto-aim & fire · <b>B</b> build · <b>R</b> recover · <b>C</b> recentre · <b>F3</b> debug · <b>Esc</b> pause',
    );
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setHint(html) { this.hint.innerHTML = html; }

  _buildCompass() {
    // Three repeats of the 360° strip so it can scroll seamlessly.
    const marks = [];
    for (let rep = 0; rep < 3; rep++) {
      for (let a = 0; a < 360; a += 15) {
        const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a];
        marks.push(card ? `<i class="card">${card}</i>` : `<i>·</i>`);
      }
    }
    this.compassStrip.innerHTML = marks.join('');
  }

  showPrompt(html) {
    this.prompt.innerHTML = html;
    this.prompt.classList.remove('hidden');
  }
  hidePrompt() { this.prompt.classList.add('hidden'); }

  toast(message, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = message;
    this.toastWrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }

  update() {
    const g = this.game;
    const v = g.playerVehicle;
    if (!v || !v.built) return;

    const s = v.grid.stats();

    // vitals
    const cab = v.grid.cab();
    const cabPct = cab ? Math.max(0, cab.health / cab.maxHealth) : 0;
    this.cabFill.style.width = (cabPct * 100).toFixed(0) + '%';
    this.cabFill.classList.toggle('low', cabPct < 0.34);
    this.cabVal.textContent = Math.round(cabPct * 100) + '%';

    const hullPct = s.maxHealth > 0 ? s.health / s.maxHealth : 0;
    this.hullFill.style.width = (hullPct * 100).toFixed(0) + '%';
    this.hullFill.classList.toggle('low', hullPct < 0.34);
    this.hullVal.textContent = Math.round(hullPct * 100) + '%';

    // speed
    const kmh = Math.abs(v.telemetry.forwardSpeed) * 3.6;
    this.speed.textContent = kmh.toFixed(0);
    const fs = v.telemetry.forwardSpeed;
    this.gear.textContent = v.disabled ? 'X' : (fs > 0.6 ? 'D' : fs < -0.6 ? 'R' : 'N');

    // stats block (rebuild only when it changes)
    const pp = v.worldPosition(_tmpV2);
    const biome = g.arena?.biomeAt ? this._biomeName(g.arena.biomeAt(pp.x, pp.z)) : null;
    const mats = g.materials || {};
    const matStr = Object.keys(mats).filter((k) => mats[k] > 0)
      .map((k) => `${k} <b>${mats[k]}</b>`).join(' · ');
    const statText =
      `<b>${s.blocks}</b> blocks · <b>${(s.mass / 1000).toFixed(2)}</b> t\n` +
      `<b>${s.engines}</b> engine${s.engines === 1 ? '' : 's'} · <b>${s.wheels}</b> wheels\n` +
      `grip <b>${v.telemetry.grounded}</b>/${s.wheels} · P/W <b>${(s.powerToWeight).toFixed(1)}</b>\n` +
      `★ Lv <b>${g.level || 1}</b> · XP <b>${g.xp || 0}</b>/${g.xpForLevel ? g.xpForLevel(g.level || 1) : 0}\n` +
      `⚙ <b>${g.cogs || 0}</b> cogs` +
      (biome ? ` · ${biome}` : '') +
      (matStr ? `\n${matStr}` : '') +
      (v.shieldMax > 0 ? `\n<span style="color:#39c2ff">◈ shield <b>${Math.round(v.shield)}</b>/${v.shieldMax}</span>` : '') +
      (v.energyMax > 0 ? `\n<span style="color:#5fd07a">⚡ energy <b>${Math.round(v.energy)}</b>/${v.energyMax}</span>` : '') +
      (v.wings && v.wings.length ? ` · ✈ ${v.wings.length}` : '') +
      (v.invuln > 0 ? `\n<b style="color:#39c2ff">◈ SPAWN SHIELD ${v.invuln.toFixed(1)}s</b>` : '') +
      (v.emp > 0 ? `\n<b style="color:#5fd0ff">⚡ SYSTEMS DOWN ${v.emp.toFixed(1)}s</b>` : '') +
      (v.smoke > 0 ? `\n<b style="color:#aeb6bd">◌ SMOKE SCREEN ${v.smoke.toFixed(1)}s</b>` : '');
    if (statText !== this._lastStats) {
      this.stats.innerHTML = statText.split('\n').join('<br>');
      this._lastStats = statText;
    }

    this._updateCompass(v);
    this._updateRadar(v);
    this._updateMinimap(v);
    this._updateBoss();

    if (this.crosshair) this.crosshair.classList.toggle('hot', !!this.game._crosshairHot);
  }

  /** Show a boss health bar whenever a live boss machine is in the world. */
  _updateBoss() {
    if (!this.bossBar) return;
    const enemies = this.game.enemies?.enemies || [];
    let boss = null;
    for (const e of enemies) { if (e.isBoss && e.built && !e.disabled) { boss = e; break; } }
    if (!boss) { this.bossBar.classList.add('hidden'); return; }
    const s = boss.grid.stats();
    const pct = s.maxHealth > 0 ? Math.max(0, s.health / s.maxHealth) : 0;
    this.bossBar.classList.remove('hidden');
    if (this.bossName) this.bossName.textContent = boss.name || 'BOSS';
    if (this.bossFill) this.bossFill.style.width = (pct * 100).toFixed(0) + '%';
  }

  _biomeName(id) {
    return {
      grassland: 'Grassland', hills: 'Rolling Hills', desert: 'Dust Flats',
      rocky: 'Rocky Badlands', mountains: 'Iron Peaks',
    }[id] || id;
  }

  refreshMaterials() { this._lastStats = null; }
  refreshLevel() { this._lastStats = null; }

  /** Force the cog readouts to update; flash the build pill when cogs are gained. */
  refreshCogs(delta) {
    this._lastStats = null;
    const pill = document.getElementById('build-cogs');
    if (pill) {
      pill.textContent = `⚙ ${this.game.cogs || 0}`;
      if (delta > 0) { pill.classList.remove('flash'); void pill.offsetWidth; pill.classList.add('flash'); }
    }
    const shopCogs = document.getElementById('shop-cogs');
    if (shopCogs) shopCogs.textContent = `⚙ ${this.game.cogs || 0}`;
  }

  _updateCompass(v) {
    const fl = v.forwardLocal;
    const dir = new THREE.Vector3(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion);
    let heading = Math.atan2(dir.x, dir.z) * 180 / Math.PI;   // 0 = +Z = "north"
    if (heading < 0) heading += 360;
    // each 15° mark is 40px wide; centre the strip on the heading
    const pxPerDeg = 40 / 15;
    const offset = -(heading * pxPerDeg) - 40 * 24 + 110;
    this.compassStrip.style.transform = `translateX(${offset}px)`;
  }

  _updateMinimap(v) {
    const ctx = this.mmctx; if (!ctx) return;
    const g = this.game, S = 150, C = S / 2, RANGE = 340, scale = C / RANGE;
    ctx.clearRect(0, 0, S, S);
    const pos = v.worldPosition(_tmpV2);
    // grid rings
    ctx.strokeStyle = 'rgba(90,120,110,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(C, C, C - 3, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(C, C, (C - 3) / 2, 0, 7); ctx.stroke();
    const dot = (wx, wz, col, r = 2) => {
      const x = C + (wx - pos.x) * scale, y = C + (wz - pos.z) * scale;   // north-up (world +Z = down)
      if (x < 2 || x > S - 2 || y < 2 || y > S - 2) return;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    };
    for (const lm of (g.arena?.landmarks || [])) dot(lm.x, lm.z, lm.kind === 'wreck' ? '#7a4a2c' : '#39c2ff', 2.5);
    for (const n of (g.resources?.nodes || [])) dot(n.x, n.z, '#5fd07a', 2);
    for (const m of (g.race?.markers?.() || [])) dot(m.x, m.z, m.active ? '#ffce4a' : '#55708a', m.active ? 3 : 2);
    for (const o of g.vehicles) { if (o === v) continue; const p = o.worldPosition(_tmpV); dot(p.x, p.z, o.disabled ? '#7a8694' : '#ff5a4d', 2.5); }
    // player arrow pointing where the machine faces (screen x=world x, y=world z)
    const fl = v.forwardLocal; const d = _tmpV.set(fl[0], 0, fl[2]).applyQuaternion(v.quaternion);
    const L = Math.hypot(d.x, d.z) || 1; const ux = d.x / L, uz = d.z / L; const px = -uz, pz = ux;
    ctx.save(); ctx.translate(C, C); ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.moveTo(ux * 7, uz * 7);
    ctx.lineTo(px * 4 - ux * 2, pz * 4 - uz * 2);
    ctx.lineTo(-px * 4 - ux * 2, -pz * 4 - uz * 2);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  _updateRadar(v) {
    const g = this.game;
    const range = 110;
    const targets = [];
    for (const lm of (g.arena?.landmarks || [])) {
      targets.push({ x: lm.x, z: lm.z, cls: 'node' });
    }
    // nearby resource deposits
    const pv = v.worldPosition(_tmpV);
    for (const n of (g.resources?.nodes || [])) {
      if ((n.x - pv.x) ** 2 + (n.z - pv.z) ** 2 < range * range) {
        targets.push({ x: n.x, z: n.z, cls: 'res' });
      }
    }
    for (const other of g.vehicles) {
      if (other === v) continue;
      const p = other.worldPosition(_tmpV);
      targets.push({ x: p.x, z: p.z, cls: other.disabled ? 'dead' : '' });
    }

    while (this._blips.length < targets.length) {
      const d = document.createElement('div');
      d.className = 'radar-blip';
      this.radar.appendChild(d);
      this._blips.push(d);
    }
    while (this._blips.length > targets.length) this._blips.pop().remove();

    const pos = v.worldPosition(_tmpV2);
    const fl = v.forwardLocal;
    const dir = _tmpV.set(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion);
    const yaw = Math.atan2(dir.x, dir.z);
    const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
    const R = 66;

    targets.forEach((t, i) => {
      const dx = t.x - pos.x, dz = t.z - pos.z;
      // rotate into vehicle space, then into screen space (up = forward)
      let rx = dx * cos - dz * sin;
      let rz = dx * sin + dz * cos;
      const dist = Math.hypot(rx, rz);
      const k = Math.min(1, dist / range);
      const ang = Math.atan2(rx, rz);
      const px = R + Math.sin(ang) * k * (R - 6);
      const py = R - Math.cos(ang) * k * (R - 6);
      const el = this._blips[i];
      el.className = 'radar-blip' + (t.cls ? ' ' + t.cls : '');
      el.style.left = px + 'px';
      el.style.top = py + 'px';
      el.style.opacity = dist > range ? '0.35' : '1';
    });
  }
}

const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
