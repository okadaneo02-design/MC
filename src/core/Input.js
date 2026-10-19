/**
 * Central input hub.
 *
 * Physical key codes (KeyboardEvent.code) are tracked raw; gameplay reads *actions*
 * which are bound to codes through the keymap, so rebinding never touches game code.
 * Build mode, driving and UI all read from the same instance, but the Game decides
 * which consumer is live, so there are no cross-mode conflicts.
 */

export const DEFAULT_BINDINGS = {
  throttle:    'KeyW',
  brake:       'KeyS',
  steerLeft:   'KeyA',
  steerRight:  'KeyD',
  handbrake:   'Space',
  boost:       'ShiftLeft',
  buildMode:   'KeyB',
  inventory:   'Tab',
  interact:    'KeyE',
  recover:     'KeyR',
  fire:        'Mouse0',
  camReset:    'KeyC',
  debug:       'F3',
  // Mechanical defaults (used by part bindings, Milestone 3)
  servoLeft:   'KeyJ',
  servoRight:  'KeyL',
  pistonOut:   'KeyU',
  pistonIn:    'KeyO',
  toolToggle:  'KeyK',
  rotatorRun:  'KeyH',
};

export const ACTION_LABELS = {
  throttle: 'Throttle', brake: 'Brake / Reverse', steerLeft: 'Steer left', steerRight: 'Steer right',
  handbrake: 'Handbrake', boost: 'Nitro / boost', buildMode: 'Toggle build mode', inventory: 'Inventory', interact: 'Interact / Salvage',
  recover: 'Recover vehicle', fire: 'Fire weapons', camReset: 'Recenter camera', debug: 'Debug overlay',
  servoLeft: 'Servo left', servoRight: 'Servo right', pistonOut: 'Piston extend', pistonIn: 'Piston retract',
  toolToggle: 'Drill / tool', rotatorRun: 'Rotator',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();          // physical codes currently down
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.bindings = { ...DEFAULT_BINDINGS };

    this.mouse = {
      x: 0, y: 0,            // client px
      ndcX: 0, ndcY: 0,      // -1..1
      dx: 0, dy: 0,          // movement accumulated this frame
      wheel: 0,
      buttons: new Set(),
      pressed: new Set(),
      released: new Set(),
      overUI: false,
    };
    this.pointerLocked = false;
    this.enabled = true;
    /** When true, keyboard game actions are suppressed (a text field has focus). */
    this.textCapture = false;
    /** Optional single-shot key grabber used by the rebinding UI. */
    this.keyGrabber = null;

    this._bind();
  }

  _bind() {
    const kd = (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'F3') e.preventDefault();
      if (e.code === 'Space' && !this.textCapture) e.preventDefault();
      if (this.keyGrabber) {
        const g = this.keyGrabber; this.keyGrabber = null;
        e.preventDefault();
        g(e.code);
        return;
      }
      if (this.textCapture) return;
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
    };
    const ku = (e) => {
      if (this.keys.delete(e.code)) this.releasedThisFrame.add(e.code);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons.clear(); });

    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      } else {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      }
      this.mouse.overUI = this._isOverUI(e.target);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.keyGrabber) {
        const g = this.keyGrabber; this.keyGrabber = null; g('Mouse' + e.button); return;
      }
      this.mouse.buttons.add(e.button);
      this.mouse.pressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.mouse.buttons.delete(e.button)) this.mouse.released.add(e.button);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this._onUnlock?.();
    });
  }

  _isOverUI(target) {
    if (!target || target === this.canvas) return false;
    let el = target;
    while (el && el !== document.body) {
      if (el.classList && (el.classList.contains('overlay') || el.id === 'build-ui' ||
          el.classList.contains('build-topbar') || el.classList.contains('build-palette'))) return true;
      el = el.parentElement;
    }
    return false;
  }

  setUnlockHandler(fn) { this._onUnlock = fn; }

  requestPointerLock() {
    if (this.pointerLocked) return;
    try {
      // Can legitimately fail (no user gesture yet, embedded frame, browser
      // cooldown after Esc). Mouse-look simply stays off until the next click.
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }
  exitPointerLock() {
    if (!this.pointerLocked) return;
    try { document.exitPointerLock?.(); } catch { /* ignore */ }
  }

  grabNextKey(fn) { this.keyGrabber = fn; }

  // ---- queries ------------------------------------------------------------
  codeDown(code) {
    if (!code) return false;
    if (code.startsWith('Mouse')) return this.mouse.buttons.has(+code.slice(5));
    return this.keys.has(code);
  }
  codePressed(code) {
    if (!code) return false;
    if (code.startsWith('Mouse')) return this.mouse.pressed.has(+code.slice(5));
    return this.pressedThisFrame.has(code);
  }
  down(action) { return this.codeDown(this.bindings[action]); }
  pressed(action) { return this.codePressed(this.bindings[action]); }
  released(action) {
    const code = this.bindings[action];
    if (!code) return false;
    if (code.startsWith('Mouse')) return this.mouse.released.has(+code.slice(5));
    return this.releasedThisFrame.has(code);
  }
  axis(negAction, posAction) {
    return (this.down(posAction) ? 1 : 0) - (this.down(negAction) ? 1 : 0);
  }

  consumeMouseDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return d;
  }
  consumeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return w; }

  /** Call once at the very end of each rendered frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouse.pressed.clear();
    this.mouse.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }

  setBindings(map) { this.bindings = { ...DEFAULT_BINDINGS, ...map }; }

  /** Human label for a physical code. */
  static label(code) {
    if (!code) return '—';
    if (code.startsWith('Mouse')) return ['LMB', 'MMB', 'RMB'][+code.slice(5)] || `M${code.slice(5)}`;
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
    return code;
  }
}
