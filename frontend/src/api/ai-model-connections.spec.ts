import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/api/index', () => ({ api }))

import {
  AiConfigurationApiError,
  aiModelConnectionsApi,
} from './ai-model-connections'

describe('aiModelConnectionsApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('normalizes the 9Router discovery shape without losing model ids', async () => {
    api.get.mockResolvedValue({
      data: {
        connectionId: 'connection-1',
        models: [
          { title: 'GPT 4.1 mini', value: 'openai/gpt-4.1-mini' },
          'anthropic/claude-sonnet',
        ],
        truncated: false,
      },
    })

    await expect(aiModelConnectionsApi.discoverModels('connection-1')).resolves.toEqual([
      { id: 'openai/gpt-4.1-mini', name: 'GPT 4.1 mini', ownedBy: null },
      { id: 'anthropic/claude-sonnet', name: 'anthropic/claude-sonnet' },
    ])
    expect(api.get).toHaveBeenCalledWith('/ai/provider-connections/connection-1/models')
  })

  it('writes a secret only through the dedicated endpoint', async () => {
    api.put.mockResolvedValue({ data: { id: 'connection-1' } })

    await aiModelConnectionsApi.updateConnectionSecret('connection-1', 'secret-value')

    expect(api.put).toHaveBeenCalledWith('/ai/provider-connections/connection-1/secret', {
      apiKey: 'secret-value',
    })
  })

  it('preserves HTTP status and safe backend error code', async () => {
    api.get.mockRejectedValue({
      response: { status: 403, data: { error: 'Forbidden', code: 'FORBIDDEN' } },
    })

    const result = await aiModelConnectionsApi.listConnections().catch((error) => error)

    expect(result).toBeInstanceOf(AiConfigurationApiError)
    expect(result).toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Forbidden' })
  })

  it('sends optimistic revisions for model edits and default changes', async () => {
    api.patch.mockResolvedValue({ data: { id: 'model-1' } })
    api.post.mockResolvedValue({
      data: {
        defaultModelConfigId: 'model-1',
        aiConfigRevision: '2026-07-16T08:00:00.000Z',
      },
    })

    await aiModelConnectionsApi.updateModelConfig('model-1', {
      displayName: 'Sales model v2',
      expectedRevision: 4,
    })
    await aiModelConnectionsApi.setDefaultModelConfig(
      'model-1',
      '2026-07-16T07:00:00.000Z',
    )

    expect(api.patch).toHaveBeenCalledWith('/ai/model-configs/model-1', {
      displayName: 'Sales model v2',
      expectedRevision: 4,
    })
    expect(api.post).toHaveBeenCalledWith('/ai/model-configs/model-1/default', {
      expectedRevision: '2026-07-16T07:00:00.000Z',
    })
  })
})
