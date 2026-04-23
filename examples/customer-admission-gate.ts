import { pathToFileURL } from 'node:url';
import {
  assertConsequenceAdmissionGateAllows,
  createConsequenceAdmissionFacadeResponse,
  evaluateConsequenceAdmissionGate,
  type ConsequenceAdmissionCustomerGateDecision,
  type FinancePipelineAdmissionRun,
} from '../src/consequence-admission/index.js';

interface CustomerGateScenario {
  readonly label: string;
  readonly proposedConsequence: string;
  readonly downstreamAction: string;
  readonly run: FinancePipelineAdmissionRun;
}

interface CustomerGateRenderedScenario {
  readonly label: string;
  readonly gate: ConsequenceAdmissionCustomerGateDecision;
}

export interface CustomerAdmissionGateExampleResult {
  readonly scenarios: readonly CustomerGateRenderedScenario[];
  readonly output: string;
}

function financeRun(input: {
  readonly runId: string;
  readonly decision: string;
  readonly certificateId?: string;
  readonly auditChainIntact?: boolean;
}): FinancePipelineAdmissionRun {
  return {
    runId: input.runId,
    decision: input.decision,
    proofMode: input.decision === 'pass' ? 'offline_fixture' : 'missing_evidence',
    warrant: input.decision === 'pass' ? 'issued' : 'missing',
    escrow: input.decision === 'pass' ? 'released' : 'held',
    receipt: input.decision === 'pass' ? 'issued' : 'missing',
    capsule: input.decision === 'pass' ? 'closed' : 'open',
    auditChainIntact: input.auditChainIntact ?? input.decision === 'pass',
    certificate: input.certificateId
      ? {
          certificateId: input.certificateId,
          signing: {
            fingerprint: `fingerprint:${input.certificateId}`,
          },
        }
      : null,
    verification: input.certificateId
      ? {
          digest: `sha256:${input.certificateId}`,
        }
      : null,
    tenantContext: {
      tenantId: 'tenant_customer_gate_demo',
      source: 'local-example',
      planId: 'community',
    },
  };
}

const scenarios: readonly CustomerGateScenario[] = Object.freeze([
  {
    label: 'Allowed report write',
    proposedConsequence:
      'Write the approved AI-assisted exposure summary into the customer reporting store.',
    downstreamAction: 'customer_reporting_store.write',
    run: financeRun({
      runId: 'customer_gate_allowed_001',
      decision: 'pass',
      certificateId: 'cert_customer_gate_allowed_001',
    }),
  },
  {
    label: 'Blocked customer message',
    proposedConsequence:
      'Send a customer-facing finance message after evidence checks failed.',
    downstreamAction: 'customer_message_sender.send',
    run: financeRun({
      runId: 'customer_gate_blocked_001',
      decision: 'fail',
      auditChainIntact: false,
    }),
  },
]);

function renderProofRefs(gate: ConsequenceAdmissionCustomerGateDecision): string {
  if (gate.proofRefs.length === 0) return 'none';
  return gate.proofRefs.map((proof) => `${proof.kind}:${proof.id}`).join(', ');
}

function renderResult(result: Omit<CustomerAdmissionGateExampleResult, 'output'>): string {
  const lines = [
    'Customer-side Attestor admission gate',
    '======================================',
    '',
    'This is the customer enforcement step after Attestor returns a decision.',
    'The downstream write/send/file/execute function is only called when the gate says PROCEED.',
    '',
  ];

  for (const scenario of result.scenarios) {
    lines.push(
      `Scenario: ${scenario.label}`,
      `Attestor decision: ${scenario.gate.decision}`,
      `Customer gate: ${scenario.gate.outcome.toUpperCase()}`,
      `Downstream action: ${scenario.gate.downstreamAction}`,
      `Proof refs: ${renderProofRefs(scenario.gate)}`,
      `Instruction: ${scenario.gate.instruction}`,
      '',
    );
  }

  lines.push('Customer system enforces the gate. Attestor supplies the decision and proof.');
  return lines.join('\n');
}

export function runCustomerAdmissionGateExample(): CustomerAdmissionGateExampleResult {
  const renderedScenarios = scenarios.map((scenario) => {
    const admission = createConsequenceAdmissionFacadeResponse({
      surface: 'finance-pipeline-run',
      run: scenario.run,
      decidedAt: '2026-04-23T18:00:00.000Z',
      requestInput: {
        actorRef: 'actor:customer-finance-workflow',
        authorityMode: 'tenant-api-key',
        summary: scenario.proposedConsequence,
      },
    });
    const gate = evaluateConsequenceAdmissionGate({
      admission,
      downstreamAction: scenario.downstreamAction,
      requireProof: admission.decision === 'admit',
    });

    if (gate.outcome === 'proceed') {
      assertConsequenceAdmissionGateAllows({
        admission,
        downstreamAction: scenario.downstreamAction,
        requireProof: true,
      });
    }

    return {
      label: scenario.label,
      gate,
    } as const;
  });

  const result = {
    scenarios: Object.freeze(renderedScenarios),
  } as const;

  return {
    ...result,
    output: renderResult(result),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(runCustomerAdmissionGateExample().output);
}
