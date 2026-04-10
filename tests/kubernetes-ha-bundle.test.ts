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
  const gkeOverlay = read('ops/kubernetes/ha/providers/gke/kustomization.yaml');
  const gkeHealthCheckPolicy = read('ops/kubernetes/ha/providers/gke/healthcheckpolicy.yaml');
  const awsOverlay = read('ops/kubernetes/ha/providers/aws/kustomization.yaml');
  const awsIngress = read('ops/kubernetes/ha/providers/aws/alb-ingress.yaml');

  ok(kustomization.includes('api-deployment.yaml') && kustomization.includes('gateway.yaml'), 'Kubernetes HA bundle: kustomization includes deployment and gateway resources');
  ok(apiDeployment.includes('ATTESTOR_HA_MODE') && apiDeployment.includes('ATTESTOR_CONTROL_PLANE_PG_URL'), 'Kubernetes HA bundle: API deployment enables HA mode and shared control-plane');
  ok(apiDeployment.includes('readinessProbe:') && apiDeployment.includes('livenessProbe:'), 'Kubernetes HA bundle: API deployment defines readiness and liveness probes');
  ok(apiDeployment.includes('rollingUpdate:') && apiDeployment.includes('maxUnavailable: 0'), 'Kubernetes HA bundle: API deployment uses zero-downtime rolling update settings');
  ok(apiDeployment.includes('startupProbe:') && apiDeployment.includes('preStop:'), 'Kubernetes HA bundle: API deployment defines startup probe and preStop drain');
  ok(apiDeployment.includes('topologySpreadConstraints:') && apiDeployment.includes('podAntiAffinity:'), 'Kubernetes HA bundle: API deployment spreads replicas across nodes/zones');
  ok(workerDeployment.includes('ATTESTOR_HA_MODE') && workerDeployment.includes('REDIS_URL'), 'Kubernetes HA bundle: worker deployment requires shared Redis and HA mode');
  ok(workerDeployment.includes('ATTESTOR_WORKER_HEALTH_PORT') && workerDeployment.includes('readinessProbe:') && workerDeployment.includes('livenessProbe:'), 'Kubernetes HA bundle: worker deployment exposes health/readiness probes');
  ok(workerDeployment.includes('topologySpreadConstraints:') && workerDeployment.includes('podAntiAffinity:'), 'Kubernetes HA bundle: worker deployment spreads replicas across nodes/zones');
  ok(apiHpa.includes('behavior:') && workerHpa.includes('behavior:'), 'Kubernetes HA bundle: HPAs include scale behaviors');
  ok(apiHpa.includes('memory') && workerHpa.includes('memory'), 'Kubernetes HA bundle: HPAs scale on memory as well as CPU');
  ok(apiPdb.includes('PodDisruptionBudget') && workerPdb.includes('PodDisruptionBudget'), 'Kubernetes HA bundle: PDBs exist for API and worker');
  ok(gateway.includes('Gateway') && httpRoute.includes('HTTPRoute'), 'Kubernetes HA bundle: Gateway API ingress resources are present');
  ok(httpRoute.includes('backendRefs:') && httpRoute.includes('attestor-api'), 'Kubernetes HA bundle: HTTPRoute forwards to attestor-api service');
  ok(gkeOverlay.includes('../../'), 'Kubernetes HA bundle: GKE managed LB overlay composes the base bundle');
  ok(gkeHealthCheckPolicy.includes('HealthCheckPolicy') && gkeHealthCheckPolicy.includes('/api/v1/ready'), 'Kubernetes HA bundle: GKE overlay defines managed health check policy');
  ok(awsOverlay.includes('../../'), 'Kubernetes HA bundle: AWS managed LB overlay composes the base bundle');
  ok(awsIngress.includes('alb.ingress.kubernetes.io/healthcheck-path') && awsIngress.includes('/api/v1/ready'), 'Kubernetes HA bundle: AWS overlay defines ALB health checks');

  console.log(`\nKubernetes HA bundle tests: ${passed} passed, 0 failed`);
}

try {
  main();
} catch (error) {
  console.error('\nKubernetes HA bundle tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
