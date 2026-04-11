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
  const gkeBackendPolicy = read('ops/kubernetes/ha/providers/gke/gcpbackendpolicy.yaml');
  const gkeGatewayPolicy = read('ops/kubernetes/ha/providers/gke/gcpgatewaypolicy.yaml');
  const awsOverlay = read('ops/kubernetes/ha/providers/aws/kustomization.yaml');
  const awsIngress = read('ops/kubernetes/ha/providers/aws/alb-ingress.yaml');
  const kedaOverlay = read('ops/kubernetes/ha/providers/keda/kustomization.yaml');
  const kedaReadme = read('ops/kubernetes/ha/providers/keda/README.md');
  const apiScaledObject = read('ops/kubernetes/ha/providers/keda/api-scaledobject.yaml');
  const workerScaledObject = read('ops/kubernetes/ha/providers/keda/worker-scaledobject.yaml');
  const workerTriggerAuth = read('ops/kubernetes/ha/providers/keda/worker-triggerauthentication.yaml');
  const certManagerOverlay = read('ops/kubernetes/ha/providers/cert-manager/kustomization.yaml');
  const certManagerReadme = read('ops/kubernetes/ha/providers/cert-manager/README.md');
  const certManagerCertificate = read('ops/kubernetes/ha/providers/cert-manager/certificate.yaml');
  const externalSecretsOverlay = read('ops/kubernetes/ha/providers/external-secrets/kustomization.yaml');
  const externalSecretsReadme = read('ops/kubernetes/ha/providers/external-secrets/README.md');
  const externalRuntimeSecret = read('ops/kubernetes/ha/providers/external-secrets/runtime-secrets.yaml');
  const externalTlsSecret = read('ops/kubernetes/ha/providers/external-secrets/tls-secret.yaml');
  const profilesReadme = read('ops/kubernetes/ha/profiles/README.md');
  const awsProfile = read('ops/kubernetes/ha/profiles/aws-production.json');
  const gkeProfile = read('ops/kubernetes/ha/profiles/gke-production.json');

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
  ok(gkeBackendPolicy.includes('GCPBackendPolicy') && gkeBackendPolicy.includes('connectionDraining') && gkeBackendPolicy.includes('securityPolicy'), 'Kubernetes HA bundle: GKE overlay defines backend timeout/draining/security policy');
  ok(gkeGatewayPolicy.includes('GCPGatewayPolicy') && gkeGatewayPolicy.includes('sslPolicy') && gkeGatewayPolicy.includes('allowGlobalAccess'), 'Kubernetes HA bundle: GKE overlay defines gateway TLS/global access policy');
  ok(awsOverlay.includes('../../'), 'Kubernetes HA bundle: AWS managed LB overlay composes the base bundle');
  ok(awsIngress.includes('alb.ingress.kubernetes.io/healthcheck-path') && awsIngress.includes('/api/v1/ready'), 'Kubernetes HA bundle: AWS overlay defines ALB health checks');
  ok(awsIngress.includes('alb.ingress.kubernetes.io/target-group-attributes') && awsIngress.includes('least_outstanding_requests'), 'Kubernetes HA bundle: AWS overlay tunes target-group draining and load balancing');
  ok(kedaOverlay.includes('api-scaledobject.yaml') && kedaOverlay.includes('worker-scaledobject.yaml'), 'Kubernetes HA bundle: KEDA overlay composes workload-aware scaled objects');
  ok(kedaReadme.includes('providers/keda') && kedaReadme.includes('redis-address'), 'Kubernetes HA bundle: KEDA README documents rollout and Redis secret requirements');
  ok(apiScaledObject.includes('type: prometheus') && apiScaledObject.includes('attestor_http_requests_total'), 'Kubernetes HA bundle: API KEDA scaler uses Prometheus request-rate telemetry');
  ok(workerScaledObject.includes('type: redis-lists') && workerScaledObject.includes('bull:attestor-pipeline:wait'), 'Kubernetes HA bundle: worker KEDA scaler uses BullMQ waiting-list backlog');
  ok(workerTriggerAuth.includes('TriggerAuthentication') && workerTriggerAuth.includes('redis-address') && workerTriggerAuth.includes('redis-password'), 'Kubernetes HA bundle: worker KEDA scaler authenticates against Redis secrets');
  ok(certManagerOverlay.includes('../../') && certManagerOverlay.includes('certificate.yaml'), 'Kubernetes HA bundle: cert-manager overlay composes certificate resource');
  ok(certManagerReadme.includes('cert-manager') && certManagerReadme.includes('ClusterIssuer'), 'Kubernetes HA bundle: cert-manager README documents issuer requirements');
  ok(certManagerCertificate.includes('kind: Certificate') && certManagerCertificate.includes('secretName: attestor-tls'), 'Kubernetes HA bundle: cert-manager overlay issues the Gateway TLS secret');
  ok(externalSecretsOverlay.includes('../../') && externalSecretsOverlay.includes('runtime-secrets.yaml'), 'Kubernetes HA bundle: external-secrets overlay composes runtime secret resources');
  ok(externalSecretsReadme.includes('External Secrets Operator') && externalSecretsReadme.includes('ClusterSecretStore'), 'Kubernetes HA bundle: external-secrets README documents cluster secret store requirements');
  ok(externalRuntimeSecret.includes('kind: ExternalSecret') && externalRuntimeSecret.includes('attestor-runtime-secrets'), 'Kubernetes HA bundle: external-secrets overlay manages runtime secret material');
  ok(externalTlsSecret.includes('kubernetes.io/tls') && externalTlsSecret.includes('attestor-tls'), 'Kubernetes HA bundle: external-secrets overlay can project TLS material');
  ok(profilesReadme.includes('render:ha-profile') && profilesReadme.includes('aws-production.json'), 'Kubernetes HA bundle: profiles README documents benchmark-to-profile tuning flow');
  ok(awsProfile.includes('"provider": "aws"') && awsProfile.includes('"availabilityTarget": 0.995'), 'Kubernetes HA bundle: AWS calibration profile ships production SLO defaults');
  ok(gkeProfile.includes('"provider": "gke"') && gkeProfile.includes('"timeoutLatencyMultiplier": 6'), 'Kubernetes HA bundle: GKE calibration profile ships backend timeout tuning defaults');

  console.log(`\nKubernetes HA bundle tests: ${passed} passed, 0 failed`);
}

try {
  main();
} catch (error) {
  console.error('\nKubernetes HA bundle tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
