const button = document.getElementById('bubble');
const badge = document.getElementById('badge');
let revision = -1;
function render(state) {
  if (Number.isSafeInteger(state?.revision)) { if (state.revision < revision) return; revision = state.revision; }
  const count = state?.count ?? 0;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  button.title = `${count ? `ZaloCRM: ${count} tin mới. ` : ''}Bấm để mở chat · Kéo để di chuyển`;
  button.setAttribute('aria-label', button.title);
}
window.bubble.onState(render);
void window.bubble.state().then(render).catch(() => {});
let drag = null, sequence = 0, frame = null;
function finish(cancelled = false) {
  const current = drag;
  if (!current) return;
  drag = null;
  if (frame !== null) cancelAnimationFrame(frame); frame = null;
  button.classList.remove('dragging');
  if (button.hasPointerCapture(current.pointerId)) button.releasePointerCapture(current.pointerId);
  void window.bubble.endDrag(current.id, cancelled).then(result => {
    if (!cancelled && !current.moved && result && !result.moved && !result.cancelled && sequence === current.id) window.bubble.open();
  }).catch(() => {});
}
button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || drag || event.isPrimary === false) return;
  event.preventDefault();
  drag = { id: ++sequence, pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  window.bubble.beginDrag(drag.id);
  try { button.setPointerCapture(event.pointerId); } catch { finish(true); }
});
button.addEventListener('pointermove', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (event.pointerType === 'mouse' && !(event.buttons & 1)) { finish(true); return; }
  if (!drag.moved && Math.hypot(event.screenX - drag.x, event.screenY - drag.y) < 5) return;
  drag.moved = true; button.classList.add('dragging');
  if (frame !== null) return;
  frame = requestAnimationFrame(() => { frame = null; if (drag) window.bubble.drag(drag.id); });
});
button.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId && event.button === 0) finish(); });
button.addEventListener('pointercancel', () => finish(true));
button.addEventListener('lostpointercapture', () => finish(true));
button.addEventListener('dragstart', event => event.preventDefault());
window.addEventListener('blur', () => finish(true));
window.addEventListener('pagehide', () => finish(true));
button.addEventListener('keydown', event => { if (!drag && !event.repeat && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); window.bubble.open(); } });
button.addEventListener('contextmenu', event => { event.preventDefault(); finish(true); window.bubble.menu(); });
