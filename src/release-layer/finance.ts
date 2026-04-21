import * as record from '../release-kernel/finance-record-release.js';
import * as communication from '../release-kernel/finance-communication-release.js';
import * as action from '../release-kernel/finance-action-release.js';
import {
  createFirstHardGatewayReleasePolicy,
  createFinanceActionReleasePolicy,
  createFinanceCommunicationReleasePolicy,
} from '../release-kernel/release-policy.js';
import {
  RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH,
  RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION,
} from './index.js';

export { record, communication, action };

export type FinanceFilingReleaseCandidate = record.FinanceFilingReleaseCandidate;
export type FinanceFilingReleaseMaterial = record.FinanceFilingReleaseMaterial;
export type FinanceCommunicationReleaseCandidate =
  communication.FinanceCommunicationReleaseCandidate;
export type FinanceCommunicationReleaseMaterial =
  communication.FinanceCommunicationReleaseMaterial;
export type FinanceActionReleaseCandidate = action.FinanceActionReleaseCandidate;
export type FinanceActionReleaseMaterial = action.FinanceActionReleaseMaterial;

export const RELEASE_LAYER_FINANCE_SURFACE_SPEC_VERSION =
  'attestor.release-layer-finance.v1';

export interface ReleaseLayerFinanceSurfaceDescriptor {
  readonly version:
    | typeof RELEASE_LAYER_FINANCE_SURFACE_SPEC_VERSION
    | typeof RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION;
  readonly subpath: typeof RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH;
  readonly wedges: readonly string[];
}

export const financeReleasePolicies = Object.freeze({
  createRecordReleasePolicy: createFirstHardGatewayReleasePolicy,
  createCommunicationReleasePolicy: createFinanceCommunicationReleasePolicy,
  createActionReleasePolicy: createFinanceActionReleasePolicy,
});

export const financeReleaseLayer = Object.freeze({
  record,
  communication,
  action,
  policies: financeReleasePolicies,
});

export type FinanceReleaseLayer = typeof financeReleaseLayer;

export function financeReleaseLayerPublicSurface(): ReleaseLayerFinanceSurfaceDescriptor {
  return Object.freeze({
    version: RELEASE_LAYER_FINANCE_SURFACE_SPEC_VERSION,
    subpath: RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH,
    wedges: Object.freeze(['record', 'communication', 'action']),
  });
}
