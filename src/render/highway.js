// 3D note highway rendered with Three.js (WebGL on an HTML5 canvas).
import * as THREE from 'three';
import { HIT, MISSED } from '../game/engine.js';

export const LANE_COLORS = [0x22d34a, 0xff3b3b, 0xffd51f, 0x2f8cff, 0xff8a1f];
export const DRUM_COLORS = [0xff3b3b, 0xffd51f, 0x2f8cff, 0x22d34a];
const OPEN_COLOR = 0xb44dff;
const KICK_COLOR = 0xff8a1f;
const SP_COLOR = 0x8ff6ff;
const BG_COLOR = 0x07060d;

const LANE_SPACING = 1;
const HIGHWAY_WIDTH = 5.6;
const HIGHWAY_LENGTH = 70;
const GEM_RADIUS = 0.4;

/** Where the strikeline should sit, as a fraction of screen height from the top. */
const STRIKELINE_SCREEN_Y = 0.8;

/** x position of a lane for a highway with `count` lanes (lanes always span the same width). */
export const laneXFor = (lane, count) => (lane - (count - 1) / 2) * LANE_SPACING * (5 / count);

function makeLaneTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#16131f');
  grad.addColorStop(0.5, '#1d1a29');
  grad.addColorStop(1, '#16131f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 64);
  // Lane separators.
  g.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 1; i < 5; i++) {
    const x = ((i * LANE_SPACING + (HIGHWAY_WIDTH - 5 * LANE_SPACING) / 2) / HIGHWAY_WIDTH) * 512;
    g.fillRect(x - 1.5, 0, 3, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, HIGHWAY_LENGTH / 4);
  return tex;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class HighwayRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);
    this.scene.fog = new THREE.Fog(BG_COLOR, 20, 45);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    this.speed = 9; // world units per second of song time
    this.leftHanded = false;
    this.laneCount = 5;
    this.colors = LANE_COLORS;
    this.openColor = OPEN_COLOR;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x302040, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 8, 6);
    this.scene.add(sun);

    this.#buildHighway();
    this.#buildPools();
    this.configureLanes('guitar');
    this.glowTime = 0;
    this.cursor = 0;
  }

  /** Call when starting or restarting a song. */
  reset() {
    this.cursor = 0;
    for (const f of this.flashes) f.userData.age = Infinity;
  }

  // ---- Scene construction ---------------------------------------------------------------

  #buildHighway() {
    this.laneTexture = makeLaneTexture();
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(HIGHWAY_WIDTH, HIGHWAY_LENGTH),
      new THREE.MeshStandardMaterial({ map: this.laneTexture, roughness: 0.9, metalness: 0 }),
    );
    board.rotation.x = -Math.PI / 2;
    board.position.z = -HIGHWAY_LENGTH / 2 + 3;
    this.scene.add(board);

    this.railMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5cff, emissive: 0x3a2cff, emissiveIntensity: 0.6 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, HIGHWAY_LENGTH), this.railMaterial);
      rail.position.set((side * HIGHWAY_WIDTH) / 2, 0.06, -HIGHWAY_LENGTH / 2 + 3);
      this.scene.add(rail);
    }
  }

  laneX(lane) {
    return laneXFor(lane, this.laneCount);
  }

  /** Sets up frets, colours and effects for an instrument ('guitar'-style 5 lanes or 'drums'). */
  configureLanes(instrument) {
    const drums = instrument === 'drums';
    this.laneCount = drums ? 4 : 5;
    this.colors = drums ? DRUM_COLORS : LANE_COLORS;
    this.openColor = drums ? KICK_COLOR : OPEN_COLOR;
    this.#buildStrikeline();
    this.#buildLaneMaterials();
    this.#buildFlashes();
  }

  #buildStrikeline() {
    if (this.strikeGroup) this.scene.remove(this.strikeGroup);
    this.strikeGroup = new THREE.Group();
    this.scene.add(this.strikeGroup);
    this.frets = [];
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(HIGHWAY_WIDTH, 0.04, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    bar.position.set(0, 0.02, 0);
    this.strikeGroup.add(bar);

    const ringGeo = new THREE.TorusGeometry(GEM_RADIUS * 1.02, 0.07, 12, 40);
    const padGeo = new THREE.CylinderGeometry(GEM_RADIUS * 0.85, GEM_RADIUS * 0.85, 0.05, 32);
    for (let lane = 0; lane < this.laneCount; lane++) {
      const color = this.colors[lane];
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }),
      );
      ring.rotation.x = Math.PI / 2;
      const padMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0 });
      const pad = new THREE.Mesh(padGeo, padMat);
      group.add(ring, pad);
      group.position.set(this.laneX(lane), 0.06, 0);
      this.strikeGroup.add(group);
      this.frets.push({ group, ring, padMat, pressed: false, flash: 0 });
    }
  }

  #buildLaneMaterials() {
    const std = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, ...extra });
    Object.assign(this.mat, {
      lane: this.colors.map((c) => std(c, { emissive: c, emissiveIntensity: 0.25 })),
      laneMissed: this.colors.map((c) => std(new THREE.Color(c).multiplyScalar(0.25))),
      open: std(this.openColor, { emissive: this.openColor, emissiveIntensity: 0.4 }),
      tail: this.colors.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })),
      tailOpen: new THREE.MeshBasicMaterial({ color: this.openColor, transparent: true, opacity: 0.6 }),
    });
  }

  #buildFlashes() {
    for (const f of this.flashes ?? []) this.scene.remove(f);
    const flashGeo = new THREE.PlaneGeometry(1, 1);
    this.flashes = this.colors.concat(this.openColor).map((color, i) => {
      const m = new THREE.Mesh(
        flashGeo,
        new THREE.MeshBasicMaterial({
          map: this.glowTexture,
          color,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(i < this.laneCount ? this.laneX(i) : 0, 0.3, 0);
      m.userData.age = Infinity;
      this.scene.add(m);
      return m;
    });
  }

  #buildPools() {
    const gemBody = new THREE.CylinderGeometry(GEM_RADIUS, GEM_RADIUS * 0.92, 0.18, 32);
    const gemCap = new THREE.CylinderGeometry(GEM_RADIUS * 0.55, GEM_RADIUS * 0.55, 0.06, 32);
    const std = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, ...extra });

    this.mat = {
      sp: std(SP_COLOR, { emissive: SP_COLOR, emissiveIntensity: 0.5 }),
      capStrum: std(0xf2f2f2),
      capHopo: std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.9 }),
      capTap: std(0x141414),
      capCymbal: std(0x222222, { metalness: 0.6, roughness: 0.3 }),
      openMissed: std(0x2a1838),
      tailSp: new THREE.MeshBasicMaterial({ color: SP_COLOR, transparent: true, opacity: 0.85 }),
      tailDead: new THREE.MeshBasicMaterial({ color: 0x3a3a44, transparent: true, opacity: 0.6 }),
      beat: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
      measure: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 }),
    };

    this.gemPool = this.#pool(() => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(gemBody, this.mat.lane[0]);
      const cap = new THREE.Mesh(gemCap, this.mat.capStrum);
      cap.position.y = 0.11;
      g.add(body, cap);
      g.userData = { body, cap };
      return g;
    });
    const openGeo = new THREE.BoxGeometry(HIGHWAY_WIDTH - 0.5, 0.12, 0.22);
    this.openPool = this.#pool(() => new THREE.Mesh(openGeo, this.mat.open));
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.tailPool = this.#pool(() => new THREE.Mesh(unitBox, this.mat.tail[0]));
    const lineGeo = new THREE.PlaneGeometry(HIGHWAY_WIDTH, 1);
    this.beatPool = this.#pool(() => {
      const m = new THREE.Mesh(lineGeo, this.mat.beat);
      m.rotation.x = -Math.PI / 2;
      return m;
    });

    this.glowTexture = makeGlowTexture();
  }

  #pool(create) {
    const items = [];
    let used = 0;
    const scene = this.scene;
    return {
      begin() {
        used = 0;
      },
      next() {
        if (used === items.length) {
          const obj = create();
          scene.add(obj);
          items.push(obj);
        }
        const obj = items[used++];
        obj.visible = true;
        return obj;
      },
      end() {
        for (let i = used; i < items.length; i++) items[i].visible = false;
      },
    };
  }

  // ---- Layout ---------------------------------------------------------------------------

  /** Size the canvas and fit the camera so the strikeline spans the screen width (portrait). */
  resize(width, height) {
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const cam = this.camera;
    cam.aspect = aspect;
    cam.fov = aspect < 1 ? 62 : 50;
    cam.updateProjectionMatrix();

    // Highway half-width on screen in NDC: almost full width in portrait, narrower in landscape.
    const targetX = Math.min(0.94, (0.62 * height) / width);
    const targetY = 1 - 2 * STRIKELINE_SCREEN_Y;
    const pitch = THREE.MathUtils.degToRad(aspect < 1 ? 50 : 32);
    let dist = 8;
    let ahead = 6;
    const edge = new THREE.Vector3();
    // Iteratively solve camera distance (for width) and look-ahead (for strikeline height).
    for (let i = 0; i < 60; i++) {
      cam.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
      cam.lookAt(0, 0, -ahead);
      cam.updateMatrixWorld();
      edge.set(HIGHWAY_WIDTH / 2 - 0.25, 0, 0).project(cam);
      dist *= edge.x / targetX;
      edge.set(0, 0, 0).project(cam);
      ahead += (edge.y - targetY) * dist * 0.5;
    }
    // Fade notes in near the far end of the visible highway.
    const far = cam.position.distanceTo(new THREE.Vector3(0, 0, -Math.min(HIGHWAY_LENGTH - 6, dist * 3.2)));
    this.scene.fog.near = far * 0.55;
    this.scene.fog.far = far;
    this.lookahead = Math.min(HIGHWAY_LENGTH - 6, dist * 3.2) / this.speed; // seconds of notes to draw
  }

  /** Screen-space x (CSS px) of each lane at the strikeline, for aligning touch controls. */
  laneScreenPositions() {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    const lanes = [];
    for (let lane = 0; lane < this.laneCount; lane++) {
      v.set(this.laneX(this.#visualLane(lane)), 0, 0).project(this.camera);
      lanes.push(((v.x + 1) / 2) * rect.width);
    }
    v.set(0, 0, 0).project(this.camera);
    return { lanes, strikeY: ((1 - v.y) / 2) * rect.height, laneWidth: Math.abs(lanes[1] - lanes[0]) };
  }

  #visualLane(lane) {
    return this.leftHanded ? this.laneCount - 1 - lane : lane;
  }

  setNoteSpeed(speed) {
    this.speed = speed;
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  // ---- Per-frame ------------------------------------------------------------------------

  setFretPressed(lane, pressed) {
    this.frets[lane].pressed = pressed;
  }

  /** Flash a lane, or the open/kick lane when `lane` is null. */
  flash(lane) {
    const i = lane === null ? this.laneCount : lane;
    this.flashes[i].userData.age = 0;
    if (lane !== null) this.frets[lane].flash = 1;
  }

  /**
   * @param {number} t song time in seconds
   * @param {import('../game/engine.js').GameEngine} engine
   * @param {number} dt seconds since last frame
   */
  render(t, engine, dt) {
    const z = (time) => -(time - t) * this.speed;
    const horizon = t + this.lookahead;
    const notes = engine.notes;

    this.gemPool.begin();
    this.openPool.begin();
    this.tailPool.begin();
    this.beatPool.begin();

    for (const line of engine.tempoMap.beatLines(t - 0.3, horizon)) {
      const m = this.beatPool.next();
      m.material = line.measure ? this.mat.measure : this.mat.beat;
      m.scale.y = line.measure ? 0.09 : 0.05;
      m.position.set(0, 0.005, z(line.time));
    }

    // Skip notes that are fully in the past (time only moves forward; reset() on restart).
    while (this.cursor < notes.length && notes[this.cursor].endTime < t - 1) this.cursor++;

    const sp = engine.spActive;
    for (let i = this.cursor; i < notes.length; i++) {
      const n = notes[i];
      if (n.time > horizon) break;
      const state = engine.state[n.id];
      const isSp = n.spPhrase >= 0 && !engine.brokenPhrases.has(n.spPhrase);

      if (n.sustain) this.#drawTail(n, t, z, state, engine, isSp);
      if (state === HIT) continue;
      const nz = z(n.time);
      if (nz > 4) continue;

      if (n.open) {
        const m = this.openPool.next();
        m.material = state === MISSED ? this.mat.openMissed : isSp ? this.mat.sp : this.mat.open;
        m.position.set(0, 0.08, nz);
        continue;
      }
      for (const lane of n.lanes) {
        const g = this.gemPool.next();
        const { body, cap } = g.userData;
        body.material = state === MISSED ? this.mat.laneMissed[lane] : isSp ? this.mat.sp : this.mat.lane[lane];
        cap.material = n.cymbal ? this.mat.capCymbal : n.tap ? this.mat.capTap : n.hopo ? this.mat.capHopo : this.mat.capStrum;
        const scale = n.cymbal ? 1.15 : n.hopo || n.tap ? 0.82 : 1;
        g.scale.set(scale, n.cymbal ? 0.45 : n.tap ? 0.7 : 1, scale);
        g.position.set(this.laneX(this.#visualLane(lane)), 0.1, nz);
      }
    }

    this.gemPool.end();
    this.openPool.end();
    this.tailPool.end();
    this.beatPool.end();

    this.#animateFrets(dt, sp);
    this.renderer.render(this.scene, this.camera);
  }

  #drawTail(n, t, z, state, engine, isSp) {
    const dropped = engine.sustainDroppedAt[n.id];
    const holding = state === HIT && dropped === Infinity && n.endTime > t;
    let start = n.time;
    if (holding) start = Math.max(n.time, t); // eaten by the strikeline while held
    const end = n.endTime;
    if (end <= start || z(end) > 4) return;
    const dead = state === MISSED || (state === HIT && dropped !== Infinity);
    const zStart = Math.min(z(start), 4);
    const zEnd = z(end);
    const lanes = n.open ? [null] : n.lanes;
    for (const lane of lanes) {
      const m = this.tailPool.next();
      const wobble = holding ? 1 + 0.25 * Math.sin(t * 40 + (lane ?? 0)) : 1;
      if (lane === null) {
        m.material = dead ? this.mat.tailDead : isSp ? this.mat.tailSp : this.mat.tailOpen;
        m.scale.set(HIGHWAY_WIDTH - 0.8, 0.03, zStart - zEnd);
        m.position.set(0, 0.04, (zStart + zEnd) / 2);
      } else {
        m.material = dead ? this.mat.tailDead : isSp ? this.mat.tailSp : this.mat.tail[lane];
        m.scale.set(0.16 * wobble, 0.05, zStart - zEnd);
        m.position.set(this.laneX(this.#visualLane(lane)), 0.05, (zStart + zEnd) / 2);
      }
    }
  }

  #animateFrets(dt, spActive) {
    for (let lane = 0; lane < this.laneCount; lane++) {
      const f = this.frets[lane];
      f.group.position.x = this.laneX(this.#visualLane(lane));
      f.flash = Math.max(0, f.flash - dt * 4);
      f.padMat.emissiveIntensity = (f.pressed ? 0.9 : 0) + f.flash * 1.5;
      f.group.position.y = f.pressed ? 0.02 : 0.06;
    }
    for (let i = 0; i < this.flashes.length; i++) {
      const m = this.flashes[i];
      if (i < this.laneCount) m.position.x = this.laneX(this.#visualLane(i));
      m.userData.age += dt;
      const life = 0.28;
      const k = Math.min(1, m.userData.age / life);
      m.material.opacity = (1 - k) * 0.9;
      const lane = i < this.laneCount;
      const size = lane ? 1.2 + k * 1.6 : 5 + k * 2;
      m.scale.set(size, lane ? size : 1.2 + k, 1);
    }
    this.glowTime += dt;
    const target = spActive ? SP_COLOR : 0x6b5cff;
    this.railMaterial.color.lerp(new THREE.Color(target), Math.min(1, dt * 6));
    this.railMaterial.emissive.copy(this.railMaterial.color);
    this.railMaterial.emissiveIntensity = spActive ? 0.8 + 0.4 * Math.sin(this.glowTime * 8) : 0.5;
  }

  dispose() {
    this.renderer.dispose();
  }
}
