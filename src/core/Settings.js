import { DEFAULT_BINDINGS } from './Input.js';

const KEY = 'machinecraft.settings.v1';

export const DEFAULT_SETTINGS = {
  quality: 'medium',     // low | medium | high
  shadows: true,
  renderDistance: 450,
  sensitivity: 1.0,
  volume: 0.6,
  invertY: false,
  bindings: { ...DEFAULT_BINDINGS },
};

export const QUALITY_PRESETS = {
  low:    { pixelRatio: 1.0, shadowMapSize: 1024, blockDetail: 0, maxParticles: 180, antialias: false, shadowDistance: 45 },
  medium: { pixelRatio: 1.5, shadowMapSize: 2048, blockDetail: 1, maxParticles: 500, antialias: true,  shadowDistance: 70 },
  high:   { pixelRatio: 2.0, shadowMapSize: 2048, blockDetail: 2, maxParticles: 1100, antialias: true, shadowDistance: 110 },
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    this.load();
    this._listeners = new Set();
  }
  get preset() { return QUALITY_PRESETS[this.data.quality] || QUALITY_PRESETS.medium; }
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit() { for (const fn of this._listeners) fn(this.data); }

  set(patch) {
    Object.assign(this.data, patch);
    this.save();
    this.emit();
  }
  resetDefaults() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.save();
    this.emit();
  }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.data = { ...DEFAULT_SETTINGS, ...parsed,
          bindings: { ...DEFAULT_BINDINGS, ...(parsed.bindings || {}) } };
      }
    } catch (e) {
      console.warn('[settings] could not read saved settings, using defaults:', e);
    }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch (e) { console.warn('[settings] save failed:', e); }
  }
}
