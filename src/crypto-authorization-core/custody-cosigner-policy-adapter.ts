import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type { CryptoAuthorizationIntent } from './object-model.js';
import type { CryptoConsequenceRiskAssessment } from './consequence-risk-mapping.js';
import type { CryptoReleaseDecisionBinding } from './release-decision-binding.js';
import type { CryptoPolicyControlPlaneScopeBinding } from './policy-control-plane-scope-binding.js';
import type { CryptoEnforcementVerificationBinding } from './enforcement-plane-verification.js';
import {
  createCryptoAuthorizationSimulation,
  type CryptoAuthorizationSimulationResult,
  type CryptoSimulationPreflightSignal,
} from './authorization-simulation.js';

/**
 * Custody co-signer and policy-engine adapter.
 *
 * Step 19 keeps custody-provider policy and key management outside Attestor
 * while making the pre-signing authorization evidence explicit: custody
 * account binding, policy decision, approval quorum, co-signer callback
 * authentication, screening, key posture, replay/idempotency, and Attestor
 * release/policy/enforcement readiness.
 */

export const CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION =
  'attestor.crypto-custody-cosigner-policy-adapter.v1';

export const CUSTODY_POLICY_PROVIDERS = [
  'fireblocks',
  'turnkey',
  'anchorage-digital',
  'coinbase-prime',
  'other',
] as const;
export type CustodyPolicyProvider = typeof CUSTODY_POLICY_PROVIDERS[number];

export const CUSTODY_POLICY_EFFECTS = [
  'allow',
  'deny',
  'review-required',
] as const;
export type CustodyPolicyEffect = typeof CUSTODY_POLICY_EFFECTS[number];

export const CUSTODY_POLICY_DECISION_STATUSES = [
  'approved',
  'denied',
  'pending',
  'failed',
  'timed-out',
] as const;
export type CustodyPolicyDecisionStatus =
  typeof CUSTODY_POLICY_DECISION_STATUSES[number];

export const CUSTODY_COSIGNER_AUTH_METHODS = [
  'jwt-public-key',
  'tls-certificate-pinning',
  'mtls',
  'spiffe',
  'hmac',
  'jws',
] as const;
export type CustodyCosignerAuthMethod =
  typeof CUSTODY_COSIGNER_AUTH_METHODS[number];

export const CUSTODY_COSIGNER_RESPONSE_ACTIONS = [
  'approve',
  'reject',
  'pending-review',
  'retry',
] as const;
export type CustodyCosignerResponseAction =
  typeof CUSTODY_COSIGNER_RESPONSE_ACTIONS[number];

export const CUSTODY_KEY_TYPES = ['mpc', 'hsm', 'tee-mpc', 'other'] as const;
export type CustodyKeyType = typeof CUSTODY_KEY_TYPES[number];

export const CUSTODY_POST_EXECUTION_STATUSES = [
  'not-submitted',
  'submitted',
  'signed',
  'broadcast',
  'confirmed',
  'failed',
  'cancelled',
] as const;
export type CustodyPostExecutionStatus =
  typeof CUSTODY_POST_EXECUTION_STATUSES[number];

export const CUSTODY_COSIGNER_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type CustodyCosignerOutcome =
  typeof CUSTODY_COSIGNER_OUTCOMES[number];

export const CUSTODY_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type CustodyObservationStatus =
  typeof CUSTODY_OBSERVATION_STATUSES[number];

export const CUSTODY_COSIGNER_CHECKS = [
  'custody-adapter-kind',
  'custody-withdrawal-intent',
  'custody-account-bound',
  'custody-transaction-request-bound',
  'custody-chain-asset-amount-bound',
  'custody-destination-bound',
  'custody-idempotency-replay',
  'custody-policy-engine-enabled',
  'custody-policy-explicit-decision',
  'custody-policy-implicit-deny',
  'custody-policy-scope-bound',
  'custody-policy-version-active',
  'custody-approval-quorum',
  'custody-duty-separation',
  'custody-break-glass-control',
  'custody-cosigner-callback-configured',
  'custody-cosigner-callback-authenticated',
  'custody-cosigner-callback-fresh',
  'custody-cosigner-response-bound',
  'custody-screening-risk',
  'custody-velocity-and-limit',
  'custody-key-posture',
  'custody-release-binding-ready',
  'custody-policy-binding-ready',
  'custody-enforcement-binding-ready',
  'custody-post-execution-status',
] as const;
export type CustodyCosignerCheck = typeof CUSTODY_COSIGNER_CHECKS[number];

export interface CustodyAccountEvidence {
  readonly provider: CustodyPolicyProvider | string;
  readonly organizationId: string;
  readonly workspaceId?: string | null;
  readonly vaultId?: string | null;
  readonly walletId?: string | null;
  readonly accountId: string;
  readonly accountRef: string;
  readonly chain: string;
  readonly asset: string;
  readonly sourceAddress?: string | null;
  readonly policyEngineEnabled: boolean;
  readonly custodyAccountKind?: string | null;
}

export interface CustodyTransactionEvidence {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly idempotencyFresh: boolean;
  readonly duplicateRequestDetected: boolean;
  readonly requestHash?: string | null;
  readonly operation: string;
  readonly chain: string;
  readonly asset: string;
  readonly amount: string;
  readonly sourceAccountRef: string;
  readonly sourceAddress?: string | null;
  readonly destinationAddress: string;
  readonly destinationRef?: string | null;
  readonly destinationMemo?: string | null;
  readonly targetId?: string | null;
  readonly requestedAt: string;
  readonly simulationPassed: boolean;
}

export interface CustodyPolicyConditionsEvidence {
  readonly chainBound: boolean;
  readonly accountBound: boolean;
  readonly assetBound: boolean;
  readonly destinationBound: boolean;
  readonly amountBound: boolean;
  readonly operationBound: boolean;
  readonly budgetBound: boolean;
  readonly velocityBound: boolean;
  readonly attestorReceiptRequired: boolean;
  readonly attestorReceiptMatched: boolean;
}

export interface CustodyPolicyDecisionEvidence {
  readonly provider: CustodyPolicyProvider | string;
  readonly decisionId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly activePolicyHash?: string | null;
  readonly ruleId?: string | null;
  readonly effect: CustodyPolicyEffect | string;
  readonly status: CustodyPolicyDecisionStatus | string;
  readonly matched: boolean;
  readonly explicitDeny: boolean;
  readonly implicitDeny: boolean;
  readonly evaluatedAt: string;
  readonly environment: string;
  readonly tenantId: string;
  readonly policyActivated: boolean;
  readonly conditions: CustodyPolicyConditionsEvidence;
}

export interface CustodyApprovalEvidence {
  readonly requiredApprovals: number;
  readonly collectedApprovals: number;
  readonly quorumSatisfied: boolean;
  readonly approverIds: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly collectedRoles: readonly string[];
  readonly requesterId: string;
  readonly requesterApproved: boolean;
  readonly dutySeparationSatisfied: boolean;
  readonly policyAdminApprovedOwnChange: boolean;
  readonly breakGlassUsed: boolean;
  readonly breakGlassAuthorized: boolean;
}

export interface CustodyCosignerCallbackEvidence {
  readonly callbackId: string;
  readonly configured: boolean;
  readonly authenticated: boolean;
  readonly authMethod: CustodyCosignerAuthMethod | string;
  readonly signatureValid: boolean;
  readonly tlsPinned: boolean;
  readonly senderConstrained: boolean;
  readonly sourceIpAllowlisted: boolean;
  readonly timestamp: string;
  readonly nonce: string;
  readonly nonceFresh: boolean;
  readonly bodyHash?: string | null;
  readonly bodyHashMatches: boolean;
  readonly responseAction: CustodyCosignerResponseAction | string;
  readonly responseSigned: boolean;
  readonly responseWithinSeconds: number;
  readonly attestorReleaseTokenVerified: boolean;
}

export interface CustodyScreeningEvidence {
  readonly destinationAllowlisted: boolean;
  readonly counterpartyKnown: boolean;
  readonly sanctionsScreened: boolean;
  readonly sanctionsHit: boolean;
  readonly riskScore: number;
  readonly riskScoreMax: number;
  readonly riskTierAllowed: boolean;
  readonly travelRuleRequired: boolean;
  readonly travelRuleCompleted: boolean;
  readonly velocityLimitChecked: boolean;
  readonly velocityLimitRemainingAtomic: string;
  readonly maxAmountAtomic: string;
}

export interface CustodyKeyPostureEvidence {
  readonly keyId: string;
  readonly keyType: CustodyKeyType | string;
  readonly cosignerId: string;
  readonly cosignerPaired: boolean;
  readonly cosignerHealthy: boolean;
  readonly enclaveBacked: boolean;
  readonly keyShareHealthy: boolean;
  readonly signingPolicyBound: boolean;
  readonly keyExportable: boolean;
  readonly signerRoleBound: boolean;
  readonly haSignerAvailable: boolean;
  readonly recoveryReady: boolean;
}

export interface CustodyPostExecutionEvidence {
  readonly activityId?: string | null;
  readonly status: CustodyPostExecutionStatus | string;
  readonly signatureHash?: string | null;
  readonly transactionHash?: string | null;
  readonly providerStatus?: string | null;
  readonly failureReason?: string | null;
}

export interface CustodyCosignerObservation {
  readonly check: CustodyCosignerCheck;
  readonly status: CustodyObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateCustodyCosignerPolicyPreflightInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly account: CustodyAccountEvidence;
  readonly transaction: CustodyTransactionEvidence;
  readonly policyDecision: CustodyPolicyDecisionEvidence;
  readonly approvals: CustodyApprovalEvidence;
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly screening: CustodyScreeningEvidence;
  readonly keyPosture: CustodyKeyPostureEvidence;
  readonly postExecution: CustodyPostExecutionEvidence;
  readonly preflightId?: string | null;
}

export interface CustodyCosignerPolicyPreflight {
  readonly version: typeof CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION;
  readonly preflightId: string;
  readonly adapterKind: 'custody-cosigner';
  readonly checkedAt: string;
  readonly provider: CustodyPolicyProvider | string;
  readonly organizationId: string;
  readonly accountRef: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly chain: string;
  readonly asset: string;
  readonly amount: string;
  readonly destinationAddress: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyDecisionId: string;
  readonly approvalQuorum: string;
  readonly keyId: string;
  readonly callbackId: string;
  readonly outcome: CustodyCosignerOutcome;
  readonly signal: CryptoSimulationPreflightSignal;
  readonly observations: readonly CustodyCosignerObservation[];
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface CustodyCosignerPolicySimulationResult {
  readonly preflight: CustodyCosignerPolicyPreflight;
  readonly simulation: CryptoAuthorizationSimulationResult;
}

export interface CustodyCosignerPolicyAdapterDescriptor {
  readonly version: typeof CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION;
  readonly adapterKind: 'custody-cosigner';
  readonly providers: typeof CUSTODY_POLICY_PROVIDERS;
  readonly policyEffects: typeof CUSTODY_POLICY_EFFECTS;
  readonly decisionStatuses: typeof CUSTODY_POLICY_DECISION_STATUSES;
  readonly authMethods: typeof CUSTODY_COSIGNER_AUTH_METHODS;
  readonly responseActions: typeof CUSTODY_COSIGNER_RESPONSE_ACTIONS;
  readonly keyTypes: typeof CUSTODY_KEY_TYPES;
  readonly postExecutionStatuses: typeof CUSTODY_POST_EXECUTION_STATUSES;
  readonly outcomes: typeof CUSTODY_COSIGNER_OUTCOMES;
  readonly checks: typeof CUSTODY_COSIGNER_CHECKS;
  readonly references: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`custody co-signer policy adapter ${fieldName} requires a non-empty value.`);
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
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`custody co-signer policy adapter ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `custody co-signer policy adapter ${fieldName} must be a non-negative integer.`,
    );
  }
  return value;
}

function normalizeNonNegativeNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `custody co-signer policy adapter ${fieldName} must be a non-negative number.`,
    );
  }
  return value;
}

function normalizeStringArray(values: readonly string[], fieldName: string): readonly string[] {
  return Object.freeze(values.map((entry, index) => normalizeIdentifier(entry, `${fieldName}[${index}]`)));
}

function normalizeAtomicUnits(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(0|[1-9][0-9]*)$/u.test(normalized)) {
    throw new Error(`custody co-signer policy adapter ${fieldName} must be unsigned atomic units.`);
  }
  return normalized;
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

function caip2ChainId(intent: CryptoAuthorizationIntent): string {
  return `${intent.chain.namespace}:${intent.chain.chainId}`;
}

function canonicalAddress(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized.toLowerCase() : null;
}

function sameIdentifier(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left?.trim() ?? '').toLowerCase() === (right?.trim() ?? '').toLowerCase();
}

function includesString(values: readonly string[], candidate: string): boolean {
  return values.some((entry) => sameIdentifier(entry, candidate));
}

function normalizeAccount(account: CustodyAccountEvidence): CustodyAccountEvidence {
  return Object.freeze({
    provider: normalizeIdentifier(account.provider, 'account.provider'),
    organizationId: normalizeIdentifier(account.organizationId, 'account.organizationId'),
    workspaceId: normalizeOptionalIdentifier(account.workspaceId, 'account.workspaceId'),
    vaultId: normalizeOptionalIdentifier(account.vaultId, 'account.vaultId'),
    walletId: normalizeOptionalIdentifier(account.walletId, 'account.walletId'),
    accountId: normalizeIdentifier(account.accountId, 'account.accountId'),
    accountRef: normalizeIdentifier(account.accountRef, 'account.accountRef'),
    chain: normalizeIdentifier(account.chain, 'account.chain'),
    asset: normalizeIdentifier(account.asset, 'account.asset'),
    sourceAddress: normalizeOptionalIdentifier(account.sourceAddress, 'account.sourceAddress'),
    policyEngineEnabled: account.policyEngineEnabled === true,
    custodyAccountKind: normalizeOptionalIdentifier(
      account.custodyAccountKind,
      'account.custodyAccountKind',
    ),
  });
}

function normalizeTransaction(transaction: CustodyTransactionEvidence): CustodyTransactionEvidence {
  return Object.freeze({
    requestId: normalizeIdentifier(transaction.requestId, 'transaction.requestId'),
    idempotencyKey: normalizeIdentifier(transaction.idempotencyKey, 'transaction.idempotencyKey'),
    idempotencyFresh: transaction.idempotencyFresh === true,
    duplicateRequestDetected: transaction.duplicateRequestDetected === true,
    requestHash: normalizeOptionalIdentifier(transaction.requestHash, 'transaction.requestHash'),
    operation: normalizeIdentifier(transaction.operation, 'transaction.operation'),
    chain: normalizeIdentifier(transaction.chain, 'transaction.chain'),
    asset: normalizeIdentifier(transaction.asset, 'transaction.asset'),
    amount: normalizeAtomicUnits(transaction.amount, 'transaction.amount'),
    sourceAccountRef: normalizeIdentifier(transaction.sourceAccountRef, 'transaction.sourceAccountRef'),
    sourceAddress: normalizeOptionalIdentifier(transaction.sourceAddress, 'transaction.sourceAddress'),
    destinationAddress: normalizeIdentifier(
      transaction.destinationAddress,
      'transaction.destinationAddress',
    ),
    destinationRef: normalizeOptionalIdentifier(transaction.destinationRef, 'transaction.destinationRef'),
    destinationMemo: normalizeOptionalIdentifier(transaction.destinationMemo, 'transaction.destinationMemo'),
    targetId: normalizeOptionalIdentifier(transaction.targetId, 'transaction.targetId'),
    requestedAt: normalizeIsoTimestamp(transaction.requestedAt, 'transaction.requestedAt'),
    simulationPassed: transaction.simulationPassed === true,
  });
}

function normalizeConditions(
  conditions: CustodyPolicyConditionsEvidence,
): CustodyPolicyConditionsEvidence {
  return Object.freeze({
    chainBound: conditions.chainBound === true,
    accountBound: conditions.accountBound === true,
    assetBound: conditions.assetBound === true,
    destinationBound: conditions.destinationBound === true,
    amountBound: conditions.amountBound === true,
    operationBound: conditions.operationBound === true,
    budgetBound: conditions.budgetBound === true,
    velocityBound: conditions.velocityBound === true,
    attestorReceiptRequired: conditions.attestorReceiptRequired === true,
    attestorReceiptMatched: conditions.attestorReceiptMatched === true,
  });
}

function normalizePolicyDecision(
  decision: CustodyPolicyDecisionEvidence,
): CustodyPolicyDecisionEvidence {
  return Object.freeze({
    provider: normalizeIdentifier(decision.provider, 'policyDecision.provider'),
    decisionId: normalizeIdentifier(decision.decisionId, 'policyDecision.decisionId'),
    policyId: normalizeIdentifier(decision.policyId, 'policyDecision.policyId'),
    policyVersion: normalizeIdentifier(decision.policyVersion, 'policyDecision.policyVersion'),
    policyHash: normalizeIdentifier(decision.policyHash, 'policyDecision.policyHash'),
    activePolicyHash: normalizeOptionalIdentifier(
      decision.activePolicyHash,
      'policyDecision.activePolicyHash',
    ),
    ruleId: normalizeOptionalIdentifier(decision.ruleId, 'policyDecision.ruleId'),
    effect: normalizeIdentifier(decision.effect, 'policyDecision.effect'),
    status: normalizeIdentifier(decision.status, 'policyDecision.status'),
    matched: decision.matched === true,
    explicitDeny: decision.explicitDeny === true,
    implicitDeny: decision.implicitDeny === true,
    evaluatedAt: normalizeIsoTimestamp(decision.evaluatedAt, 'policyDecision.evaluatedAt'),
    environment: normalizeIdentifier(decision.environment, 'policyDecision.environment'),
    tenantId: normalizeIdentifier(decision.tenantId, 'policyDecision.tenantId'),
    policyActivated: decision.policyActivated === true,
    conditions: normalizeConditions(decision.conditions),
  });
}

function normalizeApprovals(approvals: CustodyApprovalEvidence): CustodyApprovalEvidence {
  return Object.freeze({
    requiredApprovals: normalizeNonNegativeInteger(
      approvals.requiredApprovals,
      'approvals.requiredApprovals',
    ),
    collectedApprovals: normalizeNonNegativeInteger(
      approvals.collectedApprovals,
      'approvals.collectedApprovals',
    ),
    quorumSatisfied: approvals.quorumSatisfied === true,
    approverIds: normalizeStringArray(approvals.approverIds, 'approvals.approverIds'),
    requiredRoles: normalizeStringArray(approvals.requiredRoles, 'approvals.requiredRoles'),
    collectedRoles: normalizeStringArray(approvals.collectedRoles, 'approvals.collectedRoles'),
    requesterId: normalizeIdentifier(approvals.requesterId, 'approvals.requesterId'),
    requesterApproved: approvals.requesterApproved === true,
    dutySeparationSatisfied: approvals.dutySeparationSatisfied === true,
    policyAdminApprovedOwnChange: approvals.policyAdminApprovedOwnChange === true,
    breakGlassUsed: approvals.breakGlassUsed === true,
    breakGlassAuthorized: approvals.breakGlassAuthorized === true,
  });
}

function normalizeCallback(callback: CustodyCosignerCallbackEvidence): CustodyCosignerCallbackEvidence {
  return Object.freeze({
    callbackId: normalizeIdentifier(callback.callbackId, 'callback.callbackId'),
    configured: callback.configured === true,
    authenticated: callback.authenticated === true,
    authMethod: normalizeIdentifier(callback.authMethod, 'callback.authMethod'),
    signatureValid: callback.signatureValid === true,
    tlsPinned: callback.tlsPinned === true,
    senderConstrained: callback.senderConstrained === true,
    sourceIpAllowlisted: callback.sourceIpAllowlisted === true,
    timestamp: normalizeIsoTimestamp(callback.timestamp, 'callback.timestamp'),
    nonce: normalizeIdentifier(callback.nonce, 'callback.nonce'),
    nonceFresh: callback.nonceFresh === true,
    bodyHash: normalizeOptionalIdentifier(callback.bodyHash, 'callback.bodyHash'),
    bodyHashMatches: callback.bodyHashMatches === true,
    responseAction: normalizeIdentifier(callback.responseAction, 'callback.responseAction'),
    responseSigned: callback.responseSigned === true,
    responseWithinSeconds: normalizeNonNegativeNumber(
      callback.responseWithinSeconds,
      'callback.responseWithinSeconds',
    ),
    attestorReleaseTokenVerified: callback.attestorReleaseTokenVerified === true,
  });
}

function normalizeScreening(screening: CustodyScreeningEvidence): CustodyScreeningEvidence {
  return Object.freeze({
    destinationAllowlisted: screening.destinationAllowlisted === true,
    counterpartyKnown: screening.counterpartyKnown === true,
    sanctionsScreened: screening.sanctionsScreened === true,
    sanctionsHit: screening.sanctionsHit === true,
    riskScore: normalizeNonNegativeNumber(screening.riskScore, 'screening.riskScore'),
    riskScoreMax: normalizeNonNegativeNumber(screening.riskScoreMax, 'screening.riskScoreMax'),
    riskTierAllowed: screening.riskTierAllowed === true,
    travelRuleRequired: screening.travelRuleRequired === true,
    travelRuleCompleted: screening.travelRuleCompleted === true,
    velocityLimitChecked: screening.velocityLimitChecked === true,
    velocityLimitRemainingAtomic: normalizeAtomicUnits(
      screening.velocityLimitRemainingAtomic,
      'screening.velocityLimitRemainingAtomic',
    ),
    maxAmountAtomic: normalizeAtomicUnits(screening.maxAmountAtomic, 'screening.maxAmountAtomic'),
  });
}

function normalizeKeyPosture(posture: CustodyKeyPostureEvidence): CustodyKeyPostureEvidence {
  return Object.freeze({
    keyId: normalizeIdentifier(posture.keyId, 'keyPosture.keyId'),
    keyType: normalizeIdentifier(posture.keyType, 'keyPosture.keyType'),
    cosignerId: normalizeIdentifier(posture.cosignerId, 'keyPosture.cosignerId'),
    cosignerPaired: posture.cosignerPaired === true,
    cosignerHealthy: posture.cosignerHealthy === true,
    enclaveBacked: posture.enclaveBacked === true,
    keyShareHealthy: posture.keyShareHealthy === true,
    signingPolicyBound: posture.signingPolicyBound === true,
    keyExportable: posture.keyExportable === true,
    signerRoleBound: posture.signerRoleBound === true,
    haSignerAvailable: posture.haSignerAvailable === true,
    recoveryReady: posture.recoveryReady === true,
  });
}

function normalizePostExecution(postExecution: CustodyPostExecutionEvidence): CustodyPostExecutionEvidence {
  return Object.freeze({
    activityId: normalizeOptionalIdentifier(postExecution.activityId, 'postExecution.activityId'),
    status: normalizeIdentifier(postExecution.status, 'postExecution.status'),
    signatureHash: normalizeOptionalIdentifier(postExecution.signatureHash, 'postExecution.signatureHash'),
    transactionHash: normalizeOptionalIdentifier(
      postExecution.transactionHash,
      'postExecution.transactionHash',
    ),
    providerStatus: normalizeOptionalIdentifier(postExecution.providerStatus, 'postExecution.providerStatus'),
    failureReason: normalizeOptionalIdentifier(postExecution.failureReason, 'postExecution.failureReason'),
  });
}

function releaseReady(releaseBinding: CryptoReleaseDecisionBinding): boolean {
  return (
    releaseBinding.status === 'bound' &&
    (releaseBinding.releaseDecision.status === 'accepted' ||
      releaseBinding.releaseDecision.status === 'overridden')
  );
}

function policyBindingReady(policyScopeBinding: CryptoPolicyControlPlaneScopeBinding): boolean {
  return policyScopeBinding.activationRecord.state === 'active';
}

function enforcementReady(enforcementBinding: CryptoEnforcementVerificationBinding): boolean {
  return (
    enforcementBinding.adapterKind === 'custody-cosigner' &&
    enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind === 'action-dispatch' &&
    enforcementBinding.verificationProfile.failClosed
  );
}

function assertAdapterConsistency(input: CreateCustodyCosignerPolicyPreflightInput): void {
  if (input.intent.executionAdapterKind !== 'custody-cosigner') {
    throw new Error(
      'custody co-signer policy adapter requires intent execution adapter custody-cosigner.',
    );
  }
  if (input.intent.consequenceKind !== 'custody-withdrawal') {
    throw new Error(
      'custody co-signer policy adapter requires custody-withdrawal intent consequence.',
    );
  }
  if (input.intent.account.accountKind !== 'custody-account') {
    throw new Error('custody co-signer policy adapter requires a custody account intent.');
  }
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('custody co-signer policy adapter risk consequence does not match intent.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.policyScopeBinding.cryptoDecisionId) {
    throw new Error('custody co-signer policy adapter policy binding does not match release binding.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.enforcementBinding.cryptoDecisionId) {
    throw new Error(
      'custody co-signer policy adapter enforcement binding does not match release binding.',
    );
  }
  if (input.enforcementBinding.adapterKind !== 'custody-cosigner') {
    throw new Error(
      'custody co-signer policy adapter requires custody-cosigner enforcement binding.',
    );
  }
  if (input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind !== 'action-dispatch') {
    throw new Error('custody co-signer policy adapter requires action-dispatch enforcement.');
  }
  if (!input.enforcementBinding.verificationProfile.failClosed) {
    throw new Error(
      'custody co-signer policy adapter requires fail-closed enforcement verification.',
    );
  }
}

function observation(input: {
  readonly check: CustodyCosignerCheck;
  readonly status: CustodyObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): CustodyCosignerObservation {
  return Object.freeze({
    check: input.check,
    status: input.status,
    code: normalizeIdentifier(input.code, 'observation.code'),
    message: normalizeIdentifier(input.message, 'observation.message'),
    required: input.required ?? true,
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function policyConditionsReady(conditions: CustodyPolicyConditionsEvidence): boolean {
  return (
    conditions.chainBound &&
    conditions.accountBound &&
    conditions.assetBound &&
    conditions.destinationBound &&
    conditions.amountBound &&
    conditions.operationBound &&
    conditions.budgetBound &&
    conditions.velocityBound &&
    conditions.attestorReceiptRequired &&
    conditions.attestorReceiptMatched
  );
}

function collectedRequiredRoles(input: CustodyApprovalEvidence): boolean {
  return input.requiredRoles.every((role) => includesString(input.collectedRoles, role));
}

function policyDecisionAllows(decision: CustodyPolicyDecisionEvidence): boolean {
  return (
    decision.effect === 'allow' &&
    decision.status === 'approved' &&
    decision.matched &&
    !decision.explicitDeny &&
    !decision.implicitDeny
  );
}

function policyDecisionPending(decision: CustodyPolicyDecisionEvidence): boolean {
  return decision.effect === 'review-required' || decision.status === 'pending';
}

function callbackAuthenticated(callback: CustodyCosignerCallbackEvidence): boolean {
  return (
    callback.configured &&
    callback.authenticated &&
    callback.signatureValid &&
    callback.tlsPinned &&
    callback.senderConstrained &&
    callback.sourceIpAllowlisted
  );
}

function callbackFresh(callback: CustodyCosignerCallbackEvidence): boolean {
  return (
    callback.nonceFresh &&
    callback.bodyHashMatches &&
    callback.responseWithinSeconds <= 30
  );
}

function responseAllows(callback: CustodyCosignerCallbackEvidence): boolean {
  return (
    callback.responseAction === 'approve' &&
    callback.responseSigned &&
    callback.attestorReleaseTokenVerified
  );
}

function responseNeedsReview(callback: CustodyCosignerCallbackEvidence): boolean {
  return callback.responseAction === 'pending-review' || callback.responseAction === 'retry';
}

function screeningReady(
  screening: CustodyScreeningEvidence,
): boolean {
  const travelRuleReady =
    !screening.travelRuleRequired || screening.travelRuleCompleted;
  return (
    screening.destinationAllowlisted &&
    screening.counterpartyKnown &&
    screening.sanctionsScreened &&
    !screening.sanctionsHit &&
    screening.riskTierAllowed &&
    screening.riskScore <= screening.riskScoreMax &&
    travelRuleReady
  );
}

function velocityReady(input: {
  readonly screening: CustodyScreeningEvidence;
  readonly transaction: CustodyTransactionEvidence;
  readonly intent: CryptoAuthorizationIntent;
}): boolean {
  const amount = parseAtomicUnits(input.transaction.amount, 'transaction.amount');
  const remaining = parseAtomicUnits(
    input.screening.velocityLimitRemainingAtomic,
    'screening.velocityLimitRemainingAtomic',
  );
  const maxAmount = parseAtomicUnits(input.screening.maxAmountAtomic, 'screening.maxAmountAtomic');
  const intentMax = input.intent.constraints.maxAmount
    ? parseAtomicUnits(input.intent.constraints.maxAmount, 'intent.constraints.maxAmount')
    : null;
  return (
    input.screening.velocityLimitChecked &&
    amount <= remaining &&
    amount <= maxAmount &&
    (intentMax === null || amount <= intentMax)
  );
}

function keyPostureReady(keyPosture: CustodyKeyPostureEvidence): boolean {
  return (
    (keyPosture.keyType === 'mpc' || keyPosture.keyType === 'hsm' || keyPosture.keyType === 'tee-mpc') &&
    keyPosture.cosignerPaired &&
    keyPosture.cosignerHealthy &&
    keyPosture.enclaveBacked &&
    keyPosture.keyShareHealthy &&
    keyPosture.signingPolicyBound &&
    !keyPosture.keyExportable &&
    keyPosture.signerRoleBound &&
    keyPosture.haSignerAvailable &&
    keyPosture.recoveryReady
  );
}

function postExecutionReady(postExecution: CustodyPostExecutionEvidence): boolean {
  return (
    postExecution.status === 'not-submitted' ||
    postExecution.status === 'submitted' ||
    postExecution.status === 'signed' ||
    postExecution.status === 'broadcast' ||
    postExecution.status === 'confirmed'
  );
}

function buildObservations(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly account: CustodyAccountEvidence;
  readonly transaction: CustodyTransactionEvidence;
  readonly policyDecision: CustodyPolicyDecisionEvidence;
  readonly approvals: CustodyApprovalEvidence;
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly screening: CustodyScreeningEvidence;
  readonly keyPosture: CustodyKeyPostureEvidence;
  readonly postExecution: CustodyPostExecutionEvidence;
}): readonly CustodyCosignerObservation[] {
  const observations: CustodyCosignerObservation[] = [];
  const intentChainId = caip2ChainId(input.intent);
  const intentAsset = input.intent.asset?.assetId ?? null;
  const targetAddress = input.intent.target.address ?? input.intent.target.counterparty;
  const sourceAddressReady =
    !input.account.sourceAddress ||
    !input.transaction.sourceAddress ||
    sameIdentifier(input.account.sourceAddress, input.transaction.sourceAddress);
  const providerMatches = sameIdentifier(input.account.provider, input.policyDecision.provider);
  const accountReady =
    input.intent.account.accountKind === 'custody-account' &&
    input.account.chain === intentChainId &&
    sameIdentifier(input.account.asset, intentAsset) &&
    sameIdentifier(input.account.accountRef, input.transaction.sourceAccountRef) &&
    sourceAddressReady;
  const transactionBound =
    input.transaction.chain === intentChainId &&
    sameIdentifier(input.transaction.asset, intentAsset) &&
    input.transaction.simulationPassed;
  const destinationBound =
    sameIdentifier(input.transaction.destinationAddress, targetAddress) &&
    (!input.transaction.targetId || sameIdentifier(input.transaction.targetId, input.intent.target.targetId));
  const amountBound =
    input.intent.constraints.maxAmount === null ||
    parseAtomicUnits(input.transaction.amount, 'transaction.amount') <=
      parseAtomicUnits(input.intent.constraints.maxAmount, 'intent.constraints.maxAmount');
  const replayReady =
    input.transaction.idempotencyFresh && !input.transaction.duplicateRequestDetected;
  const policyActive =
    input.policyDecision.policyActivated &&
    (input.policyDecision.activePolicyHash === null ||
      input.policyDecision.activePolicyHash === input.policyDecision.policyHash);
  const quorumReady =
    input.approvals.quorumSatisfied &&
    input.approvals.collectedApprovals >= input.approvals.requiredApprovals &&
    input.approvals.approverIds.length >= input.approvals.requiredApprovals &&
    collectedRequiredRoles(input.approvals);
  const dutySeparationReady =
    input.approvals.dutySeparationSatisfied &&
    !input.approvals.requesterApproved &&
    !input.approvals.policyAdminApprovedOwnChange;
  const breakGlassReady =
    !input.approvals.breakGlassUsed || input.approvals.breakGlassAuthorized;
  const screeningIsReady = screeningReady(input.screening);
  const velocityIsReady = velocityReady({
    screening: input.screening,
    transaction: input.transaction,
    intent: input.intent,
  });

  observations.push(
    observation({
      check: 'custody-adapter-kind',
      status: input.intent.executionAdapterKind === 'custody-cosigner' ? 'pass' : 'fail',
      code:
        input.intent.executionAdapterKind === 'custody-cosigner'
          ? 'custody-adapter-kind-ready'
          : 'custody-adapter-kind-mismatch',
      message: 'Custody policy evidence is bound to the custody co-signer adapter.',
      evidence: {
        adapterKind: input.intent.executionAdapterKind ?? null,
      },
    }),
    observation({
      check: 'custody-withdrawal-intent',
      status:
        input.intent.consequenceKind === 'custody-withdrawal' &&
        input.intent.account.accountKind === 'custody-account'
          ? 'pass'
          : 'fail',
      code:
        input.intent.consequenceKind === 'custody-withdrawal' &&
        input.intent.account.accountKind === 'custody-account'
          ? 'custody-withdrawal-intent-ready'
          : 'custody-withdrawal-intent-invalid',
      message: 'Intent is a custody-account withdrawal consequence.',
      evidence: {
        consequenceKind: input.intent.consequenceKind,
        accountKind: input.intent.account.accountKind,
      },
    }),
    observation({
      check: 'custody-account-bound',
      status: accountReady && providerMatches ? 'pass' : 'fail',
      code: accountReady && providerMatches
        ? 'custody-account-bound'
        : 'custody-account-binding-mismatch',
      message: 'Custody account, provider, chain, asset, and source references match the intent.',
      evidence: {
        provider: input.account.provider,
        policyProvider: input.policyDecision.provider,
        accountRef: input.account.accountRef,
        chain: input.account.chain,
        asset: input.account.asset,
        sourceAddress: input.account.sourceAddress ?? null,
      },
    }),
    observation({
      check: 'custody-transaction-request-bound',
      status: input.transaction.simulationPassed ? 'pass' : 'fail',
      code: input.transaction.simulationPassed
        ? 'custody-transaction-request-ready'
        : 'custody-transaction-simulation-failed',
      message: 'Custody transaction request has a provider request id, hash, and simulation result.',
      evidence: {
        requestId: input.transaction.requestId,
        requestHash: input.transaction.requestHash ?? null,
        operation: input.transaction.operation,
        requestedAt: input.transaction.requestedAt,
      },
    }),
    observation({
      check: 'custody-chain-asset-amount-bound',
      status: transactionBound && amountBound ? 'pass' : 'fail',
      code: transactionBound && amountBound
        ? 'custody-chain-asset-amount-bound'
        : 'custody-chain-asset-amount-mismatch',
      message: 'Custody request chain, asset, and amount stay inside the Attestor intent.',
      evidence: {
        intentChainId,
        transactionChain: input.transaction.chain,
        intentAsset,
        transactionAsset: input.transaction.asset,
        amount: input.transaction.amount,
        maxAmount: input.intent.constraints.maxAmount,
      },
    }),
    observation({
      check: 'custody-destination-bound',
      status: destinationBound ? 'pass' : 'fail',
      code: destinationBound
        ? 'custody-destination-bound'
        : 'custody-destination-mismatch',
      message: 'Custody destination address and target bind to the intended counterparty.',
      evidence: {
        targetAddress: targetAddress ?? null,
        destinationAddress: canonicalAddress(input.transaction.destinationAddress),
        destinationRef: input.transaction.destinationRef ?? null,
        targetId: input.transaction.targetId ?? null,
      },
    }),
    observation({
      check: 'custody-idempotency-replay',
      status: replayReady ? 'pass' : 'fail',
      code: replayReady
        ? 'custody-idempotency-fresh'
        : 'custody-idempotency-replay-risk',
      message: 'Custody request idempotency key is fresh and no duplicate provider request is known.',
      evidence: {
        idempotencyKey: input.transaction.idempotencyKey,
        idempotencyFresh: input.transaction.idempotencyFresh,
        duplicateRequestDetected: input.transaction.duplicateRequestDetected,
      },
    }),
    observation({
      check: 'custody-policy-engine-enabled',
      status: input.account.policyEngineEnabled ? 'pass' : 'fail',
      code: input.account.policyEngineEnabled
        ? 'custody-policy-engine-enabled'
        : 'custody-policy-engine-disabled',
      message: 'Custody platform policy engine is enabled for the source account.',
      evidence: {
        provider: input.account.provider,
        accountRef: input.account.accountRef,
      },
    }),
  );

  if (policyDecisionAllows(input.policyDecision)) {
    observations.push(
      observation({
        check: 'custody-policy-explicit-decision',
        status: 'pass',
        code: 'custody-policy-explicit-allow',
        message: 'Custody policy engine produced an explicit allow decision.',
        evidence: {
          decisionId: input.policyDecision.decisionId,
          policyId: input.policyDecision.policyId,
          ruleId: input.policyDecision.ruleId ?? null,
          effect: input.policyDecision.effect,
          status: input.policyDecision.status,
        },
      }),
    );
  } else if (policyDecisionPending(input.policyDecision)) {
    observations.push(
      observation({
        check: 'custody-policy-explicit-decision',
        status: 'warn',
        code: 'custody-policy-decision-pending-review',
        message: 'Custody policy engine has not produced a final explicit allow decision yet.',
        evidence: {
          decisionId: input.policyDecision.decisionId,
          effect: input.policyDecision.effect,
          status: input.policyDecision.status,
        },
      }),
    );
  } else {
    observations.push(
      observation({
        check: 'custody-policy-explicit-decision',
        status: 'fail',
        code: input.policyDecision.explicitDeny || input.policyDecision.status === 'denied'
          ? 'custody-policy-explicit-deny'
          : 'custody-policy-decision-not-allow',
        message: 'Custody policy engine did not produce an explicit allow decision.',
        evidence: {
          decisionId: input.policyDecision.decisionId,
          effect: input.policyDecision.effect,
          status: input.policyDecision.status,
          explicitDeny: input.policyDecision.explicitDeny,
        },
      }),
    );
  }

  observations.push(
    observation({
      check: 'custody-policy-implicit-deny',
      status:
        input.policyDecision.matched &&
        !input.policyDecision.implicitDeny &&
        !input.policyDecision.explicitDeny
          ? 'pass'
          : 'fail',
      code:
        input.policyDecision.matched &&
        !input.policyDecision.implicitDeny &&
        !input.policyDecision.explicitDeny
          ? 'custody-policy-no-implicit-deny'
          : 'custody-policy-implicit-deny',
      message: 'Custody policy must match a rule explicitly and must not fall through implicit deny.',
      evidence: {
        matched: input.policyDecision.matched,
        explicitDeny: input.policyDecision.explicitDeny,
        implicitDeny: input.policyDecision.implicitDeny,
      },
    }),
    observation({
      check: 'custody-policy-scope-bound',
      status: policyConditionsReady(input.policyDecision.conditions) ? 'pass' : 'fail',
      code: policyConditionsReady(input.policyDecision.conditions)
        ? 'custody-policy-scope-bound'
        : 'custody-policy-scope-incomplete',
      message: 'Custody policy conditions bind chain, account, asset, destination, amount, operation, budget, velocity, and Attestor receipt.',
      evidence: {
        chainBound: input.policyDecision.conditions.chainBound,
        accountBound: input.policyDecision.conditions.accountBound,
        assetBound: input.policyDecision.conditions.assetBound,
        destinationBound: input.policyDecision.conditions.destinationBound,
        amountBound: input.policyDecision.conditions.amountBound,
        operationBound: input.policyDecision.conditions.operationBound,
        budgetBound: input.policyDecision.conditions.budgetBound,
        velocityBound: input.policyDecision.conditions.velocityBound,
        attestorReceiptRequired: input.policyDecision.conditions.attestorReceiptRequired,
        attestorReceiptMatched: input.policyDecision.conditions.attestorReceiptMatched,
      },
    }),
    observation({
      check: 'custody-policy-version-active',
      status: policyActive ? 'pass' : 'fail',
      code: policyActive
        ? 'custody-policy-version-active'
        : 'custody-policy-version-inactive',
      message: 'Custody policy decision came from the active policy version and hash.',
      evidence: {
        policyId: input.policyDecision.policyId,
        policyVersion: input.policyDecision.policyVersion,
        policyHash: input.policyDecision.policyHash,
        activePolicyHash: input.policyDecision.activePolicyHash ?? null,
        evaluatedAt: input.policyDecision.evaluatedAt,
      },
    }),
    observation({
      check: 'custody-approval-quorum',
      status: quorumReady ? 'pass' : 'warn',
      code: quorumReady
        ? 'custody-approval-quorum-satisfied'
        : 'custody-approval-quorum-pending',
      message: 'Custody approval quorum and required roles are satisfied before co-signing.',
      evidence: {
        requiredApprovals: input.approvals.requiredApprovals,
        collectedApprovals: input.approvals.collectedApprovals,
        requiredRoles: input.approvals.requiredRoles,
        collectedRoles: input.approvals.collectedRoles,
      },
    }),
    observation({
      check: 'custody-duty-separation',
      status: dutySeparationReady ? 'pass' : 'fail',
      code: dutySeparationReady
        ? 'custody-duty-separation-satisfied'
        : 'custody-duty-separation-violated',
      message: 'Requester, approver, and policy-admin roles remain separated.',
      evidence: {
        requesterId: input.approvals.requesterId,
        requesterApproved: input.approvals.requesterApproved,
        policyAdminApprovedOwnChange: input.approvals.policyAdminApprovedOwnChange,
        dutySeparationSatisfied: input.approvals.dutySeparationSatisfied,
      },
    }),
    observation({
      check: 'custody-break-glass-control',
      status: breakGlassReady
        ? input.approvals.breakGlassUsed
          ? 'warn'
          : 'pass'
        : 'fail',
      code: breakGlassReady
        ? input.approvals.breakGlassUsed
          ? 'custody-break-glass-authorized-review'
          : 'custody-break-glass-not-used'
        : 'custody-break-glass-unauthorized',
      message: 'Break-glass custody approval is either unused or explicitly authorized.',
      evidence: {
        breakGlassUsed: input.approvals.breakGlassUsed,
        breakGlassAuthorized: input.approvals.breakGlassAuthorized,
      },
    }),
    observation({
      check: 'custody-cosigner-callback-configured',
      status: input.callback.configured ? 'pass' : 'fail',
      code: input.callback.configured
        ? 'custody-cosigner-callback-configured'
        : 'custody-cosigner-callback-missing',
      message: 'Custody co-signer callback is configured as the authorization chokepoint.',
      evidence: {
        callbackId: input.callback.callbackId,
        authMethod: input.callback.authMethod,
      },
    }),
    observation({
      check: 'custody-cosigner-callback-authenticated',
      status: callbackAuthenticated(input.callback) ? 'pass' : 'fail',
      code: callbackAuthenticated(input.callback)
        ? 'custody-cosigner-callback-authenticated'
        : 'custody-cosigner-callback-authentication-failed',
      message: 'Co-signer callback is authenticated, signed, sender-constrained, TLS-pinned, and source constrained.',
      evidence: {
        authenticated: input.callback.authenticated,
        signatureValid: input.callback.signatureValid,
        tlsPinned: input.callback.tlsPinned,
        senderConstrained: input.callback.senderConstrained,
        sourceIpAllowlisted: input.callback.sourceIpAllowlisted,
      },
    }),
    observation({
      check: 'custody-cosigner-callback-fresh',
      status: callbackFresh(input.callback) ? 'pass' : 'fail',
      code: callbackFresh(input.callback)
        ? 'custody-cosigner-callback-fresh'
        : 'custody-cosigner-callback-replay-risk',
      message: 'Co-signer callback nonce, body hash, and response latency are fresh.',
      evidence: {
        timestamp: input.callback.timestamp,
        nonce: input.callback.nonce,
        nonceFresh: input.callback.nonceFresh,
        bodyHash: input.callback.bodyHash ?? null,
        bodyHashMatches: input.callback.bodyHashMatches,
        responseWithinSeconds: input.callback.responseWithinSeconds,
      },
    }),
  );

  if (responseAllows(input.callback)) {
    observations.push(
      observation({
        check: 'custody-cosigner-response-bound',
        status: 'pass',
        code: 'custody-cosigner-response-approved',
        message: 'Co-signer response approves the request and verifies the Attestor release token.',
        evidence: {
          responseAction: input.callback.responseAction,
          responseSigned: input.callback.responseSigned,
          attestorReleaseTokenVerified: input.callback.attestorReleaseTokenVerified,
        },
      }),
    );
  } else if (responseNeedsReview(input.callback)) {
    observations.push(
      observation({
        check: 'custody-cosigner-response-bound',
        status: 'warn',
        code: 'custody-cosigner-response-review-required',
        message: 'Co-signer response needs reviewer evidence before signing can proceed.',
        evidence: {
          responseAction: input.callback.responseAction,
          responseSigned: input.callback.responseSigned,
          attestorReleaseTokenVerified: input.callback.attestorReleaseTokenVerified,
        },
      }),
    );
  } else {
    observations.push(
      observation({
        check: 'custody-cosigner-response-bound',
        status: 'fail',
        code: 'custody-cosigner-response-rejected',
        message: 'Co-signer response did not approve the Attestor-bound custody request.',
        evidence: {
          responseAction: input.callback.responseAction,
          responseSigned: input.callback.responseSigned,
          attestorReleaseTokenVerified: input.callback.attestorReleaseTokenVerified,
        },
      }),
    );
  }

  observations.push(
    observation({
      check: 'custody-screening-risk',
      status: screeningIsReady ? 'pass' : 'fail',
      code: screeningIsReady
        ? 'custody-screening-risk-ready'
        : 'custody-screening-risk-blocked',
      message: 'Destination allowlist, counterparty, sanctions, risk-tier, and travel-rule screening are ready.',
      evidence: {
        destinationAllowlisted: input.screening.destinationAllowlisted,
        counterpartyKnown: input.screening.counterpartyKnown,
        sanctionsScreened: input.screening.sanctionsScreened,
        sanctionsHit: input.screening.sanctionsHit,
        riskScore: input.screening.riskScore,
        riskScoreMax: input.screening.riskScoreMax,
        riskTierAllowed: input.screening.riskTierAllowed,
        travelRuleRequired: input.screening.travelRuleRequired,
        travelRuleCompleted: input.screening.travelRuleCompleted,
      },
    }),
    observation({
      check: 'custody-velocity-and-limit',
      status: velocityIsReady ? 'pass' : 'fail',
      code: velocityIsReady
        ? 'custody-velocity-and-limit-ready'
        : 'custody-velocity-or-limit-exceeded',
      message: 'Custody amount stays within Attestor, policy, and velocity limits.',
      evidence: {
        amount: input.transaction.amount,
        maxAmountAtomic: input.screening.maxAmountAtomic,
        velocityLimitRemainingAtomic: input.screening.velocityLimitRemainingAtomic,
        intentMaxAmount: input.intent.constraints.maxAmount,
      },
    }),
    observation({
      check: 'custody-key-posture',
      status: keyPostureReady(input.keyPosture) ? 'pass' : 'fail',
      code: keyPostureReady(input.keyPosture)
        ? 'custody-key-posture-ready'
        : 'custody-key-posture-unsafe',
      message: 'Custody signing key, co-signer, key-share, signer role, HA, and recovery posture are ready.',
      evidence: {
        keyId: input.keyPosture.keyId,
        keyType: input.keyPosture.keyType,
        cosignerId: input.keyPosture.cosignerId,
        cosignerPaired: input.keyPosture.cosignerPaired,
        cosignerHealthy: input.keyPosture.cosignerHealthy,
        enclaveBacked: input.keyPosture.enclaveBacked,
        keyShareHealthy: input.keyPosture.keyShareHealthy,
        signingPolicyBound: input.keyPosture.signingPolicyBound,
        keyExportable: input.keyPosture.keyExportable,
        signerRoleBound: input.keyPosture.signerRoleBound,
        haSignerAvailable: input.keyPosture.haSignerAvailable,
        recoveryReady: input.keyPosture.recoveryReady,
      },
    }),
    observation({
      check: 'custody-release-binding-ready',
      status: releaseReady(input.releaseBinding) ? 'pass' : 'fail',
      code: releaseReady(input.releaseBinding)
        ? 'custody-release-binding-ready'
        : 'custody-release-binding-blocked',
      message: 'Attestor release binding is accepted and token-eligible before custody signing.',
      evidence: {
        releaseDecisionId: input.releaseBinding.releaseDecisionId,
        releaseStatus: input.releaseBinding.releaseDecision.status,
        bindingStatus: input.releaseBinding.status,
      },
    }),
    observation({
      check: 'custody-policy-binding-ready',
      status: policyBindingReady(input.policyScopeBinding) ? 'pass' : 'fail',
      code: policyBindingReady(input.policyScopeBinding)
        ? 'custody-policy-binding-ready'
        : 'custody-policy-binding-blocked',
      message: 'Attestor policy-control-plane activation and bundle references are bound.',
      evidence: {
        activationId: input.policyScopeBinding.activationId,
        bundleId: input.policyScopeBinding.bundleId,
        policyPackId: input.policyScopeBinding.policyPackId,
        activationStatus: input.policyScopeBinding.activationRecord.state,
      },
    }),
    observation({
      check: 'custody-enforcement-binding-ready',
      status: enforcementReady(input.enforcementBinding) ? 'pass' : 'fail',
      code: enforcementReady(input.enforcementBinding)
        ? 'custody-enforcement-binding-ready'
        : 'custody-enforcement-binding-blocked',
      message: 'Attestor enforcement binding is fail-closed at the custody action-dispatch boundary.',
      evidence: {
        adapterKind: input.enforcementBinding.adapterKind ?? null,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
        profileId: input.enforcementBinding.verificationProfile.id,
        failClosed: input.enforcementBinding.verificationProfile.failClosed,
      },
    }),
    observation({
      check: 'custody-post-execution-status',
      status: postExecutionReady(input.postExecution) ? 'pass' : 'fail',
      code: postExecutionReady(input.postExecution)
        ? 'custody-post-execution-status-ready'
        : 'custody-post-execution-status-failed',
      message: 'Custody provider activity has no failed or cancelled terminal status.',
      evidence: {
        activityId: input.postExecution.activityId ?? null,
        status: input.postExecution.status,
        providerStatus: input.postExecution.providerStatus ?? null,
        transactionHash: input.postExecution.transactionHash ?? null,
        failureReason: input.postExecution.failureReason ?? null,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(
  observations: readonly CustodyCosignerObservation[],
): CustodyCosignerOutcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(
  outcome: CustodyCosignerOutcome,
): CryptoSimulationPreflightSignal['status'] {
  switch (outcome) {
    case 'allow':
      return 'pass';
    case 'review-required':
      return 'warn';
    case 'block':
      return 'fail';
  }
}

function nonPassingReasonCodes(
  observations: readonly CustodyCosignerObservation[],
): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function preflightIdFor(input: {
  readonly account: CustodyAccountEvidence;
  readonly transaction: CustodyTransactionEvidence;
  readonly policyDecision: CustodyPolicyDecisionEvidence;
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly keyPosture: CustodyKeyPostureEvidence;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
}): string {
  return canonicalObject({
    version: CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION,
    provider: input.account.provider,
    organizationId: input.account.organizationId,
    accountRef: input.account.accountRef,
    requestId: input.transaction.requestId,
    idempotencyKey: input.transaction.idempotencyKey,
    requestHash: input.transaction.requestHash ?? null,
    chain: input.transaction.chain,
    asset: input.transaction.asset,
    amount: input.transaction.amount,
    destinationAddress: input.transaction.destinationAddress,
    policyDecisionId: input.policyDecision.decisionId,
    policyHash: input.policyDecision.policyHash,
    callbackId: input.callback.callbackId,
    nonce: input.callback.nonce,
    keyId: input.keyPosture.keyId,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

function signalFor(input: {
  readonly outcome: CustodyCosignerOutcome;
  readonly preflightId: string;
  readonly account: CustodyAccountEvidence;
  readonly transaction: CustodyTransactionEvidence;
  readonly policyDecision: CustodyPolicyDecisionEvidence;
  readonly approvals: CustodyApprovalEvidence;
  readonly callback: CustodyCosignerCallbackEvidence;
  readonly keyPosture: CustodyKeyPostureEvidence;
  readonly observations: readonly CustodyCosignerObservation[];
}): CryptoSimulationPreflightSignal {
  return Object.freeze({
    source: 'custody-policy',
    status: signalStatusFor(input.outcome),
    code: input.outcome === 'allow'
      ? 'custody-cosigner-policy-adapter-allow'
      : input.outcome === 'review-required'
        ? 'custody-cosigner-policy-adapter-review-required'
        : 'custody-cosigner-policy-adapter-block',
    message: input.outcome === 'allow'
      ? 'Custody co-signer policy adapter accepted the Attestor-bound custody preflight.'
      : input.outcome === 'review-required'
        ? 'Custody co-signer policy adapter needs reviewer or provider evidence before signing.'
        : 'Custody co-signer policy adapter would block custody signing fail-closed.',
    required: true,
    evidence: Object.freeze({
      adapterVersion: CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION,
      preflightId: input.preflightId,
      provider: input.account.provider,
      organizationId: input.account.organizationId,
      accountRef: input.account.accountRef,
      requestId: input.transaction.requestId,
      idempotencyKey: input.transaction.idempotencyKey,
      chain: input.transaction.chain,
      asset: input.transaction.asset,
      amount: input.transaction.amount,
      destinationAddress: input.transaction.destinationAddress,
      policyDecisionId: input.policyDecision.decisionId,
      policyId: input.policyDecision.policyId,
      policyVersion: input.policyDecision.policyVersion,
      approvalQuorum: `${input.approvals.collectedApprovals}/${input.approvals.requiredApprovals}`,
      callbackId: input.callback.callbackId,
      keyId: input.keyPosture.keyId,
      reasonCodes: nonPassingReasonCodes(input.observations),
    }),
  });
}

export function createCustodyCosignerPolicyPreflight(
  input: CreateCustodyCosignerPolicyPreflightInput,
): CustodyCosignerPolicyPreflight {
  assertAdapterConsistency(input);
  const account = normalizeAccount(input.account);
  const transaction = normalizeTransaction(input.transaction);
  const policyDecision = normalizePolicyDecision(input.policyDecision);
  const approvals = normalizeApprovals(input.approvals);
  const callback = normalizeCallback(input.callback);
  const screening = normalizeScreening(input.screening);
  const keyPosture = normalizeKeyPosture(input.keyPosture);
  const postExecution = normalizePostExecution(input.postExecution);
  const observations = buildObservations({
    intent: input.intent,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    account,
    transaction,
    policyDecision,
    approvals,
    callback,
    screening,
    keyPosture,
    postExecution,
  });
  const outcome = outcomeFromObservations(observations);
  const preflightId =
    normalizeOptionalIdentifier(input.preflightId, 'preflightId') ??
    preflightIdFor({
      account,
      transaction,
      policyDecision,
      callback,
      keyPosture,
      releaseBindingDigest: input.releaseBinding.digest,
      policyScopeDigest: input.policyScopeBinding.digest,
      enforcementBindingDigest: input.enforcementBinding.digest,
    });
  const signal = signalFor({
    outcome,
    preflightId,
    account,
    transaction,
    policyDecision,
    approvals,
    callback,
    keyPosture,
    observations,
  });
  const canonicalPayload = {
    version: CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION,
    preflightId,
    adapterKind: 'custody-cosigner' as const,
    checkedAt: policyDecision.evaluatedAt,
    provider: account.provider,
    organizationId: account.organizationId,
    accountRef: account.accountRef,
    requestId: transaction.requestId,
    idempotencyKey: transaction.idempotencyKey,
    chain: transaction.chain,
    asset: transaction.asset,
    amount: transaction.amount,
    destinationAddress: transaction.destinationAddress,
    policyId: policyDecision.policyId,
    policyVersion: policyDecision.policyVersion,
    policyDecisionId: policyDecision.decisionId,
    approvalQuorum: `${approvals.collectedApprovals}/${approvals.requiredApprovals}`,
    keyId: keyPosture.keyId,
    callbackId: callback.callbackId,
    outcome,
    signal,
    observations,
    releaseBindingDigest: input.releaseBinding.digest,
    policyScopeDigest: input.policyScopeBinding.digest,
    enforcementBindingDigest: input.enforcementBinding.digest,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function simulateCustodyCosignerPolicyAuthorization(
  input: CreateCustodyCosignerPolicyPreflightInput,
): CustodyCosignerPolicySimulationResult {
  const preflight = createCustodyCosignerPolicyPreflight(input);
  const simulation = createCryptoAuthorizationSimulation({
    intent: input.intent,
    riskAssessment: input.riskAssessment,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    simulatedAt: preflight.checkedAt,
    preflightSignals: [preflight.signal],
    operatorNote: `custody withdrawal ${preflight.accountRef} -> ${preflight.destinationAddress} ${preflight.amount} ${preflight.asset} preflight ${preflight.outcome}.`,
  });

  return Object.freeze({
    preflight,
    simulation,
  });
}

export function custodyCosignerPolicyPreflightLabel(
  preflight: CustodyCosignerPolicyPreflight,
): string {
  return [
    `custody:${preflight.provider}`,
    `account:${preflight.accountRef}`,
    `request:${preflight.requestId}`,
    `amount:${preflight.amount}`,
    `outcome:${preflight.outcome}`,
  ].join(' / ');
}

export function custodyCosignerPolicyAdapterDescriptor():
CustodyCosignerPolicyAdapterDescriptor {
  return Object.freeze({
    version: CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION,
    adapterKind: 'custody-cosigner',
    providers: CUSTODY_POLICY_PROVIDERS,
    policyEffects: CUSTODY_POLICY_EFFECTS,
    decisionStatuses: CUSTODY_POLICY_DECISION_STATUSES,
    authMethods: CUSTODY_COSIGNER_AUTH_METHODS,
    responseActions: CUSTODY_COSIGNER_RESPONSE_ACTIONS,
    keyTypes: CUSTODY_KEY_TYPES,
    postExecutionStatuses: CUSTODY_POST_EXECUTION_STATUSES,
    outcomes: CUSTODY_COSIGNER_OUTCOMES,
    checks: CUSTODY_COSIGNER_CHECKS,
    references: Object.freeze([
      'Fireblocks transaction authorization policy',
      'Fireblocks API co-signer callback',
      'Fireblocks co-signer approval quorum',
      'Turnkey policy engine',
      'Turnkey activity approval quorum',
      'MPC custody signing',
      'attestor-release-token',
      'release-enforcement-plane action-dispatch',
    ]),
  });
}
