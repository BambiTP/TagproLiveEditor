// settingsMenu.js - per-browser preferences (keybinds, free camera zoom,
// particles) plus the Esc menu that edits them. Everything here is local to
// this browser - there's no room/leader/network layer in this sandbox, so
// unlike BamBall's local/menu.js (roster, leader tools, map profile cards,
// group codes) this menu has exactly one panel: Settings.

// ---- localSettings: persisted keybinds + prefs -----------------------------

var LOCAL_SETTINGS_STORAGE_KEY = 'tagpro_map_editor_settings';

var LOCAL_SETTINGS_DEFAULTS = {
  keys: {
    up:       ['w', 'ArrowUp'],
    down:     ['s', 'ArrowDown'],
    left:     ['a', 'ArrowLeft'],
    right:    ['d', 'ArrowRight'],
    detonate: [' '],
    menu:     ['Escape'],
    zoomIn:   ['=', '+'],
    zoomOut:  ['-'],
  },
  particles: true,
};

var localSettingsEvents = createEventBus();

function mergeLocalSettings(stored) {
  var merged = { keys: {}, particles: LOCAL_SETTINGS_DEFAULTS.particles };
  var action;
  for (action in LOCAL_SETTINGS_DEFAULTS.keys) {
    merged.keys[action] = LOCAL_SETTINGS_DEFAULTS.keys[action].slice();
  }
  if (!stored || typeof stored !== 'object') return merged;

  if (stored.keys && typeof stored.keys === 'object') {
    for (action in LOCAL_SETTINGS_DEFAULTS.keys) {
      var bindings = stored.keys[action];
      if (!Array.isArray(bindings)) continue;
      var clean = [];
      for (var i = 0; i < bindings.length && clean.length < 2; i++) {
        if (typeof bindings[i] === 'string' && bindings[i].length) clean.push(bindings[i]);
      }
      if (clean.length) merged.keys[action] = clean;
    }
  }
  if (typeof stored.particles === 'boolean') merged.particles = stored.particles;
  return merged;
}

function loadLocalSettings() {
  var stored = null;
  try { stored = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY)); } catch (err) {}
  return mergeLocalSettings(stored);
}

var localSettings = loadLocalSettings();

function saveLocalSettings() {
  try { localStorage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify(localSettings)); } catch (err) {}
  localSettingsEvents.emit('localSettings:changed');
}

function setKeybind(action, slot, key) {
  if (!LOCAL_SETTINGS_DEFAULTS.keys[action]) return;
  // A key means one thing at a time - remove it from every other action first.
  for (var otherAction in localSettings.keys) {
    var bindings = localSettings.keys[otherAction];
    var index = bindings.indexOf(key);
    if (index !== -1) bindings.splice(index, 1);
  }
  localSettings.keys[action][slot] = key;
  saveLocalSettings();
}

function resetKeybinds() {
  var action;
  for (action in LOCAL_SETTINGS_DEFAULTS.keys) {
    localSettings.keys[action] = LOCAL_SETTINGS_DEFAULTS.keys[action].slice();
  }
  saveLocalSettings();
}

function setParticlesEnabled(enabled) {
  localSettings.particles = !!enabled;
  saveLocalSettings();
}

// ---- Esc menu: one Settings panel ------------------------------------------

var ACTION_LABELS = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right',
  detonate: 'Detonate rolling bomb', menu: 'Menu', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
};

var listeningFor = null; // { action, slot } while capturing the next keypress

function keyLabel(key) {
  if (key === ' ') return 'Space';
  return key;
}

function buildKeybindRows() {
  var list = document.getElementById('keybindList');
  if (!list) return;
  list.textContent = '';

  Object.keys(LOCAL_SETTINGS_DEFAULTS.keys).forEach(function (action) {
    var row = document.createElement('div');
    row.className = 'keybindRow';

    var label = document.createElement('span');
    label.className = 'keybindLabel';
    label.textContent = ACTION_LABELS[action] || action;
    row.appendChild(label);

    var slots = localSettings.keys[action];
    for (var slot = 0; slot < 2; slot++) {
      (function (slot) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menuBtn keybindBtn';
        btn.textContent = slots[slot] ? keyLabel(slots[slot]) : '-';
        btn.addEventListener('click', function () {
          listeningFor = { action: action, slot: slot };
          btn.textContent = 'Press a key...';
          btn.classList.add('listening');
        });
        row.appendChild(btn);
      })(slot);
    }

    list.appendChild(row);
  });
}

function initKeybindCapture() {
  window.addEventListener('keydown', function (event) {
    if (!listeningFor) return;
    event.preventDefault();
    event.stopPropagation();
    setKeybind(listeningFor.action, listeningFor.slot, event.key);
    listeningFor = null;
    buildKeybindRows();
  }, true); // capture: steal the key before movement's own keydown handler sees it
}

function toggleMenu() {
  var menu = document.getElementById('menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
}

function closeMenu() {
  var menu = document.getElementById('menu');
  if (menu) menu.classList.add('hidden');
}

function initSettingsMenu() {
  initKeybindCapture();
  buildKeybindRows();
  localSettingsEvents.on('localSettings:changed', buildKeybindRows);

  var resetBtn = document.getElementById('resetKeybindsBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetKeybinds);

  var particlesToggle = document.getElementById('particlesToggle');
  if (particlesToggle) {
    particlesToggle.checked = localSettings.particles;
    particlesToggle.addEventListener('change', function () {
      setParticlesEnabled(particlesToggle.checked);
    });
  }

  var freeZoomToggle = document.getElementById('freeZoomToggle');
  if (freeZoomToggle) {
    freeZoomToggle.checked = true;
    freeZoomToggle.disabled = true; // always free in this sandbox - shown for clarity, not a real switch
  }

  var closeBtn = document.getElementById('menuCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
}
