import { pathToFileURL } from 'node:url';
import {
  createConsequenceAdmissionFacadeResponse,
  consequenceAdmissionFacadeDescriptor,
  type ConsequenceAdmissionResponse,
  type FinancePipelineAdmissionRun,
} from '../src/consequence-admission/index.js';

interface DemoScenario {
  readonly label: string;
  readonly proposedConsequence: string;
  readonly downstreamAction: string;
  readonly run: FinancePipelineAdmissionRun;
}

export interface FirstUsefulAdmissionDemoResult {
  readonly descriptor: ReturnType<typeof consequenceAdmissionFacadeDescriptor>;
  readonly scenarios: readonly {
    readonly label: string;
    readonly proposedConsequence: string;
    readonly downstreamAction: string;
    readonly admission: ConsequenceAdmissionResponse;
    readonly gate: 'proceed' | 'hold';
  }[];
  readonly output: string;
}

function financeRun(input: {
  readonly runId: string;
  readonly decision: string;
  readonly proofMode?: string;
  readonly auditChainIntact?: boolean;
  readonly certificateId?: string;
}): FinancePipelineAdmissionRun {
  return {
    runId: input.runId,
    decision: input.decision,
    proofMode: input.proofMode ?? 'offline_fixture',
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
      tenantId: 'tenant_demo',
      source: 'local-example',
      planId: 'community',
    },
    usage: {
      used: 1,
      remaining: 9,
      quota: 10,
      enforced: true,
    },
  };
}

const scenarios: readonly DemoScenario[] = Object.freeze([
  {
    label: 'Allowed finance consequence',
    proposedConsequence:
      'Publish an AI-assisted counterparty exposure summary into the reporting workflow.',
    downstreamAction:
      'Write the approved summary to the customer reporting system.',
    run: financeRun({
      runId: 'demo_finance_allowed_001',
      decision: 'pass',
      certificateId: 'cert_demo_finance_allowed_001',
    }),
  },
  {
    label: 'Blocked finance consequence',
    proposedConsequence:
      'Send a refund-impact report whose policy and evidence checks failed.',
    downstreamAction:
      'Do not send the report; route it to human review.',
    run: financeRun({
      runId: 'demo_finance_blocked_001',
      decision: 'fail',
      proofMode: 'missing_evidence',
      auditChainIntact: false,
    }),
  },
]);

function gateFor(admission: ConsequenceAdmissionResponse): 'proceed' | 'hold' {
  return admission.decision === 'admit' || admission.decision === 'narrow'
    ? 'proceed'
    : 'hold';
}

function renderProofRefs(admission: ConsequenceAdmissionResponse): string {
  if (admission.proof.length === 0) return 'none';
  return admission.proof
    .map((proof) => `${proof.kind}:${proof.id}`)
    .join(', ');
}

function renderResult(result: Omit<FirstUsefulAdmissionDemoResult, 'output'>): string {
  const lines: string[] = [
    'Attestor first useful admission demo',
    '=====================================',
    '',
    `public facade: ${result.descriptor.publicSubpath}`,
    `explicit surface required: ${String(result.descriptor.explicitSurfaceRequired)}`,
    `automatic pack detection: ${String(result.descriptor.automaticPackDetection)}`,
    '',
    'What this proves:',
    '1. A customer system proposes a consequence.',
    '2. It calls Attestor before the downstream action happens.',
    '3. Attestor returns admit, narrow, review, or block with proof references.',
    '4. The downstream system proceeds only when the decision allows it.',
    '',
  ];

  for (const scenario of result.scenarios) {
    const { admission } = scenario;
    lines.push(
      `Scenario: ${scenario.label}`,
      `proposed consequence: ${scenario.proposedConsequence}`,
      `surface: finance-pipeline-run`,
      `entry point: ${admission.request.entryPoint.route}`,
      `native decision: ${admission.nativeDecision?.value ?? 'none'}`,
      `canonical decision: ${admission.decision}`,
      `allowed: ${String(admission.allowed)}`,
      `fail closed: ${String(admission.failClosed)}`,
      `proof refs: ${renderProofRefs(admission)}`,
      scenario.gate === 'proceed'
        ? `downstream gate: PROCEED -> ${scenario.downstreamAction}`
        : `downstream gate: HOLD -> ${scenario.downstreamAction}`,
      '',
    );
  }

  lines.push('Proof first. Action second.');
  return lines.join('\n');
}

export function runFirstUsefulAdmissionDemo(): FirstUsefulAdmissionDemoResult {
  const descriptor = consequenceAdmissionFacadeDescriptor();
  const renderedScenarios = scenarios.map((scenario) => {
    const admission = createConsequenceAdmissionFacadeResponse({
      surface: 'finance-pipeline-run',
      run: scenario.run,
      decidedAt: '2026-04-23T17:00:00.000Z',
      requestInput: {
        actorRef: 'actor:demo-ai-workflow',
        authorityMode: 'tenant-api-key',
        summary: scenario.proposedConsequence,
      },
    });
    return {
      label: scenario.label,
      proposedConsequence: scenario.proposedConsequence,
      downstreamAction: scenario.downstreamAction,
      admission,
      gate: gateFor(admission),
    } as const;
  });

  const result = {
    descriptor,
    scenarios: Object.freeze(renderedScenarios),
  } as const;

  return {
    ...result,
    output: renderResult(result),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(runFirstUsefulAdmissionDemo().output);
}
