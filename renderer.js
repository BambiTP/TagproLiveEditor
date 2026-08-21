const GRID_SIZE = 40;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;

    this.camera = { x: 0, y: 0, zoom: 1 };
    this.layers = {};

    this.renderLookup = {};
    for (const sd of renderData) {
      this.renderLookup[sd.id] = sd;
    }

    this.spriteSheets = {};  // { [key]: PIXI.ImageSource }
    this.sprites      = {};  // { [id]: PIXI.Texture }

    this.app   = new PIXI.Application();
    this.world = new PIXI.Container();
  }

  async init() {
    await this.app.init({ resizeTo: this.canvas, backgroundAlpha: 0, antialias: false });
    this.canvas.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
  }

  getLayer(name) {
    if (!this.layers[name]) {
      const container = new PIXI.Container();
      this.layers[name] = container;
      this.world.addChild(container);
    }
    return this.layers[name];
  }
attachFlag(playerId, flagId) {
  const player = game.players[playerId];
  if (!player?.sprites?.flagLayer) return;

  this.detachFlag(playerId);

  const tex = this.sprites[flagId];
  if (!tex) return;

  const flag = new PIXI.Sprite(tex);
  flag.anchor.set(0.5);
  player.sprites.flagLayer.addChild(flag);
  player.flagSprite = flag;
}

detachFlag(playerId) {
  const player = game.players[playerId];
  if (!player?.flagSprite) return;
  player.sprites.flagLayer.removeChild(player.flagSprite);
  player.flagSprite.destroy();
  player.flagSprite = null;
}
  async loadTextures(imageMap) {
    for (const [key, url] of Object.entries(imageMap)) {
      if (this.spriteSheets[key]) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await new Promise(r => img.onload = r);
      this.spriteSheets[key] = new PIXI.ImageSource({ resource: img,  });
    }
    this.cacheAllFrames();
  }

  cacheAllFrames() {
    const HALF = GRID_SIZE / 2;

    for (const sd of renderData) {
      const source = this.spriteSheets[sd.image];
      if (!source || sd.x === null || sd.y === null) continue;
      this.sprites[sd.id] = new PIXI.Texture({
        source,
        frame: new PIXI.Rectangle(sd.x * GRID_SIZE, sd.y * GRID_SIZE, GRID_SIZE, GRID_SIZE),
      });
    }

    const tilesSource = this.spriteSheets['tiles'];
    if (tilesSource) {
      for (const [key, [col, row]] of Object.entries(quadrantCoords)) {
        this.sprites[key] = new PIXI.Texture({
          source: tilesSource,
          frame: new PIXI.Rectangle(col * GRID_SIZE, row * GRID_SIZE, HALF, HALF),
        });
      }
    }
  }

drawTile(x, y, id) {
  const sd = this.renderLookup[id];
  if (!sd) return;
  const tex = this.sprites[id];
  if (!tex) return;
  const entry = game.dataMap[y][x];
  game.dataMap[y][x].id = id;

  if (sd.hasBackground) {
    const floor = new PIXI.Sprite(this.sprites[2]);
    floor.x = x * GRID_SIZE;
    floor.y = y * GRID_SIZE;
    this.getLayer('background').addChild(floor);
    if (entry) entry.backgroundSprite = floor;
  }

  const sprite = new PIXI.Sprite(tex);
  sprite.x = x * GRID_SIZE;
  sprite.y = y * GRID_SIZE;
  this.getLayer(sd.layer).addChild(sprite);
  if (entry) entry.sprite = sprite;

 if (id === 22) {
    const circle = new PIXI.Graphics();
    const r = (gameConfig.gravityWellRadius * 40);
    circle.beginFill(0x000000, 0.3);
    circle.drawCircle(0, 0, r);
    circle.endFill();
    circle.x = x * GRID_SIZE + GRID_SIZE / 2;
    circle.y = y * GRID_SIZE + GRID_SIZE / 2;
    this.getLayer(sd.layer).addChild(circle);
    if (entry) entry.gravityCircle = circle;
  }

  return sprite;
}
  createMap() {
    this.world.removeChildren();
    this.layers = {};

    for (let y = 0; y < game.map.length; y++) {
      for (let x = 0; x < game.map[y].length; x++) {
        const id = game.map[y][x];

        // Draw floor under diagonal walls (1.1 - 1.4)
        if (id >= 1.1 && id <= 1.4) {
          this.drawFloorAt(x, y);
        }

        // Draw the tile (skip wall id 1 - handled by drawWallTile, and empty id 0)
        if (id !== 1 && id !== 0) {
          this.drawTile(x, y, id);
        }

        this.drawWallTile(x, y);
      }
    }

    // Bake the background layer into a single texture for performance
    this.bakeBackground();
  }

  drawFloorAt(x, y) {
    const floorTex = this.sprites[2];
    if (!floorTex) return;

    const floor = new PIXI.Sprite(floorTex);
    floor.x = x * GRID_SIZE;
    floor.y = y * GRID_SIZE;

    this.getLayer('background').addChild(floor);

    const entry = game.dataMap[y][x];
    if (entry) entry.backgroundSprite = floor;
  }

  drawPlayer(id) {
  const player = game.players.find(p => p.id === id);
  const ballId = player.team === 'red' ? 'redball' : 'blueball';
  const tex = this.sprites[ballId];
  if (!tex) return;

  // Root container — positioned each tick, never rotated
  const container = new PIXI.Container();

  // Ball layer — rotation applied here
  const ballContainer = new PIXI.Container();
  const actualBall = new PIXI.Sprite(tex);
  actualBall.anchor.set(0.5);
  ballContainer.addChild(actualBall);
  container.addChild(ballContainer);

  // Info layer — sits alongside ball, never rotates
  const infoContainer = new PIXI.Container();
  const flagLayer = new PIXI.Container();
  flagLayer.position.set(13, -32);
  infoContainer.addChild(flagLayer);
  container.addChild(infoContainer);

  this.getLayer('players').addChild(container);

  player.container        = container;
  player.sprites          = player.sprites ?? {};
  player.sprites.ball     = ballContainer;
  player.sprites.actualBall = actualBall;
  player.sprites.info     = infoContainer;
  player.sprites.flagLayer = flagLayer;

  return container;
}
start() {
    this.createMap();

    this.app.ticker.add(() => {
      for (const player of game.players) {
        if (!player.container) continue;
        player.container.x = player.x * GRID_SIZE;
        player.container.y = player.y * GRID_SIZE;
        player.sprites.ball.rotation = player.a;
      }
    });
  }

setCamera(x, y, zoom = 1) {
    this.camera.x = x;
    this.camera.y = y;
    this.camera.zoom = zoom;

    this.world.scale.set(zoom);
    this.world.x = (this.app.renderer.width  / 2) - (x * GRID_SIZE * zoom);
    this.world.y = (this.app.renderer.height / 2) - (y * GRID_SIZE * zoom);
  }
  destroy() {
    this.stop();
    this.app.destroy(true, { children: true, texture: false, baseTexture: false });
    this.canvas.removeChild(this.app.canvas);
  }
changeTile(x, y, newId) {
  const entry = game.dataMap[y]?.[x];
  if (!entry) {
    return; 
  }

  if (entry.sprite) {
    entry.sprite.destroy();
     entry.sprite = null;
      }
  if (entry.backgroundSprite) {
    entry.backgroundSprite.destroy();
    entry.backgroundSprite = null; 
  }

  if (newId) {
    this.drawTile(x, y, newId);
  }
}


  bakeBackground() {
    const bgLayer = this.layers['background'];
    if (!bgLayer || bgLayer.children.length === 0) return;

    const width = game.map[0].length * GRID_SIZE;
    const height = game.map.length * GRID_SIZE;

    const renderTexture = PIXI.RenderTexture.create({ width, height });

    this.app.renderer.render({
      container: bgLayer,
      target: renderTexture,
    });

    for (let i = bgLayer.children.length - 1; i >= 0; i--) {
      bgLayer.children[i].destroy();
    }
    bgLayer.removeChildren();

    const bakedSprite = new PIXI.Sprite(renderTexture);
    bgLayer.addChild(bakedSprite);

    bgLayer.cacheAsBitmap = true;
  }


wallSolidsAt(col, row) {
  const tile = game.wallMap?.[row]?.[col];
  return WALL_SOLIDS[tile] ?? 0;
}

  drawWallTile(col, row) {
    const solids = this.wallSolidsAt(col, row);
    if (!solids) return;

    const HALF = GRID_SIZE / 2;

    for (let q = 0; q < 4; q++) {
      const mask = (solids >> (q << 1)) & 3;
      if (!mask) continue;

      const cx = col + ((q & 2) === 0 ? 1 : 0);
      const cy = row + (((q + 1) & 2) === 0 ? 0 : 1);

      let around =
        (this.wallSolidsAt(cx,     cy)     & 0xc0) |
        (this.wallSolidsAt(cx - 1, cy)     & 0x03) |
        (this.wallSolidsAt(cx - 1, cy - 1) & 0x0c) |
        (this.wallSolidsAt(cx,     cy - 1) & 0x30);
      around |= (around << 8);

      const start = q * 2 + 1;
      let cw = 0; while (cw < 8 && (around & (1 << (start + cw))))     cw++;
      let cc = 0; while (cc < 8 && (around & (1 << (start + 7 - cc)))) cc++;

      const hasChip    = mask === 3 && (((solids | (solids << 8)) >> ((q + 2) << 1)) & 3) === 0;
      const solidEnd   = cw === 8 ? 0 : (start + cw + 4) % 8;
      const solidStart = cw === 8 ? 0 : (start - cc + 12) % 8;

      const key = `${q}${solidStart}${solidEnd}${hasChip ? 'd' : ''}`;
      const tex = this.sprites[key] ?? this.sprites['000'];
      if (!tex) continue;

      let dx = col * GRID_SIZE;
      let dy = row * GRID_SIZE;
      if      (q === 0) { dx += HALF; }
      else if (q === 1) { dx += HALF; dy += HALF; }
      else if (q === 2) { dy += HALF; }

      const sprite = new PIXI.Sprite(tex);
      sprite.x = dx;
      sprite.y = dy;
      this.getLayer('background').addChild(sprite);
    }
  }
}