function objectOf(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function coordinate(value: unknown, limit: number): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function text(value: unknown): string {
  return typeof value === 'string' && !/^\s*[\[{]/.test(value) ? value.trim() : '';
}

export function chatLocation(content: unknown) {
  const c = objectOf(content);
  const params = objectOf(c.params);
  let coords: { lat: number; lng: number } | null = null;
  for (const source of [params, c]) {
    const lat = coordinate(source.latitude ?? source.lat, 90);
    const lng = coordinate(source.longitude ?? source.lng ?? source.lon, 180);
    if (lat !== null && lng !== null) { coords = { lat, lng }; break; }
  }
  const point = coords ? `${coords.lat},${coords.lng}` : '';
  // Use the canonical location-query embed rather than the legacy redirect,
  // which desktop navigation protection blocks. Only validated numbers enter pb.
  const embed = new URL('https://www.google.com/maps/embed');
  embed.searchParams.set('origin', 'mfe');
  embed.searchParams.set('pb', `!1m3!2m1!1s${point}!6i16`);
  return {
    coords,
    title: text(c.title) || text(params.title) || 'Vị trí được chia sẻ',
    address: text(c.description) || text(params.address) || text(c.address),
    point,
    mapUrl: point ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point)}` : '',
    directionsUrl: point ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point)}` : '',
    embedUrl: point ? embed.href : '',
  };
}
