import type { AdminAuditAction } from '../admin-audit-log.js';
import type * as ControlPlaneStore from '../control-plane-store.js';

export type AdminMutationResponseBody = Record<string, unknown>;

export interface AdminMutationBeginInput {
  idempotencyKey: string | null;
  routeId: string;
  requestPayload: unknown;
}

export interface AdminMutationReadyResult {
  kind: 'ready';
  idempotencyKey: string | null;
  requestHash: string;
}

export interface AdminMutationReplayResult {
  kind: 'replay';
  statusCode: number;
  responseBody: unknown;
  headers: Record<string, string>;
}

export interface AdminMutationConflictResult {
  kind: 'conflict';
  statusCode: 409;
  responseBody: AdminMutationResponseBody;
}

export type AdminMutationBeginResult =
  | AdminMutationReadyResult
  | AdminMutationReplayResult
  | AdminMutationConflictResult;

export interface AdminMutationFinalizationInput {
  idempotencyKey: string | null;
  routeId: string;
  requestPayload: unknown;
  statusCode: number;
  responseBody: AdminMutationResponseBody;
  audit: {
    action: AdminAuditAction;
    accountId?: string | null;
    tenantId?: string | null;
    tenantKeyId?: string | null;
    planId?: string | null;
    monthlyRunQuota?: number | null;
    requestHash?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface AdminMutationService {
  begin(input: AdminMutationBeginInput): Promise<AdminMutationBeginResult>;
  finalize(input: AdminMutationFinalizationInput): Promise<AdminMutationResponseBody>;
}

export interface AdminMutationServiceDeps {
  hashJsonValue(value: unknown): string;
  lookupAdminIdempotencyState: typeof ControlPlaneStore.lookupAdminIdempotencyState;
  recordAdminIdempotencyState: typeof ControlPlaneStore.recordAdminIdempotencyState;
  appendAdminAuditRecordState: typeof ControlPlaneStore.appendAdminAuditRecordState;
}

export function createAdminMutationService(deps: AdminMutationServiceDeps): AdminMutationService {
  return {
    async begin(input) {
      if (!input.idempotencyKey) {
        return {
          kind: 'ready',
          idempotencyKey: null,
          requestHash: deps.hashJsonValue({
            routeId: input.routeId,
            payload: input.requestPayload,
          }),
        };
      }

      const lookup = await deps.lookupAdminIdempotencyState({
        idempotencyKey: input.idempotencyKey,
        routeId: input.routeId,
        requestPayload: input.requestPayload,
      });

      if (lookup.kind === 'conflict') {
        return {
          kind: 'conflict',
          statusCode: 409,
          responseBody: {
            error: `Idempotency-Key '${input.idempotencyKey}' was already used for a different admin mutation.`,
            routeId: lookup.record.routeId,
            createdAt: lookup.record.createdAt,
          },
        };
      }

      if (lookup.kind === 'replay') {
        return {
          kind: 'replay',
          statusCode: lookup.record.statusCode,
          responseBody: lookup.response,
          headers: {
            'content-type': 'application/json; charset=UTF-8',
            'x-attestor-idempotent-replay': 'true',
            'x-attestor-idempotency-key': input.idempotencyKey,
          },
        };
      }

      return {
        kind: 'ready',
        idempotencyKey: input.idempotencyKey,
        requestHash: lookup.requestHash,
      };
    },

    async finalize(input) {
      if (input.idempotencyKey) {
        await deps.recordAdminIdempotencyState({
          idempotencyKey: input.idempotencyKey,
          routeId: input.routeId,
          requestPayload: input.requestPayload,
          statusCode: input.statusCode,
          response: input.responseBody,
        });
      }

      await deps.appendAdminAuditRecordState({
        actorType: 'admin_api_key',
        actorLabel: 'ATTESTOR_ADMIN_API_KEY',
        action: input.audit.action,
        routeId: input.routeId,
        accountId: input.audit.accountId ?? null,
        tenantId: input.audit.tenantId ?? null,
        tenantKeyId: input.audit.tenantKeyId ?? null,
        planId: input.audit.planId ?? null,
        monthlyRunQuota: input.audit.monthlyRunQuota ?? null,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.audit.requestHash ?? '',
        metadata: input.audit.metadata ?? {},
      });

      return input.responseBody;
    },
  };
}
