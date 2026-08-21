// main.js - boots the sandbox and replaces BamBall's whole network layer
// (client/net.js, client/entityReconciler.js, local/hostSession.js,
// engine/packetBuilders.js) with nothing: engine/gameInstance.js already
// runs a complete, self-contained authoritative simulation with no network
// dependency of its own - that split only existed so a packet wire could
// sit between "the game" and "the client" for multiplayer. Running in one
// tab with no peers, the render layer can just point straight at
// gi.gameState and call renderer methods directly in response to engine
// events, instead of serializing state into packets and parsing them back.
//
// mode: 'editor' (see engine/gameState.js) - no match timer/score/mercy
// rule, just a map to move around on. That also happens to be exactly the
// free-camera-zoom behavior render/camera.js already gives an editor room
// (see zoomIsFree in the ported client/inputs.js pattern below), so this
// sandbox gets "zoom out" for free instead of needing a settings gate.

var MAP_URL = 'assets/maps/default.json';

var gi = null;
var renderer = null;
var controlledId = 1; // the player you drive - id 2 (blue) just stands at spawn

// ---- game: the render layer's read model -----------------------------------
//
// client/render/renderer.js and client/render/camera.js were written
// against a `game` object shaped exactly like engine/gameState.js already
// is (players/map/dataMap/wells) - see BamBall's client/state.js, which
// used to rebuild that shape field-by-field from network packets. Since
// gi.gameState already IS that shape in this single-process sandbox, `game`
// just points at it directly, plus a few UI-only fields the render layer
// also reads that gameState has no reason to own.
var game = null;

function getPlayer(id) {
  return game.players.find(function (p) { return p.id === id; }) || null;
}

// renderer.js's createMap/redrawTiles ask "is this a wall tile" through
// tileCatalog.isWallTile - in BamBall that's derived from a server-sent
// settings packet (client/state.js's tileCatalog), but engine/tiles/
// mapFormat.js's own WALL_IDS is that exact same fact at the source, so
// there's no packet to reconstruct it from here.
var tileCatalog = {
  isWallTile: function (id) { return MapFormat.isWallId(id); },
};

// ---- boot --------------------------------------------------------------

async function boot() {
  var canvas = document.getElementById('viewport');
  renderer = new Renderer(canvas);
  await renderer.init();

  var mapRes = await fetch(MAP_URL);
  var mapDoc = await mapRes.json();

  gi = new GameInstance(gameConfig, 'editor');
  gi.loadMap(mapDoc);
  game = gi.gameState;
  game.myId = controlledId;
  game.roomKind = 'editor';
  game.spectateFollowId = null;
  game.spectateCameraReady = false;
  game.selectedPlayerIds = [];

  gi.gameHelpers.spawnPlayer(1, 'red', 'Player', false, null);
  gi.gameHelpers.spawnPlayer(2, 'blue', 'CPU', false, null);

  // Boost pads flipping to their "used" id and back, bomb pads going empty
  // and respawning, powerup pads cycling - every tile-state change the
  // engine makes goes through gameInstance.setTile, which emits exactly
  // this one event regardless of cause. changeTile is the same call
  // BamBall's packetApplier makes on a 'setTile' packet; here it's wired
  // straight to the source instead of round-tripping through one.
  gi.emitter.on('setTile', function (x, y, id) {
    renderer.changeTile(x, y, id);
  });

  var manifestRes = await fetch('assets/sprites/default.json');
  var manifest = await manifestRes.json();
  await renderer.fetchTextures({
    packed: 'assets/sprites/default.png',
    walls:  'assets/sprites/walls/classic.png',
  });
  renderer.applyManifest(manifest);

  renderer.drawPlayer(1);
  renderer.drawPlayer(2);

  renderer.start();
  gi.start();

  initInput();
  initSettingsMenu();
  requestAnimationFrame(frameLoop);
}

// ---- per-frame: camera follow only ------------------------------------
//
// Physics itself runs on gi's own fixed-60Hz loop (engine/gameInstance.js
// start()); this rAF loop only has to keep the camera glued to the
// controlled player every displayed frame; the sprite ticker keeps up
// on its own (client/render/renderer.js's app.ticker).

function frameLoop() {
  cameraController.update();
  requestAnimationFrame(frameLoop);
}

// ---- input: keyboard + wheel -------------------------------------------

var keyMap = {}; // event.key -> 'up'|'down'|'left'|'right', rebuilt from localSettings.keys

function rebuildKeyLookup() {
  keyMap = {};
  ['up', 'down', 'left', 'right'].forEach(function (direction) {
    localSettings.keys[direction].forEach(function (key) {
      keyMap[key] = direction;
      if (key.length === 1) {
        keyMap[key.toLowerCase()] = direction;
        keyMap[key.toUpperCase()] = direction;
      }
    });
  });
}

function isActionKey(eventKey, action) {
  var bindings = localSettings.keys[action];
  for (var i = 0; i < bindings.length; i++) {
    if (eventKey === bindings[i]) return true;
    if (bindings[i].length === 1 && eventKey.length === 1 &&
        eventKey.toLowerCase() === bindings[i].toLowerCase()) return true;
  }
  return false;
}

function initInput() {
  rebuildKeyLookup();
  localSettingsEvents.on('localSettings:changed', rebuildKeyLookup);

  window.addEventListener('keydown', function (event) {
    if (listeningFor) return; // settingsMenu.js is capturing this key for a rebind

    if (isActionKey(event.key, 'menu')) {
      toggleMenu();
      return;
    }

    if (isActionKey(event.key, 'zoomIn') || isActionKey(event.key, 'zoomOut')) {
      event.preventDefault();
      renderer.zoomCamera(isActionKey(event.key, 'zoomIn') ? 1.1 : 1 / 1.1);
      return;
    }

    if (isActionKey(event.key, 'detonate')) {
      event.preventDefault();
      var me = getPlayer(controlledId);
      if (me && me.rollingBomb) gi.gameHelpers.detonateRollingBomb(me);
      return;
    }

    var direction = keyMap[event.key];
    if (!direction) return;
    event.preventDefault();
    var player = getPlayer(controlledId);
    if (player) player[direction] = true;
  });

  window.addEventListener('keyup', function (event) {
    var direction = keyMap[event.key];
    if (!direction) return;
    var player = getPlayer(controlledId);
    if (player) player[direction] = false;
  });

  var canvas = renderer.app.canvas;
  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    renderer.zoomCamera(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
}

document.addEventListener('DOMContentLoaded', function () {
  boot().catch(function (err) {
    console.error('[main] boot failed:', err);
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.textContent = 'Failed to load - check the console (F12) for details.';
  });
});
