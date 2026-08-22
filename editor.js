// editor.js - single-player live map editor. Boots the same Game/Renderer
// engine game.js/renderer.js already provide; adds nothing to them. Move
// with arrow keys (real Box2D physics), paint tiles with the mouse.
//
// Placement goes through game.setTile() (already handles physics bodies)
// and either renderer.changeTile() for a cheap single-sprite redraw, or a
// full renderer.createMap() when a wall tile is touched, since the wall
// auto-tile sprites at a cell depend on its neighbors (drawWallTile reads
// wallMap around the cell) and there's no cheap way to patch just the
// affected neighbor sprites.
//
// Overlay graphics (spawn point markers, link-mode highlights, the shape/
// brush ghost preview) are PIXI.Graphics added as *stage siblings* of
// renderer.world, not children of it - renderer.createMap() calls
// world.removeChildren(), which would otherwise wipe them out on every wall
// edit. Being siblings, they never get touched by that; each frame the
// ticker just mirrors world's position/scale onto them so they still pan
// and zoom with the map.

// Pristine snapshot of gameConfig.js's own defaults (normal CTF, no
// gravity), taken before anything (Settings modal, presets) has a chance to
// mutate the shared gameConfig object. CTF_PRESET below restores this
// wholesale rather than patching a hand-picked subset of fields, so
// clicking it really means "back to normal CTF" - not just gravityY off
// with whatever friction/accel/etc. happened to be left over from Gravity
// preset or a manual Settings edit.
const DEFAULT_GAME_CONFIG = { ...gameConfig };

const EDITOR_WIDTH  = 40;
const EDITOR_HEIGHT = 30;
const GROW_MARGIN    = 10; // how far outside current bounds a click may grow the map

const WALL_IDS = new Set([1, 1.1, 1.2, 1.3, 1.4]);

// Every tile drawn on PIXI's 'background' layer (walls, floor, spikes,
// buttons, team tiles, goals) - renderer.js's createMap() bakes that whole
// layer into one flattened, cacheAsBitmap texture (bakeBackground(), for
// draw-call performance). The cheap renderer.changeTile() path just adds a
// new sprite into that already-baked container, which PIXI doesn't
// visually refresh until the next full rebuild - so any of these tiles
// placed through changeTile() render invisible until something else (e.g.
// a wall edit) forces a full createMap(). Placing any of them has to go
// through the same full-repaint path walls already use.
const BACKGROUND_LAYER_IDS = new Set(
  renderData.filter(sd => sd.layer === 'background' && typeof sd.id === 'number').map(sd => sd.id)
);

// Tiles worth offering in the palette: skip transient/runtime-only states
// (flag/boost/potato "taken", the used-bomb "emptyBomb" state), the
// non-grid special ids (redball/blueball/marsball are player effects, not
// placeable map tiles), and the red/blue exit portals - visually identical
// to the plain portal, so redundant as separate palette entries.
const PALETTE_TILES = renderData.filter(sd =>
  typeof sd.id === 'number' &&
  !/Taken$/.test(sd.name) &&
  sd.name !== 'emptyBomb' &&
  !/^(empty)?(Red|Blue)Portal$/.test(sd.name)
);

let game, renderer;
let currentTileId = 1; // wall, by default - or 'redSpawn'/'blueSpawn'

// ─── Drawing tools (brush size / rect / circle) ──────────────────────────
let currentTool  = 'brush'; // 'brush' | 'rect' | 'circle'
let brushSize    = 1;
let shapeFilled  = true;
let painting     = false;
let dragStart    = null;    // cell where the current stroke started
let strokeTileId = null;    // id for the in-progress stroke (currentTileId, or 0 for right-click erase)
let ghostCells   = [];
let lastPaintedCell = null;

// ─── Link-mode / metadata state (map-level, exported into the JSON) ─────
let mapPortalLinks = {}; // "x,y" -> { destination: {x,y}, cooldown }
let mapSwitches    = {}; // "x,y" (button pos) -> { timer, toggle: [{pos:{x,y}}] }
let mapSpawnPoints = { red: [], blue: [] }; // {x,y,radius,weight}
let mapMeta        = { name: '', author: '', gameMode: 'normal' };
let mapMarsballs   = []; // [{x,y}] - not color-encoded in the PNG, its own JSON array

let linkMode = false;
let linkSource = null;      // { type: 'portal'|'button', x, y }
let hoveredLinkCell = null;

let spawnGraphicsLayer = null;
let linkGraphicsLayer  = null;
let ghostGraphicsLayer = null;

function blankMap(width, height) {
  const map = [];
  for (let y = 0; y < height; y++) {
    map[y] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      map[y][x] = border ? 1 : 2; // wall border, floor inside
    }
  }
  return map;
}

function wallMapFrom(map) {
  return map.map(row => row.map(id => (WALL_IDS.has(id) ? id : 0)));
}

async function bootBlank() {
  document.getElementById('startScreen').style.display = 'none';

  mapPortalLinks = {};
  mapSwitches    = {};
  // A real center spawn point, not an empty list - buildSpawnPool()'s own
  // fallback for "no spawn points and no flag tile to anchor to" is
  // {x:0.5, y:0.5}, the corner cell blankMap()'s wall border occupies.
  mapSpawnPoints = { red: [{ x: EDITOR_WIDTH / 2, y: EDITOR_HEIGHT / 2, radius: 3, weight: 1 }], blue: [] };
  mapMeta        = { name: '', author: '', gameMode: 'normal' };
  mapMarsballs   = [];

  game = new Game(gameConfig);
  game.map       = blankMap(EDITOR_WIDTH, EDITOR_HEIGHT);
  game.wallMap   = wallMapFrom(game.map);
  game.spawnPool = buildSpawnPool(mapSpawnPoints, game.map);
  game.createMap();
  game.spawnPlayer(0, 'red');

  await bootRenderer();
}

async function bootFromMapId(mapId) {
  document.getElementById('startScreen').style.display = 'none';

  game = new Game(gameConfig);
  const { map, wallMap, dataMap, spawnPool, portals, switches, spawnPoints, info, marsballs } = await loadMap(mapId);
  game.map       = map;
  game.wallMap   = wallMap;
  game.dataMap   = dataMap;
  game.spawnPool = spawnPool;
  game.createMap();
  game.applyPortalData(portals);
  game.applySwitchData(switches);
  game.spawnPlayer(0, 'red');

  mapPortalLinks = portals ?? {};
  mapSwitches    = switches ?? {};
  mapSpawnPoints = { red: spawnPoints?.red ?? [], blue: spawnPoints?.blue ?? [] };
  mapMeta        = { name: info?.name ?? '', author: info?.author ?? '', gameMode: info?.gameMode ?? 'normal' };
  mapMarsballs   = marsballs ?? [];

  await bootRenderer();
}

async function bootRenderer() {
  renderer = new Renderer(document.getElementById('canvas'));
  await renderer.init();
  await renderer.loadTextures(getSelectedImageMap());
  renderer.start();
  renderer.drawPlayer(0);

  spawnGraphicsLayer = new PIXI.Container();
  linkGraphicsLayer  = new PIXI.Graphics();
  ghostGraphicsLayer = new PIXI.Graphics();
  renderer.app.stage.addChild(spawnGraphicsLayer);
  renderer.app.stage.addChild(linkGraphicsLayer);
  renderer.app.stage.addChild(ghostGraphicsLayer);
  redrawSpawnPoints();
  redrawLinkOverlay();

  renderer.app.ticker.add(() => {
    if (freeLook) {
      renderer.setCamera(cameraCenter.x, cameraCenter.y, camera.zoom);
    } else {
      const red = game.players.find(p => p.id === 0);
      if (red) renderer.setCamera(red.x, red.y, camera.zoom);
    }

    for (const layer of [spawnGraphicsLayer, linkGraphicsLayer, ghostGraphicsLayer]) {
      layer.position.set(renderer.world.x, renderer.world.y);
      layer.scale.set(renderer.camera.zoom);
    }
  });

  game.start();
  buildPalette();
  buildToolbar();
  wireMouse();
}

// ─── Movement (arrow keys only - single player) ─────────────────────────
window.addEventListener('keydown', e => handleKey(e.key, true));
window.addEventListener('keyup',   e => handleKey(e.key, false));
function handleKey(key, down) {
  if (freeLook) return;
  const red = game?.players.find(p => p.id === 0);
  if (!red) return;
  switch (key) {
    case 'ArrowLeft':  red.left  = down; break;
    case 'ArrowRight': red.right = down; break;
    case 'ArrowUp':    red.up    = down; break;
    case 'ArrowDown':  red.down  = down; break;
  }
}

// ─── Camera zoom (scroll wheel, snapped to a fixed set of clean steps -
// arbitrary fractional zoom leaves 1px seams between adjacent tile sprites) ──
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
let zoomIndex = ZOOM_LEVELS.indexOf(1);
const camera = { zoom: ZOOM_LEVELS[zoomIndex] };

// Throttled to one step per gesture - a single physical scroll notch (esp.
// on a trackpad) fires many wheel events in quick succession, and without
// this each of those events stepped zoom independently, blowing through
// several levels on one scroll.
let lastZoomAt = 0;
window.addEventListener('wheel', e => {
  // Scrolling inside the palette/toolbar/topbar or any open modal (e.g. the
  // texture gallery, which needs its own scroll) shouldn't zoom the map.
  if (e.target.closest('#palette, #toolbar, #topbar, .modalOverlay')) return;
  const now = performance.now();
  if (now - lastZoomAt < 120) return;
  lastZoomAt = now;
  zoomIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, zoomIndex + (e.deltaY < 0 ? 1 : -1)));
  camera.zoom = ZOOM_LEVELS[zoomIndex];
}, { passive: true });

// ─── Free-look ("Leave Game") - camera stops following the player, right-
// click-drag pans freely instead of erasing. 'z' zooms/centers to fit the
// whole map and enters free-look. Movement input is dropped while active
// so a key held at the moment of leaving doesn't keep walking the player.
let freeLook = false;
let cameraCenter = { x: 0, y: 0 };
let panStart = null;

function updateLeaveJoinLabel() {
  const btn = document.getElementById('leaveJoinButton');
  if (btn) btn.textContent = freeLook ? '▶ Join Game' : '🚪 Leave Game';
}

function toggleFreeLook() {
  freeLook = !freeLook;
  const red = game?.players.find(p => p.id === 0);
  if (red) red.left = red.right = red.up = red.down = false;
  if (freeLook && red) { cameraCenter.x = red.x; cameraCenter.y = red.y; }
  updateLeaveJoinLabel();
}

function switchTeam() {
  const p = game?.players.find(pl => pl.id === 0);
  if (!p) return;
  p.team = p.team === 'red' ? 'blue' : 'red';
  if (p.container) p.container.destroy();
  renderer.drawPlayer(0);
  if (p.hasFlag) renderer.attachFlag(0, p.hasFlag.flagId); // see redrawPlayers()'s comment
}

function zoomToFit() {
  if (!game || !renderer) return;

  const mapWidth = game.map[0].length, mapHeight = game.map.length;
  const viewW = renderer.app.renderer.width, viewH = renderer.app.renderer.height;
  const fitZoom = Math.min(viewW / (mapWidth * 40), viewH / (mapHeight * 40)) * 0.95;

  let bestIndex = 0;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    if (ZOOM_LEVELS[i] <= fitZoom) bestIndex = i;
  }
  zoomIndex = bestIndex;
  camera.zoom = ZOOM_LEVELS[zoomIndex];

  if (!freeLook) {
    freeLook = true;
    const red = game.players.find(p => p.id === 0);
    if (red) red.left = red.right = red.up = red.down = false;
    updateLeaveJoinLabel();
  }
  cameraCenter.x = mapWidth / 2;
  cameraCenter.y = mapHeight / 2;
}

// True while an <input>/<textarea> (any modal's text fields, the map-id
// box, etc.) has focus - single-letter shortcuts below must not fire while
// the user is typing a value that happens to contain that letter.
function isTypingInField() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

window.addEventListener('keydown', e => {
  if (isTypingInField()) return;
  if (e.key === 'z' || e.key === 'Z') zoomToFit();
  if (e.key === 'r' || e.key === 'R') resetCooldowns();
});

// Boost/bomb/portal/pup cooldowns are tracked as ad-hoc mutable state right
// on the live body userdata (other.state, other.portalOnCooldown) or the
// dataMap entry (tile.state for pups) - see contactListener.js. Walking
// every tile and putting those back to their ready state is the whole job;
// player position, flags, and switch/gate state are untouched.
const PUP_ID_TO_STATE = { 6.1: 'JukeJuice', 6.2: 'RollingBomb', 6.3: 'Tagpro' };

function resetCooldowns() {
  if (!game) return;

  for (let y = 0; y < game.dataMap.length; y++) {
    for (let x = 0; x < (game.dataMap[y]?.length ?? 0); x++) {
      const tile = game.dataMap[y][x];
      if (!tile?.body) continue;

      const ud = tile.body.GetUserData();
      switch (ud.category) {
        case 'redBoost':
        case 'blueBoost':
        case 'boost':
          if (ud.state === 'cooldown') {
            ud.state = 'active';
            helper.scheduleChangeState(x, y, 'active', tile.id);
          }
          break;

        case 'bomb':
          if (ud.state === 'cooldown') {
            ud.state = 'active';
            helper.scheduleTileChange(x, y, 10);
          }
          break;

        case 'portal':
        case 'redPortal':
        case 'bluePortal':
          ud.portalOnCooldown = false;
          break;

        case 'powerup': {
          const restored = PUP_ID_TO_STATE[tile.id];
          if (restored && tile.state !== restored) {
            tile.state = restored;
            helper.scheduleChangeState(x, y, restored, tile.id);
          }
          break;
        }
      }
    }
  }
}

// ─── Background-layer repaint coalescing ─────────────────────────────────
// Wall changes need a full renderer.createMap() to get correct neighbor
// autotiling (renderer.js has no incremental way to patch just the affected
// quadrant sprites); every other 'background'-layer tile (floor, spikes,
// buttons, team tiles, goals - BACKGROUND_LAYER_IDS) needs one too, because
// createMap() is also the only thing that re-bakes that whole layer into a
// texture (bakeBackground()) - a sprite added via the cheap changeTile()
// path renders invisible until that bake happens. Either way it's a full
// rebuild+rebake (a GPU render pass over every tile), not just a sprite
// update. Coalescing to once-per-frame (an earlier version of this) still
// ran that full pass up to 60x/second during a continuous drag, which is
// where actual lag was coming from - "once per frame" isn't cheap when the
// thing running each frame is a full-map GPU pass. Debouncing instead -
// only rebuild ~80ms after the *last* qualifying cell touched, not on every
// frame while still dragging - means nothing expensive runs at all until
// painting actually pauses. game.setTile()/wallMap stay synchronous either
// way (physics must always be correct immediately); only the visual
// catches up shortly after you stop.
let backgroundRepaintTimer = null;

// renderer.drawPlayer() always builds a fresh, empty flagLayer and
// reassigns player.sprites.flagLayer to it - normal gameplay only calls it
// once at boot so this never matters there, but every repaint here calls it
// again just to reattach players to the world createMap() just wiped, which
// silently drops the flag sprite of whoever's carrying one (the game state,
// player.hasFlag, is untouched - only the visual vanishes). Re-running
// attachFlag() afterward when they're holding one fixes that.
function redrawPlayers() {
  for (const p of game.players) {
    renderer.drawPlayer(p.id);
    if (p.hasFlag) renderer.attachFlag(p.id, p.hasFlag.flagId);
  }
}

function queueBackgroundRepaint() {
  if (backgroundRepaintTimer) clearTimeout(backgroundRepaintTimer);
  backgroundRepaintTimer = setTimeout(() => {
    backgroundRepaintTimer = null;
    renderer.createMap();
    redrawPlayers();
    redrawSpawnPoints();
    redrawLinkOverlay();
  }, 80);
}

// ─── Map growth ───────────────────────────────────────────────────────────
// "Auto-generate map dimensions": the grid starts at EDITOR_WIDTH x
// EDITOR_HEIGHT but grows to fit whatever gets placed, up to GROW_MARGIN
// tiles past whichever edge you're painting beyond. Growing left/up shifts
// every existing index, so anything with absolute (x,y) - players, spawn
// points, portal/switch link positions - has to move with it; growing
// right/down is a plain append and touches nothing existing.
function growMapIfNeeded(x, y) {
  const height = game.map.length;
  const width  = game.map[0].length;

  if (x >= 0 && x < width && y >= 0 && y < height) return { x, y };

  if (x < -GROW_MARGIN || x >= width + GROW_MARGIN || y < -GROW_MARGIN || y >= height + GROW_MARGIN) {
    return null; // too far outside - reject
  }

  const growLeft   = x < 0 ? -x : 0;
  const growRight  = x >= width ? x - width + 1 : 0;
  const growTop    = y < 0 ? -y : 0;
  const growBottom = y >= height ? y - height + 1 : 0;

  const newWidth  = width + growLeft + growRight;
  const newHeight = height + growTop + growBottom;

  const newMap = [];
  for (let ny = 0; ny < newHeight; ny++) newMap[ny] = new Array(newWidth).fill(0);
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      newMap[oy + growTop][ox + growLeft] = game.map[oy][ox];
    }
  }

  game.map     = newMap;
  game.wallMap = wallMapFrom(newMap);

  if (growLeft || growTop) {
    for (const p of game.players) {
      const nx = p.x + growLeft, ny = p.y + growTop;
      p.body.SetPosition(new Box2D.Common.Math.b2Vec2(nx, ny));
      p.x = nx; p.y = ny;
    }
    for (const team of ['red', 'blue']) {
      for (const sp of mapSpawnPoints[team]) { sp.x += growLeft; sp.y += growTop; }
    }
    mapPortalLinks = shiftKeyedPositions(mapPortalLinks, growLeft, growTop, entry => {
      if (entry.destination) entry.destination = { x: entry.destination.x + growLeft, y: entry.destination.y + growTop };
      return entry;
    });
    mapSwitches = shiftKeyedPositions(mapSwitches, growLeft, growTop, entry => {
      entry.toggle = entry.toggle.map(t => ({ pos: { x: t.pos.x + growLeft, y: t.pos.y + growTop } }));
      return entry;
    });
    if (linkSource) { linkSource.x += growLeft; linkSource.y += growTop; }
  }

  game.createMap();
  renderer.createMap();
  redrawPlayers();
  redrawSpawnPoints();
  redrawLinkOverlay();

  return { x: x + growLeft, y: y + growTop };
}

function shiftKeyedPositions(obj, dx, dy, transform) {
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    const [ox, oy] = key.split(',').map(Number);
    out[`${ox + dx},${oy + dy}`] = transform(val);
  }
  return out;
}

// ─── Tile placement ───────────────────────────────────────────────────────
function cleanupLinksAt(x, y) {
  const key = `${x},${y}`;

  if (mapPortalLinks[key]) {
    const dest = mapPortalLinks[key].destination;
    if (dest) {
      const partnerKey = `${Math.floor(dest.x)},${Math.floor(dest.y)}`;
      if (mapPortalLinks[partnerKey]) delete mapPortalLinks[partnerKey].destination;
    }
    delete mapPortalLinks[key];
  }

  if (mapSwitches[key]) delete mapSwitches[key];
  for (const sw of Object.values(mapSwitches)) {
    sw.toggle = sw.toggle.filter(t => !(t.pos.x === x && t.pos.y === y));
  }

  if (linkSource && linkSource.x === x && linkSource.y === y) linkSource = null;
}

function placeTile(x, y, id) {
  if (id) {
    const grown = growMapIfNeeded(x, y);
    if (!grown) return;
    x = grown.x; y = grown.y;
  } else if (!game.map[y] || game.map[y][x] === undefined) {
    return;
  }

  const oldId = game.map[y][x];
  if (oldId === id) return;

  cleanupLinksAt(x, y);

  const isWall = WALL_IDS.has(id);

  game.setTile(x, y, id);
  game.wallMap[y][x] = isWall ? id : 0;

  if (BACKGROUND_LAYER_IDS.has(oldId) || BACKGROUND_LAYER_IDS.has(id)) {
    queueBackgroundRepaint();
  } else {
    renderer.changeTile(x, y, id || 0);
  }
}

// Commits a whole batch of cells (a shape stroke or an NxN brush stamp) as
// one unit: grows the map once for the batch's bounding box (so mid-batch
// growth can't shift coordinates out from under cells not yet placed), then
// places every cell through the normal placeTile() path.
function commitShapeCells(cells, id) {
  if (!cells.length) return;

  // Erasing shouldn't grow the map just to erase cells that don't exist yet -
  // placeTile() already no-ops per-cell for out-of-bounds erases, so skip
  // the batch-growth step entirely and let each cell fend for itself.
  if (!id) {
    for (const c of cells) placeTile(c.x, c.y, id);
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }

  const grownMin = growMapIfNeeded(minX, minY);
  if (!grownMin) return;
  const offX1 = grownMin.x - minX, offY1 = grownMin.y - minY;

  const grownMax = growMapIfNeeded(maxX + offX1, maxY + offY1);
  if (!grownMax) return;
  const offX2 = grownMax.x - (maxX + offX1), offY2 = grownMax.y - (maxY + offY1);

  const offX = offX1 + offX2, offY = offY1 + offY2;
  for (const c of cells) placeTile(c.x + offX, c.y + offY, id);
}

function rectCells(x0, y0, x1, y1, filled) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const cells = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (filled || x === minX || x === maxX || y === minY || y === maxY) cells.push({ x, y });
    }
  }
  return cells;
}

function circleCells(cx, cy, r, filled) {
  const cellMap = new Map();
  const add = (x, y) => cellMap.set(`${x},${y}`, { x, y });
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (filled) { for (let dx = -w; dx <= w; dx++) add(cx + dx, cy + dy); }
    else { add(cx - w, cy + dy); add(cx + w, cy + dy); }
  }
  if (!filled) {
    for (let dx = -r; dx <= r; dx++) {
      const h = Math.round(Math.sqrt(Math.max(0, r * r - dx * dx)));
      add(cx + dx, cy - h); add(cx + dx, cy + h);
    }
  }
  return [...cellMap.values()];
}

function lineCells(x0, y0, x1, y1) {
  const cells = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  while (true) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return cells;
}

function computeShapeCells(a, b) {
  if (currentTool === 'rect')   return rectCells(a.x, a.y, b.x, b.y, shapeFilled);
  if (currentTool === 'line')   return lineCells(a.x, a.y, b.x, b.y);
  if (currentTool === 'circle') {
    const r = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
    return circleCells(a.x, a.y, r, shapeFilled);
  }
  return [a];
}

function brushCells(cx, cy, size) {
  const start = -Math.floor((size - 1) / 2);
  const cells = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) cells.push({ x: cx + start + dx, y: cy + start + dy });
  }
  return cells;
}

function drawGhost(cells) {
  const g = ghostGraphicsLayer;
  g.clear();
  g.beginFill(0x5b8cff, 0.35);
  for (const c of cells) g.drawRect(c.x * 40, c.y * 40, 40, 40);
  g.endFill();
}
function clearGhost() { ghostGraphicsLayer.clear(); }

function screenToCell(clientX, clientY) {
  const rect = renderer.canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const worldX = (px - renderer.world.x) / (40 * renderer.camera.zoom);
  const worldY = (py - renderer.world.y) / (40 * renderer.camera.zoom);
  return { x: Math.floor(worldX), y: Math.floor(worldY) };
}

// ─── Spawn points ─────────────────────────────────────────────────────────
function placeSpawnPoint(x, y, team) {
  const grown = growMapIfNeeded(x, y);
  if (!grown) return;
  mapSpawnPoints[team].push({ x: grown.x + 0.5, y: grown.y + 0.5, radius: 1, weight: 1 });
  game.spawnPool = buildSpawnPool(mapSpawnPoints, game.map);
  redrawSpawnPoints();
}

function findSpawnPointAt(cell) {
  for (const team of ['red', 'blue']) {
    for (const sp of mapSpawnPoints[team]) {
      if (Math.floor(sp.x) === cell.x && Math.floor(sp.y) === cell.y) return { team, sp };
    }
  }
  return null;
}

function removeSpawnPoint(found) {
  const arr = mapSpawnPoints[found.team];
  const idx = arr.indexOf(found.sp);
  if (idx !== -1) arr.splice(idx, 1);
  game.spawnPool = buildSpawnPool(mapSpawnPoints, game.map);
  redrawSpawnPoints();
}

// ─── Marsballs ────────────────────────────────────────────────────────────
// Their own top-level array in the Fortunate Maps JSON (see the real
// example: "marsballs": [{x,y}]) - no color in COLOR_TO_ID, so unlike every
// other tile they're never part of game.map/the PNG at all. Stored as plain
// integer cell coordinates, matching that example.
function placeMarsball(x, y) {
  const grown = growMapIfNeeded(x, y);
  if (!grown) return;
  if (mapMarsballs.some(m => m.x === grown.x && m.y === grown.y)) return;
  mapMarsballs.push({ x: grown.x, y: grown.y });
  redrawSpawnPoints();
}

function findMarsballAt(cell) {
  return mapMarsballs.find(m => m.x === cell.x && m.y === cell.y) ?? null;
}

function removeMarsball(m) {
  const idx = mapMarsballs.indexOf(m);
  if (idx !== -1) mapMarsballs.splice(idx, 1);
  redrawSpawnPoints();
}

// renderer.js's cacheAllFrames() always crops a fixed 40x40 frame regardless
// of a tile's declared `size` (a pre-existing quirk - marsball's real art is
// 80x80), so renderer.sprites['marsball'] is a cropped-wrong 40x40. Built
// fresh here with the correct frame instead of reusing that texture.
let marsballTexture = null;
function getMarsballTexture() {
  if (marsballTexture) return marsballTexture;
  const source = renderer.spriteSheets['tiles'];
  if (!source) return null;
  marsballTexture = new PIXI.Texture({ source, frame: new PIXI.Rectangle(12 * 40, 9 * 40, 80, 80) });
  return marsballTexture;
}

// Spawn markers are literal (translucent) TagPro balls - the real
// redball/blueball sprites, not a drawn shape. radius/weight are edited
// via shift-click but stay purely data - no visual indicator for them.
// Marsballs share this same overlay layer/redraw pass.
function redrawSpawnPoints() {
  if (!spawnGraphicsLayer) return;
  spawnGraphicsLayer.removeChildren();
  for (const team of ['red', 'blue']) {
    const tex = renderer.sprites[team === 'red' ? 'redball' : 'blueball'];
    if (!tex) continue;
    for (const sp of mapSpawnPoints[team]) {
      const sprite = new PIXI.Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.alpha = 0.5;
      sprite.x = sp.x * 40;
      sprite.y = sp.y * 40;
      spawnGraphicsLayer.addChild(sprite);
    }
  }

  const marsTex = getMarsballTexture();
  if (marsTex) {
    for (const m of mapMarsballs) {
      const sprite = new PIXI.Sprite(marsTex);
      sprite.anchor.set(0.5);
      sprite.alpha = 0.6;
      sprite.x = (m.x + 0.5) * 40;
      sprite.y = (m.y + 0.5) * 40;
      spawnGraphicsLayer.addChild(sprite);
    }
  }
}

// ─── Link mode: portal-to-portal (1:1), button-to-gate (1:many) ─────────
function isPortalId(id) { return id === 13 || id === 13.1; }
function isGateId(id) { return id === 9 || id === 9.1 || id === 9.2 || id === 9.3; }

function toggleLinkMode() {
  linkMode = !linkMode;
  linkSource = null;
  document.getElementById('linkButton').classList.toggle('primary', linkMode);
  updateHint();
  updateLinkDoneButton();
  redrawLinkOverlay();
}

// Clears the in-progress source/selection without leaving link mode - lets
// you finish one button's gate list (or bail on a portal you started) and
// immediately start picking a new source, instead of having to toggle Link
// off and back on. Escape does the same thing.
function cancelLinkSelection() {
  if (!linkSource) return;
  linkSource = null;
  updateHint();
  updateLinkDoneButton();
  redrawLinkOverlay();
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && linkMode) cancelLinkSelection();
});

function updateLinkDoneButton() {
  const btn = document.getElementById('linkDoneButton');
  if (btn) btn.style.display = linkSource ? 'inline-block' : 'none';
}

function updateHint() {
  const hint = document.getElementById('hint');
  if (!linkMode) {
    hint.textContent = 'Arrow keys to move · Left/right click or drag: place/erase · Shift+click: edit properties · Scroll: zoom';
  } else if (!linkSource) {
    hint.textContent = 'Link mode: click a portal or button to start linking';
  } else if (linkSource.type === 'portal') {
    hint.textContent = 'Click the other portal to complete the link (Esc to cancel)';
  } else {
    hint.textContent = 'Click gate tiles to link/unlink them - click Done (or Esc) when finished';
  }
}

function handleLinkClick(cell) {
  const id = game.map[cell.y]?.[cell.x];

  if (!linkSource) {
    if (isPortalId(id)) linkSource = { type: 'portal', x: cell.x, y: cell.y };
    else if (id === 8)  linkSource = { type: 'button', x: cell.x, y: cell.y };
    updateHint();
    updateLinkDoneButton();
    redrawLinkOverlay();
    return;
  }

  if (linkSource.type === 'portal') {
    if (isPortalId(id) && (cell.x !== linkSource.x || cell.y !== linkSource.y)) {
      linkPortals(linkSource, cell);
      linkSource = null;
    }
  } else if (linkSource.type === 'button') {
    if (isGateId(id)) addSwitchGate(linkSource, cell);
  }

  updateHint();
  updateLinkDoneButton();
  redrawLinkOverlay();
}

function linkPortals(a, b) {
  const keyA = `${a.x},${a.y}`, keyB = `${b.x},${b.y}`;
  mapPortalLinks[keyA] = { ...mapPortalLinks[keyA], destination: { x: b.x + 0.5, y: b.y + 0.5 } };
  mapPortalLinks[keyB] = { ...mapPortalLinks[keyB], destination: { x: a.x + 0.5, y: a.y + 0.5 } };
  placeTile(a.x, a.y, 13);
  placeTile(b.x, b.y, 13);
  game.applyPortalData(mapPortalLinks);
}

// Click a gate to add it to the active button's list; click an
// already-linked gate again to remove it - the visual (green box) tracks
// this directly, so clicking is always "toggle this gate's membership."
function addSwitchGate(button, gateCell) {
  const key = `${button.x},${button.y}`;
  mapSwitches[key] = mapSwitches[key] ?? { timer: 0, toggle: [] };
  const idx = mapSwitches[key].toggle.findIndex(t => t.pos.x === gateCell.x && t.pos.y === gateCell.y);
  if (idx === -1) mapSwitches[key].toggle.push({ pos: { x: gateCell.x, y: gateCell.y } });
  else mapSwitches[key].toggle.splice(idx, 1);
  game.applySwitchData(mapSwitches);
}

// Ambient boxes are context-dependent: with no source picked yet, every
// portal/button is a valid thing to start from; once a source is picked,
// only *its* valid targets get boxes (other portals for a portal source,
// gates for a button source) plus the source itself in gold. A gate
// already in the active button's list draws green instead of blue, so
// clicking it is visibly "already linked," not just clickable. The
// hovered tile's box is drawn thicker/brighter on top of its base color.
// Every existing link (not just the hovered one) draws a faint connecting
// line continuously while in link mode, so the whole map's wiring is
// visible at a glance; the hovered tile's own links redraw brighter on top.
// Every {x,y} cell (plain cell coordinates, not the +0.5-offset world
// coords some of these are stored in - so every caller can just do
// `*40+20` uniformly for the pixel center) that x,y is linked to/from:
// a portal's partner, a button's gates, or - reverse lookup - the button a
// gate belongs to.
function getLinkedCells(x, y) {
  const key = `${x},${y}`;
  const cells = [];

  const portalLink = mapPortalLinks[key];
  if (portalLink?.destination) {
    cells.push({ x: Math.floor(portalLink.destination.x), y: Math.floor(portalLink.destination.y) });
  }

  const sw = mapSwitches[key];
  if (sw) {
    for (const t of sw.toggle) cells.push({ x: t.pos.x, y: t.pos.y });
  }

  for (const [bKey, swEntry] of Object.entries(mapSwitches)) {
    if (bKey === key) continue;
    if (swEntry.toggle.some(t => t.pos.x === x && t.pos.y === y)) {
      const [bx, by] = bKey.split(',').map(Number);
      cells.push({ x: bx, y: by });
    }
  }

  return cells;
}

function redrawLinkOverlay() {
  if (!linkGraphicsLayer) return;
  const g = linkGraphicsLayer;
  g.clear();

  if (!linkMode) {
    // Outside link mode: a lightweight "what's this linked to" on hover -
    // a box on the hovered tile, a line to each connection, and a box on
    // each of those too. No ambient boxes on every portal/button here -
    // that's link-mode-only, this is meant to stay unobtrusive otherwise.
    if (!hoveredLinkCell) return;
    const { x, y } = hoveredLinkCell;
    const connections = getLinkedCells(x, y);
    if (!connections.length) return;

    g.lineStyle(3, 0x5b8cff, 0.95);
    g.drawRect(x * 40 + 2, y * 40 + 2, 36, 36);

    g.lineStyle(2, 0x00e0a0, 0.85);
    for (const c of connections) {
      g.moveTo(x * 40 + 20, y * 40 + 20);
      g.lineTo(c.x * 40 + 20, c.y * 40 + 20);
      g.drawRect(c.x * 40 + 2, c.y * 40 + 2, 36, 36);
    }
    return;
  }

  const buttonKey = linkSource?.type === 'button' ? `${linkSource.x},${linkSource.y}` : null;
  const activeToggle = buttonKey ? (mapSwitches[buttonKey]?.toggle ?? []) : [];
  const isActiveGate = (x, y) => activeToggle.some(t => t.pos.x === x && t.pos.y === y);

  for (let y = 0; y < game.map.length; y++) {
    for (let x = 0; x < game.map[y].length; x++) {
      const id = game.map[y][x];
      const isSource = linkSource && linkSource.x === x && linkSource.y === y;

      let selectable = false;
      let color = 0x5b8cff;

      if (isSource) {
        selectable = true;
        color = 0xffcc00;
      } else if (linkSource?.type === 'portal') {
        selectable = isPortalId(id);
      } else if (linkSource?.type === 'button') {
        selectable = isGateId(id);
        if (selectable && isActiveGate(x, y)) color = 0x00e0a0;
      } else {
        selectable = isPortalId(id) || id === 8;
      }

      if (!selectable) continue;

      const isHovered = hoveredLinkCell && hoveredLinkCell.x === x && hoveredLinkCell.y === y;
      g.lineStyle(isHovered ? 4 : 2, color, isHovered ? 1 : 0.85);
      g.drawRect(x * 40 + 2, y * 40 + 2, 36, 36);
    }
  }

  g.lineStyle(2, 0x00e0a0, 0.45);
  for (const [key, entry] of Object.entries(mapPortalLinks)) {
    if (!entry?.destination) continue;
    const [px, py] = key.split(',').map(Number);
    g.moveTo(px * 40 + 20, py * 40 + 20);
    g.lineTo(entry.destination.x * 40, entry.destination.y * 40);
  }
  for (const [key, sw] of Object.entries(mapSwitches)) {
    const [bx, by] = key.split(',').map(Number);
    for (const t of sw.toggle) {
      g.moveTo(bx * 40 + 20, by * 40 + 20);
      g.lineTo(t.pos.x * 40 + 20, t.pos.y * 40 + 20);
    }
  }

  if (hoveredLinkCell) {
    const { x, y } = hoveredLinkCell;
    const cx = x * 40 + 20, cy = y * 40 + 20;
    g.lineStyle(3, 0xffffff, 0.9);
    for (const c of getLinkedCells(x, y)) {
      g.moveTo(cx, cy);
      g.lineTo(c.x * 40 + 20, c.y * 40 + 20);
    }
  }
}

// ─── Shift+click property editing (button timer, portal cooldown, spawn radius) ──
let propertyModalOnSave = null;

function openPropertyModal(title, labelText, value, onSave) {
  document.getElementById('propertyModalTitle').textContent = title;
  document.getElementById('propertyModalLabel').textContent = labelText;
  document.getElementById('propertyModalInput').value = value;
  propertyModalOnSave = onSave;
  openModal('propertyModal');
}

function openButtonSettingsModal(cell) {
  const key = `${cell.x},${cell.y}`;
  const current = mapSwitches[key]?.timer ?? 0;
  openPropertyModal('Button timer', 'Timer (ms)', current, value => {
    mapSwitches[key] = mapSwitches[key] ?? { timer: 0, toggle: [] };
    mapSwitches[key].timer = value;
    game.applySwitchData(mapSwitches);
  });
}

function openPortalSettingsModal(cell) {
  const key = `${cell.x},${cell.y}`;
  const current = mapPortalLinks[key]?.cooldown ?? 0;
  openPropertyModal('Portal cooldown', 'Cooldown (ms)', current, value => {
    mapPortalLinks[key] = mapPortalLinks[key] ?? {};
    mapPortalLinks[key].cooldown = value;
    game.applyPortalData(mapPortalLinks);
  });
}

function openSpawnSettingsModal(found) {
  openPropertyModal('Spawn point radius', 'Radius (tiles)', found.sp.radius, value => {
    found.sp.radius = Math.max(0, value);
    game.spawnPool = buildSpawnPool(mapSpawnPoints, game.map);
    redrawSpawnPoints();
  });
}

function handleShiftClick(cell) {
  const id = game.map[cell.y]?.[cell.x];

  if (id === 8) { openButtonSettingsModal(cell); return; }
  if (isPortalId(id)) { openPortalSettingsModal(cell); return; }

  const found = findSpawnPointAt(cell);
  if (found) openSpawnSettingsModal(found);
}

// ─── Mouse ─────────────────────────────────────────────────────────────────
function wireMouse() {
  const canvas = renderer.canvas;

  canvas.addEventListener('mousedown', e => {
    if (freeLook && e.button === 2) {
      panStart = { x: e.clientX, y: e.clientY, cx: cameraCenter.x, cy: cameraCenter.y };
      return;
    }

    const cell = screenToCell(e.clientX, e.clientY);

    if (e.shiftKey) { handleShiftClick(cell); return; }
    if (linkMode)   { handleLinkClick(cell); return; }

    if (e.button === 2) {
      const found = findSpawnPointAt(cell);
      if (found) { removeSpawnPoint(found); return; }
      const mars = findMarsballAt(cell);
      if (mars) { removeMarsball(mars); return; }
    }

    if (currentTileId === 'redSpawn' || currentTileId === 'blueSpawn') {
      if (e.button === 0) placeSpawnPoint(cell.x, cell.y, currentTileId === 'redSpawn' ? 'red' : 'blue');
      return;
    }

    if (currentTileId === 'marsball') {
      if (e.button === 0) placeMarsball(cell.x, cell.y);
      return;
    }

    if (e.button !== 0 && e.button !== 2) return;
    strokeTileId = e.button === 0 ? currentTileId : 0;
    painting = true;

    if (currentTool === 'brush') {
      lastPaintedCell = `${cell.x},${cell.y}`;
      commitShapeCells(brushCells(cell.x, cell.y, brushSize), strokeTileId);
    } else {
      dragStart = cell;
      ghostCells = computeShapeCells(cell, cell);
      drawGhost(ghostCells);
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (panStart) {
      const dx = (e.clientX - panStart.x) / (40 * camera.zoom);
      const dy = (e.clientY - panStart.y) / (40 * camera.zoom);
      cameraCenter.x = panStart.cx - dx;
      cameraCenter.y = panStart.cy - dy;
      return;
    }

    const cell = screenToCell(e.clientX, e.clientY);

    // Tracked (and the link overlay redrawn) regardless of link mode - a
    // hover outside link mode still shows a linked tile's connections, see
    // redrawLinkOverlay()'s own !linkMode branch.
    hoveredLinkCell = cell;
    redrawLinkOverlay();
    if (linkMode) return;

    if (!painting) {
      // Hover indicator: what the current tool would place here right now -
      // the brush's full NxN footprint, or a single cell for spawn/marsball
      // markers and for rect/circle/line before you've started dragging one.
      drawGhost(currentTool === 'brush' ? brushCells(cell.x, cell.y, brushSize) : [cell]);
      return;
    }

    if (currentTool === 'brush') {
      const key = `${cell.x},${cell.y}`;
      if (key === lastPaintedCell) return;
      lastPaintedCell = key;
      commitShapeCells(brushCells(cell.x, cell.y, brushSize), strokeTileId);
    } else if (dragStart) {
      ghostCells = computeShapeCells(dragStart, cell);
      drawGhost(ghostCells);
    }
  });

  window.addEventListener('mouseup', () => {
    panStart = null;
    if (painting && currentTool !== 'brush' && dragStart) {
      commitShapeCells(ghostCells, strokeTileId);
      clearGhost();
    }
    painting = false;
    dragStart = null;
    ghostCells = [];
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mouseleave', () => {
    if (!painting) clearGhost();
    hoveredLinkCell = null;
    redrawLinkOverlay();
  });
}

// ─── Palette thumbnails ───────────────────────────────────────────────────
// Real crops from the loaded spritesheets rather than text-only buttons.
// Non-wall tiles are a direct 40x40 frame lookup (same frame cacheAllFrames
// uses); tiles with hasBackground get the floor tile composited underneath,
// matching what drawTile() actually draws on the map.
//
// Wall tiles (id 1, 1.1-1.4) have no frame of their own - renderer.js only
// ever draws them through drawWallTile()'s neighbor-dependent autotiling.
// wallThumbnailCanvas() below ports that same quadrant-selection math
// (unchanged from renderer.js) against a synthetic 3x3 neighborhood - the
// target id in the center, plain wall (id 1) on all 8 sides - to get an
// accurate "how this looks against solid wall" icon without touching the
// live map or renderer.

function tileThumbnailCanvas(sd) {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');

  if (WALL_IDS.has(sd.id)) {
    drawWallThumbnail(ctx, sd.id);
    return canvas;
  }

  if (sd.hasBackground) {
    const floorImg = renderer.spriteSheets['tiles']?.resource;
    if (floorImg) ctx.drawImage(floorImg, 13 * 40, 4 * 40, 40, 40, 0, 0, 40, 40);
  }

  const img = renderer.spriteSheets[sd.image]?.resource;
  if (img && sd.x !== null && sd.y !== null) {
    ctx.drawImage(img, sd.x * 40, sd.y * 40, 40, 40, 0, 0, 40, 40);
  }

  return canvas;
}

function drawWallThumbnail(ctx, id) {
  const tilesImg = renderer.spriteSheets['tiles']?.resource;
  if (!tilesImg) return;

  // Neighbors are floor (0), not solid wall: a tile fully enclosed by more
  // wall has no exposed edge, so its art is just the plain interior fill -
  // flat and undetailed as an icon. Showing it as an isolated block instead
  // (floor on every side) picks the fully-bordered variant of the art,
  // which actually reads as the tile it represents.
  const centerSolid = WALL_SOLIDS[String(id)] ?? 0;
  const solidsAt = (col, row) => (col === 1 && row === 1) ? centerSolid : 0;

  const HALF = 20;
  const solids = solidsAt(1, 1);

  for (let q = 0; q < 4; q++) {
    const mask = (solids >> (q << 1)) & 3;
    if (!mask) continue;

    const cx = 1 + ((q & 2) === 0 ? 1 : 0);
    const cy = 1 + (((q + 1) & 2) === 0 ? 0 : 1);

    let around =
      (solidsAt(cx,     cy)     & 0xc0) |
      (solidsAt(cx - 1, cy)     & 0x03) |
      (solidsAt(cx - 1, cy - 1) & 0x0c) |
      (solidsAt(cx,     cy - 1) & 0x30);
    around |= (around << 8);

    const start = q * 2 + 1;
    let cw = 0; while (cw < 8 && (around & (1 << (start + cw))))     cw++;
    let cc = 0; while (cc < 8 && (around & (1 << (start + 7 - cc)))) cc++;

    const hasChip    = mask === 3 && (((solids | (solids << 8)) >> ((q + 2) << 1)) & 3) === 0;
    const solidEnd   = cw === 8 ? 0 : (start + cw + 4) % 8;
    const solidStart = cw === 8 ? 0 : (start - cc + 12) % 8;

    const key = `${q}${solidStart}${solidEnd}${hasChip ? 'd' : ''}`;
    const coord = quadrantCoords[key] ?? quadrantCoords['000'];
    if (!coord) continue;

    let dx = (q === 0 || q === 1) ? HALF : 0;
    let dy = (q === 1 || q === 2) ? HALF : 0;

    // Position is in full-grid-cell units (matches renderer.js's cacheAllFrames:
    // `col * GRID_SIZE`); only the crop size is a half-cell.
    ctx.drawImage(tilesImg, coord[0] * 40, coord[1] * 40, HALF, HALF, dx, dy, HALF, HALF);
  }
}

function eraserThumbnailCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 40, 40);
  return canvas;
}

function marsballThumbnailCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  const img = renderer.spriteSheets['tiles']?.resource;
  if (img) {
    ctx.globalAlpha = 0.8;
    ctx.drawImage(img, 12 * 40, 9 * 40, 80, 80, 0, 0, 40, 40);
    ctx.globalAlpha = 1;
  }
  return canvas;
}

function spawnThumbnailCanvas(team) {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  const img = renderer.spriteSheets['tiles']?.resource;
  if (img) {
    ctx.globalAlpha = 0.6;
    ctx.drawImage(img, team === 'red' ? 14 * 40 : 15 * 40, 0, 40, 40, 0, 0, 40, 40);
    ctx.globalAlpha = 1;
  }
  return canvas;
}

// ─── Palette ────────────────────────────────────────────────────────────
function buildPalette() {
  const el = document.getElementById('palette');
  el.textContent = '';

  const eraser = document.createElement('button');
  eraser.className = 'paletteBtn';
  eraser.title = 'Eraser';
  eraser.appendChild(eraserThumbnailCanvas());
  eraser.addEventListener('click', () => selectTile(0, eraser));
  el.appendChild(eraser);

  const redSpawn = document.createElement('button');
  redSpawn.className = 'paletteBtn';
  redSpawn.title = 'Red spawn point';
  redSpawn.appendChild(spawnThumbnailCanvas('red'));
  redSpawn.addEventListener('click', () => selectTile('redSpawn', redSpawn));
  el.appendChild(redSpawn);

  const blueSpawn = document.createElement('button');
  blueSpawn.className = 'paletteBtn';
  blueSpawn.title = 'Blue spawn point';
  blueSpawn.appendChild(spawnThumbnailCanvas('blue'));
  blueSpawn.addEventListener('click', () => selectTile('blueSpawn', blueSpawn));
  el.appendChild(blueSpawn);

  const marsball = document.createElement('button');
  marsball.className = 'paletteBtn';
  marsball.title = 'Marsball';
  marsball.appendChild(marsballThumbnailCanvas());
  marsball.addEventListener('click', () => selectTile('marsball', marsball));
  el.appendChild(marsball);

  for (const sd of PALETTE_TILES) {
    const btn = document.createElement('button');
    btn.className = 'paletteBtn';
    btn.title = sd.name;
    btn.appendChild(tileThumbnailCanvas(sd));
    btn.addEventListener('click', () => selectTile(sd.id, btn));
    el.appendChild(btn);
  }

  el.children[4]?.classList.add('selected'); // default: first real tile (wall) - after eraser/redSpawn/blueSpawn/marsball
}

function selectTile(id, btn) {
  currentTileId = id;
  if (linkMode) toggleLinkMode();
  for (const child of document.getElementById('palette').children) {
    child.classList.remove('selected');
  }
  btn.classList.add('selected');
}

// ─── Toolbar (brush size / rect / circle, filled toggle) ─────────────────
function buildToolbar() {
  const el = document.getElementById('toolbar');
  el.textContent = '';

  const tools = [
    { id: 'brush',  label: 'Brush' },
    { id: 'line',   label: 'Line' },
    { id: 'rect',   label: 'Rect' },
    { id: 'circle', label: 'Circle' },
  ];

  const toolButtons = document.createElement('div');
  toolButtons.className = 'toolRow';
  for (const t of tools) {
    const btn = document.createElement('button');
    btn.className = 'toolBtn' + (t.id === currentTool ? ' selected' : '');
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      currentTool = t.id;
      for (const c of toolButtons.querySelectorAll('.toolBtn')) c.classList.remove('selected');
      btn.classList.add('selected');
      updateToolOptions();
    });
    toolButtons.appendChild(btn);
  }
  el.appendChild(toolButtons);

  const optionsRow = document.createElement('div');
  optionsRow.className = 'toolRow';

  const filledLabel = document.createElement('label');
  filledLabel.className = 'toolOption';
  filledLabel.id = 'filledOption';
  const filledCheckbox = document.createElement('input');
  filledCheckbox.type = 'checkbox';
  filledCheckbox.checked = shapeFilled;
  filledCheckbox.addEventListener('change', () => { shapeFilled = filledCheckbox.checked; });
  filledLabel.appendChild(filledCheckbox);
  filledLabel.appendChild(document.createTextNode('Filled'));
  optionsRow.appendChild(filledLabel);

  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'toolOption';
  sizeWrap.id = 'brushSizeOption';
  const minus = document.createElement('button');
  minus.className = 'toolBtn';
  minus.textContent = '-';
  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = brushSize;
  const plus = document.createElement('button');
  plus.className = 'toolBtn';
  plus.textContent = '+';
  minus.addEventListener('click', () => { brushSize = Math.max(1, brushSize - 1); sizeLabel.textContent = brushSize; });
  plus.addEventListener('click', () => { brushSize = Math.min(9, brushSize + 1); sizeLabel.textContent = brushSize; });
  sizeWrap.appendChild(minus);
  sizeWrap.appendChild(sizeLabel);
  sizeWrap.appendChild(plus);
  optionsRow.appendChild(sizeWrap);

  el.appendChild(optionsRow);

  function updateToolOptions() {
    filledLabel.style.display = (currentTool === 'rect' || currentTool === 'circle') ? 'flex' : 'none';
    sizeWrap.style.display = currentTool === 'brush' ? 'flex' : 'none';
  }
  updateToolOptions();
}

// ─── Export / import - Fortunate Maps format (PNG + JSON) ────────────────
// The PNG *is* the tile grid (one pixel per cell, color -> tile id via
// COLOR_TO_ID from mapLoader.js); the JSON only carries the extra metadata
// mapLoader.js's loadMap() already knows how to read (fields/portals/
// switches/spawnPoints) - there's no "map" array in it, matching the real
// Fortunate Maps format exactly so exported maps round-trip through
// loadMap()/bootFromMapId() unchanged.

const ID_TO_COLOR = {};
for (const [hex, id] of Object.entries(COLOR_TO_ID)) {
  if (!(id in ID_TO_COLOR)) ID_TO_COLOR[id] = hex;
}

function colorForTile(id) {
  if (!id) return null;
  // Gate/portal state variants all share their base id's color - the state
  // itself is carried in the JSON (fields/portals), not the PNG.
  if (id === 9.1 || id === 9.2 || id === 9.3) return ID_TO_COLOR[9];
  if (id === 13.1) return ID_TO_COLOR[13];
  if (id === 24.1) return ID_TO_COLOR[24];
  if (id === 25.1) return ID_TO_COLOR[25];
  return ID_TO_COLOR[id] ?? null;
}

function gateFieldFor(id) {
  if (id === 9.1) return 'on';
  if (id === 9.2) return 'red';
  if (id === 9.3) return 'blue';
  return null;
}

function buildMapPng() {
  const h = game.map.length, w = game.map[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const hex = colorForTile(game.map[y][x]);
      if (!hex) continue; // alpha stays 0 - createImageData zero-fills
      imageData.data[i]     = parseInt(hex.slice(0, 2), 16);
      imageData.data[i + 1] = parseInt(hex.slice(2, 4), 16);
      imageData.data[i + 2] = parseInt(hex.slice(4, 6), 16);
      imageData.data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function buildMapJson() {
  const fields = {};
  for (let y = 0; y < game.map.length; y++) {
    for (let x = 0; x < game.map[y].length; x++) {
      const state = gateFieldFor(game.map[y][x]);
      if (state) fields[`${x},${y}`] = { defaultState: state };
    }
  }
  return {
    info: {
      name: mapMeta.name || 'Untitled',
      author: mapMeta.author || 'Anonymous',
      gameMode: mapMeta.gameMode || 'normal',
    },
    fields,
    portals: mapPortalLinks,
    switches: mapSwitches,
    marsballs: mapMarsballs,
    spawnPoints: mapSpawnPoints,
  };
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportMapPng() {
  buildMapPng().toBlob(blob => downloadBlob(blob, 'map.png'), 'image/png');
}

function exportMapJson() {
  const blob = new Blob([JSON.stringify(buildMapJson(), null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'map.json');
}

async function importFortunateMap(pngFile, jsonFile) {
  const img = new Image();
  const objectUrl = URL.createObjectURL(pngFile);
  img.src = objectUrl;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

  let json = {};
  if (jsonFile) {
    try { json = JSON.parse(await jsonFile.text()); } catch {}
  }

  const cvs = document.createElement('canvas');
  cvs.width = img.naturalWidth;
  cvs.height = img.naturalHeight;
  cvs.getContext('2d').drawImage(img, 0, 0);
  const { data } = cvs.getContext('2d').getImageData(0, 0, cvs.width, cvs.height);
  URL.revokeObjectURL(objectUrl);

  const { map, wallMap, dataMap, spawnPool, portals, switches, spawnPoints, info, marsballs } =
    decodeMapPixels(data, cvs.width, cvs.height, json);

  document.getElementById('startScreen').style.display = 'none';
  game = new Game(gameConfig);
  game.map       = map;
  game.wallMap   = wallMap;
  game.dataMap   = dataMap;
  game.spawnPool = spawnPool;
  game.createMap();
  game.applyPortalData(portals);
  game.applySwitchData(switches);
  game.spawnPlayer(0, 'red');

  mapPortalLinks = portals ?? {};
  mapSwitches    = switches ?? {};
  mapSpawnPoints = { red: spawnPoints?.red ?? [], blue: spawnPoints?.blue ?? [] };
  mapMeta        = { name: json.name ?? '', author: json.author ?? '' };

  if (renderer) renderer.destroy();
  await bootRenderer();
}

function openModal(id) { document.getElementById(id).style.display = 'block'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

document.getElementById('exportOpenButton').addEventListener('click', () => openModal('exportModal'));
document.getElementById('exportModalClose').addEventListener('click', () => closeModal('exportModal'));
document.getElementById('downloadPngButton').addEventListener('click', exportMapPng);
document.getElementById('downloadJsonButton').addEventListener('click', exportMapJson);

function wireImportModal(openButtonId) {
  document.getElementById(openButtonId).addEventListener('click', () => openModal('importModal'));
}
wireImportModal('importOpenButton');
wireImportModal('startImportButton');
document.getElementById('importModalClose').addEventListener('click', () => closeModal('importModal'));
document.getElementById('importLoadButton').addEventListener('click', () => {
  const pngFile  = document.getElementById('importPngInput').files[0];
  const jsonFile = document.getElementById('importJsonInput').files[0];
  if (!pngFile) return;
  closeModal('importModal');
  importFortunateMap(pngFile, jsonFile);
});

document.getElementById('blankButton').addEventListener('click', bootBlank);
document.getElementById('loadMapButton').addEventListener('click', () => {
  const mapId = Number(document.getElementById('mapIdInput').value);
  bootFromMapId(mapId);
});

document.getElementById('textureButton').addEventListener('click', () => {
  const modal = document.getElementById('textureModal');
  modal.style.display = 'block';
  mountTexturePackPicker(document.getElementById('textureModalBody'), () => location.reload());
});
document.getElementById('textureModalClose').addEventListener('click', () => {
  document.getElementById('textureModal').style.display = 'none';
});

document.getElementById('leaveJoinButton').addEventListener('click', toggleFreeLook);
document.getElementById('switchTeamButton').addEventListener('click', switchTeam);

document.getElementById('linkButton').addEventListener('click', toggleLinkMode);
document.getElementById('linkDoneButton').addEventListener('click', cancelLinkSelection);

document.getElementById('propertyModalSave').addEventListener('click', () => {
  const value = Number(document.getElementById('propertyModalInput').value);
  if (propertyModalOnSave) propertyModalOnSave(value);
  closeModal('propertyModal');
});
document.getElementById('propertyModalClose').addEventListener('click', () => closeModal('propertyModal'));

// ─── Settings modal (match/physics settings - gameConfig.js values) ──────
// scale converts the raw stored value to what's actually shown/edited:
// display = raw / scale, raw = display * scale. Mirrors BamBall's
// settingsSchema.js convention - 1000 shows a stored ms value as seconds,
// 1/60 shows a stored per-tick (60Hz) velocity delta as its true per-second
// rate. accel/gravityWellStrength are hand-added directly onto velocity
// once per step with no dt multiplication of their own (game.js's
// moveBalls/applyGravityWells), so they need that conversion to show their
// real per-second rate. gravityY does NOT - it's handed straight to
// Box2D's own b2World gravity, which already integrates it by dt every
// Step() internally (standard Box2D semantics), so the stored value is
// already a true tiles/s² acceleration - the same unit Box2D itself uses.
// Fields with no scale (maxSpeed, jumpStrength, radii, explosion
// strengths) are already continuous values too (a velocity or a one-off
// impulse), not per-tick deltas.
const SETTINGS_FIELDS = [
  { key: 'maxSpeed',            label: 'Max speed',        unit: 'tiles/s' },
  { key: 'accel',               label: 'Acceleration',     unit: 'tiles/s²', scale: 1 / 60 },
  { key: 'gravityY',            label: 'Gravity',          unit: 'tiles/s²' },
  { key: 'jumpStrength',        label: 'Jump strength',    unit: 'tiles/s' },
  { key: 'jumpCharges',         label: 'Jump charges',     unit: '' },
  { key: 'friction',            label: 'Ball friction',    unit: '' },
  { key: 'restitution',         label: 'Ball bounciness',  unit: '' },
  { key: 'wallFriction',        label: 'Wall friction',    unit: '' },
  { key: 'wallRestitution',     label: 'Wall bounciness',  unit: '' },
  { key: 'boostMultiplier',     label: 'Boost multiplier', unit: '×' },
  { key: 'bombRadius',          label: 'Bomb radius',      unit: 'tiles' },
  { key: 'bombStrength',        label: 'Bomb strength',    unit: 'tiles/s' },
  { key: 'gravityWellStrength', label: 'Well strength',    unit: 'tiles/s²', scale: 1 / 60 },
  { key: 'gravityWellRadius',   label: 'Well radius',      unit: 'tiles' },
  { key: 'boostCooldown',       label: 'Boost cooldown',   unit: 's', scale: 1000 },
  { key: 'bombCooldown',        label: 'Bomb cooldown',    unit: 's', scale: 1000 },
  { key: 'powerupRespawn',      label: 'Powerup respawn',  unit: 's', scale: 1000 },
  { key: 'tagproTimer',         label: 'Tagpro timer',     unit: 's', scale: 1000 },
];

// Exactly two presets: CTF (normal play, the default - see gameConfig.js)
// and Gravity. Both are built from DEFAULT_GAME_CONFIG (gameConfig.js's own
// untouched defaults) rather than patching whatever gameConfig currently
// holds, so each is a full, deterministic reset - not gravityY toggled on
// top of whatever friction/accel/etc. a manual Settings edit left behind.
//
// Gravity preset values start from real TagPro's own gravity-mode event
// handler:
//   tagpro.events.register({
//     gravity: {x: 0, y: 9.8 / 2},
//     setPlayerPhysics: (box2d, bodyDef, fixDef) => { fixDef.friction = 0; fixDef.restitution = 0.3; },
//     setWallPhysics:   (box2d, bodyDef, fixDef) => { fixDef.friction = 0; fixDef.restitution = 0.3; },
//   });
// restitution/wallRestitution are overridden to 0 here (not real TagPro's
// 0.3) so balls don't bounce off the ground/walls in gravity mode.
// gravityY is TPU-scaled like every other tile-unit value in gameConfig.js.
// jumpStrength isn't touched here - it's a gameConfig.js default already
// fit to the real measured ~4.2 tile peak, not something this preset needs
// to redo.
const GRAVITY_PRESET = {
  ...DEFAULT_GAME_CONFIG,
  gravityY: (9.8 / 2) * TPU,
  friction: 0,
  restitution: 0,
  wallFriction: 0,
  wallRestitution: 0,
  jumpCharges: 2,
};
const CTF_PRESET = {
  ...DEFAULT_GAME_CONFIG,
};

// b2World's gravity and every fixture's friction/restitution are captured
// once at creation time - they do NOT hold a live reference to gameConfig,
// so mutating gameConfig alone does nothing to bodies that already exist.
// Both the preset buttons and the Settings modal's Save button need to push
// changes onto everything already spawned/placed, not just future spawns.
function pushLivePhysicsToWorld() {
  game.world.SetGravity(new Box2D.Common.Math.b2Vec2(gameConfig.gravityX, gameConfig.gravityY));

  for (const p of game.players) {
    p.jumpsRemaining = gameConfig.jumpCharges;
    for (let f = p.body.GetFixtureList(); f; f = f.GetNext()) {
      f.SetFriction(gameConfig.friction);
      f.SetRestitution(gameConfig.restitution);
    }
  }

  for (const row of game.dataMap) {
    for (const entry of row) {
      if (!entry?.body) continue;
      for (let f = entry.body.GetFixtureList(); f; f = f.GetNext()) {
        f.SetFriction(gameConfig.wallFriction);
        f.SetRestitution(gameConfig.wallRestitution);
      }
    }
  }
}

function applyPhysicsPreset(preset) {
  Object.assign(gameConfig, preset);
  pushLivePhysicsToWorld();
  openSettingsModal(); // rebuild the table so it reflects the new values
}

function openSettingsModal() {
  const body = document.getElementById('settingsModalBody');
  body.textContent = '';

  const table = document.createElement('table');
  table.className = 'settingsTable';
  for (const field of SETTINGS_FIELDS) {
    const scale = field.scale ?? 1;
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = field.label;
    row.appendChild(labelCell);

    const inputCell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.id = `settingsInput_${field.key}`;
    input.value = gameConfig[field.key] / scale;
    inputCell.appendChild(input);
    row.appendChild(inputCell);

    const unitCell = document.createElement('td');
    unitCell.className = 'settingsUnit';
    unitCell.textContent = field.unit;
    row.appendChild(unitCell);

    table.appendChild(row);
  }
  body.appendChild(table);

  openModal('settingsModal');
}

document.getElementById('settingsModalSave').addEventListener('click', () => {
  for (const field of SETTINGS_FIELDS) {
    const scale = field.scale ?? 1;
    const value = Number(document.getElementById(`settingsInput_${field.key}`).value);
    if (!Number.isNaN(value)) gameConfig[field.key] = value * scale;
  }
  pushLivePhysicsToWorld();
  // maxSpeed/accel are copied onto each player at spawn time (game.js
  // spawnPlayer), not read live from gameConfig - push them onto whoever's
  // already spawned so the change is felt immediately, not just next spawn.
  for (const p of game.players) {
    p.maxSpeed = gameConfig.maxSpeed;
    p.accel = gameConfig.accel;
  }
  closeModal('settingsModal');
});
document.getElementById('settingsModalClose').addEventListener('click', () => closeModal('settingsModal'));
document.getElementById('settingsButton').addEventListener('click', openSettingsModal);
document.getElementById('gravityPresetButton').addEventListener('click', () => applyPhysicsPreset(GRAVITY_PRESET));
document.getElementById('ctfPresetButton').addEventListener('click', () => applyPhysicsPreset(CTF_PRESET));

// ─── Metadata modal ───────────────────────────────────────────────────────
function openMetadataModal() {
  document.getElementById('metadataNameInput').value = mapMeta.name;
  document.getElementById('metadataAuthorInput').value = mapMeta.author;
  openModal('metadataModal');
}
document.getElementById('metadataModalSave').addEventListener('click', () => {
  mapMeta.name = document.getElementById('metadataNameInput').value;
  mapMeta.author = document.getElementById('metadataAuthorInput').value;
  closeModal('metadataModal');
});
document.getElementById('metadataModalClose').addEventListener('click', () => closeModal('metadataModal'));
document.getElementById('metadataButton').addEventListener('click', openMetadataModal);

// ─── Feedback (client-only - posts straight to a Discord webhook) ────────
// No server: Discord's webhook endpoint accepts a plain browser fetch()
// directly. The tradeoff is that this URL is visible to anyone who views
// the page source or this repo - if it ever gets spammed, regenerate it in
// Discord (channel Settings -> Integrations -> Webhooks), which invalidates
// this one instantly.
const FEEDBACK_WEBHOOK_URL = 'https://discord.com/api/webhooks/1540261820911190097/T_6UxS4Bu5fMr-04u-_Sk3FbVblvtRcpvx0Nn7Ec6OUlXW-2qLSjR9hMasho2YgMpzVi';

document.getElementById('feedbackButton').addEventListener('click', () => {
  document.getElementById('feedbackInput').value = '';
  openModal('feedbackModal');
});
document.getElementById('feedbackModalClose').addEventListener('click', () => closeModal('feedbackModal'));

document.getElementById('feedbackSubmitButton').addEventListener('click', async () => {
  const text = document.getElementById('feedbackInput').value.trim();
  if (!text) return;

  const btn = document.getElementById('feedbackSubmitButton');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await fetch(FEEDBACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Map Editor Feedback', content: text.slice(0, 2000) }),
    });
    closeModal('feedbackModal');
  } catch (err) {
    alert('Failed to send feedback - check your connection and try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit';
  }
});
