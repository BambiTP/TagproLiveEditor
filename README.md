# tagpro-map-editor

Phase 1 of a TagPro map editor: a bare-bones, offline, single-player sandbox
ported from [BamBall](https://github.com/BambiTP/BamBall)'s engine. No
networking, no login, no lobby/chat/scoreboard - just a ball, real Box2D
physics, and working tiles.

- WASD / arrow keys to move (real Box2D physics, ported unmodified from
  BamBall's engine)
- Drive over a boost pad or bomb pad and it works like TagPro's
- Red and blue teams both exist and spawn on the map (you control red; blue
  stands at its spawn as a stub teammate)
- Scroll wheel or the zoom keys to zoom the camera in/out
- Esc opens Settings: rebindable keys and a particles toggle

Phase 2 (not built yet): tile-placement editing and map save/open.

## Running it

No build step - it's static files. Any static server works:

```
npm start
```

or just open `index.html` through any local web server (it fetches JSON/PNG
assets, so it won't work from a bare `file://` URL).

## What's here

- `engine/` - BamBall's authoritative game engine (Box2D physics, map
  format, tile logic, match state machine), ported unmodified. It has zero
  network dependency of its own - the network layer in BamBall was a thin
  packet wire on top of this, not something this code needs to run.
- `shared/` - vendored Box2D (Box2dWeb) and the physics helpers engine/ and
  the client render layer both use.
- `client/render/` - the PixiJS rendering layer (map tiles, wall
  auto-tiling, player balls, particles), ported from BamBall with flair and
  player name-tag rendering removed.
- `client/main.js` - boots the sandbox: creates one `GameInstance`, spawns a
  red (controllable) and blue (stub) player, and wires keyboard input and
  the camera straight to it. This replaces BamBall's whole network/packet
  layer, which doesn't exist here - everything runs in one process.
- `client/settingsMenu.js` - the Esc menu (Settings only: keybinds,
  particles).
- `assets/` - one default map and one default texture pack.
