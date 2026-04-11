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
  const kustomization = read('ops/kubernetes/observability/kustomization.yaml');
  const readme = read('ops/kubernetes/observability/README.md');
  const configmap = read('ops/kubernetes/observability/configmap.yaml');
  const deployment = read('ops/kubernetes/observability/deployment.yaml');
  const service = read('ops/kubernetes/observability/service.yaml');
  const hpa = read('ops/kubernetes/observability/hpa.yaml');
  const pdb = read('ops/kubernetes/observability/pdb.yaml');
  const clusterRole = read('ops/kubernetes/observability/clusterrole.yaml');
  const binding = read('ops/kubernetes/observability/clusterrolebinding.yaml');
  const grafanaCloudKustomization = read('ops/kubernetes/observability/providers/grafana-cloud/kustomization.yaml');
  const grafanaCloudReadme = read('ops/kubernetes/observability/providers/grafana-cloud/README.md');
  const grafanaCloudSecretTemplate = read('ops/kubernetes/observability/providers/grafana-cloud/secret-template.yaml');
  const grafanaCloudDeploymentPatch = read('ops/kubernetes/observability/providers/grafana-cloud/patch-deployment.yaml');
  const grafanaCloudConfigPatch = read('ops/kubernetes/observability/providers/grafana-cloud/patch-configmap.yaml');

  ok(kustomization.includes('configmap.yaml') && kustomization.includes('deployment.yaml'), 'Kubernetes observability bundle: kustomization includes core resources');
  ok(readme.includes('gateway deployment pattern') && readme.includes('kubectl apply -k ops/kubernetes/observability'), 'Kubernetes observability bundle: README documents gateway rollout');
  ok(configmap.includes('k8sattributes:') && configmap.includes('resourcedetection:'), 'Kubernetes observability bundle: collector config uses Kubernetes/resource metadata processors');
  ok(configmap.includes('TEMPO_OTLP_ENDPOINT') && configmap.includes('LOKI_OTLP_ENDPOINT'), 'Kubernetes observability bundle: collector config is backend-endpoint aware');
  ok(deployment.includes('replicas: 2') && deployment.includes('otel/opentelemetry-collector-contrib:latest'), 'Kubernetes observability bundle: deployment runs a multi-replica collector gateway');
  ok(deployment.includes('readinessProbe:') && deployment.includes('livenessProbe:') && deployment.includes('startupProbe:'), 'Kubernetes observability bundle: deployment defines health probes');
  ok(deployment.includes('prometheus.io/scrape') && deployment.includes('containerPort: 8889'), 'Kubernetes observability bundle: deployment exposes Prometheus scrape annotations');
  ok(service.includes('port: 4317') && service.includes('port: 4318') && service.includes('port: 8889'), 'Kubernetes observability bundle: service exposes OTLP and metrics ports');
  ok(hpa.includes('maxReplicas: 6') && hpa.includes('memory'), 'Kubernetes observability bundle: HPA scales on CPU and memory');
  ok(pdb.includes('PodDisruptionBudget') && pdb.includes('minAvailable: 1'), 'Kubernetes observability bundle: PDB protects collector availability');
  ok(clusterRole.includes('pods') && clusterRole.includes('deployments'), 'Kubernetes observability bundle: RBAC grants metadata discovery permissions');
  ok(binding.includes('attestor-otel-gateway'), 'Kubernetes observability bundle: ClusterRoleBinding attaches service account');
  ok(grafanaCloudKustomization.includes('../../') && grafanaCloudKustomization.includes('patch-configmap.yaml'), 'Kubernetes observability bundle: Grafana Cloud overlay composes and patches the base bundle');
  ok(grafanaCloudReadme.includes('Grafana Cloud OTLP') && grafanaCloudReadme.includes('grafana-cloud-otlp-auth-header'), 'Kubernetes observability bundle: Grafana Cloud overlay documents OTLP secret requirements');
  ok(grafanaCloudSecretTemplate.includes('grafana-cloud-otlp-endpoint') && grafanaCloudSecretTemplate.includes('grafana-cloud-otlp-auth-header'), 'Kubernetes observability bundle: Grafana Cloud overlay ships secret template placeholders');
  ok(grafanaCloudDeploymentPatch.includes('GRAFANA_CLOUD_OTLP_ENDPOINT') && grafanaCloudDeploymentPatch.includes('GRAFANA_CLOUD_OTLP_AUTH_HEADER'), 'Kubernetes observability bundle: Grafana Cloud overlay injects managed OTLP endpoint/auth env');
  ok(grafanaCloudConfigPatch.includes('otlphttp/grafana_cloud') && grafanaCloudConfigPatch.includes('Authorization: ${GRAFANA_CLOUD_OTLP_AUTH_HEADER}'), 'Kubernetes observability bundle: Grafana Cloud overlay routes all signals through managed OTLP auth');

  console.log(`\nKubernetes observability bundle tests: ${passed} passed, 0 failed`);
}

try {
  main();
} catch (error) {
  console.error('\nKubernetes observability bundle tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
