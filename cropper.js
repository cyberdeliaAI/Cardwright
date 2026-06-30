// Minimal dependency-free image cropper for Cardwright.
// Locked aspect ratio (default 2:3 portrait, matching SillyTavern avatars).
// Renders its own modal overlay and resolves with a fixed-size canvas, or
// null if the user cancels.

const OUTPUT_WIDTH = 512; // 2:3 → 512 x 768

/**
 * Open the crop modal.
 * @param {string} imageUrl - Source image (object URL or data URL).
 * @param {{aspect?: number, title?: string}} [opts] - aspect = width/height.
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export function openCropper(imageUrl, { aspect = 2 / 3, title = 'Set the crop position of the avatar image' } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => mount(img, aspect, title, resolve);
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

function mount(img, aspect, title, resolve) {
  // Display geometry: fit the image inside a bounded stage.
  const maxW = Math.min(520, window.innerWidth - 80);
  const maxH = Math.min(560, window.innerHeight - 220);
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  const dispW = Math.round(img.naturalWidth * scale);
  const dispH = Math.round(img.naturalHeight * scale);

  // ── DOM ──
  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.innerHTML = `
    <div class="crop-modal">
      <h3 class="crop-title">${title}</h3>
      <div class="crop-stage" style="width:${dispW}px;height:${dispH}px">
        <img class="crop-img" src="${img.src}" draggable="false" style="width:${dispW}px;height:${dispH}px">
        <div class="crop-box">
          <div class="crop-grid"></div>
          ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<span class="crop-h crop-h-${h}" data-h="${h}"></span>`).join('')}
        </div>
      </div>
      <div class="crop-actions">
        <button class="button danger" data-act="crop" type="button">Crop</button>
        <button class="button" data-act="cancel" type="button">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const boxEl = overlay.querySelector('.crop-box');

  // ── Crop box state (display coords), aspect locked: w / h = aspect ──
  const MIN_W = 40;
  let box = initBox();

  function initBox() {
    let w = dispW * 0.8;
    let h = w / aspect;
    if (h > dispH) { h = dispH * 0.9; w = h * aspect; }
    if (w > dispW) { w = dispW; h = w / aspect; }
    return { x: (dispW - w) / 2, y: (dispH - h) / 2, w, h };
  }

  function clamp() {
    box.w = Math.max(MIN_W, Math.min(box.w, dispW));
    box.h = box.w / aspect;
    if (box.h > dispH) { box.h = dispH; box.w = box.h * aspect; }
    box.x = Math.max(0, Math.min(box.x, dispW - box.w));
    box.y = Math.max(0, Math.min(box.y, dispH - box.h));
  }

  function render() {
    clamp();
    boxEl.style.left = `${box.x}px`;
    boxEl.style.top = `${box.y}px`;
    boxEl.style.width = `${box.w}px`;
    boxEl.style.height = `${box.h}px`;
  }
  render();

  // ── Drag handling ──
  let drag = null; // { mode: 'move'|handle, startX, startY, start: {...box} }

  function onDown(event, mode) {
    event.preventDefault();
    drag = { mode, startX: event.clientX, startY: event.clientY, start: { ...box } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const s = drag.start;

    if (drag.mode === 'move') {
      box.x = s.x + dx;
      box.y = s.y + dy;
      render();
      return;
    }

    resize(drag.mode, dx, dy, s);
    render();
  }

  function resize(handle, dx, dy, s) {
    const right = s.x + s.w;
    const bottom = s.y + s.h;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;

    if (handle === 'e' || handle === 'w') {
      const anchorX = handle === 'e' ? s.x : right;
      let w = Math.max(MIN_W, handle === 'e' ? s.w + dx : s.w - dx);
      let h = w / aspect;
      box.w = w; box.h = h;
      box.x = handle === 'e' ? anchorX : anchorX - w;
      box.y = cy - h / 2;
      return;
    }
    if (handle === 'n' || handle === 's') {
      const anchorY = handle === 's' ? s.y : bottom;
      let h = Math.max(MIN_W / aspect, handle === 's' ? s.h + dy : s.h - dy);
      let w = h * aspect;
      box.h = h; box.w = w;
      box.y = handle === 's' ? anchorY : anchorY - h;
      box.x = cx - w / 2;
      return;
    }

    // Corners: drive size from whichever axis moved more, anchor opposite corner.
    const anchorX = (handle === 'ne' || handle === 'se') ? s.x : right;
    const anchorY = (handle === 'sw' || handle === 'se') ? s.y : bottom;
    const signX = (handle === 'ne' || handle === 'se') ? 1 : -1;
    const signY = (handle === 'sw' || handle === 'se') ? 1 : -1;
    const wFromX = s.w + signX * dx;
    const wFromY = (s.h + signY * dy) * aspect;
    let w = Math.max(MIN_W, Math.max(wFromX, wFromY));
    let h = w / aspect;
    box.w = w; box.h = h;
    box.x = (handle === 'ne' || handle === 'se') ? anchorX : anchorX - w;
    box.y = (handle === 'sw' || handle === 'se') ? anchorY : anchorY - h;
  }

  function onUp() {
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }

  boxEl.addEventListener('pointerdown', (event) => {
    const handle = event.target.dataset.h;
    if (handle) onDown(event, handle);
    else onDown(event, 'move');
  });

  // ── Actions ──
  function close(result) {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    resolve(result);
  }

  function doCrop() {
    const f = 1 / scale; // display → natural
    const sx = box.x * f;
    const sy = box.y * f;
    const sw = box.w * f;
    const sh = box.h * f;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = Math.round(OUTPUT_WIDTH / aspect);
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    close(canvas);
  }

  overlay.addEventListener('click', (event) => {
    const act = event.target.dataset.act;
    if (act === 'crop') doCrop();
    else if (act === 'cancel' || event.target === overlay) close(null);
  });

  function onKey(event) {
    if (event.key === 'Escape') close(null);
    else if (event.key === 'Enter') doCrop();
  }
  document.addEventListener('keydown', onKey);
}
