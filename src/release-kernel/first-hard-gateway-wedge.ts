import type { ConsequenceType, RiskClass } from './types.js';
import type { ReleaseTargetKind } from './object-model.js';

/**
 * The first hard gateway wedge is a product decision, not just a doc sentence.
 *
 * This module freezes the initial enforceable path so later release policy,
 * decision-engine, and verifier work all build toward the same fail-closed
 * consequence boundary instead of drifting into generic platform work.
 */

export type GatewayWedgeStatus = 'frozen' | 'active-build';

export interface GatewayWedgeSuccessCriterion {
  readonly id: string;
  readonly description: string;
}

export interface GatewayWedgeDefinition {
  readonly id: string;
  readonly name: string;
  readonly status: GatewayWedgeStatus;
  readonly consequenceType: ConsequenceType;
  readonly defaultRiskClass: RiskClass;
  readonly targetKinds: readonly ReleaseTargetKind[];
  readonly primaryDomain: 'finance';
  readonly workflowFocus: string;
  readonly outputFocus: readonly string[];
  readonly downstreamBoundary: string;
  readonly hardGateReason: string;
  readonly whyNow: readonly string[];
  readonly inScope: readonly string[];
  readonly explicitlyOutOfScope: readonly string[];
  readonly successCriteria: readonly GatewayWedgeSuccessCriterion[];
}

export const FIRST_HARD_GATEWAY_WEDGE: GatewayWedgeDefinition = {
  id: 'finance-structured-record-release',
  name: 'AI output to structured financial record release',
  status: 'frozen',
  consequenceType: 'record',
  defaultRiskClass: 'R4',
  targetKinds: ['record-store', 'artifact-registry'],
  primaryDomain: 'finance',
  workflowFocus:
    'Accept or block AI-assisted structured financial reporting artifacts before they enter filing preparation, report records, or durable reporting stores.',
  outputFocus: [
    'report field updates',
    'filing preparation payloads',
    'structured reporting artifacts',
  ],
  downstreamBoundary:
    'No write, export, or filing-preparation handoff may occur without a valid release artifact bound to the exact structured record payload.',
  hardGateReason:
    'Structured records are the cleanest first fail-closed boundary because they are hashable, target-bound, auditable, and already live inside formal reporting workflows.',
  whyNow: [
    'Recent SEC EDGAR behavior explicitly tightens structured filing enforcement by suspending filings with incorrect or incomplete structured filing fee information instead of merely warning.',
    'ESMA and EBA both describe reporting frameworks as structured, validation-rule-driven technical submission systems, which makes record release more enforceable than free-form advisory output.',
    'This wedge keeps the first gateway close to the repo’s strongest proof surface: AI-assisted financial reporting acceptance.',
  ],
  inScope: [
    'AI-assisted financial reporting outputs that become structured record payloads',
    'pre-filing record generation and mutation before submission or durable storage',
    'record-level release decisions with payload binding, evidence, and downstream rejection on missing authorization',
  ],
  explicitlyOutOfScope: [
    'general chat or analyst drafting without a concrete record boundary',
    'customer communication release as the first hard gate',
    'tool action execution as the first hard gate',
    'unstructured decision-support outputs that do not yet feed a concrete record or filing artifact',
  ],
  successCriteria: [
    {
      id: 'no-token-no-write',
      description:
        'The chosen downstream record path rejects writes or exports when no valid release token or signed record envelope is present.',
    },
    {
      id: 'payload-binding',
      description:
        'The release artifact binds to the exact structured record payload and target, not just to a run or workflow name.',
    },
    {
      id: 'replay-safe',
      description:
        'The same authorization cannot be replayed to mutate a second record or re-run a second export without explicit re-issuance.',
    },
    {
      id: 'reviewable-evidence',
      description:
        'A reviewer or auditor can inspect the findings, authority, and evidence that led to the release decision after the fact.',
    },
  ],
};

export function firstHardGatewayWedge(): GatewayWedgeDefinition {
  return FIRST_HARD_GATEWAY_WEDGE;
}
