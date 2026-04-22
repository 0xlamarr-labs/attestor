import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  Erc4337UserOperation,
  Erc4337UserOperationPreflight,
} from '../crypto-authorization-core/erc4337-user-operation-adapter.js';
import type { CryptoExecutionAdmissionPlan } from './index.js';

/**
 * ERC-4337 bundler admission handoffs project Attestor admission into the
 * JSON-RPC shape a bundler-facing integration needs before eth_sendUserOperation
 * is called. The layer does not become a bundler; it creates a bounded,
 * evidence-carrying handoff to one.
 */

export const ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION =
  'attestor.crypto-erc4337-bundler-admission-handoff.v1';

export const ERC4337_BUNDLER_ADMISSION_METHODS = [
  'eth_chainId',
  'eth_supportedEntryPoints',
  'eth_estimateUserOperationGas',
  'eth_sendUserOperation',
  'eth_getUserOperationByHash',
  'eth_getUserOperationReceipt',
] as const;
export type Erc4337BundlerAdmissionMethod =
  typeof ERC4337_BUNDLER_ADMISSION_METHODS[number];

export const ERC4337_BUNDLER_ADMISSION_OUTCOMES = [
  'ready',
  'needs-bundler-evidence',
  'blocked',
] as const;
export type Erc4337BundlerAdmissionOutcome =
  typeof ERC4337_BUNDLER_ADMISSION_OUTCOMES[number];

export const ERC4337_BUNDLER_EXPECTATION_KINDS = [
  'chain-id',
  'entrypoint-support',
  'simulation',
  'erc7562-validation-scope',
  'gas-estimate',
  'paymaster-posture',
] as const;
export type Erc4337BundlerExpectationKind =
  typeof ERC4337_BUNDLER_EXPECTATION_KINDS[number];

export const ERC4337_BUNDLER_EXPECTATION_STATUSES = [
  'satisfied',
  'missing',
  'unsupported',
  'failed',
] as const;
export type Erc4337BundlerExpectationStatus =
  typeof ERC4337_BUNDLER_EXPECTATION_STATUSES[number];

export interface Erc4337BundlerJsonRpcRequest<TParams> {
  readonly method: Erc4337BundlerAdmissionMethod;
  readonly params: TParams;
}

export interface Erc4337BundlerRpcUserOperation {
  readonly sender: string;
  readonly nonce: string;
  readonly factory?: string;
  readonly factoryData?: string;
  readonly callData: string;
  readonly callGasLimit: string;
  readonly verificationGasLimit: string;
  readonly preVerificationGas: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  readonly paymaster?: string;
  readonly paymasterVerificationGasLimit?: string;
  readonly paymasterPostOpGasLimit?: string;
  readonly paymasterData?: string;
  readonly signature: string;
  readonly eip7702Auth?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface Erc4337BundlerGasEstimate {
  readonly preVerificationGas: string;
  readonly verificationGasLimit: string;
  readonly callGasLimit: string;
  readonly paymasterVerificationGasLimit?: string | null;
  readonly paymasterPostOpGasLimit?: string | null;
}

export interface Erc4337BundlerAdmissionExpectation {
  readonly kind: Erc4337BundlerExpectationKind;
  readonly status: Erc4337BundlerExpectationStatus;
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateErc4337BundlerAdmissionHandoffInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Erc4337UserOperationPreflight;
  readonly userOperation: Erc4337UserOperation;
  readonly createdAt: string;
  readonly handoffId?: string | null;
  readonly bundlerId?: string | null;
  readonly bundlerUrl?: string | null;
  readonly bundlerChainIdHex?: string | null;
  readonly supportedEntryPoints?: readonly string[] | null;
  readonly gasEstimate?: Erc4337BundlerGasEstimate | null;
  readonly eip7702Auth?: Readonly<Record<string, CanonicalReleaseJsonValue>> | null;
  readonly operatorNote?: string | null;
}

export interface Erc4337BundlerAdmissionHandoff {
  readonly version: typeof ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly handoffId: string;
  readonly createdAt: string;
  readonly outcome: Erc4337BundlerAdmissionOutcome;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly preflightId: string;
  readonly preflightDigest: string;
  readonly userOpHash: string;
  readonly sender: string;
  readonly chainId: string;
  readonly chainIdHex: string;
  readonly entryPoint: string;
  readonly entryPointVersion: Erc4337UserOperationPreflight['entryPointVersion'];
  readonly paymaster: string | null;
  readonly factory: string | null;
  readonly bundlerId: string | null;
  readonly bundlerUrl: string | null;
  readonly methods: readonly Erc4337BundlerAdmissionMethod[];
  readonly chainIdRequest: Erc4337BundlerJsonRpcRequest<readonly []>;
  readonly supportedEntryPointsRequest: Erc4337BundlerJsonRpcRequest<readonly []>;
  readonly estimateGasRequest: Erc4337BundlerJsonRpcRequest<
    readonly [Erc4337BundlerRpcUserOperation, string]
  >;
  readonly sendUserOperationRequest: Erc4337BundlerJsonRpcRequest<
    readonly [Erc4337BundlerRpcUserOperation, string]
  >;
  readonly getUserOperationByHashRequest: Erc4337BundlerJsonRpcRequest<
    readonly [string]
  >;
  readonly getUserOperationReceiptRequest: Erc4337BundlerJsonRpcRequest<
    readonly [string]
  >;
  readonly attestorSidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  readonly expectations: readonly Erc4337BundlerAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface Erc4337BundlerAdmissionDescriptor {
  readonly version: typeof ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly methods: typeof ERC4337_BUNDLER_ADMISSION_METHODS;
  readonly outcomes: typeof ERC4337_BUNDLER_ADMISSION_OUTCOMES;
  readonly expectationKinds: typeof ERC4337_BUNDLER_EXPECTATION_KINDS;
  readonly standards: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`ERC-4337 bundler admission ${fieldName} requires a non-empty value.`);
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
    throw new Error(`ERC-4337 bundler admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error(`ERC-4337 bundler admission ${fieldName} must be an EVM address.`);
  }
  return normalized;
}

function normalizeOptionalAddress(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeAddress(value, fieldName);
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`ERC-4337 bundler admission ${fieldName} must be a 32-byte hex value.`);
  }
  return normalized;
}

function normalizeHexBytes(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]*$/u.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`ERC-4337 bundler admission ${fieldName} must be 0x-prefixed hex bytes.`);
  }
  return normalized;
}

function normalizeOptionalHexBytes(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeHexBytes(value, fieldName);
}

function normalizeQuantity(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(normalized)) return normalized;
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(
      `ERC-4337 bundler admission ${fieldName} must be a decimal integer or 0x quantity.`,
    );
  }
  return `0x${BigInt(normalized).toString(16)}`;
}

function normalizeOptionalQuantity(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeQuantity(value, fieldName);
}

function quantityToBigInt(value: string): bigint {
  return value.startsWith('0x') ? BigInt(value) : BigInt(value);
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

function chainIdHexFromCaip2(chainId: string): string {
  const [namespace, id] = chainId.split(':');
  if (namespace !== 'eip155' || !id || !/^(?:0|[1-9]\d*)$/u.test(id)) {
    throw new Error(
      'ERC-4337 bundler admission requires an EIP-155 CAIP-2 chain id such as eip155:1.',
    );
  }
  return `0x${BigInt(id).toString(16)}`;
}

function normalizeSupportedEntryPoints(
  values: readonly string[] | null | undefined,
): readonly string[] | null {
  if (values === undefined || values === null) return null;
  return Object.freeze(
    values.map((value) => normalizeAddress(value, 'supportedEntryPoints.entryPoint')),
  );
}

function normalizeGasEstimate(
  value: Erc4337BundlerGasEstimate | null | undefined,
): Erc4337BundlerGasEstimate | null {
  if (value === undefined || value === null) return null;
  return Object.freeze({
    preVerificationGas: normalizeQuantity(value.preVerificationGas, 'gasEstimate.preVerificationGas'),
    verificationGasLimit: normalizeQuantity(value.verificationGasLimit, 'gasEstimate.verificationGasLimit'),
    callGasLimit: normalizeQuantity(value.callGasLimit, 'gasEstimate.callGasLimit'),
    paymasterVerificationGasLimit: normalizeOptionalQuantity(
      value.paymasterVerificationGasLimit,
      'gasEstimate.paymasterVerificationGasLimit',
    ),
    paymasterPostOpGasLimit: normalizeOptionalQuantity(
      value.paymasterPostOpGasLimit,
      'gasEstimate.paymasterPostOpGasLimit',
    ),
  });
}

function rpcUserOperation(
  userOperation: Erc4337UserOperation,
  eip7702Auth: Readonly<Record<string, CanonicalReleaseJsonValue>> | null,
): Erc4337BundlerRpcUserOperation {
  const factory = userOperation.factory === '0x7702'
    ? '0x7702'
    : normalizeOptionalAddress(userOperation.factory, 'userOperation.factory');
  const paymaster = normalizeOptionalAddress(userOperation.paymaster, 'userOperation.paymaster');
  const operation: {
    sender: string;
    nonce: string;
    factory?: string;
    factoryData?: string;
    callData: string;
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    paymaster?: string;
    paymasterVerificationGasLimit?: string;
    paymasterPostOpGasLimit?: string;
    paymasterData?: string;
    signature: string;
    eip7702Auth?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  } = {
    sender: normalizeAddress(userOperation.sender, 'userOperation.sender'),
    nonce: normalizeQuantity(userOperation.nonce, 'userOperation.nonce'),
    callData: normalizeHexBytes(userOperation.callData, 'userOperation.callData'),
    callGasLimit: normalizeQuantity(userOperation.callGasLimit, 'userOperation.callGasLimit'),
    verificationGasLimit: normalizeQuantity(
      userOperation.verificationGasLimit,
      'userOperation.verificationGasLimit',
    ),
    preVerificationGas: normalizeQuantity(
      userOperation.preVerificationGas,
      'userOperation.preVerificationGas',
    ),
    maxFeePerGas: normalizeQuantity(userOperation.maxFeePerGas, 'userOperation.maxFeePerGas'),
    maxPriorityFeePerGas: normalizeQuantity(
      userOperation.maxPriorityFeePerGas,
      'userOperation.maxPriorityFeePerGas',
    ),
    signature: normalizeHexBytes(userOperation.signature, 'userOperation.signature'),
  };
  if (factory) operation.factory = factory;
  const factoryData = normalizeOptionalHexBytes(
    userOperation.factoryData,
    'userOperation.factoryData',
  );
  if (factoryData !== null) operation.factoryData = factoryData;
  if (paymaster) operation.paymaster = paymaster;
  const paymasterVerificationGasLimit = normalizeOptionalQuantity(
    userOperation.paymasterVerificationGasLimit,
    'userOperation.paymasterVerificationGasLimit',
  );
  if (paymasterVerificationGasLimit !== null) {
    operation.paymasterVerificationGasLimit = paymasterVerificationGasLimit;
  }
  const paymasterPostOpGasLimit = normalizeOptionalQuantity(
    userOperation.paymasterPostOpGasLimit,
    'userOperation.paymasterPostOpGasLimit',
  );
  if (paymasterPostOpGasLimit !== null) {
    operation.paymasterPostOpGasLimit = paymasterPostOpGasLimit;
  }
  const paymasterData = normalizeOptionalHexBytes(
    userOperation.paymasterData,
    'userOperation.paymasterData',
  );
  if (paymasterData !== null) operation.paymasterData = paymasterData;
  if (eip7702Auth) operation.eip7702Auth = Object.freeze({ ...eip7702Auth });
  return Object.freeze(operation);
}

function expectation(input: {
  readonly kind: Erc4337BundlerExpectationKind;
  readonly status: Erc4337BundlerExpectationStatus;
  readonly reasonCode: string;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): Erc4337BundlerAdmissionExpectation {
  return Object.freeze({
    kind: input.kind,
    status: input.status,
    reasonCode: normalizeIdentifier(input.reasonCode, 'expectation.reasonCode'),
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function gasEstimateFits(
  estimate: string | null | undefined,
  requested: string | null | undefined,
): boolean {
  if (estimate === undefined || estimate === null) return true;
  if (requested === undefined || requested === null) return false;
  return quantityToBigInt(estimate) <= quantityToBigInt(normalizeQuantity(requested, 'requestedGas'));
}

function expectationsFor(input: {
  readonly preflight: Erc4337UserOperationPreflight;
  readonly userOperation: Erc4337UserOperation;
  readonly chainIdHex: string;
  readonly bundlerChainIdHex: string | null;
  readonly supportedEntryPoints: readonly string[] | null;
  readonly gasEstimate: Erc4337BundlerGasEstimate | null;
}): readonly Erc4337BundlerAdmissionExpectation[] {
  const entryPoint = normalizeAddress(input.preflight.entryPoint, 'preflight.entryPoint');
  const erc7562Failed = input.preflight.observations.some(
    (entry) => entry.check === 'erc4337-erc7562-scope-passed' && entry.status === 'fail',
  );
  return Object.freeze([
    expectation({
      kind: 'chain-id',
      status: input.bundlerChainIdHex === null
        ? 'missing'
        : input.bundlerChainIdHex === input.chainIdHex
          ? 'satisfied'
          : 'unsupported',
      reasonCode: input.bundlerChainIdHex === null
        ? 'bundler-chain-id-missing'
        : input.bundlerChainIdHex === input.chainIdHex
          ? 'bundler-chain-id-supported'
          : 'bundler-chain-id-mismatch',
      evidence: {
        expectedChainId: input.chainIdHex,
        observedChainId: input.bundlerChainIdHex,
      },
    }),
    expectation({
      kind: 'entrypoint-support',
      status: input.supportedEntryPoints === null
        ? 'missing'
        : input.supportedEntryPoints.includes(entryPoint)
          ? 'satisfied'
          : 'unsupported',
      reasonCode: input.supportedEntryPoints === null
        ? 'supported-entrypoints-missing'
        : input.supportedEntryPoints.includes(entryPoint)
          ? 'entrypoint-supported'
          : 'entrypoint-unsupported',
      evidence: {
        entryPoint,
        supportedEntryPoints: input.supportedEntryPoints ?? [],
      },
    }),
    expectation({
      kind: 'simulation',
      status: input.preflight.outcome === 'block'
        ? 'failed'
        : input.preflight.outcome === 'allow'
          ? 'satisfied'
          : 'missing',
      reasonCode: input.preflight.outcome === 'allow'
        ? 'simulate-validation-ready'
        : input.preflight.outcome === 'block'
          ? 'simulate-validation-failed'
          : 'simulate-validation-review-required',
      evidence: {
        preflightOutcome: input.preflight.outcome,
        preflightDigest: input.preflight.digest,
      },
    }),
    expectation({
      kind: 'erc7562-validation-scope',
      status: erc7562Failed
        ? 'failed'
        : input.preflight.outcome === 'allow'
          ? 'satisfied'
          : 'missing',
      reasonCode: erc7562Failed
        ? 'erc7562-validation-scope-failed'
        : input.preflight.outcome === 'allow'
          ? 'erc7562-validation-scope-ready'
          : 'erc7562-validation-scope-review-required',
      evidence: {
        observations: input.preflight.observations
          .filter((entry) => entry.check === 'erc4337-erc7562-scope-passed')
          .map((entry) => entry.code),
      },
    }),
    expectation({
      kind: 'gas-estimate',
      status: input.gasEstimate === null
        ? 'missing'
        : gasEstimateFits(input.gasEstimate.callGasLimit, input.userOperation.callGasLimit) &&
            gasEstimateFits(
              input.gasEstimate.verificationGasLimit,
              input.userOperation.verificationGasLimit,
            ) &&
            gasEstimateFits(input.gasEstimate.preVerificationGas, input.userOperation.preVerificationGas) &&
            gasEstimateFits(
              input.gasEstimate.paymasterVerificationGasLimit,
              input.userOperation.paymasterVerificationGasLimit,
            ) &&
            gasEstimateFits(
              input.gasEstimate.paymasterPostOpGasLimit,
              input.userOperation.paymasterPostOpGasLimit,
            )
          ? 'satisfied'
          : 'failed',
      reasonCode: input.gasEstimate === null
        ? 'useroperation-gas-estimate-missing'
        : gasEstimateFits(input.gasEstimate.callGasLimit, input.userOperation.callGasLimit) &&
            gasEstimateFits(
              input.gasEstimate.verificationGasLimit,
              input.userOperation.verificationGasLimit,
            ) &&
            gasEstimateFits(input.gasEstimate.preVerificationGas, input.userOperation.preVerificationGas) &&
            gasEstimateFits(
              input.gasEstimate.paymasterVerificationGasLimit,
              input.userOperation.paymasterVerificationGasLimit,
            ) &&
            gasEstimateFits(
              input.gasEstimate.paymasterPostOpGasLimit,
              input.userOperation.paymasterPostOpGasLimit,
            )
          ? 'useroperation-gas-estimate-fits'
          : 'useroperation-gas-estimate-exceeds-limits',
      evidence: {
        estimate: input.gasEstimate as unknown as CanonicalReleaseJsonValue,
        requested: {
          callGasLimit: normalizeQuantity(input.userOperation.callGasLimit, 'userOperation.callGasLimit'),
          verificationGasLimit: normalizeQuantity(
            input.userOperation.verificationGasLimit,
            'userOperation.verificationGasLimit',
          ),
          preVerificationGas: normalizeQuantity(
            input.userOperation.preVerificationGas,
            'userOperation.preVerificationGas',
          ),
          paymasterVerificationGasLimit: normalizeOptionalQuantity(
            input.userOperation.paymasterVerificationGasLimit,
            'userOperation.paymasterVerificationGasLimit',
          ),
          paymasterPostOpGasLimit: normalizeOptionalQuantity(
            input.userOperation.paymasterPostOpGasLimit,
            'userOperation.paymasterPostOpGasLimit',
          ),
        },
      },
    }),
    expectation({
      kind: 'paymaster-posture',
      status: input.preflight.paymaster === null
        ? 'satisfied'
        : input.preflight.observations.some(
            (entry) => entry.check === 'erc4337-paymaster-readiness' && entry.status === 'fail',
          )
          ? 'failed'
          : input.preflight.outcome === 'allow'
            ? 'satisfied'
            : 'missing',
      reasonCode: input.preflight.paymaster === null
        ? 'paymaster-not-used'
        : input.preflight.observations.some(
            (entry) => entry.check === 'erc4337-paymaster-readiness' && entry.status === 'fail',
          )
          ? 'paymaster-posture-failed'
          : input.preflight.outcome === 'allow'
            ? 'paymaster-posture-ready'
            : 'paymaster-posture-review-required',
      evidence: {
        paymaster: input.preflight.paymaster,
      },
    }),
  ]);
}

function blockingReasonsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Erc4337UserOperationPreflight;
  readonly userOperation: Erc4337UserOperation;
  readonly chainIdHex: string;
  readonly expectations: readonly Erc4337BundlerAdmissionExpectation[];
}): readonly string[] {
  const reasons: string[] = [];
  const preflightSender = normalizeAddress(input.preflight.sender, 'preflight.sender');
  const preflightEntryPoint = normalizeAddress(input.preflight.entryPoint, 'preflight.entryPoint');
  const preflightUserOpHash = normalizeHash(input.preflight.userOpHash, 'preflight.userOpHash');
  if (input.plan.surface !== 'account-abstraction-bundler') {
    reasons.push('admission-plan-surface-not-account-abstraction-bundler');
  }
  if (input.plan.adapterKind !== 'erc-4337-user-operation') {
    reasons.push('admission-plan-adapter-not-erc4337-user-operation');
  }
  if (input.preflight.adapterKind !== 'erc-4337-user-operation') {
    reasons.push('preflight-adapter-not-erc4337-user-operation');
  }
  if (input.plan.outcome === 'deny') {
    reasons.push('admission-plan-denied');
  }
  if (input.preflight.outcome === 'block') {
    reasons.push('erc4337-useroperation-preflight-blocked');
  }
  if (input.plan.chainId !== input.preflight.chainId || input.userOperation.chainId !== input.plan.chainId) {
    reasons.push('erc4337-chain-mismatch');
  }
  if (
    input.plan.accountAddress.toLowerCase() !== preflightSender ||
    input.userOperation.sender.toLowerCase() !== preflightSender
  ) {
    reasons.push('erc4337-sender-mismatch');
  }
  if (input.userOperation.entryPoint.toLowerCase() !== preflightEntryPoint) {
    reasons.push('erc4337-entrypoint-mismatch');
  }
  if (input.userOperation.userOpHash.toLowerCase() !== preflightUserOpHash) {
    reasons.push('erc4337-userop-hash-mismatch');
  }
  input.expectations
    .filter((entry) => entry.status === 'unsupported' || entry.status === 'failed')
    .forEach((entry) => reasons.push(entry.reasonCode));
  return Object.freeze(reasons);
}

function outcomeFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Erc4337UserOperationPreflight;
  readonly expectations: readonly Erc4337BundlerAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
}): Erc4337BundlerAdmissionOutcome {
  if (input.blockingReasons.length > 0) return 'blocked';
  if (input.plan.outcome !== 'admit' || input.preflight.outcome !== 'allow') {
    return 'needs-bundler-evidence';
  }
  if (input.expectations.some((entry) => entry.status === 'missing')) {
    return 'needs-bundler-evidence';
  }
  return 'ready';
}

function nextActionsFor(outcome: Erc4337BundlerAdmissionOutcome): readonly string[] {
  switch (outcome) {
    case 'ready':
      return Object.freeze([
        'Submit eth_sendUserOperation to the admitted bundler endpoint.',
        'Poll eth_getUserOperationReceipt and record the Attestor admission result.',
      ]);
    case 'needs-bundler-evidence':
      return Object.freeze([
        'Call eth_chainId and eth_supportedEntryPoints before submission.',
        'Call eth_estimateUserOperationGas and refresh the handoff with returned gas evidence.',
      ]);
    case 'blocked':
      return Object.freeze([
        'Do not call eth_sendUserOperation for this handoff.',
        'Resolve the blocked EntryPoint, simulation, ERC-7562, gas, or paymaster reason and create a new handoff.',
      ]);
  }
}

function handoffIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Erc4337UserOperationPreflight;
  readonly createdAt: string;
}): string {
  return canonicalObject({
    version: ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightDigest: input.preflight.digest,
    userOpHash: input.preflight.userOpHash,
    createdAt: input.createdAt,
  }).digest;
}

export function createErc4337BundlerAdmissionHandoff(
  input: CreateErc4337BundlerAdmissionHandoffInput,
): Erc4337BundlerAdmissionHandoff {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const chainIdHex = chainIdHexFromCaip2(input.plan.chainId);
  const bundlerChainIdHex = input.bundlerChainIdHex
    ? normalizeQuantity(input.bundlerChainIdHex, 'bundlerChainIdHex')
    : null;
  const supportedEntryPoints = normalizeSupportedEntryPoints(input.supportedEntryPoints);
  const gasEstimate = normalizeGasEstimate(input.gasEstimate);
  const eip7702Auth = input.eip7702Auth ? Object.freeze({ ...input.eip7702Auth }) : null;
  const rpcOperation = rpcUserOperation(input.userOperation, eip7702Auth);
  const expectations = expectationsFor({
    preflight: input.preflight,
    userOperation: input.userOperation,
    chainIdHex,
    bundlerChainIdHex,
    supportedEntryPoints,
    gasEstimate,
  });
  const blockingReasons = blockingReasonsFor({
    plan: input.plan,
    preflight: input.preflight,
    userOperation: input.userOperation,
    chainIdHex,
    expectations,
  });
  const outcome = outcomeFor({
    plan: input.plan,
    preflight: input.preflight,
    expectations,
    blockingReasons,
  });
  const handoffId =
    normalizeOptionalIdentifier(input.handoffId, 'handoffId') ??
    handoffIdFor({
      plan: input.plan,
      preflight: input.preflight,
      createdAt,
    });
  const entryPoint = normalizeAddress(input.preflight.entryPoint, 'preflight.entryPoint');
  const userOpHash = normalizeHash(input.preflight.userOpHash, 'preflight.userOpHash');
  const attestorSidecar = Object.freeze({
    version: ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION,
    handoffId,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    userOpHash,
    outcome,
  });
  const canonicalPayload = {
    version: ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION,
    handoffId,
    createdAt,
    outcome,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    userOpHash,
    sender: normalizeAddress(input.preflight.sender, 'preflight.sender'),
    chainId: input.plan.chainId,
    chainIdHex,
    entryPoint,
    entryPointVersion: input.preflight.entryPointVersion,
    paymaster: input.preflight.paymaster,
    factory: input.preflight.factory,
    bundlerId: normalizeOptionalIdentifier(input.bundlerId, 'bundlerId'),
    bundlerUrl: normalizeOptionalIdentifier(input.bundlerUrl, 'bundlerUrl'),
    methods: ERC4337_BUNDLER_ADMISSION_METHODS,
    chainIdRequest: Object.freeze({
      method: 'eth_chainId' as const,
      params: Object.freeze([] as const),
    }),
    supportedEntryPointsRequest: Object.freeze({
      method: 'eth_supportedEntryPoints' as const,
      params: Object.freeze([] as const),
    }),
    estimateGasRequest: Object.freeze({
      method: 'eth_estimateUserOperationGas' as const,
      params: Object.freeze([rpcOperation, entryPoint] as const),
    }),
    sendUserOperationRequest: Object.freeze({
      method: 'eth_sendUserOperation' as const,
      params: Object.freeze([rpcOperation, entryPoint] as const),
    }),
    getUserOperationByHashRequest: Object.freeze({
      method: 'eth_getUserOperationByHash' as const,
      params: Object.freeze([userOpHash] as const),
    }),
    getUserOperationReceiptRequest: Object.freeze({
      method: 'eth_getUserOperationReceipt' as const,
      params: Object.freeze([userOpHash] as const),
    }),
    attestorSidecar,
    expectations,
    blockingReasons,
    nextActions: nextActionsFor(outcome),
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);
  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function erc4337BundlerAdmissionHandoffLabel(
  handoff: Erc4337BundlerAdmissionHandoff,
): string {
  return [
    `erc4337-bundler-admission:${handoff.userOpHash}`,
    `outcome:${handoff.outcome}`,
    `entrypoint:${handoff.entryPointVersion}`,
    `chain:${handoff.chainIdHex}`,
  ].join(' / ');
}

export function erc4337BundlerAdmissionDescriptor(): Erc4337BundlerAdmissionDescriptor {
  return Object.freeze({
    version: ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION,
    methods: ERC4337_BUNDLER_ADMISSION_METHODS,
    outcomes: ERC4337_BUNDLER_ADMISSION_OUTCOMES,
    expectationKinds: ERC4337_BUNDLER_EXPECTATION_KINDS,
    standards: Object.freeze([
      'ERC-4337',
      'ERC-7769',
      'ERC-7562',
      'EntryPoint',
      'UserOperation',
      'eth_sendUserOperation',
      'eth_estimateUserOperationGas',
      'eth_supportedEntryPoints',
      'EIP-7702-aware',
      'Attestor admission receipt',
    ]),
  });
}
