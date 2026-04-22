import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  CryptoExecutionAdmissionOutcome,
  CryptoExecutionAdmissionPlan,
} from './index.js';

/**
 * Wallet RPC admission turns a ready Attestor execution-admission plan into the
 * JSON-RPC handoff objects an app can use before asking a wallet to batch calls,
 * grant execution permissions, or negotiate account-abstraction capabilities.
 */

export const WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION =
  'attestor.crypto-wallet-rpc-admission-handoff.v1';

export const WALLET_RPC_ADMISSION_METHODS = [
  'wallet_getCapabilities',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'wallet_showCallsStatus',
  'wallet_requestExecutionPermissions',
  'wallet_revokeExecutionPermission',
  'wallet_getSupportedExecutionPermissions',
  'wallet_getGrantedExecutionPermissions',
] as const;
export type WalletRpcAdmissionMethod =
  typeof WALLET_RPC_ADMISSION_METHODS[number];

export const WALLET_RPC_ADMISSION_HANDOFF_OUTCOMES = [
  'ready',
  'needs-wallet-evidence',
  'blocked',
] as const;
export type WalletRpcAdmissionHandoffOutcome =
  typeof WALLET_RPC_ADMISSION_HANDOFF_OUTCOMES[number];

export const WALLET_RPC_ADMISSION_ERC7902_CAPABILITIES = [
  'eip7702Auth',
  'staticPaymasterConfiguration',
  'validityTimeRange',
  'multiDimensionalNonce',
  'accountAbstractionGasParamsOverride',
] as const;
export type WalletRpcAdmissionErc7902Capability =
  typeof WALLET_RPC_ADMISSION_ERC7902_CAPABILITIES[number];

export type WalletRpcCapability = Readonly<Record<string, CanonicalReleaseJsonValue>>;
export type WalletRpcCapabilitiesByChain = Readonly<
  Record<string, Readonly<Record<string, CanonicalReleaseJsonValue>>>
>;

export const WALLET_RPC_CAPABILITY_SUPPORT_STATUSES = [
  'supported',
  'ready',
  'unsupported',
  'missing',
  'unknown',
] as const;
export type WalletRpcCapabilitySupportStatus =
  typeof WALLET_RPC_CAPABILITY_SUPPORT_STATUSES[number];

export interface WalletRpcAdmissionCallInput {
  readonly to?: string | null;
  readonly data?: string | null;
  readonly value?: string | null;
  readonly capabilities?: Readonly<Record<string, WalletRpcCapability>> | null;
}

export interface WalletRpcAdmissionCall {
  readonly to?: string;
  readonly data?: string;
  readonly value?: string;
  readonly capabilities?: Readonly<Record<string, WalletRpcCapability>>;
}

export interface WalletRpcExecutionPermission {
  readonly type: string;
  readonly isAdjustmentAllowed: boolean;
  readonly data: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface WalletRpcExecutionRule {
  readonly type: string;
  readonly data: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface WalletRpcExecutionPermissionRequestInput {
  readonly chainIdHex?: string | null;
  readonly from?: string | null;
  readonly to: string;
  readonly permission: WalletRpcExecutionPermission;
  readonly rules?: readonly WalletRpcExecutionRule[] | null;
}

export interface WalletRpcExecutionPermissionRequest {
  readonly chainId: string;
  readonly from?: string;
  readonly to: string;
  readonly permission: WalletRpcExecutionPermission;
  readonly rules?: readonly WalletRpcExecutionRule[];
}

export type WalletRpcSupportedExecutionPermissions = Readonly<
  Record<
    string,
    {
      readonly chainIds: readonly string[];
      readonly ruleTypes: readonly string[];
    }
  >
>;

export interface WalletRpcSendCallsParams {
  readonly version: '2.0.0';
  readonly id: string;
  readonly from: string;
  readonly chainId: string;
  readonly atomicRequired: boolean;
  readonly calls: readonly WalletRpcAdmissionCall[];
  readonly capabilities?: Readonly<Record<string, WalletRpcCapability>>;
}

export interface WalletRpcJsonRpcRequest<TParams> {
  readonly method: WalletRpcAdmissionMethod;
  readonly params: TParams;
}

export interface WalletRpcCapabilityExpectation {
  readonly capability: string;
  readonly standard: 'EIP-5792' | 'ERC-7902' | 'Attestor';
  readonly required: boolean;
  readonly observedStatus: WalletRpcCapabilitySupportStatus;
  readonly reasonCode: string;
}

export interface WalletRpcPermissionExpectation {
  readonly permissionType: string;
  readonly chainId: string;
  readonly ruleTypes: readonly string[];
  readonly observedStatus: WalletRpcCapabilitySupportStatus;
  readonly reasonCode: string;
}

export interface CreateWalletRpcAdmissionHandoffInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly createdAt: string;
  readonly handoffId?: string | null;
  readonly requestId?: string | null;
  readonly dappDomain?: string | null;
  readonly from?: string | null;
  readonly chainIdHex?: string | null;
  readonly calls?: readonly WalletRpcAdmissionCallInput[] | null;
  readonly atomicRequired?: boolean;
  readonly capabilities?: Readonly<Record<string, WalletRpcCapability>> | null;
  readonly walletCapabilities?: WalletRpcCapabilitiesByChain | null;
  readonly requestedPermissions?:
    | readonly WalletRpcExecutionPermissionRequestInput[]
    | null;
  readonly supportedExecutionPermissions?: WalletRpcSupportedExecutionPermissions | null;
}

export interface WalletRpcAdmissionHandoff {
  readonly version: typeof WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly handoffId: string;
  readonly createdAt: string;
  readonly outcome: WalletRpcAdmissionHandoffOutcome;
  readonly planOutcome: CryptoExecutionAdmissionOutcome;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly chainId: string;
  readonly chainIdHex: string;
  readonly from: string;
  readonly dappDomain: string | null;
  readonly methods: readonly WalletRpcAdmissionMethod[];
  readonly capabilityDiscoveryRequest: WalletRpcJsonRpcRequest<
    readonly [string, readonly string[]]
  >;
  readonly sendCallsRequest: WalletRpcJsonRpcRequest<
    readonly [WalletRpcSendCallsParams]
  > | null;
  readonly permissionRequest: WalletRpcJsonRpcRequest<
    readonly [readonly WalletRpcExecutionPermissionRequest[]]
  > | null;
  readonly supportedExecutionPermissionsRequest: WalletRpcJsonRpcRequest<
    readonly []
  > | null;
  readonly attestorSidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  readonly capabilityExpectations: readonly WalletRpcCapabilityExpectation[];
  readonly permissionExpectations: readonly WalletRpcPermissionExpectation[];
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly canonical: string;
  readonly digest: string;
}

export interface WalletRpcAdmissionDescriptor {
  readonly version: typeof WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly methods: typeof WALLET_RPC_ADMISSION_METHODS;
  readonly outcomes: typeof WALLET_RPC_ADMISSION_HANDOFF_OUTCOMES;
  readonly erc7902Capabilities: typeof WALLET_RPC_ADMISSION_ERC7902_CAPABILITIES;
  readonly standards: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`Wallet RPC admission ${fieldName} requires a non-empty value.`);
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
    throw new Error(`Wallet RPC admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeHex(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(normalized)) {
    throw new Error(
      `Wallet RPC admission ${fieldName} must be a 0x-prefixed hex integer without leading zeroes.`,
    );
  }
  return normalized;
}

function normalizeHexBytes(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]*$/u.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`Wallet RPC admission ${fieldName} must be 0x-prefixed hex bytes.`);
  }
  return normalized;
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error(`Wallet RPC admission ${fieldName} must be an EVM address.`);
  }
  return normalized;
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

function chainIdHexFromPlan(
  plan: CryptoExecutionAdmissionPlan,
  override: string | null | undefined,
): string {
  if (override !== undefined && override !== null) {
    return normalizeHex(override, 'chainIdHex');
  }
  const [namespace, chainId] = plan.chainId.split(':');
  if (namespace !== 'eip155' || !chainId) {
    throw new Error(
      'Wallet RPC admission requires an EIP-155 CAIP-2 chain id such as eip155:8453.',
    );
  }
  return `0x${BigInt(chainId).toString(16)}`;
}

function requestIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly chainIdHex: string;
  readonly createdAt: string;
  readonly dappDomain: string | null;
}): string {
  const digest = canonicalObject({
    version: WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    chainIdHex: input.chainIdHex,
    createdAt: input.createdAt,
    dappDomain: input.dappDomain,
  }).digest.slice('sha256:'.length);
  return `0x${digest}`;
}

function handoffIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly requestId: string;
  readonly createdAt: string;
}): string {
  return canonicalObject({
    version: WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION,
    planId: input.plan.planId,
    requestId: input.requestId,
    createdAt: input.createdAt,
  }).digest;
}

function normalizeCapabilities(
  capabilities: Readonly<Record<string, WalletRpcCapability>> | null | undefined,
): Readonly<Record<string, WalletRpcCapability>> {
  return Object.freeze({ ...(capabilities ?? {}) });
}

function withAttestorSidecarCapability(
  capabilities: Readonly<Record<string, WalletRpcCapability>>,
  sidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>,
): Readonly<Record<string, WalletRpcCapability>> {
  return Object.freeze({
    ...capabilities,
    attestorAdmission: Object.freeze({
      optional: true,
      ...sidecar,
    }),
  });
}

function normalizeCall(input: WalletRpcAdmissionCallInput): WalletRpcAdmissionCall {
  const call: {
    to?: string;
    data?: string;
    value?: string;
    capabilities?: Readonly<Record<string, WalletRpcCapability>>;
  } = {};
  if (input.to !== undefined && input.to !== null) {
    call.to = normalizeAddress(input.to, 'call.to');
  }
  if (input.data !== undefined && input.data !== null) {
    call.data = normalizeHexBytes(input.data, 'call.data');
  }
  if (input.value !== undefined && input.value !== null) {
    call.value = normalizeHex(input.value, 'call.value');
  }
  if (!call.to && !call.data && !call.value) {
    throw new Error(
      'Wallet RPC admission call must include at least one of to, data, or value.',
    );
  }
  if (input.capabilities !== undefined && input.capabilities !== null) {
    call.capabilities = normalizeCapabilities(input.capabilities);
  }
  return Object.freeze(call);
}

function normalizeRules(
  rules: readonly WalletRpcExecutionRule[] | null | undefined,
): readonly WalletRpcExecutionRule[] | undefined {
  if (!rules || rules.length === 0) return undefined;
  return Object.freeze(
    rules.map((rule) =>
      Object.freeze({
        type: normalizeIdentifier(rule.type, 'permission.rule.type'),
        data: Object.freeze({ ...rule.data }),
      }),
    ),
  );
}

function normalizePermissionRequest(
  input: WalletRpcExecutionPermissionRequestInput,
  defaultChainIdHex: string,
  defaultFrom: string,
): WalletRpcExecutionPermissionRequest {
  const chainId = input.chainIdHex
    ? normalizeHex(input.chainIdHex, 'permission.chainIdHex')
    : defaultChainIdHex;
  const rules = normalizeRules(input.rules);
  const request: {
    chainId: string;
    from?: string;
    to: string;
    permission: WalletRpcExecutionPermission;
    rules?: readonly WalletRpcExecutionRule[];
  } = {
    chainId,
    from: normalizeAddress(input.from ?? defaultFrom, 'permission.from'),
    to: normalizeAddress(input.to, 'permission.to'),
    permission: Object.freeze({
      type: normalizeIdentifier(input.permission.type, 'permission.type'),
      isAdjustmentAllowed: input.permission.isAdjustmentAllowed,
      data: Object.freeze({ ...input.permission.data }),
    }),
  };
  if (rules) request.rules = rules;
  return Object.freeze(request);
}

function valueObject(
  value: CanonicalReleaseJsonValue | undefined,
): Readonly<Record<string, CanonicalReleaseJsonValue>> | null {
  if (value === null || value === undefined || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

function observedCapability(
  walletCapabilities: WalletRpcCapabilitiesByChain | null | undefined,
  chainIdHex: string,
  capability: string,
): CanonicalReleaseJsonValue | undefined {
  const chainCapabilities = walletCapabilityBucket(walletCapabilities, chainIdHex)?.[
    capability
  ];
  if (chainCapabilities !== undefined) return chainCapabilities;
  return walletCapabilityBucket(walletCapabilities, '0x0')?.[capability];
}

function walletCapabilityBucket(
  walletCapabilities: WalletRpcCapabilitiesByChain | null | undefined,
  chainIdHex: string,
): Readonly<Record<string, CanonicalReleaseJsonValue>> | undefined {
  if (!walletCapabilities) return undefined;
  const direct = walletCapabilities[chainIdHex];
  if (direct !== undefined) return direct;
  const lower = chainIdHex.toLowerCase();
  return Object.entries(walletCapabilities).find(
    ([candidate]) => candidate.toLowerCase() === lower,
  )?.[1];
}

function supportStatusFromCapability(
  capability: string,
  value: CanonicalReleaseJsonValue | undefined,
): WalletRpcCapabilitySupportStatus {
  if (value === undefined) return 'missing';
  const object = valueObject(value);
  if (!object) return 'unknown';
  if (capability === 'atomic') {
    const status = object.status;
    if (status === 'supported' || status === 'ready' || status === 'unsupported') {
      return status;
    }
  }
  const supported = object.supported;
  if (supported === true) return 'supported';
  if (supported === false) return 'unsupported';
  return 'unknown';
}

function standardForCapability(
  capability: string,
): WalletRpcCapabilityExpectation['standard'] {
  if (capability === 'attestorAdmission') return 'Attestor';
  if (
    WALLET_RPC_ADMISSION_ERC7902_CAPABILITIES.includes(
      capability as WalletRpcAdmissionErc7902Capability,
    )
  ) {
    return 'ERC-7902';
  }
  return 'EIP-5792';
}

function expectationReasonCode(input: {
  readonly capability: string;
  readonly required: boolean;
  readonly observedStatus: WalletRpcCapabilitySupportStatus;
}): string {
  if (!input.required) return `${input.capability}-optional`;
  if (input.observedStatus === 'supported' || input.observedStatus === 'ready') {
    return `${input.capability}-supported`;
  }
  return `${input.capability}-${input.observedStatus}`;
}

function capabilityExpectations(input: {
  readonly atomicRequired: boolean;
  readonly capabilities: Readonly<Record<string, WalletRpcCapability>>;
  readonly walletCapabilities: WalletRpcCapabilitiesByChain | null | undefined;
  readonly chainIdHex: string;
}): readonly WalletRpcCapabilityExpectation[] {
  const requiredCapabilities = new Set<string>();
  const optionalCapabilities = new Set<string>();
  if (input.atomicRequired) requiredCapabilities.add('atomic');
  Object.entries(input.capabilities).forEach(([name, capability]) => {
    if (name === 'attestorAdmission') {
      optionalCapabilities.add(name);
      return;
    }
    if (capability.optional === true) {
      optionalCapabilities.add(name);
    } else {
      requiredCapabilities.add(name);
    }
  });
  const names = [...requiredCapabilities, ...optionalCapabilities].filter(
    (name, index, array) => array.indexOf(name) === index,
  );
  return Object.freeze(
    names.map((capability) => {
      const required = requiredCapabilities.has(capability);
      const observedStatus = supportStatusFromCapability(
        capability,
        observedCapability(input.walletCapabilities, input.chainIdHex, capability),
      );
      return Object.freeze({
        capability,
        standard: standardForCapability(capability),
        required,
        observedStatus,
        reasonCode: expectationReasonCode({
          capability,
          required,
          observedStatus,
        }),
      });
    }),
  );
}

function permissionExpectationStatus(input: {
  readonly request: WalletRpcExecutionPermissionRequest;
  readonly supportedExecutionPermissions: WalletRpcSupportedExecutionPermissions | null | undefined;
}): WalletRpcCapabilitySupportStatus {
  if (!input.supportedExecutionPermissions) return 'missing';
  const support = input.supportedExecutionPermissions[input.request.permission.type];
  if (!support) return 'unsupported';
  if (!support.chainIds.includes(input.request.chainId)) return 'unsupported';
  const requestedRuleTypes = input.request.rules?.map((rule) => rule.type) ?? [];
  if (requestedRuleTypes.some((ruleType) => !support.ruleTypes.includes(ruleType))) {
    return 'unsupported';
  }
  return 'supported';
}

function permissionExpectations(input: {
  readonly requests: readonly WalletRpcExecutionPermissionRequest[];
  readonly supportedExecutionPermissions: WalletRpcSupportedExecutionPermissions | null | undefined;
}): readonly WalletRpcPermissionExpectation[] {
  return Object.freeze(
    input.requests.map((request) => {
      const observedStatus = permissionExpectationStatus({
        request,
        supportedExecutionPermissions: input.supportedExecutionPermissions,
      });
      const ruleTypes = Object.freeze(request.rules?.map((rule) => rule.type) ?? []);
      return Object.freeze({
        permissionType: request.permission.type,
        chainId: request.chainId,
        ruleTypes,
        observedStatus,
        reasonCode:
          observedStatus === 'supported'
            ? `${request.permission.type}-supported`
            : `${request.permission.type}-${observedStatus}`,
      });
    }),
  );
}

function blockingReasons(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly hasWalletCapabilities: boolean;
  readonly hasSupportedExecutionPermissions: boolean;
  readonly capabilityExpectations: readonly WalletRpcCapabilityExpectation[];
  readonly permissionExpectations: readonly WalletRpcPermissionExpectation[];
}): readonly string[] {
  const reasons: string[] = [];
  if (input.plan.surface !== 'wallet-rpc') {
    reasons.push('admission-plan-surface-not-wallet-rpc');
  }
  if (input.plan.outcome === 'deny') {
    reasons.push('admission-plan-denied');
  }
  if (input.hasWalletCapabilities) {
    input.capabilityExpectations
      .filter(
        (expectation) =>
          expectation.required &&
          expectation.observedStatus !== 'supported' &&
          expectation.observedStatus !== 'ready',
      )
      .forEach((expectation) => {
        reasons.push(`required-capability-${expectation.reasonCode}`);
      });
  }
  if (input.hasSupportedExecutionPermissions) {
    input.permissionExpectations
      .filter((expectation) => expectation.observedStatus !== 'supported')
      .forEach((expectation) => {
        reasons.push(`required-permission-${expectation.reasonCode}`);
      });
  }
  return Object.freeze(reasons);
}

function outcomeFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly blockingReasons: readonly string[];
  readonly hasWalletCapabilities: boolean;
  readonly hasSupportedExecutionPermissions: boolean;
  readonly capabilityExpectations: readonly WalletRpcCapabilityExpectation[];
  readonly permissionExpectations: readonly WalletRpcPermissionExpectation[];
}): WalletRpcAdmissionHandoffOutcome {
  if (input.blockingReasons.length > 0) return 'blocked';
  if (input.plan.outcome !== 'admit') return 'needs-wallet-evidence';
  const needsCapabilities =
    !input.hasWalletCapabilities &&
    input.capabilityExpectations.some((expectation) => expectation.required);
  const needsPermissions =
    !input.hasSupportedExecutionPermissions &&
    input.permissionExpectations.length > 0;
  if (needsCapabilities || needsPermissions) return 'needs-wallet-evidence';
  return 'ready';
}

function nextActionsFor(input: {
  readonly outcome: WalletRpcAdmissionHandoffOutcome;
  readonly sendCallsRequest: WalletRpcJsonRpcRequest<
    readonly [WalletRpcSendCallsParams]
  > | null;
  readonly permissionRequest: WalletRpcJsonRpcRequest<
    readonly [readonly WalletRpcExecutionPermissionRequest[]]
  > | null;
  readonly capabilityExpectations: readonly WalletRpcCapabilityExpectation[];
  readonly permissionExpectations: readonly WalletRpcPermissionExpectation[];
}): readonly string[] {
  if (input.outcome === 'blocked') {
    return Object.freeze([
      'Do not call wallet_sendCalls or wallet_requestExecutionPermissions for this plan.',
      'Resolve the blocked admission, capability, or permission reason and create a new handoff.',
    ]);
  }
  if (input.outcome === 'needs-wallet-evidence') {
    const actions = ['Call wallet_getCapabilities for the account and chain before submission.'];
    if (input.permissionExpectations.length > 0) {
      actions.push('Call wallet_getSupportedExecutionPermissions before requesting permissions.');
    }
    input.capabilityExpectations
      .filter(
        (expectation) =>
          expectation.required &&
          expectation.observedStatus !== 'supported' &&
          expectation.observedStatus !== 'ready',
      )
      .forEach((expectation) => actions.push(expectation.reasonCode));
    input.permissionExpectations
      .filter((expectation) => expectation.observedStatus !== 'supported')
      .forEach((expectation) => actions.push(expectation.reasonCode));
    return Object.freeze(actions);
  }
  const actions: string[] = [];
  if (input.permissionRequest) {
    actions.push('Request wallet execution permissions before redeeming delegated execution.');
  }
  if (input.sendCallsRequest) {
    actions.push('Submit the prepared wallet_sendCalls request and track wallet_getCallsStatus.');
  }
  actions.push('Record an Attestor admission receipt after the wallet result is observed.');
  return Object.freeze(actions);
}

export function createWalletRpcAdmissionHandoff(
  input: CreateWalletRpcAdmissionHandoffInput,
): WalletRpcAdmissionHandoff {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const chainIdHex = chainIdHexFromPlan(input.plan, input.chainIdHex);
  const from = normalizeAddress(input.from ?? input.plan.accountAddress, 'from');
  const dappDomain = normalizeOptionalIdentifier(input.dappDomain, 'dappDomain');
  const requestId =
    normalizeOptionalIdentifier(input.requestId, 'requestId') ??
    requestIdFor({
      plan: input.plan,
      chainIdHex,
      createdAt,
      dappDomain,
    });
  const calls = Object.freeze((input.calls ?? []).map((call) => normalizeCall(call)));
  const requestedPermissions = Object.freeze(
    (input.requestedPermissions ?? []).map((request) =>
      normalizePermissionRequest(request, chainIdHex, from),
    ),
  );
  if (calls.length === 0 && requestedPermissions.length === 0) {
    throw new Error(
      'Wallet RPC admission requires at least one prepared call or permission request.',
    );
  }

  const sidecar = Object.freeze({
    version: WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    outcome: input.plan.outcome,
  });
  const capabilities = withAttestorSidecarCapability(
    normalizeCapabilities(input.capabilities),
    sidecar,
  );
  const atomicRequired = input.atomicRequired ?? calls.length > 1;
  const sendCallsRequest = calls.length > 0
    ? Object.freeze({
        method: 'wallet_sendCalls' as const,
        params: Object.freeze([
          Object.freeze({
            version: '2.0.0' as const,
            id: requestId,
            from,
            chainId: chainIdHex,
            atomicRequired,
            calls,
            capabilities,
          }),
        ] as const),
      })
    : null;
  const permissionRequest = requestedPermissions.length > 0
    ? Object.freeze({
        method: 'wallet_requestExecutionPermissions' as const,
        params: Object.freeze([requestedPermissions] as const),
      })
    : null;
  const supportedExecutionPermissionsRequest = requestedPermissions.length > 0
    ? Object.freeze({
        method: 'wallet_getSupportedExecutionPermissions' as const,
        params: Object.freeze([] as const),
      })
    : null;
  const capabilityDiscoveryRequest = Object.freeze({
    method: 'wallet_getCapabilities' as const,
    params: Object.freeze([from, Object.freeze([chainIdHex])] as const),
  });
  const capabilityExpectationList = capabilityExpectations({
    atomicRequired,
    capabilities,
    walletCapabilities: input.walletCapabilities,
    chainIdHex,
  });
  const permissionExpectationList = permissionExpectations({
    requests: requestedPermissions,
    supportedExecutionPermissions: input.supportedExecutionPermissions,
  });
  const blocks = blockingReasons({
    plan: input.plan,
    hasWalletCapabilities: input.walletCapabilities !== undefined && input.walletCapabilities !== null,
    hasSupportedExecutionPermissions:
      input.supportedExecutionPermissions !== undefined &&
      input.supportedExecutionPermissions !== null,
    capabilityExpectations: capabilityExpectationList,
    permissionExpectations: permissionExpectationList,
  });
  const outcome = outcomeFor({
    plan: input.plan,
    blockingReasons: blocks,
    hasWalletCapabilities: input.walletCapabilities !== undefined && input.walletCapabilities !== null,
    hasSupportedExecutionPermissions:
      input.supportedExecutionPermissions !== undefined &&
      input.supportedExecutionPermissions !== null,
    capabilityExpectations: capabilityExpectationList,
    permissionExpectations: permissionExpectationList,
  });
  const methods: WalletRpcAdmissionMethod[] = ['wallet_getCapabilities'];
  if (supportedExecutionPermissionsRequest) {
    methods.push('wallet_getSupportedExecutionPermissions');
  }
  if (permissionRequest) {
    methods.push('wallet_requestExecutionPermissions');
    methods.push('wallet_getGrantedExecutionPermissions');
  }
  if (sendCallsRequest) {
    methods.push('wallet_sendCalls');
    methods.push('wallet_getCallsStatus');
    methods.push('wallet_showCallsStatus');
  }
  const handoffId =
    normalizeOptionalIdentifier(input.handoffId, 'handoffId') ??
    handoffIdFor({
      plan: input.plan,
      requestId,
      createdAt,
    });
  const canonicalPayload = {
    version: WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION,
    handoffId,
    createdAt,
    outcome,
    planOutcome: input.plan.outcome,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    chainId: input.plan.chainId,
    chainIdHex,
    from,
    dappDomain,
    methods,
    capabilityDiscoveryRequest,
    sendCallsRequest,
    permissionRequest,
    supportedExecutionPermissionsRequest,
    attestorSidecar: sidecar,
    capabilityExpectations: capabilityExpectationList,
    permissionExpectations: permissionExpectationList,
    blockingReasons: blocks,
    nextActions: nextActionsFor({
      outcome,
      sendCallsRequest,
      permissionRequest,
      capabilityExpectations: capabilityExpectationList,
      permissionExpectations: permissionExpectationList,
    }),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);
  return Object.freeze({
    ...canonicalPayload,
    methods: Object.freeze(methods),
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function walletRpcAdmissionHandoffLabel(
  handoff: WalletRpcAdmissionHandoff,
): string {
  return [
    `wallet-rpc-admission:${handoff.planId}`,
    `outcome:${handoff.outcome}`,
    `chain:${handoff.chainIdHex}`,
    `methods:${handoff.methods.join(',')}`,
  ].join(' / ');
}

export function walletRpcAdmissionDescriptor(): WalletRpcAdmissionDescriptor {
  return Object.freeze({
    version: WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION,
    methods: WALLET_RPC_ADMISSION_METHODS,
    outcomes: WALLET_RPC_ADMISSION_HANDOFF_OUTCOMES,
    erc7902Capabilities: WALLET_RPC_ADMISSION_ERC7902_CAPABILITIES,
    standards: Object.freeze([
      'EIP-1193',
      'EIP-155',
      'EIP-5792',
      'ERC-7715',
      'ERC-7902',
      'EIP-7702',
      'ERC-4337',
      'Attestor admission receipt',
    ]),
  });
}
