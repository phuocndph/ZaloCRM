import { api } from '@/api/index'

export type ProviderConnectionStatus =
  | 'draft'
  | 'needs_test'
  | 'connected'
  | 'failed'
  | 'disabled'

export type ProviderTestStatus =
  | 'untested'
  | 'healthy'
  | 'failed'
  | 'auth_failed'
  | 'rate_limited'
  | 'unreachable'
  | null

export interface ProviderConnection {
  id: string
  key: string
  name: string
  adapter: string
  vendor: string | null
  baseUrl: string | null
  apiKeyConfigured: boolean
  apiKeyLast4: string | null
  credentialVersion: number
  status: ProviderConnectionStatus
  lastTestStatus: ProviderTestStatus
  lastTestedAt: string | null
  lastLatencyMs: number | null
  lastErrorCode: string | null
  createdByUserId: string | null
  updatedByUserId: string | null
  createdAt: string
  updatedAt: string
  modelConfigCount: number
}

export interface CreateProviderConnectionInput {
  key: string
  name: string
  adapter: string
  vendor?: string | null
  baseUrl?: string | null
}

export interface UpdateProviderConnectionInput {
  name?: string
  adapter?: string
  vendor?: string | null
  baseUrl?: string | null
  status?: ProviderConnectionStatus
}

export interface DiscoveredModel {
  id: string
  name: string
  ownedBy?: string | null
}

export interface ConnectionProbe {
  models: Array<{ title: string; value: string }>
  modelsTruncated: boolean
  selectedModel?: string | null
  latencyMs: number
  completionVerified: boolean
}

export interface ProviderConnectionTestResult {
  connection: ProviderConnection
  probe: ConnectionProbe
}

export type ModelConfigStatus =
  | 'draft'
  | 'testing'
  | 'submitted'
  | 'approved'
  | 'archived'

export interface AiModelCapabilities {
  text?: boolean
  vision?: boolean
  tools?: boolean
  structuredOutput?: boolean
  embeddings?: boolean
}

export interface AiModelConfig {
  id: string
  connectionId: string | null
  connection?: Pick<ProviderConnection, 'id' | 'name' | 'status'> | null
  logicalKey: string | null
  displayName: string
  provider: string
  externalModelId: string
  status: ModelConfigStatus
  version: number
  revision: number
  isDefault: boolean
  parameters: Record<string, unknown>
  capabilities: AiModelCapabilities & Record<string, unknown>
  dataPolicy: Record<string, unknown>
  fallbackModelConfigId: string | null
  changeNote: string | null
  createdByUserId: string | null
  approvedByUserId: string | null
  approvedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SaveModelConfigInput {
  connectionId: string
  logicalKey: string
  displayName: string
  externalModelId: string
  parameters?: Record<string, unknown>
  capabilities?: AiModelCapabilities & Record<string, unknown>
  dataPolicy?: Record<string, unknown>
  fallbackModelConfigId?: string | null
  changeNote?: string | null
}

export interface UpdateModelConfigInput extends Partial<SaveModelConfigInput> {
  expectedRevision: number
}

export interface ModelConfigProbe {
  models: Array<{ title: string; value: string }>
  modelsTruncated: boolean
  selectedModel: string | null
  latencyMs: number
  completionVerified: boolean
}

export interface ModelConfigTestResult {
  modelConfig: AiModelConfig
  probe: ModelConfigProbe
}

export interface ModelConfigListResult {
  modelConfigs: AiModelConfig[]
  defaultModelConfigId: string | null
  aiConfigRevision: string | null
}

export interface ModelConfigImpact {
  modelConfigId: string
  canArchive: boolean
  blockingReasons: string[]
  counts: {
    agents: number
    runs: number
    evaluationRuns: number
    fallbackFor: number
    defaultForAiConfigs: number
    releases: number
    liveReleases: number
  }
  agents: Array<{ id: string; name: string; status: string }>
  releases: Array<{ id: string; version: number; status: string }>
}

export interface SetDefaultModelResult {
  defaultModelConfigId: string | null
  aiConfigRevision: string | null
}

export class AiConfigurationApiError extends Error {
  readonly status: number | null
  readonly code: string | null

  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message)
    this.name = 'AiConfigurationApiError'
    this.status = status
    this.code = code
  }
}

type ApiResponse<T> = T | { data: T }

function unwrap<T>(response: ApiResponse<T>): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data
  }
  return response as T
}

async function call<T>(request: Promise<unknown>): Promise<T> {
  try {
    return unwrap<T>((await request) as ApiResponse<T>)
  } catch (cause) {
    const error = cause as {
      message?: string
      response?: {
        status?: number
        data?: { message?: string; error?: string; code?: string }
      }
    }
    const payload = error.response?.data
    throw new AiConfigurationApiError(
      payload?.message || payload?.error || error.message || 'Không thể kết nối đến máy chủ.',
      error.response?.status ?? null,
      payload?.code ?? null,
    )
  }
}

function normalizeDiscoveredModels(payload: unknown): DiscoveredModel[] {
  const body = unwrap(payload as ApiResponse<unknown>)
  let records: unknown = body
  if (body && typeof body === 'object') {
    const objectBody = body as Record<string, unknown>
    records = objectBody.models ?? objectBody.data ?? []
  }
  if (!Array.isArray(records)) return []
  return records.flatMap((record) => {
    if (typeof record === 'string') return [{ id: record, name: record }]
    if (!record || typeof record !== 'object') return []
    const item = record as Record<string, unknown>
    const id = String(item.id ?? item.value ?? item.model ?? item.name ?? '').trim()
    if (!id) return []
    return [{
      id,
      name: String(item.name ?? item.title ?? item.id ?? item.value ?? item.model ?? id),
      ownedBy: item.ownedBy == null && item.owned_by == null
        ? null
        : String(item.ownedBy ?? item.owned_by),
    }]
  })
}

const providerBase = '/ai/provider-connections'
const modelBase = '/ai/model-configs'

export const aiModelConnectionsApi = {
  async listConnections(): Promise<ProviderConnection[]> {
    const result = await call<{ connections: ProviderConnection[] }>(api.get(providerBase))
    return result.connections ?? []
  },

  async createConnection(input: CreateProviderConnectionInput): Promise<ProviderConnection> {
    const result = await call<{ connection?: ProviderConnection } & ProviderConnection>(
      api.post(providerBase, input),
    )
    return result.connection ?? result
  },

  async updateConnection(id: string, input: UpdateProviderConnectionInput): Promise<ProviderConnection> {
    const result = await call<{ connection?: ProviderConnection } & ProviderConnection>(
      api.patch(`${providerBase}/${encodeURIComponent(id)}`, input),
    )
    return result.connection ?? result
  },

  async updateConnectionSecret(id: string, apiKey: string): Promise<ProviderConnection> {
    const result = await call<{ connection?: ProviderConnection } & ProviderConnection>(
      api.put(`${providerBase}/${encodeURIComponent(id)}/secret`, { apiKey }),
    )
    return result.connection ?? result
  },

  async testConnection(id: string, model?: string): Promise<ProviderConnectionTestResult> {
    return call<ProviderConnectionTestResult>(
      api.post(`${providerBase}/${encodeURIComponent(id)}/test`, model ? { model } : {}),
    )
  },

  async discoverModels(id: string): Promise<DiscoveredModel[]> {
    const result = await call<unknown>(
      api.get(`${providerBase}/${encodeURIComponent(id)}/models`),
    )
    return normalizeDiscoveredModels(result)
  },

  async listModelConfigs(): Promise<ModelConfigListResult> {
    return call<ModelConfigListResult>(api.get(modelBase))
  },

  async createModelConfig(input: SaveModelConfigInput): Promise<AiModelConfig> {
    const result = await call<{ model?: AiModelConfig; modelConfig?: AiModelConfig } & AiModelConfig>(
      api.post(modelBase, input),
    )
    return result.modelConfig ?? result.model ?? result
  },

  async updateModelConfig(id: string, input: UpdateModelConfigInput): Promise<AiModelConfig> {
    return call<AiModelConfig>(api.patch(`${modelBase}/${encodeURIComponent(id)}`, input))
  },

  async cloneModelConfig(id: string): Promise<AiModelConfig> {
    const result = await call<{ model?: AiModelConfig; modelConfig?: AiModelConfig } & AiModelConfig>(
      api.post(`${modelBase}/${encodeURIComponent(id)}/clone`, {}),
    )
    return result.modelConfig ?? result.model ?? result
  },

  async testModelConfig(id: string): Promise<ModelConfigTestResult> {
    return call<ModelConfigTestResult>(api.post(`${modelBase}/${encodeURIComponent(id)}/test`, {}))
  },

  async submitModelConfig(id: string): Promise<AiModelConfig> {
    return call<AiModelConfig>(api.post(`${modelBase}/${encodeURIComponent(id)}/submit`, {}))
  },

  async approveModelConfig(id: string): Promise<AiModelConfig> {
    return call<AiModelConfig>(api.post(`${modelBase}/${encodeURIComponent(id)}/approve`, {}))
  },

  async archiveModelConfig(id: string): Promise<AiModelConfig> {
    return call<AiModelConfig>(api.post(`${modelBase}/${encodeURIComponent(id)}/archive`, {}))
  },

  async getModelConfigImpact(id: string): Promise<ModelConfigImpact> {
    return call<ModelConfigImpact>(api.get(`${modelBase}/${encodeURIComponent(id)}/impact`))
  },

  async setDefaultModelConfig(id: string, expectedRevision: string | null): Promise<SetDefaultModelResult> {
    return call<SetDefaultModelResult>(
      api.post(`${modelBase}/${encodeURIComponent(id)}/default`, { expectedRevision }),
    )
  },
}
