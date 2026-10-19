import BlockRegistry, { CATEGORIES } from '../vehicles/BlockRegistry.js';

const $ = (id) => document.getElementById(id);

/** Build-mode chrome: palette, selection card, validity readout, blueprint IO. */
export class BuildMenu {
  constructor(game) {
    this.game = game;
    this.root = $('build-ui');
    this.cats = $('palette-cats');
    this.items = $('palette-items');
    this.info = $('build-info');
    this.selectedCard = $('build-selected');
    this.modeTag = $('build-mode-tag');
    this.symBtn = $('bb-symmetry');

    this.activeCat = 'structure';
    this._itemEls = new Map();

    this._buildCategories();
    this._wire();
  }

  get builder() { return this.game.builder; }

  show() { this.root.classList.remove('hidden'); this.refresh(); }
  hide() { this.root.classList.add('hidden'); }

  _wire() {
    $('bb-drive').onclick = () => this.game.setMode('drive');
    $('bb-undo').onclick = () => { if (!this.builder.undo()) this.game.hud.toast('Nothing to undo'); };
    $('bb-redo').onclick = () => { if (!this.builder.redo()) this.game.hud.toast('Nothing to redo'); };
    $('bb-symmetry').onclick = () => { this.builder.toggleSymmetry(); this.refresh(); };
    $('bb-blueprints').onclick = () => this.game.ui.openBlueprints();
  }

  _buildCategories() {
    this.cats.innerHTML = '';
    for (const c of CATEGORIES) {
      const el = document.createElement('div');
      el.className = 'palette-cat' + (c.id === this.activeCat ? ' active' : '');
      el.textContent = c.label;
      el.onclick = () => { this.activeCat = c.id; this._buildCategories(); this.refresh(); };
      this.cats.appendChild(el);
    }
  }

  refresh() {
    const inv = this.game.inventory;
    const defs = BlockRegistry.byCategory(this.activeCat);
    this.items.innerHTML = '';
    this._itemEls.clear();

    for (const def of defs) {
      const n = inv.count(def.id);
      const el = document.createElement('div');
      el.className = 'palette-item'
        + (def.id === this.builder.selectedId ? ' active' : '')
        + (n <= 0 ? ' empty' : '');
      el.innerHTML = `
        <div class="pi-swatch" style="background:${def.swatch}"></div>
        <div class="pi-text">
          <div class="pi-name">${def.name}</div>
          <div class="pi-sub">${def.mass} kg · ${def.health} hp</div>
        </div>
        <div class="pi-count${inv.creative ? ' inf' : ''}">${inv.creative ? '∞' : n}</div>`;
      el.onclick = () => { this.builder.select(def.id); this.refresh(); };
      this.items.appendChild(el);
      this._itemEls.set(def.id, el);
    }

    const mode = this.game.testerMode ? 'TESTER' : (inv.creative ? 'CREATIVE' : 'SURVIVAL');
    this.modeTag.textContent = mode;
    this.modeTag.className = 'tag' + (inv.creative ? ' creative' : '');
    this.symBtn.textContent = 'Symmetry: ' + (this.builder.symmetry ? 'On' : 'Off');
    const cogPill = $('build-cogs');
    if (cogPill) cogPill.textContent = `⚙ ${this.game.cogs || 0}`;

    this._refreshSelectedCard();
    this._refreshInfo();
  }

  _refreshSelectedCard() {
    if (this.builder.deleteMode) {
      this.selectedCard.innerHTML = '<h4>Delete tool</h4>Click a block to remove it. Attached parts return to your inventory. Press <b>X</b> to exit.';
      return;
    }
    if (!this.builder.selectedId) {
      this.selectedCard.innerHTML = '<h4>Nothing equipped</h4>Pick a part from the palette to start placing, or press <b>X</b> for the delete tool.';
      return;
    }
    const def = BlockRegistry.get(this.builder.selectedId);
    if (!def) { this.selectedCard.innerHTML = ''; return; }
    const extra = [];
    if (def.engine) extra.push(`drive <b>${(def.engine.power / 1000).toFixed(1)} kN</b> · top <b>${Math.round(def.engine.topSpeed * 3.6)} km/h</b>`);
    if (def.wheel) extra.push(`radius <b>${def.wheel.radius} m</b> · grip <b>${def.wheel.gripLateral.toFixed(2)}</b>`);
    if (def.unique) extra.push('<b>one per vehicle</b>');
    const rotLine = def.autoOrient
      ? `auto-aligned to the face you click · <b>R</b> rolls it`
      : `axis <b>${this.builder.rotAxis.toUpperCase()}</b> · <b>R</b> rotate · <b>Q/E</b> change axis`;
    this.selectedCard.innerHTML = `
      <h4>${def.name}</h4>
      ${def.desc}<br>
      mass <b>${def.mass} kg</b> · hp <b>${def.health}</b> · armour <b>${def.armor}</b><br>
      ${extra.join('<br>')}${extra.length ? '<br>' : ''}
      ${rotLine}`;
  }

  _refreshInfo() {
    const v = this.game.playerVehicle;
    const s = v.grid.stats();
    const val = v.grid.validate();
    const problems = [...val.errors.map((e) => `<span class="err">${e}</span>`), ...val.warnings];
    this.info.innerHTML =
      `<b>${s.blocks}</b> blocks · <b>${(s.mass / 1000).toFixed(2)} t</b> · ` +
      `<b>${s.engines}</b> eng · <b>${s.wheels}</b> wheels · P/W <b>${s.powerToWeight.toFixed(1)}</b>` +
      (problems.length ? ` &nbsp;|&nbsp; ${problems.join(' · ')}` : ' &nbsp;|&nbsp; ready to drive');
  }
}
