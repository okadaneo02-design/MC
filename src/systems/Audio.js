/**
 * Audio is intentionally disabled — the game ships silent.
 *
 * This is a no-op stub that preserves the original API so every `this.audio?.x()`
 * call site keeps working without changes. No AudioContext is ever created, so
 * there is no sound output of any kind.
 */
export class Audio {
  constructor() { this.enabled = false; }
  resume() {}
  setVolume() {}
  shot() {}
  boom() {}
  hit() {}
  pickup() {}
  engine() {}
  engineOff() {}
  dispose() {}
}
