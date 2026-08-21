// Box2D, buildContactListener, and tiles are globals from their script tags

const {
  b2Vec2,
  b2World,
  b2BodyDef,
  b2Body,
  b2FixtureDef,
  b2CircleShape,
  b2ContactListener,
} = {
  b2Vec2: Box2D.Common.Math.b2Vec2,
  b2World: Box2D.Dynamics.b2World,
  b2BodyDef: Box2D.Dynamics.b2BodyDef,
  b2Body: Box2D.Dynamics.b2Body,
  b2FixtureDef: Box2D.Dynamics.b2FixtureDef,
  b2CircleShape: Box2D.Collision.Shapes.b2CircleShape,
  b2ContactListener: Box2D.Dynamics.b2ContactListener,
};

class Game {
  constructor(config) {
    this.config  = config;
    this.players = [];

    this.map      = [];
    this.dataMap  = [];
    this.wallMap  = [];
    this.spawnPool = [];

    this.physicsLookup = {};
    for (const t of physicsData) {
      this.physicsLookup[t.id] = t;
    }

    this.world = new b2World(
      new b2Vec2(config.gravityX, config.gravityY),
      true
    );

    this.world.SetContactListener(buildContactListener());

    this.timeStep = 1 / 60;
    this.velIter  = 8;
    this.posIter  = 3;
    this.running  = false;
  }

  getPlayer(id) {
    return this.players.find(p => p.id === id) ?? null;
  }

  moveBalls() {
    for (const p of this.players) {
      if(p.dead){ break;}
      const body  = p.body;
      const max   = p.maxSpeed;
      const accel = p.accel;
      let { x: vx, y: vy } = body.GetLinearVelocity();

      if (p.left  && vx > -max) vx -= accel;
      if (p.right && vx <  max) vx += accel;
      if (p.up    && vy > -max) vy -= accel;
      if (p.down  && vy <  max) vy += accel;

      body.SetLinearVelocity(new b2Vec2(vx, vy));
    }
  }

  spawnPlayer(id, team) {
    const config  = this.config;
    const teamStr = (team === 2 || team === 'blue') ? 'blue' : 'red';

    const sp = this.spawnPool?.[teamStr];
    if (!sp?.length) { console.error(`spawnPool not ready for "${teamStr}"`); return null; }

    const point = sp[Math.floor(Math.random() * sp.length)];

    const bodyDef = new b2BodyDef();
    bodyDef.type           = b2Body.b2_dynamicBody;
    bodyDef.position.Set(point.x, point.y);
    bodyDef.linearDamping  = config.linearDamping;
    bodyDef.angularDamping = config.angularDamping;
    bodyDef.allowSleep     = false;
    const body = this.world.CreateBody(bodyDef);

    const fixtureDef       = new b2FixtureDef();
    fixtureDef.shape       = new b2CircleShape(config.radius);
    fixtureDef.density     = config.density;
    fixtureDef.friction    = config.friction;
    fixtureDef.restitution = config.restitution;
    body.CreateFixture(fixtureDef);

    const player = {
      id,
      team: teamStr,
      body,
      socket: null,
      isPlayer: true,

      x: point.x, y: point.y,
      lx: 0, ly: 0,
      a: 0, ra: 0,

      left: false, right: false, up: false, down: false,

      maxSpeed: config.maxSpeed,
      accel:    config.accel,

      ghost: false, hasFlag: false,
      tagpro: false, bomb: false, speed: false, grip: false,
      dead: false,teamTileCount: 0,

      jumpsRemaining: config.jumpCharges, wasUp: false,
    };

    body.SetUserData(player);
    this.players.push(player);
    return player;
  }

  removePlayer(id) {
    const index = this.players.findIndex(p => p.id === id);
    if (index === -1) return;
    this.world.DestroyBody(this.players[index].body);
    this.players.splice(index, 1);
  }

  start() {
    if (this.running) return;
    this.running = true;

    this.lastTime    = Date.now();
    this.accumulator = 0;

    const STEP = 1000 / 60;

    const loop = () => {
      if (!this.running) return;

      const now       = Date.now();
      const frameTime = now - this.lastTime;
      this.lastTime   = now;

      this.accumulator += Math.min(frameTime, 250);

      while (this.accumulator >= STEP) {
        this.step();
        this.accumulator -= STEP;
      }

      requestAnimationFrame(loop);
    };

    loop();
  }

  stop() {
    this.running = false;
  }

step() {
  this.moveBalls();
  this.applyJumps();
  this.applyGravityWells();
  this.counterGravity();
  this.world.Step(this.timeStep, this.velIter, this.posIter);
  // This Box2dWeb build never auto-clears accumulated forces (no
  // SetAutoClearForces/ClearForces call anywhere inside its own Step()) -
  // ApplyForce() adds onto body.m_force and leaves it there. counterGravity()
  // calls ApplyForce() every tick a player stays dead, so without this,
  // that force compounds tick after tick (-mg, then -2mg, then -3mg, ...)
  // instead of applying once per step, eventually launching a dead player
  // straight up through the ceiling.
  this.world.ClearForces();
  this.syncPlayers();
}

// Box2D applies world gravity (config.gravityX/Y) to every dynamic body
// every step with no per-body opt-out (this Box2D build predates
// gravityScale). A dead player's fixtures are turned into sensors
// (helpers.js's popPlayer) so they stop colliding with anything, including
// whatever they might have been standing on - without this they'd keep
// sinking through the map for as long as they stay dead. Applying an
// equal-and-opposite force before the step cancels gravity's contribution
// to *this* step exactly (mirrors BamBall's engine/gravity.js
// counterGravity()).
counterGravity() {
  if (!this.config.gravityX && !this.config.gravityY) return;

  for (const p of this.players) {
    if (!p.dead || !p.body) continue;
    const mass = p.body.GetMass();
    p.body.ApplyForce(
      new b2Vec2(-mass * this.config.gravityX, -mass * this.config.gravityY),
      p.body.GetWorldCenter()
    );
  }
}

// Edge-triggered on a fresh up-press (not held), adds -jumpStrength onto
// whatever vy the player already has, on top of - not instead of - the
// normal up/down thrust moveBalls() already applied this same tick. A
// no-op with gravity off (jumpsRemaining never matters if nothing pulls
// you back down). Charges refill on touching a wall from above -
// contactListener.js's handlePlayerBegin.
applyJumps() {
  if (!this.config.gravityX && !this.config.gravityY) return;

  for (const p of this.players) {
    if (p.dead) continue;

    const pressedNow = !!p.up && !p.wasUp;
    p.wasUp = !!p.up;
    if (!pressedNow || (p.jumpsRemaining ?? 0) <= 0) continue;

    const vel = p.body.GetLinearVelocity();
    p.body.SetLinearVelocity(new b2Vec2(vel.x, vel.y - this.config.jumpStrength));
    p.jumpsRemaining -= 1;
  }
}


applyGravityWells() {
  const strength = this.config.gravityWellStrength;

  for (let y = 0; y < this.dataMap.length; y++) {
    for (let x = 0; x < this.dataMap[y]?.length; x++) {
      const entry = this.dataMap[y][x];
      if (!entry || entry.id !== 22 || !entry.fieldBody) continue;

      const pulled = entry.fieldBody.GetUserData()?.pulledPlayers;
      if (!pulled?.size) continue;

      const cx = x + 0.5;
      const cy = y + 0.5;

      for (const player of pulled) {
        const pos  = player.body.GetPosition();
        const dx   = cx - pos.x;
        const dy   = cy - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1e-6) continue;

        const vel = player.body.GetLinearVelocity();
        player.body.SetLinearVelocity(new b2Vec2(
          vel.x + (dx / dist) * strength,
          vel.y + (dy / dist) * strength,
        ));
      }
    }
  }
}

syncPlayers() {
  for (const player of this.players) {
    const pos  = player.body.GetPosition();
    const vel  = player.body.GetLinearVelocity();
    player.x  = pos.x;
    player.y  = pos.y;
    player.lx = vel.x;
    player.ly = vel.y;
    player.a  = player.body.GetAngle();  // ← missing
  }
}

  createMap() {
    this.clearTiles();
    this.dataMap = this.map.map(row => row.map(() => null));

    for (let y = 0; y < this.map.length; y++) {
      for (let x = 0; x < this.map[y].length; x++) {
        const id = this.map[y][x];
        if (!id) continue;
        this.dataMap[y][x] = {
          id,
          body: this.makeBody(id, x, y),
          fieldBody: id === 22 ? this.makeBody(22.1, x, y) : null,
          sprite: null,
        };
      }
    }
  }

  clearTiles() {
    for (let y = 0; y < this.dataMap.length; y++) {
      for (let x = 0; x < this.dataMap[y].length; x++) {
        const data = this.dataMap[y]?.[x];
        if (data?.body) this.world.DestroyBody(data.body);
        if (data?.fieldBody) this.world.DestroyBody(data.fieldBody);
      }
    }
    this.dataMap = [];
  }

  setTile(x, y, id) {
    this.map[y][x] = id || 0;

    const old = this.dataMap[y]?.[x];
    if (old?.body) this.world.DestroyBody(old.body);
    if (old?.fieldBody) this.world.DestroyBody(old.fieldBody);

    if (!id) {
      this.dataMap[y][x] = null;
      return null;
    }

    const entry = {
      id,
      body: this.makeBody(id, x, y),
      fieldBody: id === 22 ? this.makeBody(22.1, x, y) : null,
      sprite: null,
    };
    this.dataMap[y][x] = entry;
    return entry;
  }

  applyPortalData(portals) {
    for (const [key, pd] of Object.entries(portals)) {
      const [x, y] = key.split(',').map(Number);
      const entry  = this.dataMap[y]?.[x];
      if (!entry?.body) continue;

      const ud            = entry.body.GetUserData();
      ud.portalDest       = pd.destination ?? null;
      ud.portalCooldown   = pd.cooldown    ?? 0;
      ud.portalOnCooldown = false;
    }
  }

  applySwitchData(switches) {
    for (const [key, switchData] of Object.entries(switches)) {
      const [buttonX, buttonY] = key.split(',').map(Number);
      const userData = this.dataMap[buttonY]?.[buttonX]?.body?.GetUserData();
      if (!userData) continue;

      userData.switchTimer       = switchData.timer ?? 0;
      userData.switchActive      = false;
      userData.switchTimerHandle = null;
      userData.switchGates       = switchData.toggle.map(({ pos: { x: gateX, y: gateY } }) => ({
        x: gateX,
        y: gateY,
        defaultId: this.dataMap[gateY]?.[gateX]?.id ?? 9,
      }));
    }
  }

  makeBody(id, x, y) {
    const tileData = this.physicsLookup[id];
    if (!tileData) return null;

    const bodyDef = new b2BodyDef();
    bodyDef.type  = b2Body.b2_staticBody;
    bodyDef.position.Set(x + 0.5, y + 0.5);
    const body = this.world.CreateBody(bodyDef);

    const fixDef       = new b2FixtureDef();
    fixDef.isSensor    = tileData.sensor ?? false;
    fixDef.friction    = this.config.wallFriction;
    fixDef.restitution = this.config.wallRestitution;

    if (tileData.type === 'vector') {
      const shape = new Box2D.Collision.Shapes.b2PolygonShape();
      shape.SetAsArray(tileData.vectors.map(v => new b2Vec2(v.x, v.y)));
      fixDef.shape = shape;
    } else if (tileData.type === 'square') {
      const shape = new Box2D.Collision.Shapes.b2PolygonShape();
      shape.SetAsBox(tileData.size / 2 / 40, tileData.size / 2 / 40);
      fixDef.shape = shape;
    } else if (tileData.type === 'circle') {
      fixDef.shape = new b2CircleShape(tileData.size / 2 / 40);
    }

    body.CreateFixture(fixDef);
    body.SetUserData({
      isTile:   true,
      category: tileData.category ?? 'unknown',
      tileId:   id,
      x,
      y,
    });

    return body;
  }
}