// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const aiApi = vi.hoisted(() => ({
  listConnections: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  updateConnectionSecret: vi.fn(),
  testConnection: vi.fn(),
  discoverModels: vi.fn(),
  listModelConfigs: vi.fn(),
  createModelConfig: vi.fn(),
  updateModelConfig: vi.fn(),
  cloneModelConfig: vi.fn(),
  testModelConfig: vi.fn(),
  submitModelConfig: vi.fn(),
  approveModelConfig: vi.fn(),
  archiveModelConfig: vi.fn(),
  getModelConfigImpact: vi.fn(),
  setDefaultModelConfig: vi.fn(),
}))

vi.mock('@/api/ai-model-connections', () => {
  class AiConfigurationApiError extends Error {
    status: number | null
    code: string | null

    constructor(message: string, status: number | null = null, code: string | null = null) {
      super(message)
      this.status = status
      this.code = code
    }
  }
  return { AiConfigurationApiError, aiModelConnectionsApi: aiApi }
})

import { AiConfigurationApiError } from '@/api/ai-model-connections'
import ModelsConnectionsPanel from './ModelsConnectionsPanel.vue'

const connection = {
  id: 'connection-1',
  key: 'nine-router',
  name: '9Router chính',
  adapter: 'openai_compatible',
  vendor: '9router',
  baseUrl: 'http://host.docker.internal:20128/v1',
  apiKeyConfigured: true,
  apiKeyLast4: '1234',
  credentialVersion: 1,
  status: 'connected',
  lastTestStatus: 'healthy',
  lastTestedAt: '2026-07-16T08:00:00.000Z',
  lastLatencyMs: 90,
  lastErrorCode: null,
  createdByUserId: null,
  updatedByUserId: null,
  createdAt: '2026-07-16T07:00:00.000Z',
  updatedAt: '2026-07-16T08:00:00.000Z',
  modelConfigCount: 0,
}

const emptyModels = {
  modelConfigs: [],
  defaultModelConfigId: null,
  aiConfigRevision: null,
}

describe('ModelsConnectionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiApi.listConnections.mockResolvedValue([])
    aiApi.listModelConfigs.mockResolvedValue(emptyModels)
    aiApi.updateConnectionSecret.mockResolvedValue(connection)
    aiApi.testConnection.mockResolvedValue({
      connection,
      probe: {
        models: [],
        modelsTruncated: false,
        selectedModel: null,
        latencyMs: 90,
        completionVerified: true,
      },
    })
    aiApi.discoverModels.mockResolvedValue([])
  })

  it('shows a permission state instead of treating 403 as an empty list', async () => {
    aiApi.listConnections.mockRejectedValue(
      new AiConfigurationApiError('Forbidden', 403, 'FORBIDDEN'),
    )

    const wrapper = mount(ModelsConnectionsPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('Bạn chưa có quyền xem kết nối API')
    expect(wrapper.text()).not.toContain('Chưa có kết nối API')
  })

  it('keeps the API key write-only and clears it after a successful save', async () => {
    aiApi.listConnections.mockResolvedValue([connection])
    const wrapper = mount(ModelsConnectionsPanel)
    await flushPromises()

    const rotate = wrapper.findAll('button').find((button) => button.text() === 'Xoay khóa')
    expect(rotate).toBeDefined()
    await rotate!.trigger('click')

    const secretInput = wrapper.get('input[autocomplete="new-password"]')
    expect(secretInput.attributes('type')).toBe('password')
    expect((secretInput.element as HTMLInputElement).value).toBe('')
    await secretInput.setValue('replacement-secret')
    await wrapper.get('.confirm-line input').setValue(true)
    await wrapper.get('form.dialog.narrow').trigger('submit')
    await flushPromises()

    expect(aiApi.updateConnectionSecret).toHaveBeenCalledWith(
      'connection-1',
      'replacement-secret',
    )
    expect(aiApi.testConnection).toHaveBeenCalledWith('connection-1')
    expect(wrapper.find('input[autocomplete="new-password"]').exists()).toBe(false)
  })

  it('keeps the navigation CTA usable when no verified connection exists', async () => {
    const wrapper = mount(ModelsConnectionsPanel)
    await flushPromises()

    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1].trigger('click')
    const cta = wrapper.findAll('button').find((button) => button.text() === 'Đi tới kết nối API')

    expect(cta).toBeDefined()
    expect(cta!.attributes('disabled')).toBeUndefined()
    await cta!.trigger('click')
    expect(tabs[0].attributes('aria-selected')).toBe('true')
  })

  it('fills the F5Quota preset with its provider defaults', async () => {
    const wrapper = mount(ModelsConnectionsPanel)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text().includes('Thêm kết nối'))!.trigger('click')
    const preset = wrapper.get('form.dialog select')
    await preset.setValue('9router')
    await preset.setValue('f5quota')

    const inputs = wrapper.findAll('form.dialog input')
    expect((inputs[0].element as HTMLInputElement).value).toBe('F5Quota')
    expect((inputs[1].element as HTMLInputElement).value).toBe('f5quota-primary')
    expect((inputs[2].element as HTMLInputElement).value).toBe('https://f5quota.store/v1')
  })

  it('filters a discovered F5Quota model list by name or model id', async () => {
    const f5Connection = {
      ...connection,
      id: 'f5-connection',
      key: 'f5quota-primary',
      name: 'F5Quota',
      vendor: 'f5quota',
      baseUrl: 'https://f5quota.store/v1',
    }
    aiApi.listConnections.mockResolvedValue([f5Connection])
    aiApi.discoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', ownedBy: null },
      { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex', ownedBy: null },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', ownedBy: null },
    ])
    const wrapper = mount(ModelsConnectionsPanel)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === 'Xem mô hình')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('3/3 model')

    await wrapper.get('input[type="search"]').setValue('codex')
    expect(wrapper.text()).toContain('GPT 5.3 Codex')
    expect(wrapper.text()).toContain('1/3 model')
    expect(wrapper.text()).not.toContain('Claude Sonnet 4.6')
    expect(wrapper.text()).not.toContain('Gemini 2.5 Pro')
  })

  it('does not offer a destructive retest for an approved model', async () => {
    aiApi.listConnections.mockResolvedValue([connection])
    aiApi.listModelConfigs.mockResolvedValue({
      defaultModelConfigId: null,
      aiConfigRevision: null,
      modelConfigs: [{
        id: 'model-1',
        connectionId: connection.id,
        connection,
        logicalKey: 'sales.primary',
        displayName: 'Sales primary',
        provider: '9router',
        externalModelId: 'openai/gpt-4.1-mini',
        status: 'approved',
        version: 1,
        revision: 4,
        isDefault: false,
        parameters: {},
        capabilities: { text: true },
        dataPolicy: {},
        fallbackModelConfigId: null,
        changeNote: null,
        createdByUserId: 'user-1',
        approvedByUserId: 'user-2',
        approvedAt: '2026-07-16T08:00:00.000Z',
        archivedAt: null,
        createdAt: '2026-07-16T07:00:00.000Z',
        updatedAt: '2026-07-16T08:00:00.000Z',
      }],
    })
    const wrapper = mount(ModelsConnectionsPanel)
    await flushPromises()
    await wrapper.findAll('[role="tab"]')[1].trigger('click')

    const actions = wrapper.get('.models-table .model-actions').text()
    expect(actions).not.toContain('Kiểm tra')
    expect(actions).toContain('Đặt mặc định')
    expect(actions).toContain('Nhân bản')
  })
})
