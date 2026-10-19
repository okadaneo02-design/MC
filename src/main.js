import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './core/Game.js';
import { preloadModels, ASSET_MAP } from './models/ModelLoader.js';

const canvas = document.getElementById('viewport');
const bootStatus = document.getElementById('boot-status');
const bootFill = document.getElementById('boot-bar-fill');
const bootError = document.getElementById('boot-error');

function status(text, pct) {
  bootStatus.textContent = text;
  if (pct != null) bootFill.style.width = `${Math.round(pct * 100)}%`;
}

function fail(err) {
  console.error('[boot]', err);
  bootStatus.textContent = 'Failed to start';
  bootFill.style.background = '#ff5a4d';
  bootError.textContent = (err && err.stack) ? err.stack : String(err);
}

async function boot() {
  try {
    status('Loading physics engine…', 0.15);
    await RAPIER.init();

    status('Checking WebGL…', 0.35);
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
      throw new Error('WebGL is not available in this browser.');
    }

    status('Loading block models…', 0.45);
    await preloadModels(ASSET_MAP, (p) => status(`Loading block models… ${Math.round(p * 100)}%`, 0.45 + p * 0.25));

    status('Generating models…', 0.75);
    const game = new Game(canvas);
    window.MACHINECRAFT = game;         // handy for debugging from the console

    status('Ready.', 1);
    game.start();
    game.ui.hideBoot();
    game.ui.showMainMenu();

    // Pointer lock and the audio context both have to come from a user gesture.
    canvas.addEventListener('click', () => {
      game.audio?.resume();
      if (game.running && game.mode === 'drive' && !game.paused && !game.ui.anyOverlayOpen) {
        game.input.requestPointerLock();
      }
    });
    window.addEventListener('pointerdown', () => game.audio?.resume(), { once: false });

    window.addEventListener('beforeunload', () => { if (game.running) game.saveGame(); });
  } catch (err) {
    fail(err);
  }
}

window.addEventListener('error', (e) => { if (!document.getElementById('boot').classList.contains('hidden')) fail(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { if (!document.getElementById('boot').classList.contains('hidden')) fail(e.reason); });

boot();
