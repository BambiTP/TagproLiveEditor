// texturePackPicker.js - a small self-contained UI for picking one of the
// texture packs in assets/themes.json. Knows nothing about the renderer or
// game state; it only writes the pick via spritesheetLoader.js's
// setSelectedPack() and calls back so the host page can reload/reload-textures.
//
// Usage: mountTexturePackPicker(containerEl, () => location.reload());

let texturePackPickerStyleInjected = false;

function injectTexturePackPickerStyle() {
  if (texturePackPickerStyleInjected) return;
  texturePackPickerStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .texturePackGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 10px; padding: 16px; max-height: 70vh; overflow-y: auto; }
    .texturePackCell { cursor: pointer; border: 2px solid transparent; border-radius: 6px;
      padding: 6px; text-align: center; background: #333; color: #fff; font: 12px sans-serif; }
    .texturePackCell:hover { border-color: #888; }
    .texturePackCell.selected { border-color: #4caf50; }
    .texturePackCell img { width: 100%; display: block; border-radius: 4px; margin-bottom: 4px; image-rendering: pixelated; }
  `;
  document.head.appendChild(style);
}

async function mountTexturePackPicker(container, onSelect) {
  injectTexturePackPickerStyle();

  const res = await fetch('assets/themes.json');
  const { themes } = await res.json();
  const current = getSelectedPack();

  container.textContent = '';
  const grid = document.createElement('div');
  grid.className = 'texturePackGrid';

  for (const name of themes) {
    const cell = document.createElement('div');
    cell.className = 'texturePackCell' + (name === current ? ' selected' : '');

    const img = document.createElement('img');
    img.src = `assets/themePreviews/${name}.png`;
    img.alt = name;

    const label = document.createElement('div');
    label.textContent = name;

    cell.appendChild(img);
    cell.appendChild(label);
    cell.addEventListener('click', () => {
      setSelectedPack(name);
      onSelect(name);
    });

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}
