// spritesheetLoader.js - picks which koalabeast texture pack renderer.loadTextures()
// should fetch. Doesn't touch gameConfig.js/renderer.js: it just builds an
// IMAGE_MAP-shaped object for whatever pack the player last chose (or the
// same 'musclescupgradients' default gameConfig.js already hardcodes).

const TEXTURE_PACK_STORAGE_KEY = 'tagproOpenTexturePack';
const DEFAULT_TEXTURE_PACK = 'musclescupgradients';

function buildImageMap(pack) {
  const base = `https://static.koalabeast.com/textures/${pack}`;
  return {
    tiles:        `${base}/tiles.png`,
    speedpad:     `${base}/speedpad.png`,
    speedpadRed:  `${base}/speedpadred.png`,
    speedpadBlue: `${base}/speedpadblue.png`,
    portal:       `${base}/portal.png`,
    portalRed:    `${base}/portalred.png`,
    portalBlue:   `${base}/portalblue.png`,
    gravitywell:  'https://static.koalabeast.com/images/gravitywell.png',
  };
}

function getSelectedPack() {
  return localStorage.getItem(TEXTURE_PACK_STORAGE_KEY) || DEFAULT_TEXTURE_PACK;
}

function setSelectedPack(pack) {
  localStorage.setItem(TEXTURE_PACK_STORAGE_KEY, pack);
}

function getSelectedImageMap() {
  return buildImageMap(getSelectedPack());
}
