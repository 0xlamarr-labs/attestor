import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import {
  activationApprovals as controlPlaneActivationApprovals,
  activationRecords as controlPlaneActivationRecords,
  auditLog as controlPlaneAuditLog,
  bundleCache as controlPlaneBundleCache,
  impactSummary as controlPlaneImpactSummary,
  objectModel as controlPlaneObjectModel,
  simulation as controlPlaneSimulation,
  types as controlPlaneTypes,
  type PolicyActivationApprovalGateResult,
  type PolicyActivationApprovalRequest,
  type PolicyActivationApprovalState,
  type PolicyActivationApprovalStore,
  type PolicyMutationAuditEntry,
  type PolicyMutationAuditLogWriter,
  type PolicyBundleCacheDescriptor,
  type PolicyActivationRecord,
  type PolicyPackMetadata,
  type PolicyControlPlaneStore,
  type StoredPolicyBundleRecord,
  type UpsertStoredPolicyBundleInput,
  type PolicyActivationTarget,
  type PolicyBundleReference,
  type PolicyPackLifecycleState,
  type PolicyMutationAction,
} from '../../../release-policy-control-plane/index.js';
import type {
  ReleaseActorReference,
  ReleasePolicyRolloutMode,
} from '../../../release-layer/index.js';
import { vocabulary } from '../../../release-layer/index.js';
import type { AdminAuditAction } from '../../admin-audit-log.js';

const {
  activatePolicyBundle,
  findLatestActiveExactTargetActivation,
  freezePolicyActivationScope,
  rollbackPolicyActivation,
} = controlPlaneActivationRecords;
const {
  evaluatePolicyActivationApprovalGate,
  recordPolicyActivationApprovalDecision,
  requestPolicyActivationApproval,
} = controlPlaneActivationApprovals;
const {
  createPolicyMutationAuditSubjectFromActivation,
  createPolicyMutationAuditSubjectFromBundle,
  createPolicyMutationAuditSubjectFromPack,
} = controlPlaneAuditLog;
const {
  createPolicyBundleConditionalResponse,
  policyBundleCacheHeaders,
} = controlPlaneBundleCache;
const { createPolicyImpactApi } = controlPlaneImpactSummary;
const {
  createPolicyControlPlaneMetadata,
  createPolicyPackMetadata,
} = controlPlaneObjectModel;
const { createPolicySimulationApi } = controlPlaneSimulation;
const {
  POLICY_PACK_LIFECYCLE_STATES,
  createPolicyActivationTarget,
} = controlPlaneTypes;

type JsonRecord = Record<string, unknown>;

type RouteDeps = {
  currentAdminAuthorized(c: Context): Response | null;
  policyControlPlaneStore: PolicyControlPlaneStore;
  policyActivationApprovalStore: PolicyActivationApprovalStore;
  policyMutationAuditLog: PolicyMutationAuditLogWriter;
  adminMutationRequest?: (
    c: Context,
    routeId: string,
    requestPayload: unknown,
  ) => Promise<{ idempotencyKey: string | null; requestHash: string } | Response>;
  finalizeAdminMutation?: (options: {
    idempotencyKey: string | null;
    routeId: string;
    requestPayload: unknown;
    statusCode: number;
    responseBody: Record<string, unknown>;
    audit: {
      action: AdminAuditAction;
      accountId?: string | null;
      tenantId?: string | null;
      requestHash?: string;
      metadata?: Record<string, unknown>;
    };
  }) => Promise<Record<string, unknown>>;
};

const ROLLOUT_MODES = ['dry-run', 'canary', 'enforce', 'rolled-back'] as const;
const BREAK_GLASS_ROLES = Object.freeze([
  'policy-break-glass',
  'security-admin',
  'incident-commander',
  'break-glass-admin',
]);

function noStore(c: Context): void {
  c.header('cache-control', 'no-store');
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(source: JsonRecord, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required and must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(source: JsonRecord, key: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string when provided.`);
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionalStringArray(source: JsonRecord, key: string): readonly string[] {
  const value = source[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${key} must be an array of strings when provided.`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean).sort();
}

function optionalConsequenceType(source: JsonRecord): string | null {
  const value = optionalString(source, 'consequenceType');
  if (value === null) {
    return null;
  }
  if (!(vocabulary.CONSEQUENCE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`consequenceType must be one of: ${vocabulary.CONSEQUENCE_TYPES.join(', ')}.`);
  }
  return value;
}

function optionalRiskClass(source: JsonRecord): string | null {
  const value = optionalString(source, 'riskClass');
  if (value === null) {
    return null;
  }
  if (!(vocabulary.RISK_CLASSES as readonly string[]).includes(value)) {
    throw new Error(`riskClass must be one of: ${vocabulary.RISK_CLASSES.join(', ')}.`);
  }
  return value;
}

function parseLifecycleState(value: unknown): PolicyPackLifecycleState | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    !(POLICY_PACK_LIFECYCLE_STATES as readonly string[]).includes(value)
  ) {
    throw new Error(`lifecycleState must be one of: ${POLICY_PACK_LIFECYCLE_STATES.join(', ')}.`);
  }
  return value as PolicyPackLifecycleState;
}

function parseBundleReference(value: unknown): PolicyBundleReference | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isJsonRecord(value)) {
    throw new Error('latestBundleRef must be an object when provided.');
  }
  return {
    packId: requiredString(value, 'packId'),
    bundleId: requiredString(value, 'bundleId'),
    bundleVersion: requiredString(value, 'bundleVersion'),
    digest: requiredString(value, 'digest'),
  };
}

function parsePackMetadata(value: unknown): PolicyPackMetadata {
  if (!isJsonRecord(value)) {
    throw new Error('pack must be an object.');
  }
  const now = new Date().toISOString();
  return createPolicyPackMetadata({
    id: requiredString(value, 'id'),
    name: requiredString(value, 'name'),
    description: optionalString(value, 'description'),
    lifecycleState: parseLifecycleState(value.lifecycleState),
    owners: optionalStringArray(value, 'owners'),
    labels: optionalStringArray(value, 'labels'),
    createdAt: optionalString(value, 'createdAt') ?? now,
    updatedAt: optionalString(value, 'updatedAt') ?? now,
    latestBundleRef: parseBundleReference(value.latestBundleRef),
  });
}

function parseActivationTarget(value: unknown): PolicyActivationTarget {
  if (!isJsonRecord(value)) {
    throw new Error('target must be an object.');
  }
  return createPolicyActivationTarget({
    environment: requiredString(value, 'environment'),
    tenantId: optionalString(value, 'tenantId'),
    accountId: optionalString(value, 'accountId'),
    domainId: optionalString(value, 'domainId'),
    wedgeId: optionalString(value, 'wedgeId'),
    consequenceType: (optionalConsequenceType(value) ?? undefined) as never,
    riskClass: (optionalRiskClass(value) ?? undefined) as never,
    cohortId: optionalString(value, 'cohortId'),
    planId: optionalString(value, 'planId'),
  });
}

function parseRolloutMode(value: unknown): ReleasePolicyRolloutMode {
  if (value === undefined || value === null) {
    return 'enforce';
  }
  if (typeof value !== 'string' || !(ROLLOUT_MODES as readonly string[]).includes(value)) {
    throw new Error(`rolloutMode must be one of: ${ROLLOUT_MODES.join(', ')}.`);
  }
  return value as ReleasePolicyRolloutMode;
}

function parseApprovalState(value: string | undefined): PolicyActivationApprovalState | null {
  if (value === undefined || value.trim().length === 0) return null;
  const normalized = value.trim();
  if (!['pending', 'approved', 'rejected'].includes(normalized)) {
    throw new Error('state must be one of: pending, approved, rejected.');
  }
  return normalized as PolicyActivationApprovalState;
}

async function parseJsonBody(c: Context): Promise<JsonRecord | Response> {
  try {
    const body = await c.req.json();
    if (!isJsonRecord(body)) {
      return c.json({ error: 'JSON request body must be an object.' }, 400);
    }
    return body;
  } catch {
    return c.json({ error: 'Valid JSON request body required.' }, 400);
  }
}

function packView(pack: PolicyPackMetadata): Record<string, unknown> {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    lifecycleState: pack.lifecycleState,
    owners: pack.owners,
    labels: pack.labels,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
    latestBundleRef: pack.latestBundleRef,
  };
}

function bundleSummaryView(record: StoredPolicyBundleRecord): Record<string, unknown> {
  return {
    packId: record.packId,
    bundleId: record.bundleId,
    bundleVersion: record.bundleVersion,
    storedAt: record.storedAt,
    entryCount: record.manifest.entries.length,
    payloadDigest: record.artifact.payloadDigest,
    packDigest: record.artifact.packDigest,
    manifestDigest: record.artifact.manifestDigest,
    entriesDigest: record.artifact.entriesDigest,
    signed: record.signedBundle !== null,
    keyId: record.verificationKey?.keyId ?? null,
    publicKeyFingerprint: record.verificationKey?.publicKeyFingerprint ?? null,
  };
}

function bundleDetailView(record: StoredPolicyBundleRecord, c: Context): Record<string, unknown> {
  const includeArtifact = c.req.query('includeArtifact') === 'true';
  const includeSignedBundle = c.req.query('includeSignedBundle') === 'true';
  return {
    ...bundleSummaryView(record),
    manifest: record.manifest,
    artifact: includeArtifact
      ? record.artifact
      : {
          version: record.artifact.version,
          bundleId: record.artifact.bundleId,
          packId: record.artifact.packId,
          payloadType: record.artifact.payloadType,
          payloadDigest: record.artifact.payloadDigest,
          packDigest: record.artifact.packDigest,
          manifestDigest: record.artifact.manifestDigest,
          entriesDigest: record.artifact.entriesDigest,
          schemasDigest: record.artifact.schemasDigest,
        },
    signedBundle: includeSignedBundle ? record.signedBundle : null,
    verificationKey: record.verificationKey,
  };
}

function applyBundleCacheHeaders(
  c: Context,
  descriptor: PolicyBundleCacheDescriptor,
): void {
  for (const [key, value] of Object.entries(policyBundleCacheHeaders(descriptor))) {
    c.header(key, value);
  }
}

function activationView(record: PolicyActivationRecord): Record<string, unknown> {
  return {
    id: record.id,
    state: record.state,
    operationType: record.operationType,
    target: record.target,
    selector: record.selector,
    targetLabel: record.targetLabel,
    bundle: record.bundle,
    activatedBy: record.activatedBy,
    activatedAt: record.activatedAt,
    rolloutMode: record.rolloutMode,
    reasonCode: record.reasonCode,
    rationale: record.rationale,
    previousActivationId: record.previousActivationId,
    supersededByActivationId: record.supersededByActivationId,
    rollbackOfActivationId: record.rollbackOfActivationId,
    freezeReason: record.freezeReason,
  };
}

function approvalRequestView(request: PolicyActivationApprovalRequest): Record<string, unknown> {
  return {
    id: request.id,
    state: request.state,
    target: request.target,
    targetLabel: request.targetLabel,
    bundle: request.bundle,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    reasonCode: request.reasonCode,
    rationale: request.rationale,
    requirement: request.requirement,
    decisions: request.decisions,
    approvedReviewerIds: request.approvedReviewerIds,
    rejectedReviewerIds: request.rejectedReviewerIds,
    latestDecisionAt: request.latestDecisionAt,
    approvalDigest: request.approvalDigest,
  };
}

function approvalGateView(gate: PolicyActivationApprovalGateResult): Record<string, unknown> {
  return {
    allowed: gate.allowed,
    status: gate.status,
    message: gate.message,
    requirement: gate.requirement,
    request: gate.request ? approvalRequestView(gate.request) : null,
  };
}

function auditEntryView(
  entry: PolicyMutationAuditEntry,
  includeSnapshot: boolean,
): Record<string, unknown> {
  return {
    entryId: entry.entryId,
    sequence: entry.sequence,
    occurredAt: entry.occurredAt,
    action: entry.action,
    actor: entry.actor,
    subject: entry.subject,
    reasonCode: entry.reasonCode,
    rationale: entry.rationale,
    mutationDigest: entry.mutationDigest,
    previousEntryDigest: entry.previousEntryDigest,
    entryDigest: entry.entryDigest,
    mutationSnapshot: includeSnapshot ? entry.mutationSnapshot : undefined,
  };
}

function routeAdminActor(c: Context): ReleaseActorReference {
  const actorId = c.req.header('x-attestor-admin-actor-id')?.trim() || 'admin_api_key';
  return {
    id: actorId,
    type: actorId === 'admin_api_key' ? 'service' : 'user',
    displayName: c.req.header('x-attestor-admin-actor-name')?.trim() || 'Policy Admin API',
    role: c.req.header('x-attestor-admin-actor-role')?.trim() || 'policy-admin',
  };
}

function requireBreakGlassAuthorization(
  c: Context,
  body: JsonRecord,
): {
  readonly actor: ReleaseActorReference;
  readonly reasonCode: string;
  readonly rationale: string;
  readonly incidentId: string | null;
} | Response {
  const actor = routeAdminActor(c);
  const acknowledged =
    body.breakGlass === true ||
    c.req.header('x-attestor-break-glass')?.trim().toLowerCase() === 'true';
  if (!acknowledged) {
    return c.json({
      error: 'Emergency policy control operations require breakGlass=true or x-attestor-break-glass: true.',
    }, 400);
  }

  if (!BREAK_GLASS_ROLES.includes((actor.role ?? '').trim().toLowerCase())) {
    return c.json({
      error: `Emergency policy control operations require one of these actor roles: ${BREAK_GLASS_ROLES.join(', ')}.`,
    }, 403);
  }

  const reasonCode = optionalString(body, 'reasonCode');
  const rationale = optionalString(body, 'rationale');
  if (!reasonCode || !rationale) {
    return c.json({
      error: 'Emergency policy control operations require non-empty reasonCode and rationale fields.',
    }, 400);
  }

  return {
    actor,
    reasonCode,
    rationale,
    incidentId: optionalString(body, 'incidentId'),
  };
}

function parsePositiveLimit(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function filterAuditEntries(
  entries: readonly PolicyMutationAuditEntry[],
  c: Context,
): readonly PolicyMutationAuditEntry[] | Response {
  const limitQuery = c.req.query('limit');
  const limit = parsePositiveLimit(limitQuery);
  if (limitQuery !== undefined && limit === null) {
    return c.json({ error: 'limit must be a positive integer.' }, 400);
  }
  const action = c.req.query('action')?.trim() as PolicyMutationAction | undefined;
  const packId = c.req.query('packId')?.trim();
  const bundleId = c.req.query('bundleId')?.trim();
  const activationId = c.req.query('activationId')?.trim();
  const filtered = entries
    .filter((entry) => !action || entry.action === action)
    .filter((entry) => !packId || entry.subject.packId === packId)
    .filter((entry) => !bundleId || entry.subject.bundleId === bundleId)
    .filter((entry) => !activationId || entry.subject.activationId === activationId)
    .sort((left, right) => right.sequence - left.sequence);
  return limit ? filtered.slice(0, limit) : filtered;
}

async function beginMutation(
  c: Context,
  deps: RouteDeps,
  routeId: string,
  body: JsonRecord,
): Promise<{ idempotencyKey: string | null; requestHash: string } | Response> {
  if (deps.adminMutationRequest) {
    return deps.adminMutationRequest(c, routeId, body);
  }
  return {
    idempotencyKey: null,
    requestHash: `route:${routeId}`,
  };
}

async function finishMutation(
  deps: RouteDeps,
  options: {
    idempotencyKey: string | null;
    requestHash: string;
    routeId: string;
    requestPayload: JsonRecord;
    statusCode: number;
    responseBody: Record<string, unknown>;
    adminAuditAction: AdminAuditAction;
    target?: PolicyActivationTarget | null;
    metadata?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  if (!deps.finalizeAdminMutation) {
    return options.responseBody;
  }
  return deps.finalizeAdminMutation({
    idempotencyKey: options.idempotencyKey,
    routeId: options.routeId,
    requestPayload: options.requestPayload,
    statusCode: options.statusCode,
    responseBody: options.responseBody,
    audit: {
      action: options.adminAuditAction,
      tenantId: options.target?.tenantId ?? null,
      accountId: options.target?.accountId ?? null,
      requestHash: options.requestHash,
      metadata: options.metadata ?? {},
    },
  });
}

function publishStoreMetadata(
  store: PolicyControlPlaneStore,
  bundle: StoredPolicyBundleRecord,
  latestActivationId: string | null,
): void {
  const previous = store.getMetadata();
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      store.kind,
      previous?.discoveryMode ?? 'scoped-active',
      bundle.manifest.bundle,
      latestActivationId ?? previous?.latestActivationId ?? null,
    ),
  );
}

function findRequiredBundle(
  store: PolicyControlPlaneStore,
  packId: string,
  bundleId: string,
): StoredPolicyBundleRecord | null {
  return store.getBundle(packId, bundleId);
}

function parseBundleUpsertInput(body: JsonRecord): UpsertStoredPolicyBundleInput {
  const source = isJsonRecord(body.bundle) ? body.bundle : body;
  if (!isJsonRecord(source.manifest)) {
    throw new Error('manifest must be provided as an object.');
  }
  if (!isJsonRecord(source.artifact)) {
    throw new Error('artifact must be provided as an object.');
  }
  const signedBundle = isJsonRecord(source.signedBundle) ? source.signedBundle : null;
  return {
    manifest: source.manifest as never,
    artifact: source.artifact as never,
    signedBundle: signedBundle as never,
    verificationKey: (source.verificationKey ?? signedBundle?.verificationKey ?? null) as never,
    storedAt: optionalString(source, 'storedAt') ?? undefined,
  };
}

export function registerReleasePolicyControlRoutes(app: Hono, deps: RouteDeps): void {
  const {
    policyControlPlaneStore: store,
    policyActivationApprovalStore: approvalStore,
    policyMutationAuditLog: auditLog,
  } = deps;

  app.get('/api/v1/admin/release-policy/control-plane', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const snapshot = store.exportSnapshot();
    const auditVerification = auditLog.verify();
    noStore(c);
    return c.json({
      storeKind: store.kind,
      metadata: snapshot.metadata,
      counts: {
        packs: snapshot.packs.length,
        bundles: snapshot.bundles.length,
        activations: snapshot.activations.length,
        activationApprovals: approvalStore.list().length,
        auditEntries: auditLog.entries().length,
      },
      audit: {
        valid: auditVerification.valid,
        latestEntryDigest: auditLog.latestEntryDigest(),
      },
    });
  });

  app.get('/api/v1/admin/release-policy/packs', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    noStore(c);
    return c.json({ packs: store.listPacks().map(packView) });
  });

  app.post('/api/v1/admin/release-policy/packs', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const routeId = 'admin.release_policy.packs.upsert';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const pack = parsePackMetadata(body.pack ?? body);
      const stored = store.upsertPack(pack);
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'create-pack',
        actor: routeAdminActor(c),
        subject: createPolicyMutationAuditSubjectFromPack(stored),
        reasonCode: optionalString(body, 'reasonCode') ?? 'upsert-pack',
        rationale: optionalString(body, 'rationale'),
        mutationSnapshot: stored,
      });
      const responseBody = {
        pack: packView(stored),
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 200,
        responseBody,
        adminAuditAction: 'policy_pack.upserted',
        metadata: { packId: stored.id, auditEntryId: audit.entryId },
      });
      noStore(c);
      return c.json(finalized, 200);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/v1/admin/release-policy/packs/:packId', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const pack = store.getPack(c.req.param('packId'));
    if (!pack) {
      return c.json({ error: `Policy pack '${c.req.param('packId')}' not found.` }, 404);
    }
    noStore(c);
    return c.json({ pack: packView(pack) });
  });

  app.get('/api/v1/admin/release-policy/packs/:packId/bundles', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    noStore(c);
    return c.json({
      packId: c.req.param('packId'),
      bundles: store.listBundleHistory(c.req.param('packId')).map(bundleSummaryView),
    });
  });

  app.get('/api/v1/admin/release-policy/packs/:packId/versions', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    noStore(c);
    return c.json({
      packId: c.req.param('packId'),
      versions: store.listBundleHistory(c.req.param('packId')).map(bundleSummaryView),
    });
  });

  app.post('/api/v1/admin/release-policy/bundles', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const routeId = 'admin.release_policy.bundles.publish';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const input = parseBundleUpsertInput(body);
      const pack = input.artifact.statement.predicate.pack as PolicyPackMetadata;
      store.upsertPack({
        ...pack,
        latestBundleRef: input.manifest.bundle,
        updatedAt: input.storedAt ?? new Date().toISOString(),
      });
      const record = store.upsertBundle(input);
      publishStoreMetadata(store, record, null);
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'publish-bundle',
        actor: routeAdminActor(c),
        subject: createPolicyMutationAuditSubjectFromBundle(record),
        reasonCode: optionalString(body, 'reasonCode') ?? 'publish-bundle',
        rationale: optionalString(body, 'rationale'),
        mutationSnapshot: record,
      });
      const responseBody = {
        bundle: bundleSummaryView(record),
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 201,
        responseBody,
        adminAuditAction: 'policy_bundle.published',
        metadata: {
          packId: record.packId,
          bundleId: record.bundleId,
          auditEntryId: audit.entryId,
        },
      });
      noStore(c);
      return c.json(finalized, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/v1/admin/release-policy/packs/:packId/bundles/:bundleId', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const record = findRequiredBundle(store, c.req.param('packId'), c.req.param('bundleId'));
    if (!record) {
      return c.json({
        error: `Policy bundle '${c.req.param('bundleId')}' in pack '${c.req.param('packId')}' not found.`,
      }, 404);
    }
    const conditional = createPolicyBundleConditionalResponse(
      record,
      c.req.header('if-none-match'),
      {
        now: new Date().toISOString(),
        persisted: store.kind === 'file-backed',
      },
    );
    applyBundleCacheHeaders(c, conditional.descriptor);
    if (conditional.status === 'not-modified') {
      return c.body(null, 304);
    }
    return c.json({
      bundle: bundleDetailView(record, c),
      cache: conditional.descriptor,
    });
  });

  app.get('/api/v1/admin/release-policy/activation-approvals', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    try {
      const requests = approvalStore.list({
        state: parseApprovalState(c.req.query('state')),
        targetLabel: c.req.query('targetLabel')?.trim() || null,
        packId: c.req.query('packId')?.trim() || null,
        bundleId: c.req.query('bundleId')?.trim() || null,
      });
      noStore(c);
      return c.json({ approvalRequests: requests.map(approvalRequestView) });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post('/api/v1/admin/release-policy/activation-approvals', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const routeId = 'admin.release_policy.activation_approvals.request';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const packId = requiredString(body, 'packId');
      const bundleId = requiredString(body, 'bundleId');
      const target = parseActivationTarget(body.target);
      const bundle = findRequiredBundle(store, packId, bundleId);
      if (!bundle) {
        return c.json({ error: `Policy bundle '${bundleId}' in pack '${packId}' not found.` }, 404);
      }

      const approvalRequest = requestPolicyActivationApproval(approvalStore, {
        id: optionalString(body, 'approvalRequestId') ?? undefined,
        target,
        bundleRecord: bundle,
        requestedBy: routeAdminActor(c),
        requestedAt: optionalString(body, 'requestedAt') ?? undefined,
        expiresAt: optionalString(body, 'expiresAt') ?? undefined,
        reasonCode: optionalString(body, 'reasonCode') ?? undefined,
        rationale:
          optionalString(body, 'rationale') ??
          `Request approval to activate policy bundle ${bundle.bundleId}.`,
      });
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'request-activation-approval',
        actor: routeAdminActor(c),
        subject: {
          packId: approvalRequest.bundle.packId,
          bundleId: approvalRequest.bundle.bundleId,
          bundleVersion: approvalRequest.bundle.bundleVersion,
          activationId: null,
          targetLabel: approvalRequest.targetLabel,
        },
        reasonCode: approvalRequest.reasonCode,
        rationale: approvalRequest.rationale,
        mutationSnapshot: approvalRequest,
      });
      const responseBody = {
        approvalRequest: approvalRequestView(approvalRequest),
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 201,
        responseBody,
        adminAuditAction: 'policy_activation.approval_requested',
        target,
        metadata: {
          packId,
          bundleId,
          approvalRequestId: approvalRequest.id,
          targetLabel: approvalRequest.targetLabel,
          auditEntryId: audit.entryId,
        },
      });
      noStore(c);
      return c.json(finalized, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/v1/admin/release-policy/activation-approvals/:id', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const approvalRequest = approvalStore.get(c.req.param('id'));
    if (!approvalRequest) {
      return c.json({
        error: `Policy activation approval request '${c.req.param('id')}' not found.`,
      }, 404);
    }
    noStore(c);
    return c.json({ approvalRequest: approvalRequestView(approvalRequest) });
  });

  app.post('/api/v1/admin/release-policy/activation-approvals/:id/approve', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const routeId = 'admin.release_policy.activation_approvals.approve';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const approvalRequest = recordPolicyActivationApprovalDecision(approvalStore, {
        requestId: c.req.param('id'),
        decision: 'approve',
        reviewer: routeAdminActor(c),
        decidedAt: optionalString(body, 'decidedAt') ?? undefined,
        rationale: optionalString(body, 'rationale') ?? 'Approve policy activation request.',
      });
      const latestDecision = approvalRequest.decisions.at(-1)!;
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'approve-activation',
        actor: routeAdminActor(c),
        subject: {
          packId: approvalRequest.bundle.packId,
          bundleId: approvalRequest.bundle.bundleId,
          bundleVersion: approvalRequest.bundle.bundleVersion,
          activationId: null,
          targetLabel: approvalRequest.targetLabel,
        },
        reasonCode: approvalRequest.reasonCode,
        rationale: latestDecision.rationale,
        mutationSnapshot: approvalRequest,
      });
      const responseBody = {
        approvalRequest: approvalRequestView(approvalRequest),
        decision: latestDecision,
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 200,
        responseBody,
        adminAuditAction: 'policy_activation.approval_approved',
        target: approvalRequest.target,
        metadata: {
          approvalRequestId: approvalRequest.id,
          targetLabel: approvalRequest.targetLabel,
          reviewerId: latestDecision.reviewer.id,
          auditEntryId: audit.entryId,
        },
      });
      noStore(c);
      return c.json(finalized, 200);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post('/api/v1/admin/release-policy/activation-approvals/:id/reject', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const routeId = 'admin.release_policy.activation_approvals.reject';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const approvalRequest = recordPolicyActivationApprovalDecision(approvalStore, {
        requestId: c.req.param('id'),
        decision: 'reject',
        reviewer: routeAdminActor(c),
        decidedAt: optionalString(body, 'decidedAt') ?? undefined,
        rationale: optionalString(body, 'rationale') ?? 'Reject policy activation request.',
      });
      const latestDecision = approvalRequest.decisions.at(-1)!;
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'reject-activation',
        actor: routeAdminActor(c),
        subject: {
          packId: approvalRequest.bundle.packId,
          bundleId: approvalRequest.bundle.bundleId,
          bundleVersion: approvalRequest.bundle.bundleVersion,
          activationId: null,
          targetLabel: approvalRequest.targetLabel,
        },
        reasonCode: approvalRequest.reasonCode,
        rationale: latestDecision.rationale,
        mutationSnapshot: approvalRequest,
      });
      const responseBody = {
        approvalRequest: approvalRequestView(approvalRequest),
        decision: latestDecision,
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 200,
        responseBody,
        adminAuditAction: 'policy_activation.approval_rejected',
        target: approvalRequest.target,
        metadata: {
          approvalRequestId: approvalRequest.id,
          targetLabel: approvalRequest.targetLabel,
          reviewerId: latestDecision.reviewer.id,
          auditEntryId: audit.entryId,
        },
      });
      noStore(c);
      return c.json(finalized, 200);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/v1/admin/release-policy/activations', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const targetLabel = c.req.query('targetLabel')?.trim();
    const state = c.req.query('state')?.trim();
    const activations = store
      .listActivations()
      .filter((record) => !targetLabel || record.targetLabel === targetLabel)
      .filter((record) => !state || record.state === state);
    noStore(c);
    return c.json({ activations: activations.map(activationView) });
  });

  app.post('/api/v1/admin/release-policy/activations', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const routeId = 'admin.release_policy.activations.activate';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const packId = requiredString(body, 'packId');
      const bundleId = requiredString(body, 'bundleId');
      const target = parseActivationTarget(body.target);
      const bundle = findRequiredBundle(store, packId, bundleId);
      if (!bundle) {
        return c.json({ error: `Policy bundle '${bundleId}' in pack '${packId}' not found.` }, 404);
      }
      const approvalGate = evaluatePolicyActivationApprovalGate(approvalStore, {
        target,
        bundleRecord: bundle,
        approvalRequestId: optionalString(body, 'approvalRequestId'),
        now: optionalString(body, 'activatedAt') ?? undefined,
      });
      if (!approvalGate.allowed) {
        return c.json({
          error: approvalGate.message,
          approval: approvalGateView(approvalGate),
        }, 409);
      }
      const lifecycle = activatePolicyBundle(store, {
        id: optionalString(body, 'activationId') ?? `activation_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        target,
        bundle: bundle.manifest.bundle,
        activatedBy: routeAdminActor(c),
        activatedAt: optionalString(body, 'activatedAt') ?? new Date().toISOString(),
        rolloutMode: parseRolloutMode(body.rolloutMode),
        reasonCode: optionalString(body, 'reasonCode') ?? 'activate-bundle',
        rationale: optionalString(body, 'rationale') ?? `Activate policy bundle ${bundle.bundleId}.`,
      });
      publishStoreMetadata(store, bundle, lifecycle.appliedRecord.id);
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'activate-bundle',
        actor: routeAdminActor(c),
        subject: createPolicyMutationAuditSubjectFromActivation(lifecycle.appliedRecord),
        reasonCode: lifecycle.appliedRecord.reasonCode,
        rationale: lifecycle.appliedRecord.rationale,
        mutationSnapshot: lifecycle,
      });
      const responseBody = {
        activation: activationView(lifecycle.appliedRecord),
        lifecycle,
        approval: approvalGateView(approvalGate),
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 201,
        responseBody,
        adminAuditAction: 'policy_activation.activated',
        target,
        metadata: {
          packId,
          bundleId,
          activationId: lifecycle.appliedRecord.id,
          approvalRequestId: approvalGate.request?.id ?? null,
          targetLabel: lifecycle.targetLabel,
          auditEntryId: audit.entryId,
        },
      });
      noStore(c);
      return c.json(finalized, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/v1/admin/release-policy/activations/:id', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const record = store.getActivation(c.req.param('id'));
    if (!record) {
      return c.json({ error: `Policy activation '${c.req.param('id')}' not found.` }, 404);
    }
    noStore(c);
    return c.json({ activation: activationView(record) });
  });

  app.post('/api/v1/admin/release-policy/activations/:id/rollback', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const routeId = 'admin.release_policy.activations.rollback';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const rollbackTarget = store.getActivation(c.req.param('id'));
      if (!rollbackTarget) {
        return c.json({ error: `Policy activation '${c.req.param('id')}' not found.` }, 404);
      }
      const lifecycle = rollbackPolicyActivation(store, {
        id: optionalString(body, 'activationId') ?? `rollback_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        target: rollbackTarget.target,
        rollbackTargetActivationId: rollbackTarget.id,
        activatedBy: routeAdminActor(c),
        activatedAt: optionalString(body, 'activatedAt') ?? new Date().toISOString(),
        reasonCode: optionalString(body, 'reasonCode') ?? 'rollback',
        rationale: optionalString(body, 'rationale') ?? `Rollback to policy activation ${rollbackTarget.id}.`,
      });
      const bundle = findRequiredBundle(
        store,
        lifecycle.appliedRecord.bundle.packId,
        lifecycle.appliedRecord.bundle.bundleId,
      );
      if (bundle) {
        publishStoreMetadata(store, bundle, lifecycle.appliedRecord.id);
      }
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'rollback-activation',
        actor: routeAdminActor(c),
        subject: createPolicyMutationAuditSubjectFromActivation(lifecycle.appliedRecord),
        reasonCode: lifecycle.appliedRecord.reasonCode,
        rationale: lifecycle.appliedRecord.rationale,
        mutationSnapshot: lifecycle,
      });
      const responseBody = {
        activation: activationView(lifecycle.appliedRecord),
        lifecycle,
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 201,
        responseBody,
        adminAuditAction: 'policy_activation.rolled_back',
        target: lifecycle.appliedRecord.target,
        metadata: {
          rollbackTargetActivationId: rollbackTarget.id,
          activationId: lifecycle.appliedRecord.id,
          targetLabel: lifecycle.targetLabel,
          auditEntryId: audit.entryId,
        },
      });
      noStore(c);
      return c.json(finalized, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post('/api/v1/admin/release-policy/emergency/freeze', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const breakGlass = requireBreakGlassAuthorization(c, body);
    if (breakGlass instanceof Response) return breakGlass;
    const routeId = 'admin.release_policy.emergency.freeze';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const target = parseActivationTarget(body.target);
      const packId = optionalString(body, 'packId');
      const bundleId = optionalString(body, 'bundleId');
      if ((packId && !bundleId) || (!packId && bundleId)) {
        return c.json({ error: 'Emergency freeze requires both packId and bundleId when either is provided.' }, 400);
      }

      const currentActive = findLatestActiveExactTargetActivation(store, target);
      const bundle =
        packId && bundleId
          ? findRequiredBundle(store, packId, bundleId)
          : currentActive
            ? findRequiredBundle(store, currentActive.bundle.packId, currentActive.bundle.bundleId)
            : null;
      if (!bundle) {
        return c.json({
          error: packId && bundleId
            ? `Policy bundle '${bundleId}' in pack '${packId}' not found.`
            : 'Emergency freeze requires an exact active activation or an explicit packId and bundleId.',
        }, packId && bundleId ? 404 : 400);
      }

      const lifecycle = freezePolicyActivationScope(store, {
        id: optionalString(body, 'activationId') ?? `freeze_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        target,
        bundle: bundle.manifest.bundle,
        activatedBy: breakGlass.actor,
        activatedAt: optionalString(body, 'activatedAt') ?? new Date().toISOString(),
        reasonCode: breakGlass.reasonCode,
        rationale: breakGlass.rationale,
        freezeReason: optionalString(body, 'freezeReason') ?? breakGlass.rationale,
      });
      publishStoreMetadata(store, bundle, lifecycle.appliedRecord.id);
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'freeze-scope',
        actor: breakGlass.actor,
        subject: createPolicyMutationAuditSubjectFromActivation(lifecycle.appliedRecord),
        reasonCode: lifecycle.appliedRecord.reasonCode,
        rationale: lifecycle.appliedRecord.rationale,
        mutationSnapshot: {
          lifecycle,
          breakGlass: {
            actor: breakGlass.actor,
            reasonCode: breakGlass.reasonCode,
            incidentId: breakGlass.incidentId,
          },
        },
      });
      const responseBody = {
        activation: activationView(lifecycle.appliedRecord),
        lifecycle,
        breakGlass: {
          actor: breakGlass.actor,
          reasonCode: breakGlass.reasonCode,
          incidentId: breakGlass.incidentId,
        },
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 201,
        responseBody,
        adminAuditAction: 'policy_activation.emergency_frozen',
        target: lifecycle.appliedRecord.target,
        metadata: {
          activationId: lifecycle.appliedRecord.id,
          previousActivationId: lifecycle.appliedRecord.previousActivationId,
          targetLabel: lifecycle.targetLabel,
          auditEntryId: audit.entryId,
          incidentId: breakGlass.incidentId,
        },
      });
      noStore(c);
      return c.json(finalized, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post('/api/v1/admin/release-policy/emergency/rollback', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    const breakGlass = requireBreakGlassAuthorization(c, body);
    if (breakGlass instanceof Response) return breakGlass;
    const routeId = 'admin.release_policy.emergency.rollback';
    const mutation = await beginMutation(c, deps, routeId, body);
    if (mutation instanceof Response) return mutation;

    try {
      const rollbackTargetId = requiredString(body, 'rollbackTargetActivationId');
      const rollbackTarget = store.getActivation(rollbackTargetId);
      if (!rollbackTarget) {
        return c.json({ error: `Policy activation '${rollbackTargetId}' not found.` }, 404);
      }
      const lifecycle = rollbackPolicyActivation(store, {
        id: optionalString(body, 'activationId') ?? `emergency_rollback_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        target: rollbackTarget.target,
        rollbackTargetActivationId: rollbackTarget.id,
        activatedBy: breakGlass.actor,
        activatedAt: optionalString(body, 'activatedAt') ?? new Date().toISOString(),
        reasonCode: breakGlass.reasonCode,
        rationale: breakGlass.rationale,
      });
      const bundle = findRequiredBundle(
        store,
        lifecycle.appliedRecord.bundle.packId,
        lifecycle.appliedRecord.bundle.bundleId,
      );
      if (bundle) {
        publishStoreMetadata(store, bundle, lifecycle.appliedRecord.id);
      }
      const audit = auditLog.append({
        occurredAt: new Date().toISOString(),
        action: 'rollback-activation',
        actor: breakGlass.actor,
        subject: createPolicyMutationAuditSubjectFromActivation(lifecycle.appliedRecord),
        reasonCode: lifecycle.appliedRecord.reasonCode,
        rationale: lifecycle.appliedRecord.rationale,
        mutationSnapshot: {
          lifecycle,
          breakGlass: {
            actor: breakGlass.actor,
            reasonCode: breakGlass.reasonCode,
            incidentId: breakGlass.incidentId,
          },
        },
      });
      const responseBody = {
        activation: activationView(lifecycle.appliedRecord),
        lifecycle,
        breakGlass: {
          actor: breakGlass.actor,
          reasonCode: breakGlass.reasonCode,
          incidentId: breakGlass.incidentId,
        },
        audit: auditEntryView(audit, false),
      };
      const finalized = await finishMutation(deps, {
        ...mutation,
        routeId,
        requestPayload: body,
        statusCode: 201,
        responseBody,
        adminAuditAction: 'policy_activation.emergency_rolled_back',
        target: lifecycle.appliedRecord.target,
        metadata: {
          rollbackTargetActivationId: rollbackTarget.id,
          activationId: lifecycle.appliedRecord.id,
          replacedActivationId: lifecycle.currentActiveRecord?.id ?? null,
          targetLabel: lifecycle.targetLabel,
          auditEntryId: audit.entryId,
          incidentId: breakGlass.incidentId,
        },
      });
      noStore(c);
      return c.json(finalized, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post('/api/v1/admin/release-policy/resolve', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    try {
      const resolverInput = (body.resolverInput ?? body.input ?? body) as never;
      const result = createPolicySimulationApi(store).resolveCurrent(resolverInput);
      noStore(c);
      return c.json({ resolution: result });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post('/api/v1/admin/release-policy/simulations', async (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseJsonBody(c);
    if (body instanceof Response) return body;
    try {
      const overlaySource = body.overlay;
      if (!isJsonRecord(overlaySource)) {
        return c.json({ error: 'overlay must be provided as an object.' }, 400);
      }
      const packId = requiredString(overlaySource, 'packId');
      const bundleId = requiredString(overlaySource, 'bundleId');
      const bundle = findRequiredBundle(store, packId, bundleId);
      if (!bundle) {
        return c.json({ error: `Policy bundle '${bundleId}' in pack '${packId}' not found.` }, 404);
      }
      const resolverInput = (body.resolverInput ?? body.input) as never;
      if (!resolverInput) {
        return c.json({ error: 'resolverInput is required.' }, 400);
      }
      const preview = createPolicyImpactApi(store).previewCandidateActivation(resolverInput, {
        bundleRecord: bundle,
        target: parseActivationTarget(overlaySource.target),
        discoveryMode: (optionalString(overlaySource, 'discoveryMode') ?? undefined) as never,
        activationId: optionalString(overlaySource, 'activationId') ?? undefined,
        actor: routeAdminActor(c),
        activatedAt: optionalString(overlaySource, 'activatedAt') ?? undefined,
        reasonCode: optionalString(overlaySource, 'reasonCode') ?? 'simulation',
        rationale:
          optionalString(overlaySource, 'rationale') ??
          `Simulate policy bundle ${bundle.bundleId}.`,
      });
      noStore(c);
      return c.json({ preview });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/v1/admin/release-policy/audit', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const entries = filterAuditEntries(auditLog.entries(), c);
    if (entries instanceof Response) return entries;
    const includeSnapshots = c.req.query('includeSnapshots') === 'true';
    const verification = auditLog.verify();
    noStore(c);
    return c.json({
      verification,
      latestEntryDigest: auditLog.latestEntryDigest(),
      entries: entries.map((entry) => auditEntryView(entry, includeSnapshots)),
    });
  });

  app.get('/api/v1/admin/release-policy/audit/verify', (c) => {
    const unauthorized = deps.currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    noStore(c);
    return c.json({
      verification: auditLog.verify(),
      latestEntryDigest: auditLog.latestEntryDigest(),
    });
  });
}
