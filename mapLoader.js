const CORS_PROXY = 'https://cors.bambitp.workers.dev/?url=';
const COLOR_TO_ID = {
  '787878': 1,     // Wall
  '408050': 1.2,   // 45TL
  '405080': 1.3,   // 45TR
  '807040': 1.1,   // 45BL
  '804070': 1.4,   // 45BR
  'd4d4d4': 2,     // Floor
  '808000': 16,    // YellowFlag
  'ff0000': 3,     // RedFlag
  '0000ff': 4,     // BlueFlag
  '373737': 7,     // Spike
  '202020': 22,    // GravityWell
  '656500': 21,    // YellowPotato
  'ff8080': 19,    // RedPotato
  '8080ff': 20,    // BluePotato
  'b90000': 17,    // RedGoal
  '190094': 18,    // BlueGoal
  'dcbaba': 11,    // RedTile
  'bbb8dd': 12,    // BlueTile
  'dcdcba': 23,    // YellowTile
  'ff8000': 10,    // Bomb
  'b97a57': 8,     // Button
  '007500': 9,     // Gate (overridden by JSON)
  '00ff00': 6,     // Powerup
  'cac000': 13,    // Portal
  'cc3300': 24,    // RedPortal
  '0066cc': 25,    // BluePortal
  'ffff00': 5,     // Boost
  'ff7373': 14,    // RedBoost
  '7373ff': 15,    // BlueBoost
};

async function loadMap(mapId) {
  // Load PNG
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = CORS_PROXY + `https://fortunatemaps.herokuapp.com/png/${mapId}.png`;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const cvs = document.createElement('canvas');
  cvs.width = img.naturalWidth;
  cvs.height = img.naturalHeight;
  cvs.getContext('2d').drawImage(img, 0, 0);
  const { data } = cvs.getContext('2d').getImageData(0, 0, cvs.width, cvs.height);

  // Load JSON
  let json = {};
  try {
    const res = await fetch(CORS_PROXY + `https://fortunatemaps.herokuapp.com/json/${mapId}.json`);
    json = await res.json();
  } catch {}

  return decodeMapPixels(data, cvs.width, cvs.height, json);
}

// Shared by loadMap() (network) and the map editor's local-file import -
// same Fortunate Maps PNG+JSON decode either way, just a different source
// for the raw pixel data.
function decodeMapPixels(data, w, h, json) {
  const fields   = json.fields   ?? {};
  const portals  = json.portals  ?? {};
  const switches = json.switches ?? {};

  const map     = [];
  const wallMap = [];
  const dataMap = [];

  for (let y = 0; y < h; y++) {
    map[y]     = [];
    wallMap[y] = [];
    dataMap[y] = [];
    for (let x = 0; x < w; x++) {
      const i   = (y * w + x) * 4;
      const a   = data[i + 3];
      const hex = [data[i], data[i + 1], data[i + 2]]
        .map(v => v.toString(16).padStart(2, '0')).join('');

      if (!a) {
        map[y][x]     = 0;
        wallMap[y][x] = 0;
        dataMap[y][x] = null;
        continue;
      }

      const id = COLOR_TO_ID[hex];
      wallMap[y][x] = (id === 1 || id === 1.1 || id === 1.2 || id === 1.3 || id === 1.4) ? id : 0;
const key = `${x},${y}`;

      if (hex === '007500') {
        const state = fields[key]?.defaultState?.toLowerCase();
        map[y][x] = state === 'on' ? 9.1
                  : state === 'red'   ? 9.2
                  : state === 'blue'  ? 9.3
                  : 9;
      } else if (hex === 'cac000' || hex === 'cc3300' || hex === '0066cc') {
        const baseId = COLOR_TO_ID[hex];
        const hasDestination = portals[key]?.destination != null;
        map[y][x] = hasDestination ? baseId : baseId + 0.1;
      } else {
        map[y][x] = COLOR_TO_ID[hex] ?? 0;
      }

      dataMap[y][x] = map[y][x]
        ? { id: map[y][x], body: null, sprite: null, backgroundSprite: null }
        : null;
    }
  }

  const spawnPoints = json.spawnPoints ?? {};
  const spawnPool = buildSpawnPool(spawnPoints, map);

  // info (name/author/gameMode) and marsballs aren't decoded into the tile
  // grid at all - marsballs have no color in COLOR_TO_ID, they're their own
  // JSON array - so they're passed through as-is for whoever wants them
  // (the map editor round-trips them even without dedicated UI for either).
  const info = json.info ?? {};
  const marsballs = json.marsballs ?? [];

  return { map, wallMap, dataMap, spawnPool, portals, switches, spawnPoints, info, marsballs };
}

function buildSpawnPool(spawnPoints, map) {
  const pool = {};

  for (const team of ['red', 'blue']) {
    const points = spawnPoints[team];

    if (points?.length) {
      pool[team] = [];
      for (const sp of points) {
        for (let dy = -sp.radius; dy <= sp.radius; dy++) {
          for (let dx = -sp.radius; dx <= sp.radius; dx++) {
            if (Math.sqrt(dx * dx + dy * dy) > sp.radius) continue;
            const tx = Math.floor(sp.x) + dx;
            const ty = Math.floor(sp.y) + dy;
            if (map[ty]?.[tx] !== 2) continue;
            for (let i = 0; i < sp.weight; i++) {
              pool[team].push({ x: tx + 0.5, y: ty + 0.5 });
            }
          }
        }
      }
    } else {
      const flagId = team === 'red' ? 3 : 4;
      pool[team] = null;
      outer: for (let fy = 0; fy < map.length; fy++) {
        for (let fx = 0; fx < map[fy].length; fx++) {
          if (map[fy][fx] !== flagId) continue;
          pool[team] = [];
          for (let dy = -5; dy <= 5; dy++) {
            for (let dx = -5; dx <= 5; dx++) {
              if (Math.sqrt(dx * dx + dy * dy) > 5) continue;
              const tx = fx + dx;
              const ty = fy + dy;
              if (map[ty]?.[tx] !== 2) continue;
              pool[team].push({ x: tx + 0.5, y: ty + 0.5 });
            }
          }
          break outer;
        }
      }
      pool[team] ??= [{ x: 0.5, y: 0.5 }];
    }
  }

  return pool;
}