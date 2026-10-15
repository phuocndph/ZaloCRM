// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { desktopReleaseStream, getDesktopRelease, getLatestDesktopRelease, isDesktopReleaseVersion } from './desktop-release-service.js';
import type { DesktopReleaseManifest } from './desktop-release-service.js';

function payload(manifest: DesktopReleaseManifest) {
  return {
    ...manifest,
    downloadUrl: `/api/v1/desktop/releases/${encodeURIComponent(manifest.version)}/download`,
  };
}

export async function desktopReleaseRoutes(app: FastifyInstance) {
  app.get('/api/v1/desktop/releases/latest', { preHandler: authMiddleware }, async (_request, reply) => {
    const release = await getLatestDesktopRelease();
    reply.header('Cache-Control', 'private, no-store');
    if (!release) return { available: false };
    return { available: true, release: payload(release.manifest) };
  });

  // Bộ cài không chứa dữ liệu riêng của tổ chức. Route tải là public để trình duyệt và
  // Electron tải trực tiếp bằng Content-Disposition mà không nhét JWT vào URL.
  app.get('/api/v1/desktop/releases/:version/download', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const version = String((request.params as { version?: string }).version ?? '');
    if (!isDesktopReleaseVersion(version)) return reply.status(404).send({ error: 'not_found' });
    const release = await getDesktopRelease(version);
    if (!release) return reply.status(404).send({ error: 'not_found' });
    const name = release.manifest.filename.replace(/["\\\r\n]/g, '_');
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', String(release.manifest.bytes))
      .header('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(desktopReleaseStream(release));
  });
}
