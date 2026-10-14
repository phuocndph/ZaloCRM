const button = document.getElementById('bubble');
const badge = document.getElementById('badge');
function render(state) {
  const count = state?.count ?? 0;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  button.title = count ? `ZaloCRM: ${count} tin mới` : 'Mở khung chat ZaloCRM';
  button.setAttribute('aria-label', button.title);
}
window.bubble.onState(render);
void window.bubble.state().then(render);
let drag = null;
button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  drag = { x: event.screenX, y: event.screenY, moved: false };
  button.setPointerCapture(event.pointerId);
});
button.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.screenX - drag.x, dy = event.screenY - drag.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
  drag.moved = true;
  window.bubble.move(dx, dy);
  drag.x = event.screenX; drag.y = event.screenY;
});
button.addEventListener('pointerup', () => { const moved = drag?.moved; drag = null; if (!moved) window.bubble.open(); });
button.addEventListener('pointercancel', () => { drag = null; });
button.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.bubble.open(); } });
button.addEventListener('contextmenu', (event) => { event.preventDefault(); window.bubble.menu(); });
