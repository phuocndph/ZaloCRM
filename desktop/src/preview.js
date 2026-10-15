const cards = new Map();
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : (parts[0] || '?').slice(0, 2)).toLocaleUpperCase('vi-VN');
}
function createCard(convId) {
  const card = document.createElement('article'); card.className = 'notification';
  const open = document.createElement('button'); open.className = 'open'; open.type = 'button';
  const avatarWrap = document.createElement('span'); avatarWrap.className = 'avatar-wrap';
  const fallback = document.createElement('span'); fallback.className = 'avatar-initials'; fallback.setAttribute('aria-hidden', 'true');
  const avatar = document.createElement('img'); avatar.className = 'avatar'; avatar.alt = ''; avatar.referrerPolicy = 'no-referrer'; avatar.hidden = true;
  const count = document.createElement('span'); count.className = 'notification-count';
  avatarWrap.append(fallback, avatar, count);
  const copy = document.createElement('span'); copy.className = 'identity-copy';
  const top = document.createElement('span'); top.className = 'identity-top';
  const name = document.createElement('strong'); name.className = 'name';
  const time = document.createElement('time');
  const context = document.createElement('span'); context.className = 'context';
  top.append(name, time); copy.append(top, context);
  const text = document.createElement('span'); text.className = 'preview-text';
  const close = document.createElement('button'); close.className = 'close'; close.type = 'button'; close.textContent = '×'; close.title = 'Ẩn thông báo';
  open.addEventListener('click', () => window.preview.open(convId));
  close.addEventListener('click', () => window.preview.close(convId));
  open.append(avatarWrap, copy, text); card.append(open, close);
  return { card, open, avatar, avatarWrap, fallback, count, name, time, context, text, close, avatarKey: '', generation: 0, timer: null };
}
function updateAvatar(entry, value) {
  const urls = value.redacted ? [] : [...new Set([value.avatarUrl, ...(value.avatarUrls || [])].filter(Boolean))].slice(0, 3);
  const key = JSON.stringify(urls);
  if (entry.avatarKey === key) return;
  entry.avatarKey = key;
  const generation = ++entry.generation;
  clearTimeout(entry.timer); entry.avatar.onload = null; entry.avatar.onerror = null;
  entry.avatar.hidden = true; entry.avatar.removeAttribute('src');
  let index = 0;
  function next() {
    clearTimeout(entry.timer);
    if (entry.generation !== generation || index >= urls.length) return;
    // A separate image isolates late load/error callbacks from the previous URL.
    const image = new Image(); image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (entry.generation !== generation || image.src !== entry.avatar.dataset.loadingUrl) return;
      clearTimeout(entry.timer); entry.avatar.src = image.src; entry.avatar.hidden = false;
    };
    image.onerror = () => {
      if (entry.generation === generation && image.src === entry.avatar.dataset.loadingUrl) next();
    };
    image.src = urls[index++]; entry.avatar.dataset.loadingUrl = image.src;
    entry.timer = setTimeout(next, 2500);
  }
  next();
}
window.preview.onMessage((items) => {
  const container = document.getElementById('notifications');
  const rows = Array.isArray(items) ? items : [];
  const visible = new Set(rows.map((value) => value.convId));
  for (const [id, entry] of cards) if (!visible.has(id)) {
    clearTimeout(entry.timer); entry.generation++; entry.card.remove(); cards.delete(id);
  }
  for (const value of rows) {
    let entry = cards.get(value.convId);
    if (!entry) { entry = createCard(value.convId); cards.set(value.convId, entry); }
    entry.open.setAttribute('aria-label', `Mở hội thoại ${value.name}`);
    entry.close.setAttribute('aria-label', `Ẩn thông báo ${value.name}`);
    entry.name.textContent = value.name; entry.name.title = value.name;
    entry.context.textContent = value.context; entry.context.title = value.context;
    entry.time.textContent = new Date(value.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    entry.fallback.textContent = initials(value.name);
    entry.count.hidden = !(value.count > 1);
    entry.count.textContent = value.count > 99 ? '99+' : String(value.count || 1);
    entry.count.setAttribute('aria-label', `${value.count || 1} tin mới`);
    entry.text.replaceChildren();
    if (value.senderName) { const sender = document.createElement('span'); sender.className = 'sender'; sender.textContent = `${value.senderName}: `; entry.text.append(sender); }
    entry.text.append(document.createTextNode(value.preview || 'Bạn có tin nhắn mới'));
    updateAvatar(entry, value); container.append(entry.card);
  }
});
document.body.addEventListener('mouseenter', () => window.preview.hover(true));
document.body.addEventListener('mouseleave', () => window.preview.hover(false));
