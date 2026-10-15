window.preview.onMessage((value) => {
  for (const [id, text] of [['name', value?.name], ['context', value?.context], ['text', value?.preview]]) document.getElementById(id).textContent = text || '';
  document.getElementById('avatar').src = value?.avatarUrl || 'icon.png';
});
document.getElementById('avatar').addEventListener('error', (event) => { if (!event.target.src.endsWith('/icon.png')) event.target.src = 'icon.png'; });
document.getElementById('open').addEventListener('click', () => window.preview.open());
document.getElementById('close').addEventListener('click', () => window.preview.close());
document.body.addEventListener('mouseenter', () => window.preview.hover(true));
document.body.addEventListener('mouseleave', () => window.preview.hover(false));
