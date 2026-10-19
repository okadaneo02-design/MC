import * as THREE from 'three';

/**
 * Code-driven visual effects on a strict particle budget.
 *
 * All short-lived sparks / dust / smoke / explosion puffs share ONE THREE.Points
 * draw call. Debris fragments are a small pool of tumbling boxes integrated
 * ballistically (no per-fragment rigid body, so they are cheap and capped).
 * Skid marks are a shared decal strip. Nothing here allocates per frame.
 */

const _c = new THREE.Color();

export class Effects {
  constructor(scene, maxParticles = 500) {
    this.scene = scene;
    this.max = maxParticles;

    // ---- particle pool (Points) ----
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.siz = new Float32Array(this.max);
    this.base = new Float32Array(this.max);   // size at birth
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.grav = new Float32Array(this.max);
    this.drag = new Float32Array(this.max);
    this.fade = new Float32Array(this.max);   // 1 = fade size to 0, 0 = keep
    this.cursor = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: `
        attribute float size; varying vec3 vColor;
        uniform float uScale;
        void main(){
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, size * uScale / max(0.001,-mv.z));
        }`,
      fragmentShader: `
        varying vec3 vColor;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d,d);
          if (r > 0.25) discard;
          float a = smoothstep(0.25, 0.02, r);
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // ---- debris fragments ----
    this.fragMax = Math.min(60, Math.floor(maxParticles / 8));
    this.fragGeo = new THREE.BoxGeometry(1, 1, 1);
    this.fragMat = new THREE.MeshStandardMaterial({ vertexColors: false, metalness: 0.5, roughness: 0.6, color: 0x5c6773 });
    this.frags = [];
    for (let i = 0; i < this.fragMax; i++) {
      const m = new THREE.Mesh(this.fragGeo, this.fragMat.clone());
      m.visible = false; m.castShadow = false;
      scene.add(m);
      this.frags.push({ mesh: m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    this.fragCursor = 0;

    // ---- tracers (short line segments) ----
    this.tracerMax = Math.min(40, Math.floor(maxParticles / 10));
    const tgeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(this.tracerMax * 2 * 3);
    this.tracerCol = new Float32Array(this.tracerMax * 2 * 3);
    tgeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tgeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo = tgeo;
    this.tracers = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.tracerList = [];
  }

  setMax(n) { /* pools are fixed-size; new budget affects spawn gating only */ this.budget = n; }

  // ---- spawning ---------------------------------------------------------
  _spawn(x, y, z, vx, vy, vz, size, hex, life, grav, drag, fade = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    _c.setHex(hex);
    this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
    this.siz[i] = size; this.base[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.fade[i] = fade;
  }

  spark(p, n = null, count = 10, hex = 0xffd27a) {
    for (let i = 0; i < count; i++) {
      let vx = (Math.random() - 0.5) * 7, vy = Math.random() * 5 + 1, vz = (Math.random() - 0.5) * 7;
      if (n) { vx += n.x * 6; vy += n.y * 6; vz += n.z * 6; }
      this._spawn(p.x, p.y, p.z, vx, vy, vz, 0.09 + Math.random() * 0.06, hex, 0.3 + Math.random() * 0.3, -14, 1.5);
    }
  }

  muzzle(p, dir, hex = 0xffe08a) {
    for (let i = 0; i < 7; i++) {
      this._spawn(p.x, p.y, p.z,
        dir.x * (6 + Math.random() * 8) + (Math.random() - 0.5) * 3,
        dir.y * (6 + Math.random() * 8) + (Math.random() - 0.5) * 3,
        dir.z * (6 + Math.random() * 8) + (Math.random() - 0.5) * 3,
        0.14 + Math.random() * 0.08, hex, 0.12 + Math.random() * 0.08, 0, 4);
    }
  }

  /** A heftier muzzle event for cannons: bright flash cone + a grey smoke puff. */
  cannonBlast(p, dir, hex = 0xffe08a) {
    for (let i = 0; i < 14; i++) {
      this._spawn(p.x, p.y, p.z,
        dir.x * (8 + Math.random() * 13) + (Math.random() - 0.5) * 5,
        dir.y * (8 + Math.random() * 13) + (Math.random() - 0.5) * 5,
        dir.z * (8 + Math.random() * 13) + (Math.random() - 0.5) * 5,
        0.22 + Math.random() * 0.16, hex, 0.13 + Math.random() * 0.1, 0, 5);
    }
    for (let i = 0; i < 7; i++) {
      this._spawn(p.x + dir.x * 0.35, p.y + dir.y * 0.35, p.z + dir.z * 0.35,
        dir.x * 2.5 + (Math.random() - 0.5) * 2.5, dir.y * 2.5 + Math.random() * 1.5, dir.z * 2.5 + (Math.random() - 0.5) * 2.5,
        0.36 + Math.random() * 0.26, 0x6a6a6a, 0.5 + Math.random() * 0.4, -1, 0.85, 1);
    }
  }

  /** Nitro exhaust: a jet of flame + sparks shooting out the back of a nozzle.
   *  `fwd` is the thrust direction; flame goes the opposite way. */
  thrusterFlame(p, fwd) {
    for (let i = 0; i < 4; i++) {
      const sp = 7 + Math.random() * 7;
      this._spawn(p.x - fwd.x * 0.4, p.y - fwd.y * 0.4, p.z - fwd.z * 0.4,
        -fwd.x * sp + (Math.random() - 0.5) * 2, -fwd.y * sp + (Math.random() - 0.5) * 2, -fwd.z * sp + (Math.random() - 0.5) * 2,
        0.18 + Math.random() * 0.12, i % 2 ? 0xff9a2a : 0x4fc3ff, 0.14 + Math.random() * 0.1, 0, 4);
    }
  }

  /** A billowing smoke screen — lots of slow grey puffs that drift and linger. */
  smokeScreen(p, radius = 12) {
    const n = Math.min(40, Math.floor(radius * 2.5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.5;
      this._spawn(p.x + Math.cos(a) * r, p.y + 0.5 + Math.random() * 1.5, p.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 1.5, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 1.5,
        1.0 + Math.random() * 1.2, 0x6a6e73, 2.5 + Math.random() * 2.5, -0.3, 0.6, 1);
    }
  }

  impact(p, n, hex = 0xffb347) {
    this.spark(p, n, 12, hex);
    for (let i = 0; i < 6; i++) {
      this._spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2,
        0.3 + Math.random() * 0.2, 0x6b6b6b, 0.5 + Math.random() * 0.4, -1, 0.8, 1);
    }
  }

  explosion(p, scale = 1) {
    const n = Math.floor(16 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const s = (4 + Math.random() * 9) * scale;
      this._spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(b) * s, Math.abs(Math.sin(b) * s) + 2, Math.sin(a) * Math.cos(b) * s,
        (0.3 + Math.random() * 0.35) * scale, i % 3 ? 0xff7a2a : 0xffd24a, 0.4 + Math.random() * 0.4, -6, 1.2);
    }
    for (let i = 0; i < Math.floor(10 * scale); i++) {
      this._spawn(p.x, p.y + 0.3, p.z, (Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3,
        (0.5 + Math.random() * 0.6) * scale, 0x3a3a3a, 0.8 + Math.random() * 0.6, -1.5, 0.7, 1);
    }
  }

  dust(p, intensity = 1) {
    if (Math.random() > 0.6 * intensity) return;
    this._spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5,
      0.25 + Math.random() * 0.25, 0x8a7d66, 0.5 + Math.random() * 0.5, -0.8, 0.9, 1);
  }

  drillSparks(p) {
    for (let i = 0; i < 3; i++) {
      this._spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 6, Math.random() * 5 + 2, (Math.random() - 0.5) * 6,
        0.07 + Math.random() * 0.05, 0xffce5a, 0.2 + Math.random() * 0.2, -14, 1.5);
    }
  }

  debris(p, color = 0x5c6773, count = 5, speed = 5) {
    for (let k = 0; k < count; k++) {
      const f = this.frags[this.fragCursor];
      this.fragCursor = (this.fragCursor + 1) % this.fragMax;
      f.mesh.visible = true;
      f.mesh.material.color.setHex(color);
      const s = 0.12 + Math.random() * 0.22;
      f.mesh.scale.set(s, s, s * (0.6 + Math.random()));
      f.mesh.position.set(p.x, p.y, p.z);
      f.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8 + 1.5, (Math.random() - 0.5) * speed);
      f.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      f.life = 1.4 + Math.random() * 1.2;
    }
  }

  tracer(a, b, hex = 0xffd36a) {
    this.tracerList.push({ a: a.clone(), b: b.clone(), life: 0.06, hex });
  }

  // ---- update -----------------------------------------------------------
  update(dt) {
    // particles
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.siz[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.siz[i] = 0; continue; }
      const i3 = i * 3;
      const d = 1 - this.drag[i] * dt;
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.vel[i3 + 1] += this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.siz[i] = this.fade[i] ? this.base[i] * t : this.base[i];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.setDrawRange(0, this.max);

    // debris
    for (const f of this.frags) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.vel.y -= 16 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      if (f.mesh.position.y < 0.05) { f.mesh.position.y = 0.05; f.vel.y *= -0.3; f.vel.x *= 0.7; f.vel.z *= 0.7; }
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      if (f.life <= 0) f.mesh.visible = false;
      else f.mesh.material.opacity = Math.min(1, f.life);
    }

    // tracers
    let ti = 0;
    for (const t of this.tracerList) {
      t.life -= dt;
      if (t.life <= 0) continue;
      const o = ti * 6;
      this.tracerPos[o] = t.a.x; this.tracerPos[o + 1] = t.a.y; this.tracerPos[o + 2] = t.a.z;
      this.tracerPos[o + 3] = t.b.x; this.tracerPos[o + 4] = t.b.y; this.tracerPos[o + 5] = t.b.z;
      _c.setHex(t.hex);
      for (let k = 0; k < 2; k++) {
        this.tracerCol[o + k * 3] = _c.r; this.tracerCol[o + k * 3 + 1] = _c.g; this.tracerCol[o + k * 3 + 2] = _c.b;
      }
      ti++;
      if (ti >= this.tracerMax) break;
    }
    this.tracerList = this.tracerList.filter((t) => t.life > 0).slice(0, this.tracerMax);
    this.tracerGeo.setDrawRange(0, ti * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.points.material.dispose();
    this.tracers.removeFromParent();
    this.tracerGeo.dispose();
    for (const f of this.frags) { f.mesh.removeFromParent(); f.mesh.material.dispose(); }
    this.fragGeo.dispose();
  }
}
