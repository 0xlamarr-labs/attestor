import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function main(): void {
  const kustomization = read('ops/kubernetes/ha/kustomization.yaml');
  const apiDeployment = read('ops/kubernetes/ha/api-deployment.yaml');
  const workerDeployment = read('ops/kubernetes/ha/worker-deployment.yaml');
  const apiHpa = read('ops/kubernetes/ha/api-hpa.yaml');
  const workerHpa = read('ops/kubernetes/ha/worker-hpa.yaml');
  const gateway = read('ops/kubernetes/ha/gateway.yaml');
  const httpRoute = read('ops/kubernetes/ha/httproute.yaml');
  const apiPdb = read('ops/kubernetes/ha/api-pdb.yaml');
  const workerPdb = read('ops/kubernetes/ha/worker-pdb.yaml');

  ok(kustomization.includes('api-deployment.yaml') && kustomization.includes('gateway.yaml'), 'Kubernetes HA bundle: kustomization includes deployment and gateway resources');
  ok(apiDeployment.includes('ATTESTOR_HA_MODE') && apiDeployment.includes('ATTESTOR_CONTROL_PLANE_PG_URL'), 'Kubernetes HA bundle: API deployment enables HA mode and shared control-plane');
  ok(apiDeployment.includes('readinessProbe:') && apiDeployment.includes('livenessProbe:'), 'Kubernetes HA bundle: API deployment defines readiness and liveness probes');
  ok(apiDeployment.includes('rollingUpdate:') && apiDeployment.includes('maxUnavailable: 0'), 'Kubernetes HA bundle: API deployment uses zero-downtime rolling update settings');
  ok(workerDeployment.includes('ATTESTOR_HA_MODE') && workerDeployment.includes('REDIS_URL'), 'Kubernetes HA bundle: worker deployment requires shared Redis and HA mode');
  ok(apiHpa.includes('HorizontalPodAutoscaler') && workerHpa.includes('HorizontalPodAutoscaler'), 'Kubernetes HA bundle: HPAs exist for API and worker');
  ok(apiPdb.includes('PodDisruptionBudget') && workerPdb.includes('PodDisruptionBudget'), 'Kubernetes HA bundle: PDBs exist for API and worker');
  ok(gateway.includes('Gateway') && httpRoute.includes('HTTPRoute'), 'Kubernetes HA bundle: Gateway API ingress resources are present');
  ok(httpRoute.includes('backendRefs:') && httpRoute.includes('attestor-api'), 'Kubernetes HA bundle: HTTPRoute forwards to attestor-api service');

  console.log(`\nKubernetes HA bundle tests: ${passed} passed, 0 failed`);
}

try {
  main();
} catch (error) {
  console.error('\nKubernetes HA bundle tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
