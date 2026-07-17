import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import {
  ProviderConnectionError,
  testProviderConnection,
} from './provider-connection-service.js';

export const MODEL_CONFIG_STATUSES = ['draft', 'testing', 'submitted', 'approved', 'archived'] as const;
export type ModelConfigStatus = (typeof MODEL_CONFIG_STATUSES)[number];

export type ModelConfigActor = { orgId: string; userId: string };

export type CreateModelConfigInput = {
  connectionId?: unknown;
  logicalKey?: unknown;
  displayName?: unknown;
  externalModelId?: unknown;
  parameters?: unknown;
  capabilities?: unknown;
  dataPolicy?: unknown;
  fallbackModelConfigId?: unknown;
  changeNote?: unknown;
};

export type UpdateModelConfigInput = CreateModelConfigInput & {
  expectedRevision?: unknown;
};

export class ModelConfigError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'AI_MODEL_CONFIG_ERROR',
  ) {
    super(message);
    this.name = 'ModelConfigError';
  }
}
