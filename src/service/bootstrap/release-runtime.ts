import { generatePkiHierarchy } from '../../signing/pki-chain.js';
import {
  decisionLog,
  evidence,
  introspection,
  review,
  shadow,
  token,
  type ReleaseDecisionEngine,
  type ReleaseDecisionLogWriter,
  type ReleaseEvidencePackIssuer,
  type ReleaseEvidencePackStore,
  type ReleaseReviewerQueueStore,
  type ReleaseTokenIntrospectionStore,
  type ReleaseTokenIntrospector,
  type ReleaseTokenIssuer,
  type ReleaseTokenVerificationKey,
  type ShadowModeReleaseEvaluator,
} from '../../release-layer/index.js';
import {
  activationApprovals as controlPlaneActivationApprovals,
  auditLog as controlPlaneAuditLog,
  financeProving as controlPlaneFinanceProving,
  store as controlPlaneStore,
  type PolicyActivationApprovalStore,
  type PolicyControlPlaneStore,
  type PolicyMutationAuditLogWriter,
} from '../../release-policy-control-plane/index.js';
import {
  createFileBackedDegradedModeGrantStore,
  type DegradedModeGrantStore,
} from '../../release-enforcement-plane/degraded-mode.js';
import {
  CURRENT_RELEASE_RUNTIME_STORE_MODES,
  assertReleaseRuntimeDurability,
  resolveRuntimeProfile,
  type AttestorRuntimeProfile,
  type ReleaseRuntimeStoreModes,
  type RuntimeProfileDurabilityEvaluation,
} from './runtime-profile.js';

const {
  createFileBackedReleaseDecisionLogWriter,
  createInMemoryReleaseDecisionLogWriter,
} = decisionLog;
const {
  createFileBackedReleaseEvidencePackStore,
  createInMemoryReleaseEvidencePackStore,
  createReleaseEvidencePackIssuer,
} = evidence;
const {
  createFileBackedReleaseTokenIntrospectionStore,
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
} = introspection;
const {
  createFileBackedReleaseReviewerQueueStore,
  createInMemoryReleaseReviewerQueueStore,
} = review;
const { createShadowModeReleaseEvaluator } = shadow;
const { createReleaseTokenIssuer } = token;
const { createFileBackedPolicyActivationApprovalStore } = controlPlaneActivationApprovals;
const { createFileBackedPolicyMutationAuditLogWriter } = controlPlaneAuditLog;
const {
  createFinanceControlPlaneReleaseDecisionEngine,
  ensureFinanceProvingPolicies,
  FINANCE_PROVING_POLICY_ENVIRONMENT,
} = controlPlaneFinanceProving;
const { createFileBackedPolicyControlPlaneStore } = controlPlaneStore;

const RELEASE_ISSUER = 'attestor.api.release.local';
const API_CA_SUBJECT = 'Attestor Keyless CA';
const API_SIGNER_SUBJECT = 'API Runtime Signer';
const API_REVIEWER_SUBJECT = 'API Reviewer';

function releaseRuntimeStoreModesForProfile(
  runtimeProfile: AttestorRuntimeProfile,
): ReleaseRuntimeStoreModes {
  return Object.freeze({
    ...CURRENT_RELEASE_RUNTIME_STORE_MODES,
    'release-decision-log':
      runtimeProfile.id === 'local-dev'
        ? 'memory'
        : CURRENT_RELEASE_RUNTIME_STORE_MODES['release-decision-log'],
    'release-reviewer-queue':
      runtimeProfile.id === 'local-dev'
        ? 'memory'
        : CURRENT_RELEASE_RUNTIME_STORE_MODES['release-reviewer-queue'],
    'release-token-introspection':
      runtimeProfile.id === 'local-dev'
        ? 'memory'
        : CURRENT_RELEASE_RUNTIME_STORE_MODES['release-token-introspection'],
    'release-evidence-pack-store':
      runtimeProfile.id === 'local-dev'
        ? 'memory'
        : CURRENT_RELEASE_RUNTIME_STORE_MODES['release-evidence-pack-store'],
  });
}

function createReleaseDecisionLogWriterForProfile(
  runtimeProfile: AttestorRuntimeProfile,
): ReleaseDecisionLogWriter {
  if (runtimeProfile.id === 'local-dev') {
    return createInMemoryReleaseDecisionLogWriter();
  }
  return createFileBackedReleaseDecisionLogWriter();
}

function createReleaseReviewerQueueStoreForProfile(
  runtimeProfile: AttestorRuntimeProfile,
): ReleaseReviewerQueueStore {
  if (runtimeProfile.id === 'local-dev') {
    return createInMemoryReleaseReviewerQueueStore();
  }
  return createFileBackedReleaseReviewerQueueStore();
}

function createReleaseTokenIntrospectionStoreForProfile(
  runtimeProfile: AttestorRuntimeProfile,
): ReleaseTokenIntrospectionStore {
  if (runtimeProfile.id === 'local-dev') {
    return createInMemoryReleaseTokenIntrospectionStore();
  }
  return createFileBackedReleaseTokenIntrospectionStore();
}

function createReleaseEvidencePackStoreForProfile(
  runtimeProfile: AttestorRuntimeProfile,
): ReleaseEvidencePackStore {
  if (runtimeProfile.id === 'local-dev') {
    return createInMemoryReleaseEvidencePackStore();
  }
  return createFileBackedReleaseEvidencePackStore();
}

export interface ReleaseRuntimeBootstrap {
  runtimeProfile: AttestorRuntimeProfile;
  releaseRuntimeStoreModes: ReleaseRuntimeStoreModes;
  releaseRuntimeDurability: RuntimeProfileDurabilityEvaluation;
  pki: ReturnType<typeof generatePkiHierarchy>;
  pkiReady: boolean;
  financeReleaseDecisionLog: ReleaseDecisionLogWriter;
  apiReleaseReviewerQueueStore: ReleaseReviewerQueueStore;
  apiReleaseIntrospectionStore: ReleaseTokenIntrospectionStore;
  apiReleaseIntrospector: ReleaseTokenIntrospector;
  apiReleaseTokenIssuer: ReleaseTokenIssuer;
  apiReleaseEvidencePackStore: ReleaseEvidencePackStore;
  apiReleaseEvidencePackIssuer: ReleaseEvidencePackIssuer;
  apiReleaseVerificationKeyPromise: Promise<ReleaseTokenVerificationKey>;
  apiReleaseDegradedModeGrantStore: DegradedModeGrantStore;
  policyControlPlaneStore: PolicyControlPlaneStore;
  policyActivationApprovalStore: PolicyActivationApprovalStore;
  policyMutationAuditLog: PolicyMutationAuditLogWriter;
  financePolicyEnvironment: string;
  financeReleaseDecisionEngine: ReleaseDecisionEngine;
  financeCommunicationReleaseShadowEvaluator: ShadowModeReleaseEvaluator;
  financeActionReleaseShadowEvaluator: ShadowModeReleaseEvaluator;
}

export interface CreateReleaseRuntimeBootstrapInput {
  runtimeProfile?: AttestorRuntimeProfile;
}

export function createReleaseRuntimeBootstrap(
  input: CreateReleaseRuntimeBootstrapInput = {},
): ReleaseRuntimeBootstrap {
  const runtimeProfile = input.runtimeProfile ?? resolveRuntimeProfile();
  const releaseRuntimeStoreModes = releaseRuntimeStoreModesForProfile(runtimeProfile);
  const releaseRuntimeDurability = assertReleaseRuntimeDurability(
    runtimeProfile,
    releaseRuntimeStoreModes,
  );
  const pki = generatePkiHierarchy(API_CA_SUBJECT, API_SIGNER_SUBJECT, API_REVIEWER_SUBJECT);
  const pkiReady = true;
  const financeReleaseDecisionLog = createReleaseDecisionLogWriterForProfile(runtimeProfile);
  const apiReleaseReviewerQueueStore = createReleaseReviewerQueueStoreForProfile(runtimeProfile);
  const apiReleaseIntrospectionStore =
    createReleaseTokenIntrospectionStoreForProfile(runtimeProfile);
  const apiReleaseIntrospector = createReleaseTokenIntrospector(apiReleaseIntrospectionStore);
  const apiReleaseTokenIssuer = createReleaseTokenIssuer({
    issuer: RELEASE_ISSUER,
    privateKeyPem: pki.signer.keyPair.privateKeyPem,
    publicKeyPem: pki.signer.keyPair.publicKeyPem,
  });
  const apiReleaseEvidencePackStore = createReleaseEvidencePackStoreForProfile(runtimeProfile);
  const apiReleaseEvidencePackIssuer = createReleaseEvidencePackIssuer({
    issuer: RELEASE_ISSUER,
    privateKeyPem: pki.signer.keyPair.privateKeyPem,
    publicKeyPem: pki.signer.keyPair.publicKeyPem,
  });
  const apiReleaseVerificationKeyPromise = apiReleaseTokenIssuer.exportVerificationKey();
  const apiReleaseDegradedModeGrantStore = createFileBackedDegradedModeGrantStore();
  const policyControlPlaneStore = createFileBackedPolicyControlPlaneStore();
  const policyActivationApprovalStore = createFileBackedPolicyActivationApprovalStore();
  const policyMutationAuditLog = createFileBackedPolicyMutationAuditLogWriter();
  const financePolicyEnvironment =
    process.env.ATTESTOR_RELEASE_POLICY_ENVIRONMENT?.trim() ||
    FINANCE_PROVING_POLICY_ENVIRONMENT;

  ensureFinanceProvingPolicies(policyControlPlaneStore, {
    environment: financePolicyEnvironment,
  });

  const financeReleaseDecisionEngine = createFinanceControlPlaneReleaseDecisionEngine({
    store: policyControlPlaneStore,
    flow: 'record',
    environment: financePolicyEnvironment,
    decisionLog: financeReleaseDecisionLog,
  });
  const financeCommunicationReleaseShadowEvaluator = createShadowModeReleaseEvaluator({
    engine: createFinanceControlPlaneReleaseDecisionEngine({
      store: policyControlPlaneStore,
      flow: 'communication',
      environment: financePolicyEnvironment,
    }),
  });
  const financeActionReleaseShadowEvaluator = createShadowModeReleaseEvaluator({
    engine: createFinanceControlPlaneReleaseDecisionEngine({
      store: policyControlPlaneStore,
      flow: 'action',
      environment: financePolicyEnvironment,
    }),
  });

  return {
    runtimeProfile,
    releaseRuntimeStoreModes,
    releaseRuntimeDurability,
    pki,
    pkiReady,
    financeReleaseDecisionLog,
    apiReleaseReviewerQueueStore,
    apiReleaseIntrospectionStore,
    apiReleaseIntrospector,
    apiReleaseTokenIssuer,
    apiReleaseEvidencePackStore,
    apiReleaseEvidencePackIssuer,
    apiReleaseVerificationKeyPromise,
    apiReleaseDegradedModeGrantStore,
    policyControlPlaneStore,
    policyActivationApprovalStore,
    policyMutationAuditLog,
    financePolicyEnvironment,
    financeReleaseDecisionEngine,
    financeCommunicationReleaseShadowEvaluator,
    financeActionReleaseShadowEvaluator,
  };
}
