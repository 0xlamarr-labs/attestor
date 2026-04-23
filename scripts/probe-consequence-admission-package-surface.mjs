import assert from 'node:assert/strict';

const admission = await import('attestor/consequence-admission');

assert.equal(
  admission.CONSEQUENCE_ADMISSION_FACADE_SPEC_VERSION,
  'attestor.consequence-admission-facade.v1',
);
assert.equal(
  admission.consequenceAdmissionFacadeDescriptor().publicSubpath,
  'attestor/consequence-admission',
);
assert.equal(
  admission.consequenceAdmissionFacadeDescriptor().automaticPackDetection,
  false,
);
assert.equal(
  admission.consequenceAdmissionFacadeDescriptor().entryPoints.financePipelineRun.route,
  '/api/v1/pipeline/run',
);
assert.equal(
  admission.consequenceAdmissionFacadeDescriptor().entryPoints.cryptoExecutionPlan.route,
  null,
);
assert.equal(
  admission.consequenceAdmissionFacadeDescriptor().entryPoints.cryptoExecutionPlan.packageSubpath,
  'attestor/crypto-execution-admission',
);
assert.equal(
  admission.financePipelineAdmissionDescriptor().route,
  '/api/v1/pipeline/run',
);
assert.equal(
  admission.cryptoExecutionPlanAdmissionDescriptor().hostedRouteClaimed,
  false,
);
assert.equal(
  admission.isConsequenceAdmissionFacadeSurface('finance-pipeline-run'),
  true,
);
assert.equal(
  admission.isConsequenceAdmissionFacadeSurface('auto'),
  false,
);
assert.equal(
  admission.mapFinancePipelineDecisionToAdmission('pass').mappedDecision,
  'admit',
);
assert.equal(
  admission.mapCryptoAdmissionOutcomeToAdmission('needs-evidence').mappedDecision,
  'review',
);

let blockedInternalPath = false;
try {
  await import('attestor/consequence-admission/facade.js');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  blockedInternalPath =
    message.includes('Package subpath') ||
    message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED');
}

assert.equal(
  blockedInternalPath,
  true,
  'internal consequence admission module paths should stay outside the public package surface',
);

console.log('consequence-admission package surface probe passed');
