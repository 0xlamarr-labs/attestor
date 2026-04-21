import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  CryptoAuthorizationIntent,
} from './object-model.js';
import {
  createCryptoCanonicalCounterpartyReference,
  type CryptoCanonicalCounterpartyReference,
} from './canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
  type CryptoConsequenceRiskAssessment,
} from './consequence-risk-mapping.js';
import type {
  CryptoAuthorizationConsequenceKind,
  CryptoAuthorizationPolicyDimension,
} from './types.js';
import type {
  CryptoSimulationPreflightSignal,
} from './authorization-simulation.js';

/**
 * Approval and allowance consequence support for programmable-money flows.
 *
 * Step 14 deliberately keeps spender/allowance policy in the crypto core,
 * not in a Safe, wallet, or Permit2-specific adapter. ERC-20 approve,
 * EIP-2612 permits, Permit2 allowances, transaction-scoped approvals, and
 * wallet permission grants all collapse to the same Attestor question:
 * who may spend what, for how long, with which nonce, budget, and revocation
 * path, before any downstream execution adapter is allowed to move value.
 */

export const CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION =
  'attestor.crypto-approval-allowance-consequence.v1';

export const CRYPTO_APPROVAL_ALLOWANCE_MECHANISMS = [
  'erc20-approve',
  'erc20-increase-allowance',
  'erc20-decrease-allowance',
  'eip-2612-permit',
  'permit2-allowance',
  'permit2-signature-transfer',
  'erc-7674-temporary-approve',
  'wallet-permission-grant',
] as const;
export type CryptoApprovalAllowanceMechanism =
  typeof CRYPTO_APPROVAL_ALLOWANCE_MECHANISMS[number];

export const CRYPTO_ALLOWANCE_AMOUNT_POSTURES = [
  'exact',
  'bounded',
  'unlimited',
  'decrease-only',
  'revoke',
] as const;
export type CryptoAllowanceAmountPosture =
  typeof CRYPTO_ALLOWANCE_AMOUNT_POSTURES[number];

export const CRYPTO_ALLOWANCE_DURATION_POSTURES = [
  'persistent',
  'time-bound',
  'transaction-scoped',
  'revoked',
] as const;
export type CryptoAllowanceDurationPosture =
  typeof CRYPTO_ALLOWANCE_DURATION_POSTURES[number];

export const CRYPTO_APPROVAL_ALLOWANCE_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type CryptoApprovalAllowanceOutcome =
  typeof CRYPTO_APPROVAL_ALLOWANCE_OUTCOMES[number];

export const CRYPTO_APPROVAL_ALLOWANCE_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type CryptoApprovalAllowanceObservationStatus =
  typeof CRYPTO_APPROVAL_ALLOWANCE_OBSERVATION_STATUSES[number];

export const CRYPTO_APPROVAL_ALLOWANCE_REVOCATION_METHODS = [
  'approve-zero',
  'permit2-lockdown',
  'wallet-revoke',
  'temporary-expires',
  'not-applicable',
] as const;
export type CryptoApprovalAllowanceRevocationMethod =
  typeof CRYPTO_APPROVAL_ALLOWANCE_REVOCATION_METHODS[number];

export const CRYPTO_APPROVAL_ALLOWANCE_CHECKS = [
  'approval-intent-kind',
  'approval-chain-runtime',
  'approval-token-bound',
  'approval-owner-bound',
  'approval-spender-bound',
  'approval-target-bound',
  'approval-function-selector-bound',
  'approval-amount-posture',
  'approval-amount-within-intent',
  'approval-resulting-allowance-within-intent',
  'approval-expiry-bound',
  'approval-budget-bound',
  'approval-revocation-bound',
  'approval-permit-evidence-bound',
  'approval-temporary-scope-bound',
  'approval-risk-assessment-bound',
] as const;
export type CryptoApprovalAllowanceCheck =
  typeof CRYPTO_APPROVAL_ALLOWANCE_CHECKS[number];

export interface CryptoApprovalAllowanceRevocationPosture {
  readonly revocable: boolean;
  readonly method?: CryptoApprovalAllowanceRevocationMethod | null;
  readonly authorityRef?: string | null;
  readonly revocationTarget?: string | null;
}

export interface CreateCryptoApprovalAllowanceConsequenceInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly spenderAddress: string;
  readonly requestedAmount: string;
  readonly tokenAddress?: string | null;
  readonly ownerAddress?: string | null;
  readonly currentAllowance?: string | null;
  readonly resultingAllowance?: string | null;
  readonly normalizedUsd?: string | null;
  readonly amountPosture?: CryptoAllowanceAmountPosture | null;
  readonly durationPosture?: CryptoAllowanceDurationPosture | null;
  readonly allowanceExpiration?: string | null;
  readonly permitDeadline?: string | null;
  readonly permitNonce?: string | null;
  readonly permitDomainChainId?: string | null;
  readonly permitDomainVerifyingContract?: string | null;
  readonly revocation?: CryptoApprovalAllowanceRevocationPosture | null;
  readonly budgetId?: string | null;
  readonly spenderLabel?: string | null;
  readonly approvalPolicyRef?: string | null;
  readonly isKnownSpender?: boolean | null;
  readonly consequenceId?: string | null;
}

export interface CryptoApprovalAllowanceObservation {
  readonly check: CryptoApprovalAllowanceCheck;
  readonly status: CryptoApprovalAllowanceObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CryptoApprovalAllowanceConsequence {
  readonly version: typeof CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION;
  readonly consequenceId: string;
  readonly intentId: string;
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly amountPosture: CryptoAllowanceAmountPosture;
  readonly durationPosture: CryptoAllowanceDurationPosture;
  readonly outcome: CryptoApprovalAllowanceOutcome;
  readonly chainId: string;
  readonly ownerAddress: string;
  readonly tokenAddress: string | null;
  readonly spenderAddress: string;
  readonly requestedAmount: string;
  readonly currentAllowance: string | null;
  readonly resultingAllowance: string;
  readonly allowanceExpiration: string | null;
  readonly permitDeadline: string | null;
  readonly permitNonce: string | null;
  readonly budgetId: string | null;
  readonly revocation: CryptoApprovalAllowanceRevocationPosture;
  readonly counterparty: CryptoCanonicalCounterpartyReference;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly requiredPolicyDimensions: readonly CryptoAuthorizationPolicyDimension[];
  readonly signal: CryptoSimulationPreflightSignal;
  readonly observations: readonly CryptoApprovalAllowanceObservation[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoApprovalAllowanceConsequenceDescriptor {
  readonly version: typeof CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION;
  readonly mechanisms: typeof CRYPTO_APPROVAL_ALLOWANCE_MECHANISMS;
  readonly amountPostures: typeof CRYPTO_ALLOWANCE_AMOUNT_POSTURES;
  readonly durationPostures: typeof CRYPTO_ALLOWANCE_DURATION_POSTURES;
  readonly outcomes: typeof CRYPTO_APPROVAL_ALLOWANCE_OUTCOMES;
  readonly revocationMethods: typeof CRYPTO_APPROVAL_ALLOWANCE_REVOCATION_METHODS;
  readonly checks: typeof CRYPTO_APPROVAL_ALLOWANCE_CHECKS;
  readonly standards: readonly string[];
}

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';
export const CRYPTO_APPROVAL_MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

const DECIMAL_SCALE = 18n;
const DECIMAL_SCALE_UNITS = 10n ** DECIMAL_SCALE;

const MECHANISM_FUNCTION_SELECTORS: Partial<Record<CryptoApprovalAllowanceMechanism, string>> = {
  'erc20-approve': '0x095ea7b3',
  'erc20-increase-allowance': '0x39509351',
  'erc20-decrease-allowance': '0xa457c2d7',
  'eip-2612-permit': '0xd505accf',
};

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Crypto approval allowance consequence ${fieldName} requires a non-empty value.`);
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

function normalizeIsoTimestamp(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = normalizeIdentifier(value, fieldName);
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Crypto approval allowance consequence ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`Crypto approval allowance consequence ${fieldName} must be an EVM address.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalAddress(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeAddress(value, fieldName);
}

function normalizeAmount(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  parseDecimalToScaledUnits(normalized, fieldName);
  return normalized;
}

function normalizeOptionalAmount(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeAmount(value, fieldName);
}

function parseDecimalToScaledUnits(value: string, fieldName: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,77})(?:\.\d{1,18})?$/.test(normalized)) {
    throw new Error(
      `Crypto approval allowance consequence ${fieldName} must be a non-negative decimal with up to 18 fractional digits.`,
    );
  }
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * DECIMAL_SCALE_UNITS + BigInt(fraction.padEnd(Number(DECIMAL_SCALE), '0'));
}

function formatScaledUnits(value: bigint): string {
  const whole = value / DECIMAL_SCALE_UNITS;
  const fraction = value % DECIMAL_SCALE_UNITS;
  if (fraction === 0n) {
    return whole.toString();
  }
  return `${whole}.${fraction.toString().padStart(Number(DECIMAL_SCALE), '0').replace(/0+$/, '')}`;
}

function decimalCompare(left: string, right: string): number {
  const leftValue = parseDecimalToScaledUnits(left, 'amount comparison left');
  const rightValue = parseDecimalToScaledUnits(right, 'amount comparison right');
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
}

function decimalAdd(left: string, right: string): string {
  return formatScaledUnits(
    parseDecimalToScaledUnits(left, 'allowance addition left') +
      parseDecimalToScaledUnits(right, 'allowance addition right'),
  );
}

function decimalSubtractFloor(left: string, right: string): string {
  const leftValue = parseDecimalToScaledUnits(left, 'allowance subtraction left');
  const rightValue = parseDecimalToScaledUnits(right, 'allowance subtraction right');
  return formatScaledUnits(leftValue > rightValue ? leftValue - rightValue : 0n);
}

function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function caip2ChainId(intent: CryptoAuthorizationIntent): string {
  return `${intent.chain.namespace}:${intent.chain.chainId}`;
}

function mechanismFrom(input: CryptoApprovalAllowanceMechanism): CryptoApprovalAllowanceMechanism {
  if (!CRYPTO_APPROVAL_ALLOWANCE_MECHANISMS.includes(input)) {
    throw new Error(`Crypto approval allowance consequence does not support mechanism ${input}.`);
  }
  return input;
}

function amountPostureFrom(input: {
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly requestedAmount: string;
  readonly amountPosture?: CryptoAllowanceAmountPosture | null;
}): CryptoAllowanceAmountPosture {
  if (input.amountPosture !== undefined && input.amountPosture !== null) {
    if (!CRYPTO_ALLOWANCE_AMOUNT_POSTURES.includes(input.amountPosture)) {
      throw new Error(`Crypto approval allowance consequence does not support amount posture ${input.amountPosture}.`);
    }
    return input.amountPosture;
  }
  if (input.requestedAmount === '0') {
    return 'revoke';
  }
  if (input.mechanism === 'erc20-decrease-allowance') {
    return 'decrease-only';
  }
  if (input.requestedAmount === CRYPTO_APPROVAL_MAX_UINT256) {
    return 'unlimited';
  }
  if (
    input.mechanism === 'permit2-signature-transfer' ||
    input.mechanism === 'erc-7674-temporary-approve'
  ) {
    return 'exact';
  }
  return 'bounded';
}

function durationPostureFrom(input: {
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly amountPosture: CryptoAllowanceAmountPosture;
  readonly allowanceExpiration: string | null;
  readonly durationPosture?: CryptoAllowanceDurationPosture | null;
}): CryptoAllowanceDurationPosture {
  if (input.durationPosture !== undefined && input.durationPosture !== null) {
    if (!CRYPTO_ALLOWANCE_DURATION_POSTURES.includes(input.durationPosture)) {
      throw new Error(`Crypto approval allowance consequence does not support duration posture ${input.durationPosture}.`);
    }
    return input.durationPosture;
  }
  if (input.amountPosture === 'revoke') {
    return 'revoked';
  }
  if (
    input.mechanism === 'permit2-signature-transfer' ||
    input.mechanism === 'erc-7674-temporary-approve'
  ) {
    return 'transaction-scoped';
  }
  if (input.allowanceExpiration !== null) {
    return 'time-bound';
  }
  return 'persistent';
}

function revocationFrom(
  input: CryptoApprovalAllowanceRevocationPosture | null | undefined,
  durationPosture: CryptoAllowanceDurationPosture,
): CryptoApprovalAllowanceRevocationPosture {
  const method =
    input?.method ??
    (durationPosture === 'transaction-scoped'
      ? 'temporary-expires'
      : durationPosture === 'revoked'
        ? 'approve-zero'
        : null);
  if (method !== null && !CRYPTO_APPROVAL_ALLOWANCE_REVOCATION_METHODS.includes(method)) {
    throw new Error(`Crypto approval allowance consequence does not support revocation method ${method}.`);
  }
  return Object.freeze({
    revocable:
      input?.revocable ??
      (durationPosture === 'transaction-scoped' ||
        durationPosture === 'revoked'),
    method,
    authorityRef: normalizeOptionalIdentifier(input?.authorityRef, 'revocation.authorityRef'),
    revocationTarget: normalizeOptionalAddress(input?.revocationTarget, 'revocation.revocationTarget'),
  });
}

function resultingAllowanceFor(input: {
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly amountPosture: CryptoAllowanceAmountPosture;
  readonly requestedAmount: string;
  readonly currentAllowance: string | null;
  readonly resultingAllowance: string | null;
}): string {
  if (input.resultingAllowance !== null) {
    return input.resultingAllowance;
  }
  if (input.amountPosture === 'revoke') {
    return '0';
  }
  if (input.mechanism === 'permit2-signature-transfer') {
    return '0';
  }
  if (input.mechanism === 'erc20-increase-allowance' && input.currentAllowance !== null) {
    return decimalAdd(input.currentAllowance, input.requestedAmount);
  }
  if (input.mechanism === 'erc20-decrease-allowance' && input.currentAllowance !== null) {
    return decimalSubtractFloor(input.currentAllowance, input.requestedAmount);
  }
  return input.requestedAmount;
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

function observation(input: {
  readonly check: CryptoApprovalAllowanceCheck;
  readonly status: CryptoApprovalAllowanceObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): CryptoApprovalAllowanceObservation {
  return Object.freeze({
    check: input.check,
    status: input.status,
    code: normalizeIdentifier(input.code, 'observation.code'),
    message: normalizeIdentifier(input.message, 'observation.message'),
    required: input.required ?? true,
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function requiresPermitEvidence(mechanism: CryptoApprovalAllowanceMechanism): boolean {
  return (
    mechanism === 'eip-2612-permit' ||
    mechanism === 'permit2-allowance' ||
    mechanism === 'permit2-signature-transfer'
  );
}

function requiresEvmRuntime(mechanism: CryptoApprovalAllowanceMechanism): boolean {
  return mechanism !== 'wallet-permission-grant';
}

function expectedSelectorFor(mechanism: CryptoApprovalAllowanceMechanism): string | null {
  return MECHANISM_FUNCTION_SELECTORS[mechanism] ?? null;
}

function createRiskAssessment(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly amountPosture: CryptoAllowanceAmountPosture;
  readonly requestedAmount: string;
  readonly normalizedUsd: string | null;
  readonly counterparty: CryptoCanonicalCounterpartyReference;
  readonly durationPosture: CryptoAllowanceDurationPosture;
  readonly budgetId: string | null;
  readonly revocation: CryptoApprovalAllowanceRevocationPosture;
  readonly isKnownSpender: boolean | null;
}): CryptoConsequenceRiskAssessment {
  return createCryptoConsequenceRiskAssessment({
    consequenceKind: input.intent.consequenceKind,
    account: input.intent.account,
    asset: input.intent.asset,
    amount: {
      assetAmount: input.requestedAmount,
      normalizedUsd: input.normalizedUsd,
      isUnlimitedApproval: input.amountPosture === 'unlimited',
    },
    counterparty: input.counterparty,
    context: {
      executionAdapterKind: input.intent.executionAdapterKind,
      hasExpiry:
        input.durationPosture === 'transaction-scoped' ||
        input.durationPosture === 'revoked' ||
        input.durationPosture === 'time-bound',
      hasBudget: input.budgetId !== null,
      hasRevocationPath:
        input.durationPosture === 'transaction-scoped' ||
        input.durationPosture === 'revoked' ||
        input.revocation.revocable,
      isKnownCounterparty: input.isKnownSpender,
      signals: input.intent.consequenceKind === 'permission-grant'
        ? ['wallet-permission']
        : [],
    },
  });
}

function buildObservations(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly amountPosture: CryptoAllowanceAmountPosture;
  readonly durationPosture: CryptoAllowanceDurationPosture;
  readonly ownerAddress: string;
  readonly tokenAddress: string | null;
  readonly spenderAddress: string;
  readonly requestedAmount: string;
  readonly currentAllowance: string | null;
  readonly resultingAllowance: string;
  readonly allowanceExpiration: string | null;
  readonly permitDeadline: string | null;
  readonly permitNonce: string | null;
  readonly permitDomainChainId: string | null;
  readonly permitDomainVerifyingContract: string | null;
  readonly budgetId: string | null;
  readonly revocation: CryptoApprovalAllowanceRevocationPosture;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
}): readonly CryptoApprovalAllowanceObservation[] {
  const observations: CryptoApprovalAllowanceObservation[] = [];
  const intentKindOk =
    input.intent.consequenceKind === 'approval' ||
    input.intent.consequenceKind === 'permission-grant';
  const evmRuntimeOk =
    !requiresEvmRuntime(input.mechanism) ||
    input.intent.chain.namespace === 'eip155' ||
    input.intent.chain.runtimeFamily === 'evm';
  const asset = input.intent.asset;
  const expectedSelector = expectedSelectorFor(input.mechanism);
  const intentSelector = input.intent.target.functionSelector?.toLowerCase() ?? null;
  const maxAmount = input.intent.constraints.maxAmount;
  const tokenMatchesAsset =
    input.tokenAddress === null ||
    asset === null ||
    sameAddress(input.tokenAddress, asset.assetId);
  const targetAddress = input.intent.target.address;
  const targetBound =
    targetAddress === null ||
    sameAddress(targetAddress, input.tokenAddress) ||
    sameAddress(targetAddress, input.spenderAddress);
  const decreaseNeedsCurrent =
    input.mechanism === 'erc20-decrease-allowance' &&
    input.currentAllowance === null;
  const decreaseExceedsCurrent =
    input.mechanism === 'erc20-decrease-allowance' &&
    input.currentAllowance !== null &&
    decimalCompare(input.requestedAmount, input.currentAllowance) > 0;
  const requestedExceedsIntent =
    maxAmount !== null &&
    input.amountPosture !== 'decrease-only' &&
    input.amountPosture !== 'revoke' &&
    decimalCompare(input.requestedAmount, maxAmount) > 0;
  const resultingExceedsIntent =
    maxAmount !== null &&
    input.amountPosture !== 'decrease-only' &&
    input.amountPosture !== 'revoke' &&
    decimalCompare(input.resultingAllowance, maxAmount) > 0;
  const expiryBound =
    input.amountPosture === 'decrease-only' ||
    input.amountPosture === 'revoke' ||
    input.durationPosture === 'transaction-scoped' ||
    input.durationPosture === 'revoked' ||
    input.allowanceExpiration !== null;
  const budgetBound =
    input.amountPosture === 'decrease-only' ||
    input.amountPosture === 'revoke' ||
    input.budgetId !== null;
  const revocationBound =
    input.amountPosture === 'decrease-only' ||
    input.amountPosture === 'revoke' ||
    input.durationPosture === 'transaction-scoped' ||
    input.durationPosture === 'revoked' ||
    input.revocation.revocable;
  const permitDeadlineWithinIntent =
    input.permitDeadline === null ||
    Date.parse(input.permitDeadline) <= Date.parse(input.intent.constraints.validUntil);

  observations.push(
    observation({
      check: 'approval-intent-kind',
      status: intentKindOk ? 'pass' : 'fail',
      code: intentKindOk ? 'approval-intent-kind-bound' : 'approval-intent-kind-mismatch',
      message: intentKindOk
        ? 'Intent is an approval or permission-grant consequence.'
        : 'Approval allowance consequences require an approval or permission-grant intent.',
      evidence: {
        consequenceKind: input.intent.consequenceKind,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-chain-runtime',
      status: evmRuntimeOk ? 'pass' : 'fail',
      code: evmRuntimeOk ? 'approval-chain-runtime-compatible' : 'approval-chain-runtime-not-evm',
      message: evmRuntimeOk
        ? 'Approval mechanism is compatible with the intent chain runtime.'
        : 'ERC-20 and permit approval mechanisms require an EVM-compatible runtime.',
      evidence: {
        mechanism: input.mechanism,
        chainNamespace: input.intent.chain.namespace,
        runtimeFamily: input.intent.chain.runtimeFamily,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-token-bound',
      status:
        input.intent.consequenceKind === 'permission-grant' && input.tokenAddress === null
          ? 'pass'
          : asset === null || asset.assetKind === 'native-token' || !tokenMatchesAsset
            ? 'fail'
            : 'pass',
      code:
        input.intent.consequenceKind === 'permission-grant' && input.tokenAddress === null
          ? 'approval-token-not-required'
          : asset === null
            ? 'approval-token-asset-missing'
            : asset.assetKind === 'native-token'
              ? 'approval-token-native-asset-invalid'
              : tokenMatchesAsset
                ? 'approval-token-bound'
                : 'approval-token-asset-mismatch',
      message:
        input.intent.consequenceKind === 'permission-grant' && input.tokenAddress === null
          ? 'Wallet permission grant does not require a token address.'
          : asset === null
            ? 'Token approval requires an asset reference.'
            : asset.assetKind === 'native-token'
              ? 'Native token approvals are not ERC-20 allowance consequences.'
              : tokenMatchesAsset
                ? 'Token address is bound to the intent asset.'
                : 'Token address does not match the intent asset.',
      evidence: {
        tokenAddress: input.tokenAddress,
        assetId: asset?.assetId ?? null,
        assetKind: asset?.assetKind ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-owner-bound',
      status: sameAddress(input.ownerAddress, input.intent.account.address) ? 'pass' : 'fail',
      code: sameAddress(input.ownerAddress, input.intent.account.address)
        ? 'approval-owner-bound'
        : 'approval-owner-account-mismatch',
      message: sameAddress(input.ownerAddress, input.intent.account.address)
        ? 'Approval owner matches the intent account.'
        : 'Approval owner does not match the intent account.',
      evidence: {
        ownerAddress: input.ownerAddress,
        accountAddress: input.intent.account.address,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-spender-bound',
      status: input.spenderAddress === ZERO_EVM_ADDRESS ? 'fail' : 'pass',
      code: input.spenderAddress === ZERO_EVM_ADDRESS
        ? 'approval-spender-zero-address'
        : 'approval-spender-bound',
      message: input.spenderAddress === ZERO_EVM_ADDRESS
        ? 'Approval spender cannot be the EVM zero address.'
        : 'Approval spender is explicit and non-zero.',
      evidence: {
        spenderAddress: input.spenderAddress,
        targetCounterparty: input.intent.target.counterparty ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-target-bound',
      status: targetBound ? 'pass' : 'fail',
      code: targetBound ? 'approval-target-bound' : 'approval-target-mismatch',
      message: targetBound
        ? 'Intent target binds either the token contract or spender surface for the approval.'
        : 'Intent target must bind the token contract or spender surface for the approval.',
      evidence: {
        intentTargetAddress: targetAddress ?? null,
        tokenAddress: input.tokenAddress,
        spenderAddress: input.spenderAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-function-selector-bound',
      status:
        expectedSelector === null || intentSelector === null || intentSelector === expectedSelector
          ? 'pass'
          : 'fail',
      code:
        expectedSelector === null
          ? 'approval-function-selector-adapter-specific'
          : intentSelector === null
            ? 'approval-function-selector-not-required'
            : intentSelector === expectedSelector
              ? 'approval-function-selector-bound'
              : 'approval-function-selector-mismatch',
      message:
        expectedSelector === null
          ? 'Approval mechanism has adapter-specific selector semantics outside the core.'
          : intentSelector === null
            ? 'Intent does not require a function selector match for this approval.'
            : intentSelector === expectedSelector
              ? 'Intent function selector matches the approval mechanism.'
              : 'Intent function selector does not match the approval mechanism.',
      evidence: {
        mechanism: input.mechanism,
        intentFunctionSelector: intentSelector,
        expectedFunctionSelector: expectedSelector,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-amount-posture',
      status:
        input.amountPosture === 'unlimited' && maxAmount !== CRYPTO_APPROVAL_MAX_UINT256
          ? 'warn'
          : 'pass',
      code:
        input.amountPosture === 'unlimited' && maxAmount !== CRYPTO_APPROVAL_MAX_UINT256
          ? 'approval-unlimited-requires-explicit-policy'
          : 'approval-amount-posture-bound',
      message:
        input.amountPosture === 'unlimited' && maxAmount !== CRYPTO_APPROVAL_MAX_UINT256
          ? 'Unlimited allowance requires explicit max-uint policy scope.'
          : 'Approval amount posture is explicitly classified.',
      evidence: {
        amountPosture: input.amountPosture,
        requestedAmount: input.requestedAmount,
        maxAmount: maxAmount ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-amount-within-intent',
      status: requestedExceedsIntent ? 'fail' : 'pass',
      code: requestedExceedsIntent
        ? 'approval-requested-amount-exceeds-intent'
        : 'approval-requested-amount-within-intent',
      message: requestedExceedsIntent
        ? 'Requested approval amount exceeds the intent maxAmount.'
        : 'Requested approval amount is within the intent maxAmount or does not increase allowance.',
      evidence: {
        requestedAmount: input.requestedAmount,
        maxAmount: maxAmount ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-resulting-allowance-within-intent',
      status: decreaseNeedsCurrent || decreaseExceedsCurrent || resultingExceedsIntent
        ? 'fail'
        : 'pass',
      code: decreaseNeedsCurrent
        ? 'approval-decrease-current-allowance-missing'
        : decreaseExceedsCurrent
          ? 'approval-decrease-exceeds-current-allowance'
          : resultingExceedsIntent
            ? 'approval-resulting-allowance-exceeds-intent'
            : 'approval-resulting-allowance-within-intent',
      message: decreaseNeedsCurrent
        ? 'Decrease allowance requires current allowance evidence.'
        : decreaseExceedsCurrent
          ? 'Decrease allowance amount exceeds current allowance evidence.'
          : resultingExceedsIntent
            ? 'Resulting allowance exceeds the intent maxAmount.'
            : 'Resulting allowance remains inside the intent maxAmount or reduces allowance.',
      evidence: {
        currentAllowance: input.currentAllowance,
        requestedAmount: input.requestedAmount,
        resultingAllowance: input.resultingAllowance,
        maxAmount: maxAmount ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-expiry-bound',
      status: expiryBound ? 'pass' : 'warn',
      code: expiryBound ? 'approval-expiry-bound' : 'approval-expiry-missing',
      message: expiryBound
        ? 'Approval is time-bound, transaction-scoped, or revokes allowance.'
        : 'Persistent approval is missing an allowance expiration.',
      evidence: {
        durationPosture: input.durationPosture,
        allowanceExpiration: input.allowanceExpiration,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-budget-bound',
      status: budgetBound ? 'pass' : 'warn',
      code: budgetBound ? 'approval-budget-bound' : 'approval-budget-missing',
      message: budgetBound
        ? 'Approval is tied to a budget or does not increase spending authority.'
        : 'Approval is missing a budget binding.',
      evidence: {
        budgetId: input.budgetId,
        amountPosture: input.amountPosture,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-revocation-bound',
      status: revocationBound ? 'pass' : 'warn',
      code: revocationBound ? 'approval-revocation-bound' : 'approval-revocation-missing',
      message: revocationBound
        ? 'Approval has a revocation path or is transaction-scoped/revoked.'
        : 'Approval is missing an explicit revocation path.',
      evidence: {
        revocable: input.revocation.revocable,
        method: input.revocation.method ?? null,
        authorityRef: input.revocation.authorityRef ?? null,
      },
    }),
  );

  const permitRequired = requiresPermitEvidence(input.mechanism);
  observations.push(
    observation({
      check: 'approval-permit-evidence-bound',
      status: !permitRequired
        ? 'pass'
        : input.permitDeadline !== null &&
            input.permitNonce !== null &&
            input.permitDomainChainId === caip2ChainId(input.intent) &&
            (input.permitDomainVerifyingContract === null ||
              input.mechanism === 'permit2-allowance' ||
              input.mechanism === 'permit2-signature-transfer' ||
              sameAddress(
                input.permitDomainVerifyingContract,
                input.tokenAddress ?? input.intent.target.address,
              )) &&
            permitDeadlineWithinIntent
          ? 'pass'
          : 'fail',
      code: !permitRequired
        ? 'approval-permit-evidence-not-required'
        : input.permitDeadline === null
          ? 'approval-permit-deadline-missing'
          : input.permitNonce === null
            ? 'approval-permit-nonce-missing'
            : input.permitDomainChainId !== caip2ChainId(input.intent)
              ? 'approval-permit-domain-chain-mismatch'
              : !permitDeadlineWithinIntent
                ? 'approval-permit-deadline-exceeds-intent'
                : 'approval-permit-evidence-bound',
      message: !permitRequired
        ? 'Approval mechanism does not require permit signature evidence.'
        : 'Permit signature evidence must bind nonce, deadline, chain domain, and verifying contract posture.',
      evidence: {
        mechanism: input.mechanism,
        permitDeadline: input.permitDeadline,
        permitNonce: input.permitNonce,
        permitDomainChainId: input.permitDomainChainId,
        permitDomainVerifyingContract: input.permitDomainVerifyingContract,
        intentChainId: caip2ChainId(input.intent),
      },
    }),
  );

  const temporaryExpected =
    input.mechanism === 'permit2-signature-transfer' ||
    input.mechanism === 'erc-7674-temporary-approve';
  observations.push(
    observation({
      check: 'approval-temporary-scope-bound',
      status:
        !temporaryExpected || input.durationPosture === 'transaction-scoped'
          ? 'pass'
          : 'fail',
      code:
        !temporaryExpected
          ? 'approval-temporary-scope-not-required'
          : input.durationPosture === 'transaction-scoped'
            ? 'approval-temporary-scope-bound'
            : 'approval-temporary-scope-mismatch',
      message:
        !temporaryExpected
          ? 'Approval mechanism is not expected to be transaction-scoped.'
          : input.durationPosture === 'transaction-scoped'
            ? 'Temporary approval is transaction-scoped.'
            : 'Temporary approval mechanism must be transaction-scoped.',
      evidence: {
        mechanism: input.mechanism,
        durationPosture: input.durationPosture,
      },
    }),
  );

  observations.push(
    observation({
      check: 'approval-risk-assessment-bound',
      status:
        input.riskAssessment.consequenceKind === input.intent.consequenceKind &&
        input.riskAssessment.riskClass === 'R4'
          ? 'pass'
          : 'fail',
      code:
        input.riskAssessment.consequenceKind === input.intent.consequenceKind &&
        input.riskAssessment.riskClass === 'R4'
          ? 'approval-risk-assessment-bound'
          : 'approval-risk-assessment-not-high-assurance',
      message:
        input.riskAssessment.consequenceKind === input.intent.consequenceKind &&
        input.riskAssessment.riskClass === 'R4'
          ? 'Approval allowance consequence is bound to high-assurance risk assessment.'
          : 'Approval allowance consequence must remain high-assurance and intent-consistent.',
      evidence: {
        riskClass: input.riskAssessment.riskClass,
        consequenceKind: input.riskAssessment.consequenceKind,
        requiredPolicyDimensions: input.riskAssessment.review.requiredPolicyDimensions,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(
  observations: readonly CryptoApprovalAllowanceObservation[],
): CryptoApprovalAllowanceOutcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(
  outcome: CryptoApprovalAllowanceOutcome,
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

function failingReasonCodes(
  observations: readonly CryptoApprovalAllowanceObservation[],
): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function signalFor(input: {
  readonly consequenceId: string;
  readonly outcome: CryptoApprovalAllowanceOutcome;
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly amountPosture: CryptoAllowanceAmountPosture;
  readonly durationPosture: CryptoAllowanceDurationPosture;
  readonly tokenAddress: string | null;
  readonly spenderAddress: string;
  readonly requestedAmount: string;
  readonly resultingAllowance: string;
  readonly budgetId: string | null;
  readonly observations: readonly CryptoApprovalAllowanceObservation[];
}): CryptoSimulationPreflightSignal {
  const status = signalStatusFor(input.outcome);
  return Object.freeze({
    source: 'erc-7715-permission',
    status,
    code: input.outcome === 'allow'
      ? 'approval-allowance-preflight-pass'
      : input.outcome === 'review-required'
        ? 'approval-allowance-preflight-review-required'
        : 'approval-allowance-preflight-block',
    message: input.outcome === 'allow'
      ? 'Approval allowance consequence is bounded enough for downstream authorization simulation.'
      : input.outcome === 'review-required'
        ? 'Approval allowance consequence needs additional policy evidence before execution.'
        : 'Approval allowance consequence must fail closed before execution.',
    required: true,
    evidence: Object.freeze({
      consequenceId: input.consequenceId,
      mechanism: input.mechanism,
      amountPosture: input.amountPosture,
      durationPosture: input.durationPosture,
      tokenAddress: input.tokenAddress,
      spenderAddress: input.spenderAddress,
      requestedAmount: input.requestedAmount,
      resultingAllowance: input.resultingAllowance,
      budgetId: input.budgetId,
      reasonCodes: failingReasonCodes(input.observations),
    }),
  });
}

function consequenceIdFor(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly mechanism: CryptoApprovalAllowanceMechanism;
  readonly spenderAddress: string;
  readonly tokenAddress: string | null;
  readonly requestedAmount: string;
  readonly resultingAllowance: string;
  readonly amountPosture: CryptoAllowanceAmountPosture;
  readonly durationPosture: CryptoAllowanceDurationPosture;
}): string {
  return canonicalObject({
    version: CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION,
    intentId: input.intent.intentId,
    mechanism: input.mechanism,
    spenderAddress: input.spenderAddress,
    tokenAddress: input.tokenAddress,
    requestedAmount: input.requestedAmount,
    resultingAllowance: input.resultingAllowance,
    amountPosture: input.amountPosture,
    durationPosture: input.durationPosture,
  }).digest;
}

export function createCryptoApprovalAllowanceConsequence(
  input: CreateCryptoApprovalAllowanceConsequenceInput,
): CryptoApprovalAllowanceConsequence {
  const mechanism = mechanismFrom(input.mechanism);
  const requestedAmount = normalizeAmount(input.requestedAmount, 'requestedAmount');
  const currentAllowance = normalizeOptionalAmount(input.currentAllowance, 'currentAllowance');
  const explicitResultingAllowance = normalizeOptionalAmount(
    input.resultingAllowance,
    'resultingAllowance',
  );
  const allowanceExpiration = normalizeIsoTimestamp(
    input.allowanceExpiration,
    'allowanceExpiration',
  );
  const permitDeadline = normalizeIsoTimestamp(input.permitDeadline, 'permitDeadline');
  const amountPosture = amountPostureFrom({
    mechanism,
    requestedAmount,
    amountPosture: input.amountPosture,
  });
  const durationPosture = durationPostureFrom({
    mechanism,
    amountPosture,
    allowanceExpiration,
    durationPosture: input.durationPosture,
  });
  const ownerAddress = normalizeAddress(input.ownerAddress ?? input.intent.account.address, 'ownerAddress');
  const tokenAddress = normalizeOptionalAddress(
    input.tokenAddress ?? input.intent.asset?.assetId,
    'tokenAddress',
  );
  const spenderAddress = normalizeAddress(input.spenderAddress, 'spenderAddress');
  const resultingAllowance = resultingAllowanceFor({
    mechanism,
    amountPosture,
    requestedAmount,
    currentAllowance,
    resultingAllowance: explicitResultingAllowance,
  });
  const budgetId = normalizeOptionalIdentifier(
    input.budgetId ?? input.intent.constraints.budgetId,
    'budgetId',
  );
  const revocation = revocationFrom(input.revocation, durationPosture);
  const permitNonce = normalizeOptionalIdentifier(input.permitNonce, 'permitNonce');
  const permitDomainChainId = normalizeOptionalIdentifier(
    input.permitDomainChainId,
    'permitDomainChainId',
  );
  const permitDomainVerifyingContract = normalizeOptionalAddress(
    input.permitDomainVerifyingContract,
    'permitDomainVerifyingContract',
  );
  const counterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'contract',
    counterpartyId: spenderAddress,
    chain: input.intent.chain,
    display: input.spenderLabel ?? spenderAddress,
  });
  const normalizedUsd = normalizeOptionalAmount(input.normalizedUsd, 'normalizedUsd');
  const riskAssessment = createRiskAssessment({
    intent: input.intent,
    amountPosture,
    requestedAmount,
    normalizedUsd,
    counterparty,
    durationPosture,
    budgetId,
    revocation,
    isKnownSpender: input.isKnownSpender ?? null,
  });
  const observations = buildObservations({
    intent: input.intent,
    mechanism,
    amountPosture,
    durationPosture,
    ownerAddress,
    tokenAddress,
    spenderAddress,
    requestedAmount,
    currentAllowance,
    resultingAllowance,
    allowanceExpiration,
    permitDeadline,
    permitNonce,
    permitDomainChainId,
    permitDomainVerifyingContract,
    budgetId,
    revocation,
    riskAssessment,
  });
  const outcome = outcomeFromObservations(observations);
  const consequenceId =
    normalizeOptionalIdentifier(input.consequenceId, 'consequenceId') ??
    consequenceIdFor({
      intent: input.intent,
      mechanism,
      spenderAddress,
      tokenAddress,
      requestedAmount,
      resultingAllowance,
      amountPosture,
      durationPosture,
    });
  const signal = signalFor({
    consequenceId,
    outcome,
    mechanism,
    amountPosture,
    durationPosture,
    tokenAddress,
    spenderAddress,
    requestedAmount,
    resultingAllowance,
    budgetId,
    observations,
  });
  const consequenceKind = input.intent.consequenceKind;
  const canonicalPayload = {
    version: CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION,
    consequenceId,
    intentId: input.intent.intentId,
    consequenceKind,
    mechanism,
    amountPosture,
    durationPosture,
    outcome,
    chainId: caip2ChainId(input.intent),
    ownerAddress,
    tokenAddress,
    spenderAddress,
    requestedAmount,
    currentAllowance,
    resultingAllowance,
    allowanceExpiration,
    permitDeadline,
    permitNonce,
    permitDomainChainId,
    permitDomainVerifyingContract,
    budgetId,
    revocation,
    approvalPolicyRef: normalizeOptionalIdentifier(input.approvalPolicyRef, 'approvalPolicyRef'),
    counterpartyDigest: counterparty.digest,
    riskAssessmentDigest: riskAssessment.digest,
    requiredPolicyDimensions: riskAssessment.review.requiredPolicyDimensions,
    signal,
    observations,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    version: CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION,
    consequenceId,
    intentId: input.intent.intentId,
    consequenceKind,
    mechanism,
    amountPosture,
    durationPosture,
    outcome,
    chainId: caip2ChainId(input.intent),
    ownerAddress,
    tokenAddress,
    spenderAddress,
    requestedAmount,
    currentAllowance,
    resultingAllowance,
    allowanceExpiration,
    permitDeadline,
    permitNonce,
    budgetId,
    revocation,
    counterparty,
    riskAssessment,
    requiredPolicyDimensions: riskAssessment.review.requiredPolicyDimensions,
    signal,
    observations,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoApprovalAllowanceConsequenceLabel(
  consequence: CryptoApprovalAllowanceConsequence,
): string {
  return [
    `approval:${consequence.intentId}`,
    `outcome:${consequence.outcome}`,
    `mechanism:${consequence.mechanism}`,
    `spender:${consequence.spenderAddress}`,
    `amount:${consequence.amountPosture}`,
    `duration:${consequence.durationPosture}`,
  ].join(' / ');
}

export function cryptoApprovalAllowanceConsequenceDescriptor():
CryptoApprovalAllowanceConsequenceDescriptor {
  return Object.freeze({
    version: CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION,
    mechanisms: CRYPTO_APPROVAL_ALLOWANCE_MECHANISMS,
    amountPostures: CRYPTO_ALLOWANCE_AMOUNT_POSTURES,
    durationPostures: CRYPTO_ALLOWANCE_DURATION_POSTURES,
    outcomes: CRYPTO_APPROVAL_ALLOWANCE_OUTCOMES,
    revocationMethods: CRYPTO_APPROVAL_ALLOWANCE_REVOCATION_METHODS,
    checks: CRYPTO_APPROVAL_ALLOWANCE_CHECKS,
    standards: Object.freeze([
      'EIP-20',
      'ERC-20-approve',
      'EIP-2612',
      'Permit2',
      'ERC-7674',
      'ERC-7715-permission-ready',
      'EIP-712',
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'attestor-crypto-authorization-simulation',
    ]),
  });
}
