import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withFileLock, writeTextFileAtomic } from '../platform/file-store.js';
import type { ReleaseActorReference } from '../release-layer/index.js';
import type {
  EnforcementBreakGlassGrant,
  EnforcementRequest,
  VerificationResult,
} from './object-model.js';
import type {
  EnforcementBoundaryKind,
  EnforcementBreakGlassReason,
  EnforcementCacheState,
  EnforcementDegradedState,
  EnforcementFailureReason,
  EnforcementOutcome,
  EnforcementPointKind,
  ReleaseEnforcementConsequenceType,
  ReleaseEnforcementRiskClass,
} from './types.js';
import {
  ENFORCEMENT_BOUNDARY_KINDS,
  ENFORCEMENT_BREAK_GLASS_REASONS,
  ENFORCEMENT_FAILURE_REASONS,
  ENFORCEMENT_POINT_KINDS,
} from './types.js';

export const RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION =
  'attestor.release-enforcement-degraded-mode.v1';

export const DEFAULT_CACHE_ONLY_MAX_TTL_SECONDS = 10 * 60;
export const DEFAULT_BREAK_GLASS_MAX_TTL_SECONDS = 30 * 60;
export const DEFAULT_DEGRADED_MODE_MAX_USES = 1;

export const DEFAULT_DEGRADED_MODE_ALLOWED_FAILURE_REASONS = Object.freeze([
  'introspection-unavailable',
  'fresh-introspection-required',
] as const satisfies readonly EnforcementFailureReason[]);

export const CACHE_ONLY_ACCEPTED_CACHE_STATES = Object.freeze([
  'fresh',
  'stale-allowed',
] as const satisfies readonly EnforcementCacheState[]);

export type DegradedModeGrantState = Extract<
  EnforcementDegradedState,
  'cache-only' | 'break-glass-open'
>;

export type DegradedModeGrantStatus =
  | 'active'
  | 'not-yet-valid'
  | 'expired'
  | 'revoked'
  | 'exhausted';

export type DegradedModeDecisionStatus =
  | 'normal'
  | 'fail-closed'
  | 'cache-only-allow'
  | 'break-glass-allow'
  | 'break-glass-required';

export type DegradedModeAuditAction =
  | 'grant-created'
  | 'grant-used'
  | 'grant-denied'
  | 'grant-revoked';

export interface DegradedModeScope {
  readonly environment?: string | null;
  readonly enforcementPointId?: string | null;
  readonly pointKind?: EnforcementPointKind | null;
  readonly boundaryKind?: EnforcementBoundaryKind | null;
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly workloadId?: string | null;
  readonly audience?: string | null;
  readonly targetId?: string | null;
  readonly consequenceType?: ReleaseEnforcementConsequenceType | null;
  readonly riskClass?: ReleaseEnforcementRiskClass | null;
}

export interface CreateDegradedModeGrantInput {
  readonly id?: string;
  readonly state: DegradedModeGrantState;
  readonly reason: EnforcementBreakGlassReason;
  readonly scope?: DegradedModeScope | null;
  readonly authorizedBy: ReleaseActorReference;
  readonly approvedBy?: readonly ReleaseActorReference[];
  readonly authorizedAt?: string;
  readonly startsAt?: string;
  readonly expiresAt?: string;
  readonly ttlSeconds?: number;
  readonly maxTtlSeconds?: number;
  readonly ticketId: string;
  readonly rationale: string;
  readonly allowedFailureReasons?: readonly EnforcementFailureReason[];
  readonly maxUses?: number;
  readonly remainingUses?: number;
}

export interface DegradedModeGrant {
  readonly version: typeof RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION;
  readonly id: string;
  readonly state: DegradedModeGrantState;
  readonly reason: EnforcementBreakGlassReason;
  readonly scope: DegradedModeScope;
  readonly authorizedBy: ReleaseActorReference;
  readonly approvedBy: readonly ReleaseActorReference[];
  readonly authorizedAt: string;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly ticketId: string;
  readonly rationale: string;
  readonly allowedFailureReasons: readonly EnforcementFailureReason[];
  readonly maxUses: number;
  readonly remainingUses: number;
  readonly auditDigest: string;
  readonly revokedAt: string | null;
  readonly revokedBy: ReleaseActorReference | null;
  readonly revocationReason: string | null;
}

export interface DegradedModeAuditRecord {
  readonly version: typeof RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION;
  readonly id: string;
  readonly action: DegradedModeAuditAction;
  readonly grantId: string;
  readonly recordedAt: string;
  readonly actor: ReleaseActorReference | null;
  readonly state: DegradedModeGrantState;
  readonly scope: DegradedModeScope;
  readonly reason: EnforcementBreakGlassReason;
  readonly ticketId: string;
  readonly expiresAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly outcome: EnforcementOutcome | null;
  readonly remainingUses: number;
  readonly previousDigest: string | null;
  readonly digest: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface EvaluateDegradedModeInput {
  readonly checkedAt: string;
  readonly grant?: DegradedModeGrant | null;
  readonly request?: EnforcementRequest | null;
  readonly scope?: DegradedModeScope | null;
  readonly verification?: VerificationResult | null;
  readonly failureReasons?: readonly EnforcementFailureReason[];
}

export interface DegradedModeDecision {
  readonly version: typeof RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION;
  readonly checkedAt: string;
  readonly status: DegradedModeDecisionStatus;
  readonly degradedState: EnforcementDegradedState;
  readonly outcome: EnforcementOutcome;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly grant: DegradedModeGrant | null;
  readonly breakGlass: EnforcementBreakGlassGrant | null;
  readonly grantStatus: DegradedModeGrantStatus | null;
  readonly auditRecord: DegradedModeAuditRecord | null;
}

export interface ListDegradedModeGrantOptions {
  readonly status?: DegradedModeGrantStatus | 'all';
  readonly checkedAt?: string;
  readonly scope?: DegradedModeScope | null;
}

export interface RevokeDegradedModeGrantInput {
  readonly id: string;
  readonly revokedAt: string;
  readonly revokedBy: ReleaseActorReference;
  readonly revocationReason: string;
}

export interface ConsumeDegradedModeGrantInput {
  readonly id: string;
  readonly checkedAt: string;
  readonly actor?: ReleaseActorReference | null;
  readonly failureReasons?: readonly EnforcementFailureReason[];
  readonly outcome?: EnforcementOutcome | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DegradedModeGrantStore {
  registerGrant(grant: DegradedModeGrant): DegradedModeGrant;
  findGrant(id: string): DegradedModeGrant | null;
  listGrants(options?: ListDegradedModeGrantOptions): readonly DegradedModeGrant[];
  revokeGrant(input: RevokeDegradedModeGrantInput): DegradedModeGrant | null;
  consumeGrant(input: ConsumeDegradedModeGrantInput): DegradedModeGrant | null;
  listAuditRecords(): readonly DegradedModeAuditRecord[];
  auditHead(): string | null;
}

interface DegradedModeGrantStoreFile {
  readonly version: 1;
  grants: DegradedModeGrant[];
  auditRecords: DegradedModeAuditRecord[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(',')}}`;
}

function sha256Digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) {
    throw new Error(`Release enforcement-plane degraded mode ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(
      `Release enforcement-plane degraded mode ${fieldName} cannot be blank when provided.`,
    );
  }
  return normalized;
}

function normalizeOptionalEnum<T extends readonly string[]>(
  value: T[number] | string | null | undefined,
  allowed: T,
  fieldName: string,
): T[number] | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!allowed.includes(value)) {
    throw new Error(`Release enforcement-plane degraded mode ${fieldName} has unknown value: ${value}`);
  }
  return value;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Release enforcement-plane degraded mode ${fieldName} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeActor(actor: ReleaseActorReference, fieldName: string): ReleaseActorReference {
  const type = actor.type;
  if (type !== 'user' && type !== 'service' && type !== 'system') {
    throw new Error(
      `Release enforcement-plane degraded mode ${fieldName}.type must be user, service, or system.`,
    );
  }

  return Object.freeze({
    id: normalizeIdentifier(actor.id, `${fieldName}.id`),
    type,
    ...(actor.displayName ? { displayName: actor.displayName.trim() } : {}),
    ...(actor.role ? { role: actor.role.trim() } : {}),
  });
}

function normalizeScope(scope: DegradedModeScope | null | undefined): DegradedModeScope {
  const normalized = {
    environment: normalizeOptionalIdentifier(scope?.environment, 'scope.environment'),
    enforcementPointId: normalizeOptionalIdentifier(
      scope?.enforcementPointId,
      'scope.enforcementPointId',
    ),
    pointKind: normalizeOptionalEnum(scope?.pointKind, ENFORCEMENT_POINT_KINDS, 'scope.pointKind'),
    boundaryKind: normalizeOptionalEnum(
      scope?.boundaryKind,
      ENFORCEMENT_BOUNDARY_KINDS,
      'scope.boundaryKind',
    ),
    tenantId: normalizeOptionalIdentifier(scope?.tenantId, 'scope.tenantId'),
    accountId: normalizeOptionalIdentifier(scope?.accountId, 'scope.accountId'),
    workloadId: normalizeOptionalIdentifier(scope?.workloadId, 'scope.workloadId'),
    audience: normalizeOptionalIdentifier(scope?.audience, 'scope.audience'),
    targetId: normalizeOptionalIdentifier(scope?.targetId, 'scope.targetId'),
    consequenceType: scope?.consequenceType ?? null,
    riskClass: scope?.riskClass ?? null,
  };

  if (normalized.accountId && !normalized.tenantId) {
    throw new Error(
      'Release enforcement-plane degraded mode account scope also requires tenant scope.',
    );
  }

  return Object.freeze(normalized);
}

function normalizeFailureReasons(
  reasons: readonly EnforcementFailureReason[] | null | undefined,
  fieldName = 'allowedFailureReasons',
  allowEmpty = false,
): readonly EnforcementFailureReason[] {
  const selected = reasons ?? DEFAULT_DEGRADED_MODE_ALLOWED_FAILURE_REASONS;
  const unique = new Set<EnforcementFailureReason>();
  for (const reason of selected) {
    if (!(ENFORCEMENT_FAILURE_REASONS as readonly string[]).includes(reason)) {
      throw new Error(`Release enforcement-plane degraded mode ${fieldName} has unknown reason: ${reason}`);
    }
    unique.add(reason);
  }

  if (!allowEmpty && unique.size === 0) {
    throw new Error(`Release enforcement-plane degraded mode ${fieldName} requires at least one reason.`);
  }

  return Object.freeze([...unique]);
}

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  return Object.freeze([...new Set(reasons)]);
}

function assertReason(reason: EnforcementBreakGlassReason): void {
  if (!(ENFORCEMENT_BREAK_GLASS_REASONS as readonly string[]).includes(reason)) {
    throw new Error(`Release enforcement-plane degraded mode unknown break-glass reason: ${reason}`);
  }
}

function defaultMaxTtlSeconds(state: DegradedModeGrantState): number {
  return state === 'cache-only'
    ? DEFAULT_CACHE_ONLY_MAX_TTL_SECONDS
    : DEFAULT_BREAK_GLASS_MAX_TTL_SECONDS;
}

function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  fieldName: string,
): number {
  const selected = value ?? defaultValue;
  if (!Number.isInteger(selected) || selected <= 0) {
    throw new Error(`Release enforcement-plane degraded mode ${fieldName} must be a positive integer.`);
  }
  return selected;
}

function createGrantDigest(input: Omit<DegradedModeGrant, 'auditDigest'>): string {
  return sha256Digest({
    version: input.version,
    id: input.id,
    state: input.state,
    reason: input.reason,
    scope: input.scope,
    authorizedBy: input.authorizedBy,
    approvedBy: input.approvedBy,
    authorizedAt: input.authorizedAt,
    startsAt: input.startsAt,
    expiresAt: input.expiresAt,
    ticketId: input.ticketId,
    rationale: input.rationale,
    allowedFailureReasons: input.allowedFailureReasons,
    maxUses: input.maxUses,
    remainingUses: input.remainingUses,
    revokedAt: input.revokedAt,
    revokedBy: input.revokedBy,
    revocationReason: input.revocationReason,
  });
}

export function createDegradedModeGrantId(): string {
  return `dmg_${randomUUID().replaceAll('-', '')}`;
}

export function createDegradedModeGrant(input: CreateDegradedModeGrantInput): DegradedModeGrant {
  if (input.state !== 'cache-only' && input.state !== 'break-glass-open') {
    throw new Error(
      'Release enforcement-plane degraded mode grant state must be cache-only or break-glass-open.',
    );
  }
  assertReason(input.reason);

  const authorizedAt = normalizeIsoTimestamp(
    input.authorizedAt ?? new Date().toISOString(),
    'authorizedAt',
  );
  const startsAt = normalizeIsoTimestamp(input.startsAt ?? authorizedAt, 'startsAt');
  const maxTtlSeconds = normalizePositiveInteger(
    input.maxTtlSeconds,
    defaultMaxTtlSeconds(input.state),
    'maxTtlSeconds',
  );
  const ttlSeconds =
    input.expiresAt === undefined
      ? normalizePositiveInteger(input.ttlSeconds, maxTtlSeconds, 'ttlSeconds')
      : null;
  const expiresAt = normalizeIsoTimestamp(
    input.expiresAt ??
      new Date(new Date(startsAt).getTime() + (ttlSeconds ?? maxTtlSeconds) * 1000).toISOString(),
    'expiresAt',
  );
  const startsAtMs = new Date(startsAt).getTime();
  const expiresAtMs = new Date(expiresAt).getTime();
  if (expiresAtMs <= startsAtMs) {
    throw new Error('Release enforcement-plane degraded mode grant expiresAt must be after startsAt.');
  }
  if (expiresAtMs - startsAtMs > maxTtlSeconds * 1000) {
    throw new Error(
      `Release enforcement-plane degraded mode grant ttl cannot exceed ${maxTtlSeconds} seconds.`,
    );
  }

  const maxUses = normalizePositiveInteger(
    input.maxUses,
    DEFAULT_DEGRADED_MODE_MAX_USES,
    'maxUses',
  );
  const remainingUses = normalizePositiveInteger(
    input.remainingUses,
    maxUses,
    'remainingUses',
  );
  if (remainingUses > maxUses) {
    throw new Error('Release enforcement-plane degraded mode remainingUses cannot exceed maxUses.');
  }

  const withoutDigest: Omit<DegradedModeGrant, 'auditDigest'> = Object.freeze({
    version: RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
    id: normalizeIdentifier(input.id ?? createDegradedModeGrantId(), 'id'),
    state: input.state,
    reason: input.reason,
    scope: normalizeScope(input.scope),
    authorizedBy: normalizeActor(input.authorizedBy, 'authorizedBy'),
    approvedBy: Object.freeze((input.approvedBy ?? []).map((actor) => normalizeActor(actor, 'approvedBy'))),
    authorizedAt,
    startsAt,
    expiresAt,
    ticketId: normalizeIdentifier(input.ticketId, 'ticketId'),
    rationale: normalizeIdentifier(input.rationale, 'rationale'),
    allowedFailureReasons: normalizeFailureReasons(input.allowedFailureReasons),
    maxUses,
    remainingUses,
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
  });

  return Object.freeze({
    ...withoutDigest,
    auditDigest: createGrantDigest(withoutDigest),
  });
}

export function degradedModeGrantStatus(
  grant: DegradedModeGrant,
  checkedAt: string,
): DegradedModeGrantStatus {
  if (grant.revokedAt !== null) {
    return 'revoked';
  }
  if (grant.remainingUses <= 0) {
    return 'exhausted';
  }
  const checkedAtMs = new Date(normalizeIsoTimestamp(checkedAt, 'checkedAt')).getTime();
  const startsAtMs = new Date(grant.startsAt).getTime();
  const expiresAtMs = new Date(grant.expiresAt).getTime();
  if (checkedAtMs < startsAtMs) {
    return 'not-yet-valid';
  }
  if (checkedAtMs >= expiresAtMs) {
    return 'expired';
  }
  return 'active';
}

export function degradedModeScopeFromRequest(request: EnforcementRequest): DegradedModeScope {
  return Object.freeze({
    environment: request.enforcementPoint.environment,
    enforcementPointId: request.enforcementPoint.enforcementPointId,
    pointKind: request.enforcementPoint.pointKind,
    boundaryKind: request.enforcementPoint.boundaryKind,
    tenantId: request.enforcementPoint.tenantId,
    accountId: request.enforcementPoint.accountId,
    workloadId: request.enforcementPoint.workloadId,
    audience: request.enforcementPoint.audience,
    targetId: request.targetId,
    consequenceType: request.enforcementPoint.consequenceType,
    riskClass: request.enforcementPoint.riskClass,
  });
}

function scopeFieldMatches<T>(
  grantValue: T | null | undefined,
  requestValue: T | null | undefined,
): boolean {
  return grantValue === null || grantValue === undefined || grantValue === requestValue;
}

export function degradedModeScopeMatches(
  grantScope: DegradedModeScope,
  requestScope: DegradedModeScope | null | undefined,
): boolean {
  if (!requestScope) {
    return Object.values(grantScope).every((value) => value === null || value === undefined);
  }

  return (
    scopeFieldMatches(grantScope.environment, requestScope.environment) &&
    scopeFieldMatches(grantScope.enforcementPointId, requestScope.enforcementPointId) &&
    scopeFieldMatches(grantScope.pointKind, requestScope.pointKind) &&
    scopeFieldMatches(grantScope.boundaryKind, requestScope.boundaryKind) &&
    scopeFieldMatches(grantScope.tenantId, requestScope.tenantId) &&
    scopeFieldMatches(grantScope.accountId, requestScope.accountId) &&
    scopeFieldMatches(grantScope.workloadId, requestScope.workloadId) &&
    scopeFieldMatches(grantScope.audience, requestScope.audience) &&
    scopeFieldMatches(grantScope.targetId, requestScope.targetId) &&
    scopeFieldMatches(grantScope.consequenceType, requestScope.consequenceType) &&
    scopeFieldMatches(grantScope.riskClass, requestScope.riskClass)
  );
}

export function degradedModeGrantView(grant: DegradedModeGrant): Record<string, unknown> {
  return Object.freeze({
    version: grant.version,
    id: grant.id,
    state: grant.state,
    reason: grant.reason,
    scope: grant.scope,
    authorizedBy: grant.authorizedBy,
    approvedBy: grant.approvedBy,
    authorizedAt: grant.authorizedAt,
    startsAt: grant.startsAt,
    expiresAt: grant.expiresAt,
    ticketId: grant.ticketId,
    rationale: grant.rationale,
    allowedFailureReasons: grant.allowedFailureReasons,
    maxUses: grant.maxUses,
    remainingUses: grant.remainingUses,
    status: degradedModeGrantStatus(grant, new Date().toISOString()),
    auditDigest: grant.auditDigest,
    revokedAt: grant.revokedAt,
    revokedBy: grant.revokedBy,
    revocationReason: grant.revocationReason,
  });
}

export function grantToBreakGlassGrant(grant: DegradedModeGrant): EnforcementBreakGlassGrant {
  return Object.freeze({
    reason: grant.reason,
    authorizedBy: grant.authorizedBy,
    authorizedAt: grant.authorizedAt,
    expiresAt: grant.expiresAt,
    ticketId: grant.ticketId,
    rationale: grant.rationale,
  });
}

function cacheStateAllowsDegradedMode(verification: VerificationResult | null | undefined): boolean {
  if (!verification) {
    return false;
  }
  if (verification.status === 'invalid') {
    return false;
  }
  return (CACHE_ONLY_ACCEPTED_CACHE_STATES as readonly EnforcementCacheState[]).includes(
    verification.cacheState,
  );
}

function allFailuresAllowed(
  failures: readonly EnforcementFailureReason[],
  allowed: readonly EnforcementFailureReason[],
): boolean {
  const allowedSet = new Set(allowed);
  return failures.length > 0 && failures.every((reason) => allowedSet.has(reason));
}

function emptyDecision(input: EvaluateDegradedModeInput): DegradedModeDecision {
  return Object.freeze({
    version: RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
    checkedAt: normalizeIsoTimestamp(input.checkedAt, 'checkedAt'),
    status: 'normal',
    degradedState: 'normal',
    outcome: 'allow',
    failureReasons: Object.freeze([]),
    grant: null,
    breakGlass: null,
    grantStatus: null,
    auditRecord: null,
  });
}

function failClosedDecision(input: {
  readonly checkedAt: string;
  readonly status: DegradedModeDecisionStatus;
  readonly failures: readonly EnforcementFailureReason[];
  readonly grant: DegradedModeGrant | null;
  readonly grantStatus: DegradedModeGrantStatus | null;
}): DegradedModeDecision {
  return Object.freeze({
    version: RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
    checkedAt: normalizeIsoTimestamp(input.checkedAt, 'checkedAt'),
    status: input.status,
    degradedState: 'fail-closed',
    outcome: 'deny',
    failureReasons: uniqueFailureReasons([...input.failures, 'break-glass-required']),
    grant: input.grant,
    breakGlass: null,
    grantStatus: input.grantStatus,
    auditRecord: null,
  });
}

export function evaluateDegradedMode(input: EvaluateDegradedModeInput): DegradedModeDecision {
  const checkedAt = normalizeIsoTimestamp(input.checkedAt, 'checkedAt');
  const failures = normalizeFailureReasons(
    input.failureReasons ?? input.verification?.failureReasons ?? [],
    'failureReasons',
    true,
  );

  if (failures.length === 0 && input.verification?.status !== 'invalid') {
    return emptyDecision({ ...input, checkedAt });
  }

  const grant = input.grant ?? null;
  if (!grant) {
    return failClosedDecision({
      checkedAt,
      status: 'break-glass-required',
      failures,
      grant: null,
      grantStatus: null,
    });
  }

  const grantStatus = degradedModeGrantStatus(grant, checkedAt);
  const requestScope = normalizeScope(input.scope ?? (input.request ? degradedModeScopeFromRequest(input.request) : null));
  if (
    grantStatus !== 'active' ||
    !degradedModeScopeMatches(grant.scope, requestScope) ||
    !allFailuresAllowed(failures, grant.allowedFailureReasons)
  ) {
    return failClosedDecision({
      checkedAt,
      status: 'fail-closed',
      failures,
      grant,
      grantStatus,
    });
  }

  if (grant.state === 'cache-only') {
    if (!cacheStateAllowsDegradedMode(input.verification)) {
      return failClosedDecision({
        checkedAt,
        status: 'fail-closed',
        failures,
        grant,
        grantStatus,
      });
    }
    return Object.freeze({
      version: RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
      checkedAt,
      status: 'cache-only-allow',
      degradedState: 'cache-only',
      outcome: 'allow',
      failureReasons: failures,
      grant,
      breakGlass: null,
      grantStatus,
      auditRecord: null,
    });
  }

  return Object.freeze({
    version: RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
    checkedAt,
    status: 'break-glass-allow',
    degradedState: 'break-glass-open',
    outcome: 'break-glass-allow',
    failureReasons: failures,
    grant,
    breakGlass: grantToBreakGlassGrant(grant),
    grantStatus,
    auditRecord: null,
  });
}

function createAuditRecord(input: {
  readonly id?: string;
  readonly action: DegradedModeAuditAction;
  readonly grant: DegradedModeGrant;
  readonly recordedAt: string;
  readonly actor?: ReleaseActorReference | null;
  readonly failureReasons?: readonly EnforcementFailureReason[];
  readonly outcome?: EnforcementOutcome | null;
  readonly remainingUses: number;
  readonly previousDigest: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): DegradedModeAuditRecord {
  const recordWithoutDigest: Omit<DegradedModeAuditRecord, 'digest'> = {
    version: RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
    id: input.id ?? `dma_${randomUUID().replaceAll('-', '')}`,
    action: input.action,
    grantId: input.grant.id,
    recordedAt: normalizeIsoTimestamp(input.recordedAt, 'recordedAt'),
    actor: input.actor ? normalizeActor(input.actor, 'audit.actor') : null,
    state: input.grant.state,
    scope: input.grant.scope,
    reason: input.grant.reason,
    ticketId: input.grant.ticketId,
    expiresAt: input.grant.expiresAt,
    failureReasons: normalizeFailureReasons(input.failureReasons ?? [], 'audit.failureReasons', true),
    outcome: input.outcome ?? null,
    remainingUses: input.remainingUses,
    previousDigest: input.previousDigest,
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  };

  return Object.freeze({
    ...recordWithoutDigest,
    digest: sha256Digest(recordWithoutDigest),
  });
}

function replaceGrantUseBudget(grant: DegradedModeGrant, remainingUses: number): DegradedModeGrant {
  const withoutDigest: Omit<DegradedModeGrant, 'auditDigest'> = Object.freeze({
    ...grant,
    remainingUses,
  });
  return Object.freeze({
    ...withoutDigest,
    auditDigest: createGrantDigest(withoutDigest),
  });
}

function replaceGrantRevocation(
  grant: DegradedModeGrant,
  input: RevokeDegradedModeGrantInput,
): DegradedModeGrant {
  const withoutDigest: Omit<DegradedModeGrant, 'auditDigest'> = Object.freeze({
    ...grant,
    revokedAt: normalizeIsoTimestamp(input.revokedAt, 'revokedAt'),
    revokedBy: normalizeActor(input.revokedBy, 'revokedBy'),
    revocationReason: normalizeIdentifier(input.revocationReason, 'revocationReason'),
  });
  return Object.freeze({
    ...withoutDigest,
    auditDigest: createGrantDigest(withoutDigest),
  });
}

function cloneGrant(grant: DegradedModeGrant): DegradedModeGrant {
  return Object.freeze(structuredClone(grant)) as DegradedModeGrant;
}

function cloneAuditRecord(record: DegradedModeAuditRecord): DegradedModeAuditRecord {
  return Object.freeze(structuredClone(record)) as DegradedModeAuditRecord;
}

function defaultDegradedModeGrantStoreFile(): DegradedModeGrantStoreFile {
  return {
    version: 1,
    grants: [],
    auditRecords: [],
  };
}

function loadDegradedModeGrantStoreFile(path: string): DegradedModeGrantStoreFile {
  if (!existsSync(path)) {
    return defaultDegradedModeGrantStoreFile();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as DegradedModeGrantStoreFile;
    if (
      parsed.version === 1 &&
      Array.isArray(parsed.grants) &&
      Array.isArray(parsed.auditRecords)
    ) {
      return parsed;
    }
  } catch {
    // fall through to safe default
  }
  return defaultDegradedModeGrantStoreFile();
}

function saveDegradedModeGrantStoreFile(path: string, file: DegradedModeGrantStoreFile): void {
  writeTextFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

function defaultDegradedModeGrantStorePath(): string {
  return resolve(
    process.env.ATTESTOR_RELEASE_ENFORCEMENT_DEGRADED_MODE_STORE_PATH ??
      '.attestor/release-enforcement-degraded-mode-store.json',
  );
}

function ensureDegradedModeGrantStoreDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function createDegradedModeGrantStoreFromAccessors(accessors: {
  readonly read: () => DegradedModeGrantStoreFile;
  readonly mutate: <T>(action: (file: DegradedModeGrantStoreFile) => T) => T;
}): DegradedModeGrantStore {
  function appendAudit(
    file: DegradedModeGrantStoreFile,
    input: Omit<Parameters<typeof createAuditRecord>[0], 'previousDigest'>,
  ): void {
    file.auditRecords.push(
      createAuditRecord({
        ...input,
        previousDigest: file.auditRecords.at(-1)?.digest ?? null,
      }),
    );
  }

  return Object.freeze({
    registerGrant(grant: DegradedModeGrant): DegradedModeGrant {
      const normalizedGrant = cloneGrant(grant);
      return accessors.mutate((file) => {
        if (file.grants.some((entry) => entry.id === normalizedGrant.id)) {
          throw new Error(`Release enforcement-plane degraded mode grant already exists: ${grant.id}`);
        }
        file.grants.push(normalizedGrant);
        appendAudit(file, {
          action: 'grant-created',
          grant: normalizedGrant,
          recordedAt: normalizedGrant.authorizedAt,
          actor: normalizedGrant.authorizedBy,
          failureReasons: normalizedGrant.allowedFailureReasons,
          outcome: null,
          remainingUses: normalizedGrant.remainingUses,
          metadata: { auditDigest: normalizedGrant.auditDigest },
        });
        return cloneGrant(normalizedGrant);
      });
    },
    findGrant(id: string): DegradedModeGrant | null {
      const grant = accessors.read().grants.find((entry) => entry.id === normalizeIdentifier(id, 'id'));
      return grant ? cloneGrant(grant) : null;
    },
    listGrants(options?: ListDegradedModeGrantOptions): readonly DegradedModeGrant[] {
      const checkedAt = options?.checkedAt ?? new Date().toISOString();
      const status = options?.status ?? 'all';
      const scope = options?.scope ? normalizeScope(options.scope) : null;
      return Object.freeze(
        accessors.read().grants.filter((grant) => {
          if (status !== 'all' && degradedModeGrantStatus(grant, checkedAt) !== status) {
            return false;
          }
          return scope ? degradedModeScopeMatches(grant.scope, scope) : true;
        }).map((grant) => cloneGrant(grant)),
      );
    },
    revokeGrant(input: RevokeDegradedModeGrantInput): DegradedModeGrant | null {
      return accessors.mutate((file) => {
        const id = normalizeIdentifier(input.id, 'id');
        const index = file.grants.findIndex((entry) => entry.id === id);
        if (index < 0) {
          return null;
        }
        const revoked = replaceGrantRevocation(file.grants[index], input);
        file.grants[index] = revoked;
        appendAudit(file, {
          action: 'grant-revoked',
          grant: revoked,
          recordedAt: revoked.revokedAt ?? input.revokedAt,
          actor: revoked.revokedBy,
          failureReasons: [],
          outcome: null,
          remainingUses: revoked.remainingUses,
          metadata: { revocationReason: revoked.revocationReason },
        });
        return cloneGrant(revoked);
      });
    },
    consumeGrant(input: ConsumeDegradedModeGrantInput): DegradedModeGrant | null {
      return accessors.mutate((file) => {
        const id = normalizeIdentifier(input.id, 'id');
        const index = file.grants.findIndex((entry) => entry.id === id);
        if (index < 0 || degradedModeGrantStatus(file.grants[index], input.checkedAt) !== 'active') {
          return null;
        }
        const consumed = replaceGrantUseBudget(file.grants[index], file.grants[index].remainingUses - 1);
        file.grants[index] = consumed;
        appendAudit(file, {
          action: 'grant-used',
          grant: consumed,
          recordedAt: input.checkedAt,
          actor: input.actor ?? null,
          failureReasons: input.failureReasons ?? [],
          outcome: input.outcome ?? null,
          remainingUses: consumed.remainingUses,
          metadata: input.metadata,
        });
        return cloneGrant(consumed);
      });
    },
    listAuditRecords(): readonly DegradedModeAuditRecord[] {
      return Object.freeze(accessors.read().auditRecords.map((record) => cloneAuditRecord(record)));
    },
    auditHead(): string | null {
      return accessors.read().auditRecords.at(-1)?.digest ?? null;
    },
  });
}

export function createInMemoryDegradedModeGrantStore(): DegradedModeGrantStore {
  let file = defaultDegradedModeGrantStoreFile();
  return createDegradedModeGrantStoreFromAccessors({
    read: () => file,
    mutate: (action) => {
      const workingCopy = structuredClone(file) as DegradedModeGrantStoreFile;
      const result = action(workingCopy);
      file = workingCopy;
      return result;
    },
  });
}

export function createFileBackedDegradedModeGrantStore(
  path = defaultDegradedModeGrantStorePath(),
): DegradedModeGrantStore {
  return createDegradedModeGrantStoreFromAccessors({
    read: () => {
      ensureDegradedModeGrantStoreDirectory(path);
      return withFileLock(path, () => loadDegradedModeGrantStoreFile(path));
    },
    mutate: (action) => {
      ensureDegradedModeGrantStoreDirectory(path);
      return withFileLock(path, () => {
        const file = loadDegradedModeGrantStoreFile(path);
        const result = action(file);
        saveDegradedModeGrantStoreFile(path, file);
        return result;
      });
    },
  });
}

export function resetFileBackedDegradedModeGrantStoreForTests(path?: string): void {
  const resolvedPath = path ?? defaultDegradedModeGrantStorePath();
  if (existsSync(resolvedPath)) {
    rmSync(resolvedPath, { force: true });
  }
  if (existsSync(`${resolvedPath}.lock`)) {
    rmSync(`${resolvedPath}.lock`, { recursive: true, force: true });
  }
}
