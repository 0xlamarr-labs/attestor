import { createHash } from 'node:crypto';
import { riskControlProfile, type ControlFailureDisposition } from '../release-kernel/risk-controls.js';
import { RISK_CLASSES, type ReviewAuthorityMode } from '../release-kernel/types.js';
import {
  CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS,
  CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES,
  type CryptoAccountReference,
  type CryptoAssetReference,
  type CryptoAuthorizationArtifactKind,
  type CryptoAuthorizationConsequenceKind,
  type CryptoAuthorizationPolicyDimension,
  type CryptoAuthorizationRiskClass,
  type CryptoExecutionAdapterKind,
} from './types.js';
import type { CryptoCanonicalCounterpartyReference } from './canonical-references.js';

/**
 * Deterministic crypto consequence risk mapping.
 *
 * Step 04 keeps this adapter-neutral: the base consequence profile supplies the
 * floor, while amount, account, asset, counterparty, and execution-context
 * signals can only raise risk or add review requirements.
 */

export const CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION =
  'attestor.crypto-consequence-risk-mapping.v1';

export const CRYPTO_CONSEQUENCE_RISK_FACTOR_KINDS = [
  'base-consequence',
  'amount',
  'account',
  'asset',
  'counterparty',
  'execution-context',
  'policy-posture',
] as const;
export type CryptoConsequenceRiskFactorKind =
  typeof CRYPTO_CONSEQUENCE_RISK_FACTOR_KINDS[number];

export const CRYPTO_CONSEQUENCE_CONTEXT_SIGNALS = [
  'known-counterparty',
  'new-counterparty',
  'cross-chain',
  'high-privilege-call',
  'admin-upgrade',
  'wallet-permission',
  'missing-expiry',
  'missing-budget',
  'missing-revocation',
  'agent-initiated',
  'user-initiated',
  'custody-policy-present',
  'custody-policy-missing',
  'offchain-settlement',
  'intent-solver-routing',
] as const;
export type CryptoConsequenceContextSignal =
  typeof CRYPTO_CONSEQUENCE_CONTEXT_SIGNALS[number];

export const CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD = Object.freeze({
  review: '10000',
  dualApproval: '100000',
  critical: '1000000',
});

export const CRYPTO_VALUE_MOVING_CONSEQUENCE_KINDS = [
  'transfer',
  'approval',
  'swap',
  'bridge',
  'agent-payment',
  'custody-withdrawal',
] as const satisfies readonly CryptoAuthorizationConsequenceKind[];
export type CryptoValueMovingConsequenceKind =
  typeof CRYPTO_VALUE_MOVING_CONSEQUENCE_KINDS[number];

export interface CryptoConsequenceAmountInput {
  readonly assetAmount?: string | null;
  readonly normalizedUsd?: string | null;
  readonly isUnlimitedApproval?: boolean;
}

export interface CryptoConsequenceRiskContextInput {
  readonly executionAdapterKind?: CryptoExecutionAdapterKind | null;
  readonly signals?: readonly CryptoConsequenceContextSignal[];
  readonly operationCount?: number | null;
  readonly hasExpiry?: boolean | null;
  readonly hasBudget?: boolean | null;
  readonly hasRevocationPath?: boolean | null;
  readonly isKnownCounterparty?: boolean | null;
  readonly requiresCustodyPolicy?: boolean | null;
  readonly hasCustodyPolicy?: boolean | null;
}

export interface CreateCryptoConsequenceRiskAssessmentInput {
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly account: CryptoAccountReference;
  readonly asset?: CryptoAssetReference | null;
  readonly amount?: CryptoConsequenceAmountInput | null;
  readonly counterparty?: CryptoCanonicalCounterpartyReference | null;
  readonly context?: CryptoConsequenceRiskContextInput | null;
}

export interface CryptoConsequenceRiskFinding {
  readonly factorKind: CryptoConsequenceRiskFactorKind;
  readonly code: string;
  readonly riskClass: CryptoAuthorizationRiskClass;
  readonly reason: string;
  readonly requiredPolicyDimensions: readonly CryptoAuthorizationPolicyDimension[];
}

export interface CryptoConsequenceReviewRequirement {
  readonly riskClass: CryptoAuthorizationRiskClass;
  readonly authorityMode: ReviewAuthorityMode;
  readonly minimumReviewerCount: number;
  readonly requiresNamedReviewer: boolean;
  readonly failureDisposition: ControlFailureDisposition;
  readonly requiredArtifacts: readonly CryptoAuthorizationArtifactKind[];
  readonly requiredPolicyDimensions: readonly CryptoAuthorizationPolicyDimension[];
  readonly tokenEnforcement: ReturnType<typeof riskControlProfile>['token']['minimumEnforcement'];
  readonly maxTokenTtlSeconds: number;
}

export interface CryptoConsequenceRiskAssessment {
  readonly version: typeof CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION;
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly accountKind: CryptoAccountReference['accountKind'];
  readonly assetKind: CryptoAssetReference['assetKind'] | null;
  readonly counterpartyKind: CryptoCanonicalCounterpartyReference['counterpartyKind'] | null;
  readonly amountNormalizedUsd: string | null;
  readonly riskClass: CryptoAuthorizationRiskClass;
  readonly defaultRiskClass: CryptoAuthorizationRiskClass;
  readonly review: CryptoConsequenceReviewRequirement;
  readonly findings: readonly CryptoConsequenceRiskFinding[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoConsequenceRiskMappingDescriptor {
  readonly version: typeof CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION;
  readonly consequenceKinds: readonly CryptoAuthorizationConsequenceKind[];
  readonly riskClasses: readonly CryptoAuthorizationRiskClass[];
  readonly factorKinds: readonly CryptoConsequenceRiskFactorKind[];
  readonly contextSignals: readonly CryptoConsequenceContextSignal[];
  readonly valueMovingConsequenceKinds: readonly CryptoValueMovingConsequenceKind[];
  readonly amountThresholdsUsd: typeof CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD;
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const RISK_RANK: Record<CryptoAuthorizationRiskClass, number> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
};

const USD_SCALE = 6;
const SMART_ACCOUNT_KINDS = new Set<CryptoAccountReference['accountKind']>([
  'safe',
  'erc-4337-smart-account',
  'erc-7579-modular-account',
  'erc-6900-modular-account',
]);

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function canonicalizeJson(value: CanonicalJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeJson(entry)).join(',')}]`;

  const objectValue = value as { readonly [key: string]: CanonicalJsonValue };
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(objectValue[key])}`)
    .join(',')}}`;
}

function digestCanonicalJson(value: CanonicalJsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`;
}

function riskMax(
  left: CryptoAuthorizationRiskClass,
  right: CryptoAuthorizationRiskClass,
): CryptoAuthorizationRiskClass {
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
}

function riskMaxAll(values: readonly CryptoAuthorizationRiskClass[]): CryptoAuthorizationRiskClass {
  return values.reduce((current, next) => riskMax(current, next), 'R0');
}

function isValueMovingConsequence(
  consequenceKind: CryptoAuthorizationConsequenceKind,
): consequenceKind is CryptoValueMovingConsequenceKind {
  return includesValue(CRYPTO_VALUE_MOVING_CONSEQUENCE_KINDS, consequenceKind);
}

function parseDecimalToScaledUnits(value: string, fieldName: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error(`Crypto consequence risk mapping ${fieldName} must be a non-negative decimal with up to 6 fractional digits.`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * 10n ** BigInt(USD_SCALE) + BigInt(fraction.padEnd(USD_SCALE, '0'));
}

function normalizeAmountUsd(amount: CryptoConsequenceAmountInput | null | undefined): string | null {
  if (!amount?.normalizedUsd) {
    return null;
  }
  parseDecimalToScaledUnits(amount.normalizedUsd, 'normalizedUsd');
  return amount.normalizedUsd.trim();
}

function amountAtLeast(value: string, threshold: string): boolean {
  return (
    parseDecimalToScaledUnits(value, 'normalizedUsd') >=
    parseDecimalToScaledUnits(threshold, 'amount threshold')
  );
}

function createFinding(
  factorKind: CryptoConsequenceRiskFactorKind,
  code: string,
  riskClass: CryptoAuthorizationRiskClass,
  reason: string,
  requiredPolicyDimensions: readonly CryptoAuthorizationPolicyDimension[] = [],
): CryptoConsequenceRiskFinding {
  return Object.freeze({
    factorKind,
    code,
    riskClass,
    reason,
    requiredPolicyDimensions: Object.freeze([...requiredPolicyDimensions]),
  });
}

function normalizedContextSignals(
  input: CreateCryptoConsequenceRiskAssessmentInput,
): readonly CryptoConsequenceContextSignal[] {
  const context = input.context;
  const signals: CryptoConsequenceContextSignal[] = [];

  for (const signal of context?.signals ?? []) {
    if (!includesValue(CRYPTO_CONSEQUENCE_CONTEXT_SIGNALS, signal)) {
      throw new Error(`Crypto consequence risk mapping does not support context signal ${signal}.`);
    }
    signals.push(signal);
  }

  if (context?.isKnownCounterparty === true) signals.push('known-counterparty');
  if (context?.isKnownCounterparty === false) signals.push('new-counterparty');
  if (context?.hasExpiry === false) signals.push('missing-expiry');
  if (context?.hasBudget === false) signals.push('missing-budget');
  if (context?.hasRevocationPath === false) signals.push('missing-revocation');
  if (context?.requiresCustodyPolicy === true && context.hasCustodyPolicy !== true) {
    signals.push('custody-policy-missing');
  }
  if (context?.requiresCustodyPolicy === true && context.hasCustodyPolicy === true) {
    signals.push('custody-policy-present');
  }

  return unique(signals);
}

function amountFindings(
  input: CreateCryptoConsequenceRiskAssessmentInput,
  amountNormalizedUsd: string | null,
): readonly CryptoConsequenceRiskFinding[] {
  const findings: CryptoConsequenceRiskFinding[] = [];
  const amount = input.amount;

  if (amount?.assetAmount != null) {
    const assetAmount = amount.assetAmount.trim();
    if (assetAmount.length === 0) {
      throw new Error('Crypto consequence risk mapping assetAmount cannot be blank when provided.');
    }
  }

  if (amount?.isUnlimitedApproval === true) {
    findings.push(
      createFinding(
        'amount',
        'unlimited-approval',
        'R4',
        'Unlimited token approvals are treated as regulated-grade authorization consequences.',
        ['spender', 'amount', 'validity-window'],
      ),
    );
  }

  if (isValueMovingConsequence(input.consequenceKind) && amountNormalizedUsd === null) {
    findings.push(
      createFinding(
        'amount',
        'missing-normalized-amount',
        'R3',
        'Value-moving crypto consequences require a normalized amount before automatic release can be considered.',
        ['amount'],
      ),
    );
  }

  if (amountNormalizedUsd !== null) {
    if (amountAtLeast(amountNormalizedUsd, CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD.critical)) {
      findings.push(
        createFinding(
          'amount',
          'critical-amount',
          'R4',
          'Critical-value crypto consequences require dual approval and durable evidence.',
          ['amount', 'approval-quorum'],
        ),
      );
    } else if (
      amountAtLeast(amountNormalizedUsd, CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD.dualApproval)
    ) {
      findings.push(
        createFinding(
          'amount',
          'dual-approval-amount',
          'R4',
          'High-value crypto consequences require dual approval.',
          ['amount', 'approval-quorum'],
        ),
      );
    } else if (
      amountAtLeast(amountNormalizedUsd, CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD.review)
    ) {
      findings.push(
        createFinding(
          'amount',
          'review-amount',
          'R3',
          'Material crypto value movement requires a named reviewer.',
          ['amount'],
        ),
      );
    }
  }

  return Object.freeze(findings);
}

function accountFindings(
  input: CreateCryptoConsequenceRiskAssessmentInput,
): readonly CryptoConsequenceRiskFinding[] {
  const findings: CryptoConsequenceRiskFinding[] = [];

  if (input.account.accountKind === 'custody-account' && isValueMovingConsequence(input.consequenceKind)) {
    findings.push(
      createFinding(
        'account',
        'custody-account-value-movement',
        'R4',
        'Custody-account value movement requires custody-grade approval evidence.',
        ['account', 'approval-quorum'],
      ),
    );
  }

  if (input.account.accountKind === 'agent-wallet' && isValueMovingConsequence(input.consequenceKind)) {
    findings.push(
      createFinding(
        'account',
        'agent-wallet-value-movement',
        'R3',
        'Agent-controlled value movement requires named accountability unless bounded by later policy.',
        ['actor', 'budget'],
      ),
    );
  }

  return Object.freeze(findings);
}

function assetFindings(
  input: CreateCryptoConsequenceRiskAssessmentInput,
  amountNormalizedUsd: string | null,
): readonly CryptoConsequenceRiskFinding[] {
  const findings: CryptoConsequenceRiskFinding[] = [];
  const asset = input.asset;

  if (!asset) {
    return Object.freeze(findings);
  }

  if (asset.assetKind === 'rwa-token') {
    findings.push(
      createFinding(
        'asset',
        'rwa-token',
        'R4',
        'Real-world asset tokens are treated as regulated-grade value consequences.',
        ['asset', 'risk-tier'],
      ),
    );
  }

  if (asset.assetKind === 'non-fungible-token' && amountNormalizedUsd === null) {
    findings.push(
      createFinding(
        'asset',
        'unpriced-non-fungible-token',
        'R3',
        'NFT consequences without normalized value require review because market value is not deterministic.',
        ['asset', 'amount'],
      ),
    );
  }

  return Object.freeze(findings);
}

function counterpartyFindings(
  input: CreateCryptoConsequenceRiskAssessmentInput,
): readonly CryptoConsequenceRiskFinding[] {
  const findings: CryptoConsequenceRiskFinding[] = [];
  const counterparty = input.counterparty ?? null;

  if (!counterparty && CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.consequenceKind].requiredPolicyDimensions.includes('counterparty')) {
    findings.push(
      createFinding(
        'counterparty',
        'missing-counterparty',
        'R3',
        'Counterparty-scoped crypto consequences require an explicit counterparty reference.',
        ['counterparty'],
      ),
    );
    return Object.freeze(findings);
  }

  switch (counterparty?.counterpartyKind) {
    case 'bridge':
      findings.push(
        createFinding(
          'counterparty',
          'bridge-counterparty',
          'R4',
          'Bridge counterparties are treated as regulated-grade due to cross-chain settlement risk.',
          ['counterparty', 'protocol', 'amount'],
        ),
      );
      break;
    case 'custody-destination':
      findings.push(
        createFinding(
          'counterparty',
          'custody-destination-counterparty',
          'R4',
          'Custody destinations require custody-grade approval and evidence.',
          ['counterparty', 'approval-quorum'],
        ),
      );
      break;
    case 'intent-solver':
      findings.push(
        createFinding(
          'counterparty',
          'intent-solver-counterparty',
          'R3',
          'Intent-solver routing requires review-grade evidence until solver policy is proven.',
          ['counterparty', 'protocol'],
        ),
      );
      break;
    case 'offchain-entity':
      findings.push(
        createFinding(
          'counterparty',
          'offchain-entity-counterparty',
          'R3',
          'Off-chain entities require explicit accountability evidence before value movement.',
          ['counterparty'],
        ),
      );
      break;
    default:
      break;
  }

  return Object.freeze(findings);
}

function contextFindings(
  input: CreateCryptoConsequenceRiskAssessmentInput,
  signals: readonly CryptoConsequenceContextSignal[],
): readonly CryptoConsequenceRiskFinding[] {
  const findings: CryptoConsequenceRiskFinding[] = [];
  const context = input.context;

  if (context?.operationCount != null) {
    if (!Number.isInteger(context.operationCount) || context.operationCount <= 0) {
      throw new Error('Crypto consequence risk mapping operationCount must be a positive integer.');
    }
    if (context.operationCount > 20) {
      findings.push(
        createFinding(
          'execution-context',
          'large-batch-operation',
          'R4',
          'Large batched crypto execution requires dual approval.',
          ['runtime-context', 'approval-quorum'],
        ),
      );
    } else if (context.operationCount > 1) {
      findings.push(
        createFinding(
          'execution-context',
          'batch-operation',
          'R3',
          'Batched crypto execution requires review-grade runtime context.',
          ['runtime-context'],
        ),
      );
    }
  }

  switch (context?.executionAdapterKind) {
    case 'eip-7702-delegation':
      findings.push(
        createFinding(
          'execution-context',
          'eip-7702-delegation',
          'R4',
          'EOA delegation authorizations are treated as regulated-grade account-control consequences.',
          ['actor', 'validity-window', 'runtime-context'],
        ),
      );
      break;
    case 'custody-cosigner':
      findings.push(
        createFinding(
          'execution-context',
          'custody-cosigner',
          'R4',
          'Custody co-signer paths require custody policy evidence.',
          ['approval-quorum'],
        ),
      );
      break;
    case 'erc-6900-plugin':
    case 'erc-7579-module':
      findings.push(
        createFinding(
          'execution-context',
          'modular-account-extension',
          'R3',
          'Modular account extension execution requires review-grade module context.',
          ['runtime-context'],
        ),
      );
      break;
    default:
      break;
  }

  for (const signal of signals) {
    switch (signal) {
      case 'new-counterparty':
        findings.push(
          createFinding(
            'counterparty',
            'new-counterparty',
            'R4',
            'New counterparties require dual approval until scoped by policy.',
            ['counterparty', 'approval-quorum'],
          ),
        );
        break;
      case 'cross-chain':
        findings.push(
          createFinding(
            'execution-context',
            'cross-chain',
            'R4',
            'Cross-chain execution requires regulated-grade accounting and review controls.',
            ['runtime-context', 'protocol'],
          ),
        );
        break;
      case 'high-privilege-call':
      case 'admin-upgrade':
        findings.push(
          createFinding(
            'execution-context',
            signal,
            'R4',
            'Privileged contract execution requires dual approval and durable evidence.',
            ['function-selector', 'calldata-class', 'approval-quorum'],
          ),
        );
        break;
      case 'wallet-permission':
        findings.push(
          createFinding(
            'execution-context',
            'wallet-permission',
            'R4',
            'Wallet permission grants are treated as high-authority execution consequences.',
            ['spender', 'validity-window'],
          ),
        );
        break;
      case 'missing-expiry':
        findings.push(
          createFinding(
            'policy-posture',
            'missing-expiry',
            input.consequenceKind === 'agent-payment' ? 'R3' : 'R4',
            'Missing expiry prevents bounded authorization.',
            ['validity-window'],
          ),
        );
        break;
      case 'missing-budget':
        findings.push(
          createFinding(
            'policy-posture',
            'missing-budget',
            input.consequenceKind === 'agent-payment' ? 'R3' : 'R4',
            'Missing budget prevents bounded value authorization.',
            ['budget'],
          ),
        );
        break;
      case 'missing-revocation':
        findings.push(
          createFinding(
            'policy-posture',
            'missing-revocation',
            'R4',
            'Missing revocation path is not acceptable for delegated or permissioned execution.',
            ['validity-window'],
          ),
        );
        break;
      case 'custody-policy-missing':
        findings.push(
          createFinding(
            'policy-posture',
            'custody-policy-missing',
            'R4',
            'Custody execution requires custody policy evidence.',
            ['approval-quorum'],
          ),
        );
        break;
      case 'offchain-settlement':
        findings.push(
          createFinding(
            'execution-context',
            'offchain-settlement',
            'R3',
            'Off-chain settlement requires review-grade reconciliation evidence.',
            ['runtime-context'],
          ),
        );
        break;
      case 'intent-solver-routing':
        findings.push(
          createFinding(
            'execution-context',
            'intent-solver-routing',
            'R3',
            'Intent-solver routing requires solver and settlement evidence.',
            ['protocol', 'runtime-context'],
          ),
        );
        break;
      case 'known-counterparty':
      case 'agent-initiated':
      case 'user-initiated':
      case 'custody-policy-present':
        break;
    }
  }

  return Object.freeze(findings);
}

function requiredArtifactsFor(
  input: CreateCryptoConsequenceRiskAssessmentInput,
  riskClass: CryptoAuthorizationRiskClass,
): readonly CryptoAuthorizationArtifactKind[] {
  const artifacts: CryptoAuthorizationArtifactKind[] = ['attestor-release-receipt'];

  if (SMART_ACCOUNT_KINDS.has(input.account.accountKind)) {
    artifacts.push('erc-1271-validation');
  } else {
    artifacts.push('eip-712-authorization');
  }

  if (input.consequenceKind === 'permission-grant') {
    artifacts.push('wallet-permission-grant');
  }
  if (input.consequenceKind === 'agent-payment') {
    artifacts.push('http-payment-authorization');
  }
  if (input.consequenceKind === 'custody-withdrawal' || input.account.accountKind === 'custody-account') {
    artifacts.push('custody-policy-decision');
  }
  if (riskClass === 'R3' || riskClass === 'R4') {
    artifacts.push('execution-proof');
  }

  return unique(artifacts);
}

function requiredPolicyDimensionsFor(
  input: CreateCryptoConsequenceRiskAssessmentInput,
  findings: readonly CryptoConsequenceRiskFinding[],
): readonly CryptoAuthorizationPolicyDimension[] {
  const profileDimensions =
    CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.consequenceKind].requiredPolicyDimensions;
  return unique([
    ...profileDimensions,
    'risk-tier',
    ...findings.flatMap((finding) => finding.requiredPolicyDimensions),
  ]);
}

function reviewRequirementFor(
  input: CreateCryptoConsequenceRiskAssessmentInput,
  riskClass: CryptoAuthorizationRiskClass,
  findings: readonly CryptoConsequenceRiskFinding[],
): CryptoConsequenceReviewRequirement {
  const controls = riskControlProfile(riskClass);
  return Object.freeze({
    riskClass,
    authorityMode: controls.review.mode,
    minimumReviewerCount: controls.review.minimumReviewerCount,
    requiresNamedReviewer: controls.review.requiresNamedReviewer,
    failureDisposition: controls.review.failureDisposition,
    requiredArtifacts: requiredArtifactsFor(input, riskClass),
    requiredPolicyDimensions: requiredPolicyDimensionsFor(input, findings),
    tokenEnforcement: controls.token.minimumEnforcement,
    maxTokenTtlSeconds: controls.token.maxTtlSeconds,
  });
}

export function isCryptoConsequenceContextSignal(
  value: string,
): value is CryptoConsequenceContextSignal {
  return includesValue(CRYPTO_CONSEQUENCE_CONTEXT_SIGNALS, value);
}

export function createCryptoConsequenceRiskAssessment(
  input: CreateCryptoConsequenceRiskAssessmentInput,
): CryptoConsequenceRiskAssessment {
  if (!CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS.includes(input.consequenceKind)) {
    throw new Error(
      `Crypto consequence risk mapping does not support consequence kind ${input.consequenceKind}.`,
    );
  }

  const profile = CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.consequenceKind];
  const amountNormalizedUsd = normalizeAmountUsd(input.amount);
  const signals = normalizedContextSignals(input);
  const findings = Object.freeze([
    createFinding(
      'base-consequence',
      `base-${input.consequenceKind}`,
      profile.defaultRiskClass,
      `Base risk for ${input.consequenceKind} is ${profile.defaultRiskClass}.`,
      profile.requiredPolicyDimensions,
    ),
    ...amountFindings(input, amountNormalizedUsd),
    ...accountFindings(input),
    ...assetFindings(input, amountNormalizedUsd),
    ...counterpartyFindings(input),
    ...contextFindings(input, signals),
  ]);
  const riskClass = riskMaxAll(findings.map((finding) => finding.riskClass));
  const review = reviewRequirementFor(input, riskClass, findings);
  const payload = {
    version: CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION,
    consequenceKind: input.consequenceKind,
    accountKind: input.account.accountKind,
    assetKind: input.asset?.assetKind ?? null,
    counterpartyKind: input.counterparty?.counterpartyKind ?? null,
    amountNormalizedUsd,
    riskClass,
    reviewAuthorityMode: review.authorityMode,
    minimumReviewerCount: review.minimumReviewerCount,
    findingCodes: findings.map((finding) => finding.code),
    requiredArtifacts: review.requiredArtifacts,
    requiredPolicyDimensions: review.requiredPolicyDimensions,
  } as const;

  return Object.freeze({
    version: CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION,
    consequenceKind: input.consequenceKind,
    accountKind: input.account.accountKind,
    assetKind: input.asset?.assetKind ?? null,
    counterpartyKind: input.counterparty?.counterpartyKind ?? null,
    amountNormalizedUsd,
    riskClass,
    defaultRiskClass: profile.defaultRiskClass,
    review,
    findings,
    canonical: canonicalizeJson(payload),
    digest: digestCanonicalJson(payload),
  });
}

export function cryptoConsequenceRiskAssessmentLabel(
  assessment: CryptoConsequenceRiskAssessment,
): string {
  return [
    `consequence:${assessment.consequenceKind}`,
    `risk:${assessment.riskClass}`,
    `account:${assessment.accountKind}`,
    assessment.assetKind ? `asset:${assessment.assetKind}` : null,
    assessment.counterpartyKind ? `counterparty:${assessment.counterpartyKind}` : null,
    `review:${assessment.review.authorityMode}`,
  ]
    .filter((segment): segment is string => segment !== null)
    .join(' / ');
}

export function compareCryptoRiskClass(
  left: CryptoAuthorizationRiskClass,
  right: CryptoAuthorizationRiskClass,
): number {
  return RISK_RANK[left] - RISK_RANK[right];
}

export function maxCryptoRiskClass(
  values: readonly CryptoAuthorizationRiskClass[],
): CryptoAuthorizationRiskClass {
  if (values.length === 0) {
    throw new Error('Crypto consequence risk mapping requires at least one risk class.');
  }
  return riskMaxAll(values);
}

export function cryptoConsequenceRiskMappingDescriptor(): CryptoConsequenceRiskMappingDescriptor {
  return Object.freeze({
    version: CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION,
    consequenceKinds: CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS,
    riskClasses: RISK_CLASSES,
    factorKinds: CRYPTO_CONSEQUENCE_RISK_FACTOR_KINDS,
    contextSignals: CRYPTO_CONSEQUENCE_CONTEXT_SIGNALS,
    valueMovingConsequenceKinds: CRYPTO_VALUE_MOVING_CONSEQUENCE_KINDS,
    amountThresholdsUsd: CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD,
  });
}
