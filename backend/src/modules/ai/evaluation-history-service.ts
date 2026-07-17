import { prisma } from '../../shared/database/prisma-client.js';
import { EvaluationEngineError, type EvaluationTarget } from './evaluation-engine-service.js';

export const AI_EVALUATION_RUN_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type AiEvaluationRunStatus = (typeof AI_EVALUATION_RUN_STATUSES)[number];

export const AI_EVALUATION_TARGETS: EvaluationTarget[] = [
  'prompt',
  'model',
  'agent',
  'skill',
  'knowledge',
  'policy',
];

const CRITERIA = new Set([
  'accuracy',
  'groundedness',
  'policy_compliance',
  'tone',
  'emotion_appropriateness',
  'helpfulness',
  'sales_effectiveness',
  'conciseness',
  'hallucination',
  'privacy',
  'handoff_correctness',
]);

type HistoryFilters = {
  status?: AiEvaluationRunStatus;
  targetType?: EvaluationTarget;
  targetId?: string;
  limit?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringArray(value: unknown, maximum = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, 120))
    .slice(0, maximum);
}

function iso(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function safeConfig(value: unknown) {
  const source = record(value);
  const targetType = stringValue(source.targetType);
  return {
    targetType: targetType && AI_EVALUATION_TARGETS.includes(targetType as EvaluationTarget)
      ? targetType as EvaluationTarget
      : null,
    targetId: stringValue(source.targetId),
    threshold: numberValue(source.threshold),
    suite: stringValue(source.suite),
  };
}

function safeRunMetrics(value: unknown) {
  const source = record(value);
  return {
    averageScore: numberValue(source.averageScore),
    threshold: numberValue(source.threshold),
    passed: booleanValue(source.passed),
    criticalFailures: stringArray(source.criticalFailures),
    caseCount: numberValue(source.caseCount),
  };
}

function safeResultMetrics(value: unknown) {
  const source = record(value);
  const rawCriteria = record(source.criteria);
  const criteria = Object.fromEntries(
    Object.entries(rawCriteria)
      .filter(([key, score]) => CRITERIA.has(key) && numberValue(score) !== null)
      .map(([key, score]) => [key, numberValue(score)]),
  );
  return {
    criteria,
    policyViolations: stringArray(source.policyViolations, 50),
  };
}

const runSelect = {
  id: true,
  name: true,
  status: true,
  agentId: true,
  promptVersionId: true,
  modelConfigId: true,
  datasetVersion: true,
  config: true,
  metrics: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  agent: { select: { id: true, name: true, status: true } },
  promptVersion: {
    select: {
      id: true,
      version: true,
      status: true,
      prompt: { select: { key: true, name: true } },
    },
  },
  modelConfig: { select: { id: true, name: true, provider: true, model: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { results: true } },
} as const;

function serializeRun(row: any) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    agentId: row.agentId,
    promptVersionId: row.promptVersionId,
    modelConfigId: row.modelConfigId,
    datasetVersion: row.datasetVersion,
    config: safeConfig(row.config),
    metrics: safeRunMetrics(row.metrics),
    agent: row.agent
      ? { id: row.agent.id, name: row.agent.name, status: row.agent.status }
      : null,
    promptVersion: row.promptVersion
      ? {
          id: row.promptVersion.id,
          version: row.promptVersion.version,
          status: row.promptVersion.status,
          prompt: row.promptVersion.prompt
            ? { key: row.promptVersion.prompt.key, name: row.promptVersion.prompt.name }
            : null,
        }
      : null,
    modelConfig: row.modelConfig
      ? {
          id: row.modelConfig.id,
          name: row.modelConfig.name,
          provider: row.modelConfig.provider,
          model: row.modelConfig.model,
          status: row.modelConfig.status,
        }
      : null,
    createdBy: row.createdBy
      ? { id: row.createdBy.id, fullName: row.createdBy.fullName }
      : null,
    resultCount: row._count?.results ?? 0,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return 30;
  return Math.max(1, Math.min(100, Math.trunc(value!)));
}

export async function listEvaluationRuns(orgId: string, filters: HistoryFilters = {}) {
  const targetId = filters.targetId?.trim();
  if (filters.targetId !== undefined && !targetId) {
    throw new EvaluationEngineError('Evaluation target id is invalid', 400, 'EVALUATION_TARGET_INVALID');
  }

  const jsonFilters: Array<Record<string, unknown>> = [];
  if (filters.targetType) {
    jsonFilters.push({ config: { path: ['targetType'], equals: filters.targetType } });
  }
  if (targetId) {
    jsonFilters.push({ config: { path: ['targetId'], equals: targetId } });
  }

  const rows = await prisma.aiEvaluationRun.findMany({
    where: {
      orgId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(jsonFilters.length ? { AND: jsonFilters } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: normalizeLimit(filters.limit),
    select: runSelect,
  });

  return { runs: rows.map(serializeRun) };
}

export async function getEvaluationRun(orgId: string, runId: string) {
  const id = runId.trim();
  if (!id) {
    throw new EvaluationEngineError('Evaluation run id is required', 400, 'EVALUATION_RUN_ID_REQUIRED');
  }

  const row = await prisma.aiEvaluationRun.findFirst({
    where: { id, orgId },
    select: {
      ...runSelect,
      results: {
        orderBy: [{ evaluationCase: { key: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          status: true,
          score: true,
          metrics: true,
          errorCode: true,
          createdAt: true,
          updatedAt: true,
          evaluationCase: {
            select: { id: true, key: true, name: true, taskType: true, tags: true },
          },
        },
      },
    },
  });

  if (!row) {
    throw new EvaluationEngineError(
      'Evaluation run not found in this organization',
      404,
      'EVALUATION_RUN_NOT_FOUND',
    );
  }

  return {
    run: {
      ...serializeRun(row),
      results: row.results.map((result: any) => ({
        id: result.id,
        status: result.status,
        score: numberValue(result.score),
        metrics: safeResultMetrics(result.metrics),
        errorCode: stringValue(result.errorCode),
        evaluationCase: {
          id: result.evaluationCase.id,
          key: result.evaluationCase.key,
          name: result.evaluationCase.name,
          taskType: result.evaluationCase.taskType,
          tags: stringArray(result.evaluationCase.tags),
        },
        createdAt: iso(result.createdAt),
        updatedAt: iso(result.updatedAt),
      })),
    },
  };
}

export const evaluationHistoryInternals = {
  safeConfig,
  safeRunMetrics,
  safeResultMetrics,
};
