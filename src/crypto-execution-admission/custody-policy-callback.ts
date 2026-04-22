import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import {
  type CustodyAccountEvidence,
  type CustodyApprovalEvidence,
  type CustodyCosignerAuthMethod,
  type CustodyCosignerCallbackEvidence,
  type CustodyCosignerPolicyPreflight,
  type CustodyCosignerResponseAction,
  type CustodyKeyPostureEvidence,
  type CustodyPolicyDecisionEvidence,
  type CustodyPolicyProvider,
  type CustodyPostExecutionEvidence,
  type CustodyScreeningEvidence,
  type CustodyTransactionEvidence,
} from '../crypto-authorization-core/custody-cosigner-policy-adapter.js';
import type { CryptoExecutionAdmissionPlan } from './index.js';

/**
 * Custody policy admission callback contracts turn custody/co-signer provider
 * callback evidence into a deterministic Attestor allow / needs-review / deny
 * response before any custody key path signs or dispatches a value-moving action.
 */

export const CUSTODY_POLICY_ADMISSION_CALLBACK_SPEC_VERSION =
  'attestor.crypto-custody-policy-admission-callback.v1';

export const CUSTODY_POLICY_ADMISSION_CALLBACK_OUTCOMES = [
  'allow',
  'needs-review',
  'deny',
] as const;
export type CustodyPolicyAdmissionCallbackOutcome =
  typeof CUSTODY_POLICY_ADMISSION_CALLBACK_OUTCOMES[number];

export const CUSTODY_POLICY_ADMISSION_CALLBACK_ACTIONS = [
  'approve-request',
  'queue-review',
  'reject-request',
] as const;
export type CustodyPolicyAdmissionCallbackAction =
  typeof CUSTODY_POLICY_ADMISSION_CALLBACK_ACTIONS[number];

export const CUSTODY_POLICY_CALLBACK_INTEGRATION_MODES = [
  'sync-callback',
  'approval-queue',
  'policy-consensus',
] as const;
export type CustodyPolicyCallbackIntegrationMode =
  typeof CUSTODY_POLICY_CALLBACK_INTEGRATION_MODES[number];

export const CUSTODY_POLICY_CALLBACK_PROTOCOLS = [
  'jwt-signed-json',
  'tls-pinned-json',
  'sender-constrained-json',
  'hmac-signed-json',
] as const;
export type CustodyPolicyCallbackProtocol =
  typeof CUSTODY_POLICY_CALLBACK_PROTOCOLS[number];

export const CUSTODY_POLICY_ADMISSION_EXPECTATION_KINDS = [
  'plan-surface',
  'adapter-preflight',
  'provider-binding',
  'transaction-binding',
  'policy-decision',
  'approval-quorum',
  'duty-separation',
  'break-glass-control',
  'callback-configuration',
  'callback-authentication',
  'callback-freshness',
  'attestor-token-binding',
  'screening',
  'velocity-limit',
  'key-posture',
  'callback-response',
  'post-execution',
] as const;
export type CustodyPolicyAdmissionExpectationKind =
  typeof CUSTODY_POLICY_ADMISSION_EXPECTATION_KINDS[number];

export const CUSTODY_POLICY_ADMISSION_EXPECTATION_STATUSES = [
  'satisfied',
  'missing',
  'pending',
  'failed',
  'unsupported',
] as const;
export type CustodyPolicyAdmissionExpectationStatus =
  typeof CUSTODY_POLICY_ADMISSION_EXPECTATION_STATUSES[number];

export interface CustodyPolicyCallbackProviderProfile {
  readonly provider: CustodyPolicyProvider | string;
  readonly integrationMode: CustodyPolicyCallbackIntegrationMode;
  readonly responseDeadlineSeconds: number | null;
  readonly standards: readonly string[];
}

export interface CustodyPolicyAdmissionExpectation {
  readonly kind: CustodyPolicyAdmissionExpectationKind;
  readonly status: CustodyPolicyAdmissionExpectationStatus;
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CustodyPolicyAdmissionProviderResponse {
  readonly integrationMode: CustodyPolicyCallbackIntegrationMode;
  readonly protocol: CustodyPolicyCallbackProtocol;
  readonly responseDeadlineSeconds: number | null;
  readonly authenticatedChannelRequired: true;
  readonly signedResponseRequired: boolean;
  readonly failClosed: true;
  readonly observedCallbackAction: CustodyCosignerResponseAction | string;
  readonly normalizedCallbackAction: 'approve' | 'pending-review' | 'reject';
}

export interface CreateCustodyPolicyAdmissionCallbackContractInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly account: CustodyAccountEvidence;
  readonly transaction: CustodyTransactionEvidence;
  readonly policyDecision: CustodyPolicyDecisionEvidence;
  readonly approvals: CustodyApprovalEvidence;
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly screening: CustodyScreeningEvidence;
  readonly keyPosture: CustodyKeyPostureEvidence;
  readonly postExecution: CustodyPostExecutionEvidence;
  readonly createdAt: string;
  readonly contractId?: string | null;
  readonly callbackUrl?: string | null;
  readonly operatorNote?: string | null;
}

export interface CustodyPolicyAdmissionCallbackContract {
  readonly version: typeof CUSTODY_POLICY_ADMISSION_CALLBACK_SPEC_VERSION;
  readonly contractId: string;
  readonly createdAt: string;
  readonly provider: CustodyPolicyProvider | string;
  readonly integrationMode: CustodyPolicyCallbackIntegrationMode;
  readonly protocol: CustodyPolicyCallbackProtocol;
  readonly outcome: CustodyPolicyAdmissionCallbackOutcome;
  readonly action: CustodyPolicyAdmissionCallbackAction;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly preflightId: string;
  readonly preflightDigest: string;
  readonly organizationId: string;
  readonly accountRef: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly chain: string;
  readonly asset: string;
  readonly amount: string;
  readonly sourceAddress: string | null;
  readonly destinationAddress: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyDecisionId: string;
  readonly approvalQuorum: string;
  readonly keyId: string;
  readonly callbackId: string;
  readonly callbackUrl: string | null;
  readonly providerResponse: CustodyPolicyAdmissionProviderResponse;
  readonly attestorSidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  readonly expectations: readonly CustodyPolicyAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface CustodyPolicyAdmissionCallbackDescriptor {
  readonly version: typeof CUSTODY_POLICY_ADMISSION_CALLBACK_SPEC_VERSION;
  readonly outcomes: typeof CUSTODY_POLICY_ADMISSION_CALLBACK_OUTCOMES;
  readonly actions: typeof CUSTODY_POLICY_ADMISSION_CALLBACK_ACTIONS;
  readonly integrationModes: typeof CUSTODY_POLICY_CALLBACK_INTEGRATION_MODES;
  readonly protocols: typeof CUSTODY_POLICY_CALLBACK_PROTOCOLS;
  readonly expectationKinds: typeof CUSTODY_POLICY_ADMISSION_EXPECTATION_KINDS;
  readonly expectationStatuses: typeof CUSTODY_POLICY_ADMISSION_EXPECTATION_STATUSES;
  readonly runtimeChecks: readonly string[];
  readonly standards: readonly string[];
}

function includesValue<T extends string>(
  values: readonly T[],
  candidate: string,
): candidate is T {
  return (values as readonly string[]).includes(candidate);
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`custody policy admission callback ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`custody policy admission callback ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeNonNegativeNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `custody policy admission callback ${fieldName} must be a non-negative number.`,
    );
  }
  return value;
}

function normalizeAtomicUnits(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(
      `custody policy admission callback ${fieldName} must be unsigned atomic units.`,
    );
  }
  return normalized;
}

function normalizeOptionalUrl(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  const normalized = normalizeOptionalIdentifier(value, fieldName);
  if (normalized === null) return null;
  try {
    return new URL(normalized).toString();
  } catch {
    throw new Error(`custody policy admission callback ${fieldName} must be a URL.`);
  }
}

function sameIdentifier(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left?.trim() ?? '').toLowerCase() === (right?.trim() ?? '').toLowerCase();
}

function parseAtomicUnits(value: string, fieldName: string): bigint {
  return BigInt(normalizeAtomicUnits(value, fieldName));
}

function canonicalObject<T extends CanonicalReleaseJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  const canonical = canonicalizeReleaseJson(value);
  return Object.freeze({
    canonical,
    digest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  });
}

function providerProfileFor(
  provider: CustodyPolicyProvider | string,
): CustodyPolicyCallbackProviderProfile {
  const normalized = normalizeIdentifier(provider, 'provider').toLowerCase();
  if (normalized === 'fireblocks') {
    return Object.freeze({
      provider,
      integrationMode: 'sync-callback',
      responseDeadlineSeconds: 30,
      standards: Object.freeze([
        'Fireblocks API co-signer callback',
        'MPC custody signing',
      ]),
    });
  }
  if (normalized === 'turnkey') {
    return Object.freeze({
      provider,
      integrationMode: 'policy-consensus',
      responseDeadlineSeconds: null,
      standards: Object.freeze([
        'Turnkey policy engine',
        'Turnkey activity consensus',
      ]),
    });
  }
  return Object.freeze({
    provider,
    integrationMode: 'approval-queue',
    responseDeadlineSeconds: null,
    standards: Object.freeze([
      'custody policy engine',
      'co-signer callback',
    ]),
  });
}

function protocolFor(authMethod: CustodyCosignerAuthMethod | string): CustodyPolicyCallbackProtocol {
  switch (authMethod) {
    case 'jwt-public-key':
    case 'jws':
      return 'jwt-signed-json';
    case 'tls-certificate-pinning':
      return 'tls-pinned-json';
    case 'hmac':
      return 'hmac-signed-json';
    case 'mtls':
    case 'spiffe':
      return 'sender-constrained-json';
    default:
      return 'sender-constrained-json';
  }
}

function signedResponseRequired(protocol: CustodyPolicyCallbackProtocol): boolean {
  return protocol === 'jwt-signed-json' || protocol === 'hmac-signed-json';
}

function expectation(input: {
  readonly kind: CustodyPolicyAdmissionExpectationKind;
  readonly status: CustodyPolicyAdmissionExpectationStatus;
  readonly reasonCode: string;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): CustodyPolicyAdmissionExpectation {
  return Object.freeze({
    kind: input.kind,
    status: input.status,
    reasonCode: normalizeIdentifier(input.reasonCode, 'expectation.reasonCode'),
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function adapterPreflightExpectation(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CustodyCosignerPolicyPreflight;
}): CustodyPolicyAdmissionExpectation {
  const status: CustodyPolicyAdmissionExpectationStatus =
    input.plan.outcome === 'deny' || input.preflight.outcome === 'block'
      ? 'failed'
      : input.plan.outcome === 'admit' && input.preflight.outcome === 'allow'
        ? 'satisfied'
        : 'pending';
  return expectation({
    kind: 'adapter-preflight',
    status,
    reasonCode:
      status === 'failed'
        ? 'custody-adapter-preflight-blocked'
        : status === 'pending'
          ? 'custody-adapter-preflight-needs-review'
          : 'custody-adapter-preflight-ready',
    evidence: {
      planOutcome: input.plan.outcome,
      preflightOutcome: input.preflight.outcome,
      preflightDigest: input.preflight.digest,
    },
  });
}

function planSurfaceExpectation(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly account: CustodyAccountEvidence;
}): CustodyPolicyAdmissionExpectation {
  const sourceMatches =
    input.account.sourceAddress === undefined ||
    input.account.sourceAddress === null ||
    sameIdentifier(input.plan.accountAddress, input.account.sourceAddress);
  const ready =
    input.plan.surface === 'custody-policy-engine' &&
    input.plan.adapterKind === 'custody-cosigner' &&
    input.preflight.adapterKind === 'custody-cosigner' &&
    sameIdentifier(input.plan.chainId, input.preflight.chain) &&
    sameIdentifier(input.preflight.accountRef, input.account.accountRef) &&
    sourceMatches;
  return expectation({
    kind: 'plan-surface',
    status: ready ? 'satisfied' : 'unsupported',
    reasonCode: ready
      ? 'custody-admission-plan-surface-ready'
      : 'custody-admission-plan-surface-mismatch',
    evidence: {
      planSurface: input.plan.surface,
      planAdapterKind: input.plan.adapterKind ?? 'adapter-neutral',
      preflightAdapterKind: input.preflight.adapterKind,
      planChainId: input.plan.chainId,
      preflightChain: input.preflight.chain,
      planAccountAddress: input.plan.accountAddress,
      custodySourceAddress: input.account.sourceAddress ?? null,
      accountRef: input.account.accountRef,
    },
  });
}

function providerBindingExpectation(input: {
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly account: CustodyAccountEvidence;
  readonly policyDecision: CustodyPolicyDecisionEvidence;
}): CustodyPolicyAdmissionExpectation {
  const ready =
    sameIdentifier(input.preflight.provider, input.account.provider) &&
    sameIdentifier(input.policyDecision.provider, input.account.provider) &&
    sameIdentifier(input.preflight.organizationId, input.account.organizationId) &&
    sameIdentifier(input.preflight.accountRef, input.account.accountRef);
  return expectation({
    kind: 'provider-binding',
    status: ready ? 'satisfied' : 'failed',
    reasonCode: ready
      ? 'custody-provider-binding-ready'
      : 'custody-provider-binding-mismatch',
    evidence: {
      provider: input.account.provider,
      preflightProvider: input.preflight.provider,
      policyDecisionProvider: input.policyDecision.provider,
      organizationId: input.account.organizationId,
      accountRef: input.account.accountRef,
    },
  });
}

function transactionBindingExpectation(input: {
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly account: CustodyAccountEvidence;
  readonly transaction: CustodyTransactionEvidence;
}): CustodyPolicyAdmissionExpectation {
  const ready =
    sameIdentifier(input.preflight.requestId, input.transaction.requestId) &&
    sameIdentifier(input.preflight.idempotencyKey, input.transaction.idempotencyKey) &&
    sameIdentifier(input.preflight.chain, input.transaction.chain) &&
    sameIdentifier(input.preflight.chain, input.account.chain) &&
    sameIdentifier(input.preflight.asset, input.transaction.asset) &&
    sameIdentifier(input.preflight.asset, input.account.asset) &&
    sameIdentifier(input.preflight.amount, input.transaction.amount) &&
    sameIdentifier(input.preflight.destinationAddress, input.transaction.destinationAddress) &&
    sameIdentifier(input.transaction.sourceAccountRef, input.account.accountRef) &&
    input.transaction.simulationPassed === true &&
    input.transaction.duplicateRequestDetected !== true &&
    input.transaction.idempotencyFresh === true;
  return expectation({
    kind: 'transaction-binding',
    status: ready ? 'satisfied' : 'failed',
    reasonCode: ready
      ? 'custody-transaction-binding-ready'
      : 'custody-transaction-binding-mismatch',
    evidence: {
      requestId: input.transaction.requestId,
      idempotencyKey: input.transaction.idempotencyKey,
      idempotencyFresh: input.transaction.idempotencyFresh,
      duplicateRequestDetected: input.transaction.duplicateRequestDetected,
      chain: input.transaction.chain,
      asset: input.transaction.asset,
      amount: input.transaction.amount,
      sourceAccountRef: input.transaction.sourceAccountRef,
      destinationAddress: input.transaction.destinationAddress,
      simulationPassed: input.transaction.simulationPassed,
    },
  });
}

function policyDecisionExpectation(
  policyDecision: CustodyPolicyDecisionEvidence,
): CustodyPolicyAdmissionExpectation {
  const activeHashMatches =
    policyDecision.activePolicyHash === null ||
    policyDecision.activePolicyHash === undefined ||
    sameIdentifier(policyDecision.activePolicyHash, policyDecision.policyHash);
  const conditionsReady =
    policyDecision.conditions.chainBound &&
    policyDecision.conditions.accountBound &&
    policyDecision.conditions.assetBound &&
    policyDecision.conditions.destinationBound &&
    policyDecision.conditions.amountBound &&
    policyDecision.conditions.operationBound &&
    policyDecision.conditions.budgetBound &&
    policyDecision.conditions.velocityBound;
  const status = normalizeIdentifier(policyDecision.status, 'policyDecision.status');
  const effect = normalizeIdentifier(policyDecision.effect, 'policyDecision.effect');
  let expectationStatus: CustodyPolicyAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'custody-policy-decision-ready';
  if (
    effect === 'deny' ||
    status === 'denied' ||
    status === 'failed' ||
    status === 'timed-out' ||
    policyDecision.explicitDeny ||
    policyDecision.implicitDeny
  ) {
    expectationStatus = 'failed';
    reasonCode = 'custody-policy-decision-denied';
  } else if (effect === 'review-required' || status === 'pending') {
    expectationStatus = 'pending';
    reasonCode = 'custody-policy-decision-needs-review';
  } else if (
    effect !== 'allow' ||
    status !== 'approved' ||
    !policyDecision.matched ||
    !policyDecision.policyActivated ||
    !activeHashMatches ||
    !conditionsReady
  ) {
    expectationStatus = 'failed';
    reasonCode = 'custody-policy-decision-not-bound';
  }
  return expectation({
    kind: 'policy-decision',
    status: expectationStatus,
    reasonCode,
    evidence: {
      decisionId: policyDecision.decisionId,
      policyId: policyDecision.policyId,
      policyVersion: policyDecision.policyVersion,
      policyHash: policyDecision.policyHash,
      activePolicyHash: policyDecision.activePolicyHash ?? null,
      effect,
      status,
      matched: policyDecision.matched,
      explicitDeny: policyDecision.explicitDeny,
      implicitDeny: policyDecision.implicitDeny,
      policyActivated: policyDecision.policyActivated,
      conditionsReady,
    },
  });
}

function approvalQuorumExpectation(approvals: CustodyApprovalEvidence): CustodyPolicyAdmissionExpectation {
  const enoughApprovals =
    approvals.quorumSatisfied &&
    approvals.collectedApprovals >= approvals.requiredApprovals &&
    approvals.requiredApprovals > 0;
  return expectation({
    kind: 'approval-quorum',
    status: enoughApprovals ? 'satisfied' : 'pending',
    reasonCode: enoughApprovals
      ? 'custody-approval-quorum-ready'
      : 'custody-approval-quorum-needs-review',
    evidence: {
      requiredApprovals: approvals.requiredApprovals,
      collectedApprovals: approvals.collectedApprovals,
      quorumSatisfied: approvals.quorumSatisfied,
      approverIds: approvals.approverIds as unknown as CanonicalReleaseJsonValue,
      requiredRoles: approvals.requiredRoles as unknown as CanonicalReleaseJsonValue,
      collectedRoles: approvals.collectedRoles as unknown as CanonicalReleaseJsonValue,
    },
  });
}

function dutySeparationExpectation(approvals: CustodyApprovalEvidence): CustodyPolicyAdmissionExpectation {
  const ready =
    approvals.dutySeparationSatisfied &&
    !approvals.requesterApproved &&
    !approvals.policyAdminApprovedOwnChange;
  return expectation({
    kind: 'duty-separation',
    status: ready ? 'satisfied' : 'failed',
    reasonCode: ready
      ? 'custody-duty-separation-ready'
      : 'custody-duty-separation-failed',
    evidence: {
      requesterId: approvals.requesterId,
      requesterApproved: approvals.requesterApproved,
      dutySeparationSatisfied: approvals.dutySeparationSatisfied,
      policyAdminApprovedOwnChange: approvals.policyAdminApprovedOwnChange,
    },
  });
}

function breakGlassExpectation(approvals: CustodyApprovalEvidence): CustodyPolicyAdmissionExpectation {
  const status: CustodyPolicyAdmissionExpectationStatus = !approvals.breakGlassUsed
    ? 'satisfied'
    : approvals.breakGlassAuthorized
      ? 'pending'
      : 'failed';
  return expectation({
    kind: 'break-glass-control',
    status,
    reasonCode: !approvals.breakGlassUsed
      ? 'custody-break-glass-not-used'
      : approvals.breakGlassAuthorized
        ? 'custody-break-glass-needs-review'
        : 'custody-break-glass-unauthorized',
    evidence: {
      breakGlassUsed: approvals.breakGlassUsed,
      breakGlassAuthorized: approvals.breakGlassAuthorized,
    },
  });
}

function callbackConfigurationExpectation(
  callback: CustodyCosignerCallbackEvidence,
): CustodyPolicyAdmissionExpectation {
  return expectation({
    kind: 'callback-configuration',
    status: callback.configured ? 'satisfied' : 'failed',
    reasonCode: callback.configured
      ? 'custody-callback-configured'
      : 'custody-callback-not-configured',
    evidence: {
      callbackId: callback.callbackId,
      configured: callback.configured,
      authMethod: callback.authMethod,
    },
  });
}

function callbackAuthenticationExpectation(input: {
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly protocol: CustodyPolicyCallbackProtocol;
}): CustodyPolicyAdmissionExpectation {
  const signedRequired = signedResponseRequired(input.protocol);
  const signatureReady = signedRequired
    ? input.callback.signatureValid && input.callback.responseSigned
    : true;
  const tlsReady = input.protocol === 'tls-pinned-json' ? input.callback.tlsPinned : true;
  const senderReady =
    input.protocol === 'sender-constrained-json'
      ? input.callback.senderConstrained || input.callback.sourceIpAllowlisted
      : true;
  const ready =
    input.callback.authenticated &&
    signatureReady &&
    tlsReady &&
    senderReady &&
    input.callback.sourceIpAllowlisted;
  return expectation({
    kind: 'callback-authentication',
    status: ready ? 'satisfied' : 'failed',
    reasonCode: ready
      ? 'custody-callback-authentication-ready'
      : 'custody-callback-authentication-failed',
    evidence: {
      protocol: input.protocol,
      authMethod: input.callback.authMethod,
      authenticated: input.callback.authenticated,
      signatureValid: input.callback.signatureValid,
      responseSigned: input.callback.responseSigned,
      tlsPinned: input.callback.tlsPinned,
      senderConstrained: input.callback.senderConstrained,
      sourceIpAllowlisted: input.callback.sourceIpAllowlisted,
      signedResponseRequired: signedRequired,
    },
  });
}

function callbackFreshnessExpectation(input: {
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly profile: CustodyPolicyCallbackProviderProfile;
}): CustodyPolicyAdmissionExpectation {
  const responseWithinSeconds = normalizeNonNegativeNumber(
    input.callback.responseWithinSeconds,
    'callback.responseWithinSeconds',
  );
  const deadline = input.profile.responseDeadlineSeconds;
  const withinDeadline = deadline === null || responseWithinSeconds <= deadline;
  const ready =
    input.callback.nonceFresh &&
    input.callback.bodyHash !== null &&
    input.callback.bodyHash !== undefined &&
    input.callback.bodyHashMatches &&
    withinDeadline;
  return expectation({
    kind: 'callback-freshness',
    status: ready ? 'satisfied' : 'failed',
    reasonCode: ready
      ? 'custody-callback-fresh'
      : 'custody-callback-stale-or-unbound',
    evidence: {
      timestamp: input.callback.timestamp,
      nonce: input.callback.nonce,
      nonceFresh: input.callback.nonceFresh,
      bodyHash: input.callback.bodyHash ?? null,
      bodyHashMatches: input.callback.bodyHashMatches,
      responseWithinSeconds,
      responseDeadlineSeconds: deadline,
    },
  });
}

function attestorTokenExpectation(input: {
  readonly policyDecision: CustodyPolicyDecisionEvidence;
  readonly callback: CustodyCosignerCallbackEvidence;
}): CustodyPolicyAdmissionExpectation {
  const required = input.policyDecision.conditions.attestorReceiptRequired;
  const ready =
    !required ||
    (input.policyDecision.conditions.attestorReceiptMatched &&
      input.callback.attestorReleaseTokenVerified);
  return expectation({
    kind: 'attestor-token-binding',
    status: ready ? 'satisfied' : 'failed',
    reasonCode: ready
      ? 'custody-attestor-token-binding-ready'
      : 'custody-attestor-token-binding-missing',
    evidence: {
      attestorReceiptRequired: required,
      attestorReceiptMatched: input.policyDecision.conditions.attestorReceiptMatched,
      attestorReleaseTokenVerified: input.callback.attestorReleaseTokenVerified,
    },
  });
}

function screeningExpectation(screening: CustodyScreeningEvidence): CustodyPolicyAdmissionExpectation {
  let status: CustodyPolicyAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'custody-screening-ready';
  if (!screening.sanctionsScreened) {
    status = 'missing';
    reasonCode = 'custody-screening-not-run';
  } else if (
    screening.sanctionsHit ||
    !screening.destinationAllowlisted ||
    !screening.counterpartyKnown ||
    !screening.riskTierAllowed ||
    screening.riskScore > screening.riskScoreMax
  ) {
    status = 'failed';
    reasonCode = 'custody-screening-risk-blocked';
  } else if (screening.travelRuleRequired && !screening.travelRuleCompleted) {
    status = 'pending';
    reasonCode = 'custody-travel-rule-needs-review';
  }
  return expectation({
    kind: 'screening',
    status,
    reasonCode,
    evidence: {
      destinationAllowlisted: screening.destinationAllowlisted,
      counterpartyKnown: screening.counterpartyKnown,
      sanctionsScreened: screening.sanctionsScreened,
      sanctionsHit: screening.sanctionsHit,
      riskScore: screening.riskScore,
      riskScoreMax: screening.riskScoreMax,
      riskTierAllowed: screening.riskTierAllowed,
      travelRuleRequired: screening.travelRuleRequired,
      travelRuleCompleted: screening.travelRuleCompleted,
    },
  });
}

function velocityLimitExpectation(input: {
  readonly transaction: CustodyTransactionEvidence;
  readonly screening: CustodyScreeningEvidence;
}): CustodyPolicyAdmissionExpectation {
  const amount = parseAtomicUnits(input.transaction.amount, 'transaction.amount');
  const remaining = parseAtomicUnits(
    input.screening.velocityLimitRemainingAtomic,
    'screening.velocityLimitRemainingAtomic',
  );
  const maxAmount = parseAtomicUnits(input.screening.maxAmountAtomic, 'screening.maxAmountAtomic');
  let status: CustodyPolicyAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'custody-velocity-and-limit-ready';
  if (!input.screening.velocityLimitChecked) {
    status = 'missing';
    reasonCode = 'custody-velocity-limit-not-checked';
  } else if (amount > remaining || amount > maxAmount) {
    status = 'failed';
    reasonCode = 'custody-velocity-or-limit-exceeded';
  }
  return expectation({
    kind: 'velocity-limit',
    status,
    reasonCode,
    evidence: {
      amount: input.transaction.amount,
      velocityLimitChecked: input.screening.velocityLimitChecked,
      velocityLimitRemainingAtomic: input.screening.velocityLimitRemainingAtomic,
      maxAmountAtomic: input.screening.maxAmountAtomic,
    },
  });
}

function keyPostureExpectation(
  keyPosture: CustodyKeyPostureEvidence,
): CustodyPolicyAdmissionExpectation {
  const ready =
    keyPosture.cosignerPaired &&
    keyPosture.cosignerHealthy &&
    keyPosture.enclaveBacked &&
    keyPosture.keyShareHealthy &&
    keyPosture.signingPolicyBound &&
    !keyPosture.keyExportable &&
    keyPosture.signerRoleBound &&
    keyPosture.haSignerAvailable &&
    keyPosture.recoveryReady;
  return expectation({
    kind: 'key-posture',
    status: ready ? 'satisfied' : 'failed',
    reasonCode: ready
      ? 'custody-key-posture-ready'
      : 'custody-key-posture-unsafe',
    evidence: {
      keyId: keyPosture.keyId,
      keyType: keyPosture.keyType,
      cosignerId: keyPosture.cosignerId,
      cosignerPaired: keyPosture.cosignerPaired,
      cosignerHealthy: keyPosture.cosignerHealthy,
      enclaveBacked: keyPosture.enclaveBacked,
      keyShareHealthy: keyPosture.keyShareHealthy,
      signingPolicyBound: keyPosture.signingPolicyBound,
      keyExportable: keyPosture.keyExportable,
      signerRoleBound: keyPosture.signerRoleBound,
      haSignerAvailable: keyPosture.haSignerAvailable,
      recoveryReady: keyPosture.recoveryReady,
    },
  });
}

function callbackResponseExpectation(
  callback: CustodyCosignerCallbackEvidence,
): CustodyPolicyAdmissionExpectation {
  const action = normalizeIdentifier(callback.responseAction, 'callback.responseAction');
  let status: CustodyPolicyAdmissionExpectationStatus = 'unsupported';
  let reasonCode = 'custody-callback-response-unsupported';
  if (action === 'approve') {
    status = 'satisfied';
    reasonCode = 'custody-callback-response-approved';
  } else if (action === 'pending-review') {
    status = 'pending';
    reasonCode = 'custody-callback-response-needs-review';
  } else if (action === 'retry') {
    status = 'pending';
    reasonCode = 'custody-callback-response-retry';
  } else if (action === 'reject') {
    status = 'failed';
    reasonCode = 'custody-callback-response-rejected';
  }
  return expectation({
    kind: 'callback-response',
    status,
    reasonCode,
    evidence: {
      responseAction: action,
      responseSigned: callback.responseSigned,
      responseWithinSeconds: callback.responseWithinSeconds,
    },
  });
}

function postExecutionExpectation(
  postExecution: CustodyPostExecutionEvidence,
): CustodyPolicyAdmissionExpectation {
  const status = normalizeIdentifier(postExecution.status, 'postExecution.status');
  const failed = status === 'failed' || status === 'cancelled';
  return expectation({
    kind: 'post-execution',
    status: failed ? 'failed' : 'satisfied',
    reasonCode: failed
      ? 'custody-post-execution-status-failed'
      : 'custody-post-execution-status-compatible',
    evidence: {
      activityId: postExecution.activityId ?? null,
      status,
      signatureHash: postExecution.signatureHash ?? null,
      transactionHash: postExecution.transactionHash ?? null,
      providerStatus: postExecution.providerStatus ?? null,
      failureReason: postExecution.failureReason ?? null,
    },
  });
}

function expectationsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly account: CustodyAccountEvidence;
  readonly transaction: CustodyTransactionEvidence;
  readonly policyDecision: CustodyPolicyDecisionEvidence;
  readonly approvals: CustodyApprovalEvidence;
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly screening: CustodyScreeningEvidence;
  readonly keyPosture: CustodyKeyPostureEvidence;
  readonly postExecution: CustodyPostExecutionEvidence;
  readonly profile: CustodyPolicyCallbackProviderProfile;
  readonly protocol: CustodyPolicyCallbackProtocol;
}): readonly CustodyPolicyAdmissionExpectation[] {
  return Object.freeze([
    planSurfaceExpectation(input),
    adapterPreflightExpectation(input),
    providerBindingExpectation(input),
    transactionBindingExpectation(input),
    policyDecisionExpectation(input.policyDecision),
    approvalQuorumExpectation(input.approvals),
    dutySeparationExpectation(input.approvals),
    breakGlassExpectation(input.approvals),
    callbackConfigurationExpectation(input.callback),
    callbackAuthenticationExpectation(input),
    callbackFreshnessExpectation(input),
    attestorTokenExpectation(input),
    screeningExpectation(input.screening),
    velocityLimitExpectation(input),
    keyPostureExpectation(input.keyPosture),
    callbackResponseExpectation(input.callback),
    postExecutionExpectation(input.postExecution),
  ]);
}

function blockingReasonsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly expectations: readonly CustodyPolicyAdmissionExpectation[];
}): readonly string[] {
  const reasons: string[] = [];
  if (input.plan.outcome === 'deny') reasons.push('admission-plan-denied');
  if (input.preflight.outcome === 'block') reasons.push('custody-preflight-blocked');
  input.expectations
    .filter((entry) => entry.status === 'failed' || entry.status === 'unsupported')
    .forEach((entry) => reasons.push(entry.reasonCode));
  return Object.freeze([...new Set(reasons)]);
}

function outcomeFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly expectations: readonly CustodyPolicyAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
}): CustodyPolicyAdmissionCallbackOutcome {
  if (input.blockingReasons.length > 0) return 'deny';
  if (input.plan.outcome !== 'admit' || input.preflight.outcome !== 'allow') {
    return 'needs-review';
  }
  if (
    input.expectations.some(
      (entry) => entry.status === 'missing' || entry.status === 'pending',
    )
  ) {
    return 'needs-review';
  }
  return 'allow';
}

function actionFor(
  outcome: CustodyPolicyAdmissionCallbackOutcome,
): CustodyPolicyAdmissionCallbackAction {
  switch (outcome) {
    case 'allow':
      return 'approve-request';
    case 'needs-review':
      return 'queue-review';
    case 'deny':
      return 'reject-request';
  }
}

function normalizedCallbackActionFor(
  action: CustodyPolicyAdmissionCallbackAction,
): 'approve' | 'pending-review' | 'reject' {
  switch (action) {
    case 'approve-request':
      return 'approve';
    case 'queue-review':
      return 'pending-review';
    case 'reject-request':
      return 'reject';
  }
}

function nextActionsFor(input: {
  readonly outcome: CustodyPolicyAdmissionCallbackOutcome;
  readonly action: CustodyPolicyAdmissionCallbackAction;
}): readonly string[] {
  if (input.outcome === 'allow') {
    return Object.freeze([
      'Return the provider approval response only for this Attestor-bound custody request.',
      'Record the provider activity id, signature hash, or transaction hash against this callback contract after signing or broadcast.',
    ]);
  }
  if (input.outcome === 'needs-review') {
    return Object.freeze([
      'Do not approve the custody signing path yet.',
      'Queue reviewer, quorum, policy, callback freshness, or provider evidence and mint a fresh callback contract before approval.',
    ]);
  }
  return Object.freeze([
    'Reject or fail closed for this custody request.',
    'Do not sign, broadcast, or retry automatically until a new Attestor admission contract is created.',
  ]);
}

function contractIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly createdAt: string;
}): string {
  return canonicalObject({
    version: CUSTODY_POLICY_ADMISSION_CALLBACK_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    callbackId: input.callback.callbackId,
    nonce: input.callback.nonce,
    createdAt: input.createdAt,
  }).digest;
}

export function createCustodyPolicyAdmissionCallbackContract(
  input: CreateCustodyPolicyAdmissionCallbackContractInput,
): CustodyPolicyAdmissionCallbackContract {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const provider = normalizeIdentifier(input.account.provider, 'account.provider');
  const profile = providerProfileFor(provider);
  const protocol = protocolFor(input.callback.authMethod);
  const expectations = expectationsFor({
    ...input,
    profile,
    protocol,
  });
  const blockingReasons = blockingReasonsFor({
    plan: input.plan,
    preflight: input.preflight,
    expectations,
  });
  const outcome = outcomeFor({
    plan: input.plan,
    preflight: input.preflight,
    expectations,
    blockingReasons,
  });
  const action = actionFor(outcome);
  const contractId =
    normalizeOptionalIdentifier(input.contractId, 'contractId') ??
    contractIdFor({
      plan: input.plan,
      preflight: input.preflight,
      callback: input.callback,
      createdAt,
    });
  const callbackUrl = normalizeOptionalUrl(input.callbackUrl, 'callbackUrl');
  const providerResponse: CustodyPolicyAdmissionProviderResponse = Object.freeze({
    integrationMode: profile.integrationMode,
    protocol,
    responseDeadlineSeconds: profile.responseDeadlineSeconds,
    authenticatedChannelRequired: true,
    signedResponseRequired: signedResponseRequired(protocol),
    failClosed: true,
    observedCallbackAction: input.callback.responseAction,
    normalizedCallbackAction: normalizedCallbackActionFor(action),
  });
  const approvalQuorum = `${input.approvals.collectedApprovals}/${input.approvals.requiredApprovals}`;
  const attestorSidecar = Object.freeze({
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    releaseBindingDigest: input.preflight.releaseBindingDigest,
    policyScopeDigest: input.preflight.policyScopeDigest,
    enforcementBindingDigest: input.preflight.enforcementBindingDigest,
    provider,
    requestId: input.transaction.requestId,
    policyDecisionId: input.policyDecision.decisionId,
    callbackId: input.callback.callbackId,
    callbackNonce: input.callback.nonce,
    outcome,
    action,
  });
  const canonicalPayload = {
    version: CUSTODY_POLICY_ADMISSION_CALLBACK_SPEC_VERSION,
    contractId,
    createdAt,
    provider,
    integrationMode: profile.integrationMode,
    protocol,
    outcome,
    action,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    organizationId: normalizeIdentifier(input.account.organizationId, 'account.organizationId'),
    accountRef: normalizeIdentifier(input.account.accountRef, 'account.accountRef'),
    requestId: normalizeIdentifier(input.transaction.requestId, 'transaction.requestId'),
    idempotencyKey: normalizeIdentifier(
      input.transaction.idempotencyKey,
      'transaction.idempotencyKey',
    ),
    chain: normalizeIdentifier(input.transaction.chain, 'transaction.chain'),
    asset: normalizeIdentifier(input.transaction.asset, 'transaction.asset'),
    amount: normalizeAtomicUnits(input.transaction.amount, 'transaction.amount'),
    sourceAddress: normalizeOptionalIdentifier(
      input.transaction.sourceAddress,
      'transaction.sourceAddress',
    ),
    destinationAddress: normalizeIdentifier(
      input.transaction.destinationAddress,
      'transaction.destinationAddress',
    ),
    policyId: normalizeIdentifier(input.policyDecision.policyId, 'policyDecision.policyId'),
    policyVersion: normalizeIdentifier(
      input.policyDecision.policyVersion,
      'policyDecision.policyVersion',
    ),
    policyDecisionId: normalizeIdentifier(
      input.policyDecision.decisionId,
      'policyDecision.decisionId',
    ),
    approvalQuorum,
    keyId: normalizeIdentifier(input.keyPosture.keyId, 'keyPosture.keyId'),
    callbackId: normalizeIdentifier(input.callback.callbackId, 'callback.callbackId'),
    callbackUrl,
    providerResponse,
    attestorSidecar,
    expectations,
    blockingReasons,
    nextActions: nextActionsFor({ outcome, action }),
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function custodyPolicyAdmissionCallbackLabel(
  contract: CustodyPolicyAdmissionCallbackContract,
): string {
  return [
    `custody-callback:${contract.provider}`,
    `request:${contract.requestId}`,
    `policy:${contract.policyDecisionId}`,
    `outcome:${contract.outcome}`,
  ].join(' / ');
}

export function custodyPolicyAdmissionCallbackDescriptor():
CustodyPolicyAdmissionCallbackDescriptor {
  return Object.freeze({
    version: CUSTODY_POLICY_ADMISSION_CALLBACK_SPEC_VERSION,
    outcomes: CUSTODY_POLICY_ADMISSION_CALLBACK_OUTCOMES,
    actions: CUSTODY_POLICY_ADMISSION_CALLBACK_ACTIONS,
    integrationModes: CUSTODY_POLICY_CALLBACK_INTEGRATION_MODES,
    protocols: CUSTODY_POLICY_CALLBACK_PROTOCOLS,
    expectationKinds: CUSTODY_POLICY_ADMISSION_EXPECTATION_KINDS,
    expectationStatuses: CUSTODY_POLICY_ADMISSION_EXPECTATION_STATUSES,
    runtimeChecks: Object.freeze([
      'planSurface',
      'adapterPreflight',
      'providerBinding',
      'transactionBinding',
      'policyDecision',
      'approvalQuorum',
      'callbackAuthentication',
      'callbackFreshness',
      'attestorTokenBinding',
      'screening',
      'velocityLimit',
      'keyPosture',
      'callbackResponse',
    ]),
    standards: Object.freeze([
      'Fireblocks API co-signer callback',
      'Turnkey policy engine',
      'MPC custody signing',
      'Attestor release layer',
      'Attestor policy control plane',
      'Attestor enforcement plane',
    ]),
  });
}
