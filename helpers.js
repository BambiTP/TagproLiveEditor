// b2ContactListener is available as a global from Box2dWeb

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

/**
 * Apply an explosion centred at world position (cx, cy).
 * Every player within radius receives an impulse directed away
 * from the blast centre, falling off linearly:
 *    speedBoost = strength × (radius − distance)
 * All values in Box2D units (tiles). Config is in TPU; the
 * conversion factor is baked in at GAME_CONFIG time.
 */
let helper = {
  activateGravityWell(player, wellData) {
    if (!wellData.pulledPlayers) wellData.pulledPlayers = new Set();
    wellData.pulledPlayers.add(player);
  },

  gravityWellStop(player, wellData) {
    wellData.pulledPlayers?.delete(player);
  },

  schedulePlayerTeleport(player, x, y) {
    Promise.resolve().then(() => {
      player.body.SetPosition(new Box2D.Common.Math.b2Vec2(x, y));
      player.x = x;
      player.y = y;
    });
  },

  applyExplosion(cx, cy, radius, strength) {
    const b2Vec2 = Box2D.Common.Math.b2Vec2;

    for (const player of game.players) {
      const pos  = player.body.GetPosition();
      const dx   = pos.x - cx;
      const dy   = pos.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= radius || dist < 1e-6) continue;

      const boost = strength * (radius - dist);
      const vel   = player.body.GetLinearVelocity();
      player.body.SetLinearVelocity(new b2Vec2(
        vel.x + (dx / dist) * boost,
        vel.y + (dy / dist) * boost,
      ));
    }
  },

  pickupFlag(player, other) {
    if (player.hasFlag) return;
    const id = game.map[other.y][other.x];
    if (id !== 3 && id !== 4 && id !== 16) return;
    player.hasFlag = { flagId: id, originX: other.x, originY: other.y };
    console.log(`[pickupFlag] Player ${player.id} picked up flag ${id} at (${other.x}, ${other.y})`);
    this.scheduleTileChange(other.x, other.y, id + 0.1);
    renderer.attachFlag(player.id, id);          // ← draw flag on ball
  },

  returnFlag(player) {
    if (!player.hasFlag) return;
    const { flagId, originX, originY } = player.hasFlag;
    player.hasFlag = false;
    console.log(`[returnFlag] Flag ${flagId} returned to origin (${originX}, ${originY})`);
    this.scheduleTileChange(originX, originY, flagId);
    renderer.detachFlag(player.id);              // ← remove flag from ball
  },

  transferFlag(from, to) {
    to.hasFlag = from.hasFlag;
    from.hasFlag = false;
    console.log(`[transferFlag] Flag transferred from player ${from.id} to player ${to.id}`);
    renderer.detachFlag(from.id);                // ← remove from passer
    renderer.attachFlag(to.id, to.hasFlag.flagId); // ← attach to receiver
  },

  captureFlag(player) {
    if (!game.scores) game.scores = { red: 0, blue: 0 };
    game.scores[player.team]++;
    console.log(`[captureFlag] Player ${player.id} (${player.team}) captured the flag! Scores:`, game.scores);
    this.returnFlag(player);
  },

  isFlagInBase(team) {
    const id = team === 'red' ? 3 : 4;
    for (let y = 0; y < game.map.length; y++)
      for (let x = 0; x < game.map[y].length; x++)
        if (game.map[y][x] === id) {
          console.log(`[isFlagInBase] ${team} flag is in base at (${x}, ${y})`);
          return true;
        }
    console.log(`[isFlagInBase] ${team} flag is NOT in base`);
    return false;
  },



popPlayer(player) {
  if (player.dead) return;

if (player.rollingBomb) {
  player.rollingBomb = false;
  const pos = player.body.GetPosition();
  this.applyExplosion(
    pos.x, pos.y,   // ← guaranteed accurate
    game.config.rollingBombRadius,
    game.config.rollingBombStrength
  );
  return;
}

  player.dead = true;

  this.returnFlag(player);
  this.applyExplosion(player.x, player.y, game.config.deathExploRadius, game.config.deathExploStrength);

  player.body.SetLinearVelocity(new Box2D.Common.Math.b2Vec2(0, 0));
  for (let f = player.body.GetFixtureList(); f; f = f.GetNext()) {
    f.SetSensor(true);
  }

  if (player.container) {
    player.container.destroy();
    player.container = null;
    player.sprites = null;
  }

  setTimeout(() => this.respawnPlayer(player), 3000);
},

respawnPlayer(player) {
  const sp    = game.spawnPool[player.team];
  const point = sp[Math.floor(Math.random() * sp.length)];

  for (let f = player.body.GetFixtureList(); f; f = f.GetNext()) {
    f.SetSensor(false);
  }

  player.body.SetType(Box2D.Dynamics.b2Body.b2_dynamicBody);
  player.body.SetPosition(new Box2D.Common.Math.b2Vec2(point.x, point.y));
  player.x = point.x;
  player.y = point.y;
  player.dead = false;

  renderer.drawPlayer(player.id);
},
  pickSpawnPoint(team) {
    const pool = game.spawnPool[team];
    return pool[Math.floor(Math.random() * pool.length)];
  },


  /**
   * Boost a single player in the direction they're already
   * travelling, scaling their speed to maxSpeed × boostMultiplier.
   * No-ops when the ball is nearly stationary.
   */
  applyBoost(player) {
    const vel   = player.body.GetLinearVelocity();
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (speed < 1e-4) return;

    const target     = player.maxSpeed * game.config.boostMultiplier;
    const multiplier = target / speed;
    player.body.SetLinearVelocity(
      new Box2D.Common.Math.b2Vec2(vel.x * multiplier, vel.y * multiplier)
    );
  },

  scheduleChangeState(x, y, state, id) {
    Promise.resolve().then(() => {
      if (!game) return;
      const tileData = game.dataMap[y][x];
      if (tileData) tileData.state = state;
      if (renderer) renderer.changeTile(x, y, id);
    });
  },

  scheduleTileChange(x, y, newId = 0) {
    Promise.resolve().then(() => {
      if (!game) return;
      game.setTile(x, y, newId);
      if (renderer) renderer.changeTile(x, y, newId);
    });
  },

  triggerBomb(x, y) {
    if (game.map[y][x] !== 10) return;
    this.applyExplosion(x + 0.5, y + 0.5, game.config.bombRadius, game.config.bombStrength);
    this.scheduleTileChange(x, y, 10.1);
    setTimeout(() => this.scheduleTileChange(x, y, 10), game.config.bombCooldown);
  },

startPowerups() {
  // trackCooldown (contactListener.js) instead of a bare setTimeout so the
  // editor's Reset Cooldowns key can also fast-forward the very first pup
  // spawn, not just later pickup respawns.
  trackCooldown(game.config.powerupRespawn, () => {
    if (!game) return;

    const powerupStates = ['JukeJuice', 'RollingBomb', 'Tagpro'];
    const stateToId = {
      'JukeJuice':   6.1,
      'RollingBomb': 6.2,
      'Tagpro':      6.3
    };

    for (let y = 0; y < game.dataMap.length; y++) {
      if (!game.dataMap[y]) continue;
      for (let x = 0; x < game.dataMap[y].length; x++) {
        const tile = game.dataMap[y][x];
        if (!tile?.body) continue;

        const ud = tile.body.GetUserData();
        if (ud?.category !== 'powerup') continue;
        if (tile.state && tile.state !== 'empty') continue;

        const randomState = powerupStates[Math.floor(Math.random() * powerupStates.length)];
        const targetId    = stateToId[randomState];

        tile.state = randomState;
        this.scheduleChangeState(x, y, randomState, targetId);
      }
    }
  });
}






};
