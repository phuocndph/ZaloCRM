// Keep drag coordinates in Electron's desktop coordinate system (DIP), including mixed-DPI monitors.
class BubbleDrag {
  constructor({ cursor, bounds, workArea, move, finish, enabled, now = Date.now }) {
    Object.assign(this, { cursor, bounds, workArea, move, finish, enabled, now }); this.gesture = null;
  }
  get active() { return !!this.gesture; }
  begin(id) {
    if (!Number.isSafeInteger(id) || id < 1 || !this.enabled()) return false;
    this.end(undefined, true);
    this.gesture = { id, cursor: this.cursor(), bounds: this.bounds(), moved: false, updatedAt: this.now() };
    return true;
  }
  update(id) {
    const g = this.gesture;
    if (!g || g.id !== id) return;
    if (!this.enabled()) { this.end(id, true); return; }
    g.updatedAt = this.now();
    const point = this.cursor(), dx = point.x - g.cursor.x, dy = point.y - g.cursor.y;
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    g.moved = true;
    const work = this.workArea(point);
    const x = Math.round(Math.max(work.x, Math.min(g.bounds.x + dx, work.x + work.width - g.bounds.width)));
    const y = Math.round(Math.max(work.y, Math.min(g.bounds.y + dy, work.y + work.height - g.bounds.height)));
    this.move(x, y);
  }
  end(id, cancelled = false) {
    const g = this.gesture;
    if (!g || id !== undefined && g.id !== id) return null;
    if (!cancelled) this.update(g.id);
    // update() may cancel the gesture if the session became unavailable.
    if (this.gesture !== g) return null;
    this.gesture = null;
    this.finish(g.moved, cancelled);
    return { moved: g.moved, cancelled };
  }
  expire() { if (this.gesture && this.now() - this.gesture.updatedAt > 10000) this.end(undefined, true); }
}
module.exports = { BubbleDrag };
