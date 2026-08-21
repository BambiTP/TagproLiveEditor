// replayPlayer.js
//
// Key state encoding: positive = pressed, negative = released.
// Absolute value increments by 1 each toggle (1, -2, 3, -4 …)
//
// rx/ry/lx/ly are periodic server corrections → warp the Box2D body.
// Multiply by 2.5 to convert from server units to this game's tile units.
//
// Usage:
//   const rp = new ReplayPlayer(game, renderer);
//   rp.load(ndjsonText);   // parses events + loads map
//   rp.play();             // starts physics-driven playback

const REPLAY_SCALE = 2.5;

// Game states matching TagPro protocol
const STATE = {
  WAITING: 3,      // Pre-game lobby, players frozen
  PLAYING: 1,      // Active gameplay
  ENDED: 5,        // Game over
  PAUSED: 2,       // Paused (if applicable)
};

class ReplayPlayer {
  constructor(game, renderer) {
    this.game      = game;
    this.renderer  = renderer;
    this.events    = [];
    this.cursor    = 0;
    this.time      = 0;        // elapsed replay time in ms
    this.playing   = false;
    this.last      = null;
    this.speed     = 1;
    this.followId  = null;
    this.gameState = STATE.WAITING;  // Current game state
    this.countdown = null;           // Pre-game countdown value
  }

  // ── Load ─────────────────────────────────────────────────────────────────

  load(ndjsonText) {
    this.events = ndjsonText.trim().split('\n').map(l => JSON.parse(l));
    this.cursor = 0;
    this.time   = 0;
    this.gameState = STATE.WAITING;
    this.countdown = null;

    // Clear any prior state
    this.game.stop();
    for (const id of Object.keys(this.game.players)) this.game.removePlayer(id);

    // Find and apply map + metadata before playback starts
    for (const [, type, data] of this.events) {
      if (type === 'map')               this.applyMap(data);
      if (type === 'recorder-metadata') this.followId = data?.follow?.[0] ?? null;
    }
  }

  applyMap(data) {
    const src = data.tiles;
    const cols = src.length;
    const rows = src[0].length;

    // Build map with correct orientation: map[y][x] = src[x][y]
    const map = Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => src[x][y] ?? 0)
    );

    this.game.map = map;

    // Build wallMap directly using wall IDs
    const wallMap = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const id = map[y][x];

        // Store wall IDs directly
        if (
          id === 1 ||
          id === 1.1 ||
          id === 1.2 ||
          id === 1.3 ||
          id === 1.4
        ) {
          wallMap[y][x] = id;
        }
      }
    }

    this.game.wallMap = wallMap;

    // Build dataMap
    this.game.dataMap = map.map(row =>
      row.map(id =>
        id
          ? {
              id,
              body: null,
              sprite: null,
              backgroundSprite: null,
            }
          : null
      )
    );

    this.game.createMap();
    this.renderer.createMap();
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  get duration() {
    return this.events.length ? this.events[this.events.length - 1][0] : 0;
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.last    = null;
    this.game.start();                    // physics loop runs normally
    requestAnimationFrame(t => this.tick(t));
  }

  pause() {
    this.playing = false;
    this.game.stop();
  }

  tick(now) {
    if (!this.playing) return;

    if (this.last !== null) this.time += (now - this.last) * this.speed;
    this.last = now;

    // Clamp at end
    if (this.time >= this.duration) {
      this.time = this.duration;
      this.flush();
      this.pause();
      return;
    }

    this.flush();       // apply all events up to current replay time

    // Camera follow
    const followId = this.followId;
    const target   = followId
      ? this.game.players[followId]
      : Object.values(this.game.players)[0];
    if (target) this.renderer.setCamera(target.x, target.y);

    requestAnimationFrame(t => this.tick(t));
  }

  // Process every event whose timestamp has passed
  flush() {
    while (this.cursor < this.events.length) {
      const [t, type, data] = this.events[this.cursor];
      if (t > this.time) break;
      this.handle(type, data);
      this.cursor++;
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  handle(type, data) {
    if      (type === 'p')          this.handleP(data);
    else if (type === 'id')         this.followId = data;
    else if (type === 'mapupdate')  this.handleMapUpdate(data);
    else if (type === 'playerLeft') this.handlePlayerLeft(data);
    else if (type === 'time')       this.handleTime(data);
  }

  handleTime(data) {
    // Update game state from time event
    if (data.state !== undefined) {
      this.gameState = data.state;
    }
    if (data.time !== undefined && data.time <= 3 && data.time > 0) {
      // Countdown timer (3, 2, 1)
      this.countdown = data.time;
    }
  }


  handleP(updates) {
    for (const u of updates) {
      const id = u.id;
      let p = this.game.players[id];

      // First time we see this player with full info → spawn them
      if (!p && u.name !== undefined) {
        // Map team: 1 = red, 2 = blue (TagPro native)
        p = this.game.spawnPlayer(id, 0, 0, u.team ?? 1);
        this.renderer.drawPlayer(id);
      }
      if (!p) continue;

      // ── Speed / accel (powerups change these mid-game) ──────────────────
      if (u.ms !== undefined) p.maxSpeed = u.ms * REPLAY_SCALE;
      if (u.ac !== undefined) p.accel    = u.ac * REPLAY_SCALE;

      // ── Key states ──────────────────────────────────────────────────────
      // positive = pressed, negative = released
      // Only apply key inputs if game is in PLAYING state
      const canMove = this.gameState === STATE.PLAYING && !p.dead;

      if (u.up    !== undefined) p.up    = u.up    > 0;
      if (u.down  !== undefined) p.down  = u.down  > 0;
      if (u.left  !== undefined) p.left  = u.left  > 0;
      if (u.right !== undefined) p.right = u.right > 0;

      // ── Server position / velocity correction ───────────────────────────
      // Always apply position corrections regardless of state (server authority)
      if (u.rx !== undefined || u.ry !== undefined) {
        const body = p.body;
        const cur  = body.GetPosition();
        const x    = u.rx !== undefined ? u.rx * REPLAY_SCALE + 0.5 : cur.x;
        const y    = u.ry !== undefined ? u.ry * REPLAY_SCALE + 0.5 : cur.y;
        body.SetPosition(new Box2D.Common.Math.b2Vec2(x, y));
      }

      if (u.lx !== undefined || u.ly !== undefined) {
        const body = p.body;
        const cur  = body.GetLinearVelocity();
        const vx   = u.lx !== undefined ? u.lx * REPLAY_SCALE : cur.x;
        const vy   = u.ly !== undefined ? u.ly * REPLAY_SCALE : cur.y;
        body.SetLinearVelocity(new Box2D.Common.Math.b2Vec2(vx, vy));
      }

 // ── Dead / Alive state ──────────────────────────────────────────────
if (u.dead !== undefined) {
  p.dead = u.dead;

  if (p.sprite) {
    p.ghost = u.dead;
    p.sprite.alpha = u.dead ? 0.15 : 1;
  }

  // Box2D: remove collision
  const fixture = p.body.GetFixtureList();
  if (fixture) {
    fixture.SetSensor(!!u.dead);
  }
}

      // ── Visibility ──────────────────────────────────────────────────────
      // Apply frozen state: zero velocity and disable keys when not playing or dead
      if (!canMove) {
        // Zero out velocity to prevent drift during wait/dead states
        const body = p.body;
        body.SetLinearVelocity(new Box2D.Common.Math.b2Vec2(0, 0));
        body.SetAngularVelocity(0);

        // Reset keys so no force is applied
        p.up = p.down = p.left = p.right = false;
      }
    }
  }

  handleMapUpdate({ x, y, v }) {
    const id  = v || 0;
    this.game.setTile(x, y, id);

    const entry = this.game.dataMap[y]?.[x];
    if (entry?.sprite)           { entry.sprite.destroy();           entry.sprite           = null; }
    if (entry?.backgroundSprite) { entry.backgroundSprite.destroy(); entry.backgroundSprite = null; }
    if (id) this.renderer.drawTile(x, y, id);
  }

  handlePlayerLeft({ id }) {
    const p = this.game.players[id];
    if (!p) return;
    if (p.container) p.container.destroy();
    this.game.removePlayer(id);
  }
}