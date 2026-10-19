import { Input, ACTION_LABELS } from '../core/Input.js';
import BlockRegistry from '../vehicles/BlockRegistry.js';
import { cogValue } from '../systems/DamageSystem.js';

/** Cost in Cogs to buy a block from the shop — about 3× what breaking it yields. */
export const shopPrice = (def) => cogValue(def) * 3 + 2;

const $ = (id) => document.getElementById(id);

/** Cheerful paint presets (name, hex) for the whole-vehicle paint shop. */
const PAINT_PRESETS = [
  ['Ocean Blue', 0x2f7fd0], ['Sky Cyan', 0x37c6d8], ['Emerald', 0x3fb85a], ['Sunshine', 0xf2c33e],
  ['Rocket Orange', 0xf07a26], ['Cherry Red', 0xd83a3a], ['Candy Pink', 0xf06bb0], ['Electric Purple', 0x8a5ad0],
  ['Lime Punch', 0xa6e22e], ['Teal', 0x1fa89a], ['Deep Navy', 0x24406b], ['Crimson', 0x9b1c2e],
  ['Gold', 0xe0a43a], ['Bronze', 0xa9743b], ['Gunmetal', 0x4a525c], ['Jet Black', 0x15181c],
  ['Snow White', 0xeef2f6], ['Silver', 0xb8c0c8], ['Mint', 0x8ff0c0], ['Lavender', 0xc0a8f0],
  ['Coral', 0xff6f61], ['Mustard', 0xd4a017], ['Forest', 0x2f6b34], ['Ice Blue', 0xa8d8f0],
  ['Hot Magenta', 0xe0338a], ['Toxic Green', 0x5fff5f], ['Rust', 0x8a4b2a], ['Plum', 0x6b2f6b],
];

/** Owns every full-screen overlay: menus, settings, pause, inventory, blueprints. */
export class UI {
  constructor(game) {
    this.game = game;
    this.boot = $('boot');
    this.mainMenu = $('main-menu');
    this.settingsMenu = $('settings-menu');
    this.pauseMenu = $('pause-menu');
    this.inventoryUI = $('inventory-ui');
    this.blueprintUI = $('blueprint-ui');
    this.salvageUI = $('salvage-ui');
    this.shopUI = $('shop-ui');
    this.paintUI = $('paint-ui');
    this._settingsReturn = 'main';
    this._wire();
  }

  // ---- boot --------------------------------------------------------------
  bootStatus(text, pct) {
    $('boot-status').textContent = text;
    if (pct != null) $('boot-bar-fill').style.width = `${Math.round(pct * 100)}%`;
  }
  bootError(message) {
    $('boot-status').textContent = 'Failed to start';
    $('boot-error').textContent = message;
    $('boot-bar-fill').style.background = '#ff5a4d';
  }
  hideBoot() { this.boot.classList.add('hidden'); }

  // ---- generic -----------------------------------------------------------
  hideAllOverlays() {
    for (const el of [this.mainMenu, this.settingsMenu, this.pauseMenu, this.inventoryUI, this.blueprintUI, this.salvageUI, this.shopUI, this.paintUI]) {
      el.classList.add('hidden');
    }
    $('partcfg-ui').classList.add('hidden');
    this._salvageWreck = null;
  }
  get anyOverlayOpen() {
    return [this.mainMenu, this.settingsMenu, this.pauseMenu, this.inventoryUI, this.blueprintUI, this.salvageUI, this.shopUI, this.paintUI]
      .some((el) => !el.classList.contains('hidden')) || !$('partcfg-ui').classList.contains('hidden');
  }

  // ---- shop --------------------------------------------------------------
  openShop() {
    this.shopUI.classList.remove('hidden');
    this.renderShop();
  }
  closeShop() { this.shopUI.classList.add('hidden'); }

  openPaint() {
    const wrap = $('paint-swatches'); wrap.innerHTML = '';
    for (const [name, hex] of PAINT_PRESETS) {
      const sw = document.createElement('div');
      sw.className = 'paint-sw';
      sw.style.background = '#' + hex.toString(16).padStart(6, '0');
      sw.innerHTML = `<span>${name}</span>`;
      sw.onclick = () => this._applyPaint(hex);
      wrap.appendChild(sw);
    }
    const rb = document.createElement('div');
    rb.className = 'paint-sw';
    rb.style.background = 'linear-gradient(90deg,#f44,#fa0,#fd0,#4c4,#4cf,#93f)';
    rb.innerHTML = '<span>Surprise</span>';
    rb.onclick = () => this._applyPaint(PAINT_PRESETS[Math.floor(Math.random() * PAINT_PRESETS.length)][1]);
    wrap.appendChild(rb);
    this.paintUI.classList.remove('hidden');
  }

  /** Paint the whole machine (or strip to bare metal with null). */
  _applyPaint(hex) {
    const v = this.game.playerVehicle;
    if (!v) return;
    v.grid.paint = hex;
    v.build({ preserveMotion: true });
    if (this.game.mode === 'build') v.setFrozen(true);
    this.game.hud?.toast(hex == null ? 'Stripped to bare metal.' : 'Fresh coat of paint!', 'good');
  }

  /** A 6-char room code (no ambiguous chars) for sharing a multiplayer game. */
  _genCode() {
    const A = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  renderShop() {
    const grid = $('shop-grid');
    const inv = this.game.inventory;
    $('shop-cogs').textContent = `⚙ ${this.game.cogs || 0}`;
    const buyable = BlockRegistry.all().filter((d) => d.behavior !== 'cab');
    grid.innerHTML = '';
    for (const def of buyable) {
      const price = shopPrice(def);
      const afford = (this.game.cogs || 0) >= price;
      const cell = document.createElement('div');
      cell.className = 'shop-cell';
      cell.innerHTML = `
        <div class="pi-swatch" style="background:${def.swatch}"></div>
        <div class="pi-text">
          <div class="pi-name">${def.name}</div>
          <div class="pi-sub">owned ${inv.creative ? '∞' : inv.count(def.id)}</div>
        </div>
        <button class="shop-buy" ${afford ? '' : 'disabled'}>⚙ ${price}</button>`;
      cell.querySelector('.shop-buy').onclick = () => this._buy(def, price);
      grid.appendChild(cell);
    }
  }

  _buy(def, price) {
    if ((this.game.cogs || 0) < price) { this.game.hud.toast('Not enough Cogs.', 'bad'); return; }
    this.game.cogs -= price;
    this.game.inventory.add(def.id, 1);
    this.game.hud.refreshCogs?.();
    this.game.buildMenu.refresh();
    this.renderShop();
    this.game.audio?.pickup?.();
    this.game.hud.toast(`Bought ${def.name}.`, 'good');
  }

  showMainMenu() {
    this.hideAllOverlays();
    this.mainMenu.classList.remove('hidden');
    this.game.hud.hide();
    this.game.buildMenu.hide();
    this._refreshContinue();
    $('mm-foot').innerHTML =
      `MACHINECRAFT — build, fight, salvage, explore<br>` +
      `Three.js r169 · Rapier 3D · all models generated procedurally at runtime`;
  }

  async _refreshContinue() {
    const g = this.game;
    const slots = await g.listSlots();
    this._slots = slots;

    // render the 10-slot grid
    const grid = $('mm-slots');
    if (grid) {
      grid.innerHTML = '';
      for (const s of slots) {
        const el = document.createElement('div');
        el.className = 'slot' + (s.used ? ' filled' : '') + (s.slot === g.currentSlot ? ' current' : '');
        const info = s.used
          ? `<span class="slot-info">L${s.level} · ${s.blocks}blk${s.creative ? ' · C' : ''}</span>`
          : `<span class="slot-info">empty</span>`;
        el.innerHTML = `<span class="slot-n">Slot ${s.slot}</span>${info}`;
        el.title = s.used ? `Saved ${new Date(s.savedAt).toLocaleString()} — click to play, Shift-click to erase` : 'Empty — click to start a new world here';
        el.onclick = (e) => this._enterSlot(s.slot, !!e.shiftKey);
        grid.appendChild(el);
      }
    }

    // "Continue latest" loads the most-recently-saved slot
    const used = slots.filter((s) => s.used).sort((a, b) => b.savedAt - a.savedAt);
    const btn = $('mm-continue');
    btn.disabled = used.length === 0;
    if (used.length) {
      this._latestSlot = used[0].slot;
      btn.textContent = `Continue Slot ${used[0].slot}  ·  ${new Date(used[0].savedAt).toLocaleString()}`;
    } else {
      this._latestSlot = null;
      btn.textContent = 'Continue latest';
    }
  }

  /** First empty slot number, or the current slot if all 10 are full. */
  _firstEmptySlot() {
    const empty = (this._slots || []).find((s) => !s.used);
    return empty ? empty.slot : this.game.currentSlot;
  }

  async _enterSlot(n, erase = false) {
    const g = this.game;
    const s = (this._slots || []).find((x) => x.slot === n);
    if (erase) {
      if (!s || !s.used) return;
      await g.save.deleteWorld(g._slotKey(n));
      g.hud.toast(`Slot ${n} erased.`, 'good');
      this._refreshContinue();
      return;
    }
    if (s && s.used) g.continueGame(n);
    else g.newGame({ slot: n });
  }

  showPause() {
    this.pauseMenu.classList.remove('hidden');
    $('pm-foot').textContent = `World seed ${this.game.seed}`;
  }
  hidePause() { this.pauseMenu.classList.add('hidden'); }

  // ---- wiring ------------------------------------------------------------
  _wire() {
    const g = this.game;

    // username (cosmetic to the player; one value quietly reveals the sandboxes)
    const userEl = $('mm-user');
    try { userEl.value = localStorage.getItem('mc.user') || ''; } catch {}
    const unlocked = () => g.username === 'NeoDev';
    const syncUser = () => {
      g.username = userEl.value.trim();
      try { localStorage.setItem('mc.user', g.username); } catch {}
      // Creative + Tester simply don't exist unless the right username is present.
      const show = unlocked() ? '' : 'none';
      $('mm-creative').style.display = show;
      $('mm-tester').style.display = show;
    };
    userEl.oninput = syncUser; syncUser();

    $('mm-continue').onclick = () => g.continueGame(this._latestSlot || g.currentSlot);
    $('mm-new').onclick = () => g.newGame({ creative: false, slot: this._firstEmptySlot() });
    $('mm-creative').onclick = () => { if (unlocked()) g.newGame({ creative: true, slot: this._firstEmptySlot() }); };
    $('mm-tester').onclick = () => { if (unlocked()) g.newGame({ tester: true, slot: this._firstEmptySlot() }); };
    $('mm-settings').onclick = () => this.openSettings('main');

    $('bb-paint').onclick = () => this.openPaint();
    $('paint-close').onclick = () => this.paintUI.classList.add('hidden');
    $('paint-clear').onclick = () => this._applyPaint(null);
    $('paint-custom-input').oninput = (e) => this._applyPaint(parseInt(e.target.value.slice(1), 16));

    const room = () => (($('mm-room').value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || this._genCode());
    $('mm-host').onclick = () => {
      const r = room(); $('mm-room').value = r;
      const link = `http://${location.host}/?room=${r}`;
      $('mm-mphint').innerHTML = `Room <b>${r}</b> — send this link:<br><b style="user-select:all">${link}</b><br>waiting for Player 2…`;
      g.hostGame(r);
    };
    $('mm-join').onclick = () => { const r = room(); $('mm-room').value = r; $('mm-mphint').textContent = 'Connecting to ' + r + '…'; g.joinGame(r); };
    // deep link: ?room=CODE prefills the field so a shared link is one tap to join
    try {
      const qr = new URLSearchParams(location.search).get('room');
      if (qr) { $('mm-room').value = qr.toLowerCase().replace(/[^a-z0-9_-]/g, ''); $('mm-mphint').innerHTML = 'Invited to room <b>' + $('mm-room').value + '</b> — tap <b>Join</b>.'; }
    } catch {}

    $('pm-resume').onclick = () => g.setPaused(false);
    $('pm-save').onclick = async () => {
      const ok = await g.saveGame();
      g.hud.toast(ok ? 'Game saved.' : 'Save failed — see console.', ok ? 'good' : 'bad');
    };
    $('pm-settings').onclick = () => this.openSettings('pause');
    $('pm-quit').onclick = async () => { await g.saveGame(); g.quitToMenu(); };

    $('set-back').onclick = () => this.closeSettings();
    $('set-reset').onclick = () => {
      g.settings.resetDefaults();
      g.input.setBindings(g.settings.data.bindings);
      this._fillSettings();
    };

    $('inv-close').onclick = () => this.closeInventory();
    $('bp-close').onclick = () => this.blueprintUI.classList.add('hidden');
    $('bp-save').onclick = () => this._saveBlueprint();
    $('bp-export').onclick = () => this._exportCode();
    $('bp-import').onclick = () => this._importCode();
    $('bp-code').onfocus = () => { g.input.textCapture = true; };
    $('bp-code').onblur = () => { g.input.textCapture = false; };
    $('pc-close').onclick = () => $('partcfg-ui').classList.add('hidden');
    $('salvage-close').onclick = () => this.closeSalvage();
    $('salvage-all').onclick = () => this._salvageAll();
    $('bb-shop').onclick = () => this.openShop();
    $('shop-close').onclick = () => this.closeShop();

    const bind = (id, key, transform = (v) => v) => {
      const el = $(id);
      el.oninput = () => {
        g.settings.set({ [key]: transform(el.value) });
        g.applySettings();
      };
    };
    bind('set-quality', 'quality');
    bind('set-shadows', 'shadows', (v) => v === 'on');
    bind('set-renderdist', 'renderDistance', Number);
    bind('set-sens', 'sensitivity', Number);
    bind('set-volume', 'volume', Number);
    bind('set-invert', 'invertY', (v) => v === 'yes');

    const nameInput = $('bp-name');
    nameInput.onfocus = () => { g.input.textCapture = true; };
    nameInput.onblur = () => { g.input.textCapture = false; };
  }

  // ---- settings ----------------------------------------------------------
  openSettings(from) {
    this._settingsReturn = from;
    this._fillSettings();
    this.mainMenu.classList.add('hidden');
    this.pauseMenu.classList.add('hidden');
    this.settingsMenu.classList.remove('hidden');
  }
  closeSettings() {
    this.settingsMenu.classList.add('hidden');
    if (this._settingsReturn === 'pause') this.pauseMenu.classList.remove('hidden');
    else this.mainMenu.classList.remove('hidden');
  }

  _fillSettings() {
    const d = this.game.settings.data;
    $('set-quality').value = d.quality;
    $('set-shadows').value = d.shadows ? 'on' : 'off';
    $('set-renderdist').value = d.renderDistance;
    $('set-sens').value = d.sensitivity;
    $('set-volume').value = d.volume;
    $('set-invert').value = d.invertY ? 'yes' : 'no';
    this._fillKeybinds();
  }

  _fillKeybinds() {
    const list = $('keybind-list');
    const g = this.game;
    list.innerHTML = '';
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      const row = document.createElement('div');
      row.className = 'kb';
      const code = g.settings.data.bindings[action];
      row.innerHTML = `<span>${label}</span>`;
      const btn = document.createElement('button');
      btn.textContent = Input.label(code);
      btn.onclick = () => {
        row.classList.add('listening');
        btn.textContent = 'press a key…';
        g.input.grabNextKey((newCode) => {
          row.classList.remove('listening');
          const bindings = { ...g.settings.data.bindings, [action]: newCode };
          g.settings.set({ bindings });
          g.input.setBindings(bindings);
          this._fillKeybinds();
        });
      };
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  // ---- inventory ---------------------------------------------------------
  toggleInventory() {
    if (this.inventoryUI.classList.contains('hidden')) this.openInventory();
    else this.closeInventory();
  }
  openInventory() {
    const inv = this.game.inventory;
    const grid = $('inv-grid');
    grid.innerHTML = '';
    const entries = inv.creative ? BlockRegistry.all().map((d) => [d.id, Infinity]) : inv.nonEmpty();
    if (!entries.length) {
      grid.innerHTML = '<div class="inv-empty">Empty. Salvage enemy machines to fill it up.</div>';
    }
    for (const [id, n] of entries) {
      const def = BlockRegistry.get(id);
      if (!def) continue;
      const cell = document.createElement('div');
      cell.className = 'inv-cell';
      cell.innerHTML = `
        <div class="pi-swatch" style="background:${def.swatch}"></div>
        <div class="pi-text">
          <div class="pi-name">${def.name}</div>
          <div class="pi-sub">${def.mass} kg</div>
        </div>
        <div class="pi-count${inv.creative ? ' inf' : ''}">${inv.creative ? '∞' : n}</div>`;
      grid.appendChild(cell);
    }
    this.inventoryUI.classList.remove('hidden');
  }
  closeInventory() { this.inventoryUI.classList.add('hidden'); }

  // ---- salvage -----------------------------------------------------------
  openSalvage(wreck) {
    if (!wreck) return;
    this._salvageWreck = wreck;
    $('salvage-name').textContent = wreck.name || 'Wreck';
    this.salvageUI.classList.remove('hidden');
    this.game.input.exitPointerLock();
    this._refreshSalvage();
  }
  closeSalvage() { this.salvageUI.classList.add('hidden'); this._salvageWreck = null; }

  _refreshSalvage() {
    const wreck = this._salvageWreck;
    const list = $('salvage-list');
    if (!wreck || !this.game.vehicles.includes(wreck) || wreck.grid.size === 0) {
      list.innerHTML = '<div class="salvage-empty">Nothing left to salvage.</div>';
      return;
    }
    const manifest = this.game.salvage.manifest(wreck);
    list.innerHTML = '';
    if (!manifest.length) { list.innerHTML = '<div class="salvage-empty">Nothing left to salvage.</div>'; return; }
    for (const { id, def, count } of manifest) {
      const row = document.createElement('div');
      row.className = 'salvage-row';
      row.innerHTML = `
        <div class="pi-swatch" style="background:${def.swatch}"></div>
        <div class="pi-text"><div class="pi-name">${def.name}</div><div class="pi-sub">${def.mass} kg · ${def.category}</div></div>
        <div class="sv-count">×${count}</div>`;
      const take1 = document.createElement('button');
      take1.className = 'btn small';
      take1.textContent = 'Take 1';
      take1.onclick = () => { this.game.salvage.take(wreck, id, 1); this._refreshSalvage(); };
      const takeN = document.createElement('button');
      takeN.className = 'btn small btn-primary';
      takeN.textContent = `Take ${count}`;
      takeN.onclick = () => { this.game.salvage.take(wreck, id, count); this._refreshSalvage(); };
      row.appendChild(take1); row.appendChild(takeN);
      list.appendChild(row);
    }
  }

  _salvageAll() {
    const wreck = this._salvageWreck;
    if (!wreck) return;
    const n = this.game.salvage.takeAll(wreck);
    this.game.hud.toast(`Salvaged ${n} part${n === 1 ? '' : 's'}.`, 'good');
    this._refreshSalvage();
    if (!this.game.vehicles.includes(wreck) || wreck.grid.size === 0) this.closeSalvage();
  }

  // ---- part configuration -----------------------------------------------
  openPartConfig(block, vehicle) {
    if (!block) return;
    const def = block.def;
    // materialise an editable config from the block's or definition's defaults
    if (!block.config && def.config) block.config = { ...def.config };
    const cfg = block.config || {};
    this._pcBlock = block;
    this._pcVehicle = vehicle;

    $('pc-title').textContent = `Configure ${def.name}`;
    const body = $('pc-body');
    body.innerHTML = '';

    const rows = this._partSchema(def);
    for (const row of rows) {
      const label = document.createElement('label');
      label.textContent = row.label;
      body.appendChild(label);
      body.appendChild(this._pcControl(row, cfg));
    }
    $('partcfg-ui').classList.remove('hidden');
  }

  _partSchema(def) {
    const b = def.behavior;
    if (b === 'joint' && def.joint.type === 'servo') {
      return [
        { key: 'speed', label: 'Rotation speed', type: 'range', min: 0.5, max: 5, step: 0.1 },
        { key: 'minAngle', label: 'Min angle (rad)', type: 'range', min: -3.1, max: 0, step: 0.05 },
        { key: 'maxAngle', label: 'Max angle (rad)', type: 'range', min: 0, max: 3.1, step: 0.05 },
        { key: 'returnCenter', label: 'Return to centre', type: 'bool' },
        { key: 'reverse', label: 'Reverse direction', type: 'bool' },
        { info: 'Driven by the Servo left / right keys (J / L by default).' },
      ];
    }
    if (b === 'joint' && def.joint.type === 'rotator') {
      return [
        { key: 'speed', label: 'Spin speed', type: 'range', min: 1, max: 16, step: 0.5 },
        { key: 'reverse', label: 'Reverse direction', type: 'bool' },
        { key: 'hold', label: 'Hold key to run', type: 'bool' },
        { info: 'Driven by the Rotator key (H by default).' },
      ];
    }
    if (b === 'joint' && def.joint.type === 'piston') {
      return [
        { key: 'speed', label: 'Extend speed', type: 'range', min: 0.2, max: 2.5, step: 0.1 },
        { key: 'extend', label: 'Max extension (m)', type: 'range', min: 0.2, max: 1.4, step: 0.05 },
        { info: 'Driven by the Piston extend / retract keys (U / O by default).' },
      ];
    }
    if (b === 'joint' && def.joint.type === 'hinge') {
      return [{ info: 'A free hinge is passive — it swings with gravity, forces and collisions. Nothing to configure.' }];
    }
    if (b === 'drill') {
      return [{ info: 'Hold the Drill key (K by default) to spin it up. It cuts whatever the tip touches.' }];
    }
    if (b === 'turret' || b === 'weapon') {
      return [{ info: 'Fires with the Fire control (left mouse). Turrets aim at your crosshair automatically.' }];
    }
    return [{ info: 'No settings.' }];
  }

  _pcControl(row, cfg) {
    if (row.info) {
      const d = document.createElement('div');
      d.className = 'pc-val';
      d.style.gridColumn = '1 / -1';
      d.textContent = row.info;
      return d;
    }
    if (row.type === 'bool') {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="yes">On</option><option value="no">Off</option>';
      sel.value = cfg[row.key] ? 'yes' : 'no';
      sel.onchange = () => this._pcSet(row.key, sel.value === 'yes');
      return sel;
    }
    // range
    const wrap = document.createElement('div');
    wrap.className = 'pc-row-range';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = row.min; input.max = row.max; input.step = row.step;
    input.value = cfg[row.key] ?? row.min;
    const val = document.createElement('span');
    val.className = 'pc-val';
    val.textContent = (+input.value).toFixed(2);
    input.oninput = () => { val.textContent = (+input.value).toFixed(2); this._pcSet(row.key, +input.value); };
    wrap.appendChild(input); wrap.appendChild(val);
    return wrap;
  }

  _pcSet(key, value) {
    const block = this._pcBlock;
    if (!block) return;
    if (!block.config) block.config = { ...(block.def.config || {}) };
    block.config[key] = value;
    // limits are baked into the joint at build time, so rebuild to apply them
    if (this._pcVehicle && (key === 'minAngle' || key === 'maxAngle' || key === 'extend')) {
      this._pcVehicle.build({ preserveMotion: true });
      if (this.game.mode === 'build') this._pcVehicle.setFrozen(true);
    }
  }

  // ---- blueprints --------------------------------------------------------
  async openBlueprints() {
    await this._refreshBlueprints();
    this.blueprintUI.classList.remove('hidden');
  }

  async _refreshBlueprints() {
    const list = $('bp-list');
    list.innerHTML = '<div class="inv-empty">Loading…</div>';
    const rows = await this.game.save.listBlueprints();
    list.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<div class="inv-empty">No blueprints saved yet.</div>';
      return;
    }
    for (const r of rows) {
      const el = document.createElement('div');
      el.className = 'bp-row';
      const blocks = r.blueprint.blocks.length;
      el.innerHTML = `<div class="bp-name">${escapeHtml(r.name)}</div>
        <div class="bp-meta">${blocks} blocks · ${new Date(r.savedAt).toLocaleDateString()}</div>`;
      const load = document.createElement('button');
      load.className = 'btn small btn-primary';
      load.textContent = 'Load';
      load.onclick = () => this._loadBlueprint(r);
      const del = document.createElement('button');
      del.className = 'btn small danger';
      del.textContent = 'Delete';
      del.onclick = async () => { await this.game.save.deleteBlueprint(r.id); this._refreshBlueprints(); };
      el.appendChild(load); el.appendChild(del);
      list.appendChild(el);
    }
  }

  /** Encode the current machine to a shareable base64 code and copy it. */
  _exportCode() {
    const v = this.game.playerVehicle;
    if (!v) return;
    // 8-digit, numbers only. The machine is stored in the local vault under the
    // code; the code is the compact handle you keep or share.
    let code;
    do { code = String(Math.floor(10000000 + Math.random() * 90000000)); }
    while (localStorage.getItem('mcbp_' + code));
    try { localStorage.setItem('mcbp_' + code, JSON.stringify(v.grid.serialize())); } catch {}
    const el = $('bp-code'); el.value = code; el.focus(); el.select();
    try { navigator.clipboard?.writeText(code); } catch {}
    this.game.hud.toast(`Saved as code ${code} — copied to clipboard.`, 'good');
  }

  /** Import a machine from an 8-digit code in the local vault. */
  _importCode() {
    const code = ($('bp-code').value || '').replace(/\D/g, '');
    if (code.length !== 8) { this.game.hud.toast('Enter the 8-digit code (numbers only).', 'bad'); return; }
    const json = localStorage.getItem('mcbp_' + code);
    if (!json) { this.game.hud.toast('No machine found for that code.', 'bad'); return; }
    try {
      const bp = JSON.parse(json);
      const res = this.game.loadBlueprintIntoPlayer(bp);
      if (res.ok) { this.game.hud.toast('Imported machine from code!', 'good'); this.blueprintUI.classList.add('hidden'); $('bp-code').value = ''; }
      else this.game.hud.toast(res.reason || 'Import failed.', 'bad');
    } catch (e) { this.game.hud.toast('Could not read that code.', 'bad'); }
  }

  async _saveBlueprint() {
    const name = $('bp-name').value.trim() || 'Machine ' + new Date().toLocaleTimeString();
    const v = this.game.playerVehicle;
    const id = await this.game.save.saveBlueprint(name, v.grid.serialize(), {
      blocks: v.grid.size, mass: Math.round(v.grid.stats().mass),
    });
    if (id != null) {
      this.game.hud.toast(`Blueprint "${escapeHtml(name)}" saved.`, 'good');
      $('bp-name').value = '';
      this._refreshBlueprints();
    } else {
      this.game.hud.toast('Blueprint save failed — see console.', 'bad');
    }
  }

  _loadBlueprint(record) {
    const res = this.game.loadBlueprintIntoPlayer(record.blueprint);
    if (res.ok) {
      this.game.hud.toast(`Loaded "${escapeHtml(record.name)}".`, 'good');
      this.blueprintUI.classList.add('hidden');
    } else {
      this.game.hud.toast(res.reason, 'bad');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
