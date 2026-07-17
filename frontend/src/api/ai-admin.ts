// SPDX-License-Identifier: AGPL-3.0-or-later
// Typed API contract for AI administration readiness and provider probes.
import { api } from '@/api/index';

export type AiReadinessStatus =
  | 'disabled'
  | 'not_configured'
  | 'needs_test'
  | 'ready'
  | 'error';

export type AiReadinessCheckId =
  | 'ai_enabled'
  | 'provider_selected'
  | 'api_key'
  | 'base_url'
  | 'model_selected'
  | 'connection'
  | 'model_available';

export type AiReadinessCheckStatus = 'passed' | 'failed' | 'warning';
export type AiModelAvailabilityStatus = 'missing' | 'unverified' | 'available' | 'unavailable';
export type AiConnectionStatus = 'not_tested' | 'connected' | 'failed';

export interface AiReadinessCheck {
  id: AiReadinessCheckId;
  status: AiReadinessCheckStatus;
  message: string;
}

export interface AiReadinessResponse {
  ready: boolean;
  status: AiReadinessStatus;
  checkedAt: string;
  config: {
    enabled: boolean;
    provider: string | null;
    model: string | null;
  };
  provider: {
    id: string | null;
    name: string | null;
    configured: boolean;
    hasApiKey: boolean;
    baseUrlConfigured: boolean;
    /** Display-only endpoint metadata. The backend never returns the API key. */
    baseUrl: string | null;
  };
  model: {
    id: string | null;
    configured: boolean;
    status: AiModelAvailabilityStatus;
    available: boolean | null;
  };
  connection: {
    status: AiConnectionStatus;
    testedAt: string | null;
    latencyMs: number | null;
    errorCode: string | null;
  };
  checks: AiReadinessCheck[];
}

export interface AiProviderProbeResponse {
  ok: boolean;
  status: AiConnectionStatus;
  provider: string;
  model: string | null;
  modelAvailable: boolean | null;
  modelsCount: number;
  latencyMs: number | null;
  testedAt: string;
}

export async function getAiReadiness(signal?: AbortSignal): Promise<AiReadinessResponse> {
  const response = await api.get<AiReadinessResponse>('/ai/admin/readiness', { signal });
  return response.data;
}

export async function testAiProviderConnection(
  providerId: string,
  model?: string | null,
): Promise<AiProviderProbeResponse> {
  const response = await api.post<AiProviderProbeResponse>(
    `/ai/admin/providers/${encodeURIComponent(providerId)}/test`,
    model ? { model } : {},
  );
  return response.data;
}

