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

const { createInMemoryReleaseDecisionLogWriter } = decisionLog;
const { createInMemoryReleaseEvidencePackStore, createReleaseEvidencePackIssuer } = evidence;
const { createInMemoryReleaseTokenIntrospectionStore, createReleaseTokenIntrospector } =
  introspection;
const { createInMemoryReleaseReviewerQueueStore } = review;
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

export interface ReleaseRuntimeBootstrap {
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

export function createReleaseRuntimeBootstrap(): ReleaseRuntimeBootstrap {
  const pki = generatePkiHierarchy(API_CA_SUBJECT, API_SIGNER_SUBJECT, API_REVIEWER_SUBJECT);
  const pkiReady = true;
  const financeReleaseDecisionLog = createInMemoryReleaseDecisionLogWriter();
  const apiReleaseReviewerQueueStore = createInMemoryReleaseReviewerQueueStore();
  const apiReleaseIntrospectionStore = createInMemoryReleaseTokenIntrospectionStore();
  const apiReleaseIntrospector = createReleaseTokenIntrospector(apiReleaseIntrospectionStore);
  const apiReleaseTokenIssuer = createReleaseTokenIssuer({
    issuer: RELEASE_ISSUER,
    privateKeyPem: pki.signer.keyPair.privateKeyPem,
    publicKeyPem: pki.signer.keyPair.publicKeyPem,
  });
  const apiReleaseEvidencePackStore = createInMemoryReleaseEvidencePackStore();
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
