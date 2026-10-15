window.preview.onMessage((items) => {
  const container = document.getElementById('notifications');
  container.replaceChildren();
  const rows = Array.isArray(items) ? items : [];
  document.getElementById('total').textContent = rows.length > 1 ? `${rows.length} hội thoại` : '';
  for (const value of rows) {
    const card = document.createElement('article'); card.className = 'notification';
    const open = document.createElement('button'); open.className = 'open'; open.type = 'button';
    open.setAttribute('aria-label', `Mở hội thoại ${value.name}`);
    const top = document.createElement('span'); top.className = 'notification-top';
    const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = 'ZaloCRM';
    const count = document.createElement('span'); count.textContent = value.count > 1 ? `· ${value.count} tin mới` : '· Tin nhắn đến';
    const time = document.createElement('time'); time.textContent = new Date(value.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    top.append(brand, count, time);
    const identity = document.createElement('span'); identity.className = 'identity';
    const avatar = document.createElement('img'); avatar.className = 'avatar'; avatar.alt = ''; avatar.referrerPolicy = 'no-referrer'; avatar.src = value.avatarUrl || 'icon.png';
    avatar.addEventListener('error', () => { if (!avatar.src.endsWith('/icon.png')) avatar.src = 'icon.png'; });
    const copy = document.createElement('span'); copy.className = 'identity-copy';
    const name = document.createElement('strong'); name.className = 'name'; name.textContent = value.name; name.title = value.name;
    const context = document.createElement('span'); context.className = 'context'; context.textContent = value.context; context.title = value.context;
    copy.append(name, context); identity.append(avatar, copy);
    const text = document.createElement('span'); text.className = 'preview-text';
    if (value.senderName) { const sender = document.createElement('span'); sender.className = 'sender'; sender.textContent = `${value.senderName}: `; text.append(sender); }
    text.append(document.createTextNode(value.preview || 'Bạn có tin nhắn mới'));
    open.append(top, identity, text); open.addEventListener('click', () => window.preview.open(value.convId));
    const close = document.createElement('button'); close.className = 'close'; close.type = 'button'; close.textContent = '×'; close.title = 'Ẩn thông báo'; close.setAttribute('aria-label', `Ẩn thông báo ${value.name}`);
    close.addEventListener('click', () => window.preview.close(value.convId));
    card.append(open, close); container.append(card);
  }
});
document.body.addEventListener('mouseenter', () => window.preview.hover(true));
document.body.addEventListener('mouseleave', () => window.preview.hover(false));
