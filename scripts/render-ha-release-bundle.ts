import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type Provider = 'generic' | 'aws' | 'gke';

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true';
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function write(path: string, contents: string): void {
  writeFileSync(resolve(path), contents, 'utf8');
}

function replaceOne(contents: string, search: string | RegExp, replacement: string): string {
  const matched =
    typeof search === 'string'
      ? contents.includes(search)
      : new RegExp(search.source, search.flags.replace('g', '')).test(contents);
  if (!matched) throw new Error(`Expected replacement did not match: ${String(search)}`);
  return contents.replace(search, replacement);
}

function replaceYamlLine(contents: string, key: string, replacementLine: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(\\s*${escaped}:).*$`, 'm');
  if (!pattern.test(contents)) throw new Error(`Expected replacement did not match: ${key}`);
  return contents.replace(pattern, replacementLine);
}

function replaceContainerImage(contents: string, containerName: string, replacement: string): string {
  const escaped = containerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(- name:\\s*${escaped}[\\s\\S]*?\\n\\s*image:\\s*)(\\S+)`);
  if (!pattern.test(contents)) throw new Error(`Expected container image replacement did not match: ${containerName}`);
  return contents.replace(pattern, `$1${replacement}`);
}

function ensureHttpRouteHostname(contents: string, hostname: string): string {
  if (contents.includes('attestor.example.com')) {
    return contents.replace(/attestor\.example\.com/g, hostname);
  }
  if (/^\s*hostnames:\s*$/m.test(contents)) {
    return contents;
  }
  const specPattern = /^spec:\s*$/m;
  if (!specPattern.test(contents)) throw new Error('Expected HTTPRoute spec block for hostname injection');
  return contents.replace(specPattern, `spec:\n  hostnames:\n    - ${hostname}`);
}

function scalarFromYaml(yaml: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = yaml.match(new RegExp(`^\\s*${escaped}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return match?.[1]?.trim();
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function runTsx(script: string, args: string[], envVars: NodeJS.ProcessEnv): void {
  const run = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), script, ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: envVars,
  });
  if (run.status !== 0) {
    throw new Error(`${script} failed.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  }
}

function main(): void {
  const provider = (arg('provider', env('ATTESTOR_HA_PROVIDER') ?? 'gke') as Provider);
  if (!['generic', 'aws', 'gke'].includes(provider)) {
    throw new Error('provider must be one of generic, aws, gke');
  }

  const benchmarkPath = required(arg('benchmark', env('ATTESTOR_HA_BENCHMARK_PATH')), '--benchmark');
  const profilePath = arg(
    'profile',
    env('ATTESTOR_HA_PROFILE_PATH')
      ?? (provider === 'aws'
        ? 'ops/kubernetes/ha/profiles/aws-production.json'
        : 'ops/kubernetes/ha/profiles/gke-production.json'),
  )!;
  const outputDir = resolve(arg('output-dir', `.attestor/ha/release/${provider}`)!);
  const namespace = env('ATTESTOR_K8S_NAMESPACE') ?? 'attestor';
  const apiImage = required(arg('api-image', env('ATTESTOR_API_IMAGE')), 'ATTESTOR_API_IMAGE');
  const workerImage = required(arg('worker-image', env('ATTESTOR_WORKER_IMAGE')), 'ATTESTOR_WORKER_IMAGE');
  const imagePullPolicy = env('ATTESTOR_IMAGE_PULL_POLICY') ?? 'IfNotPresent';
  const hostname = required(env('ATTESTOR_PUBLIC_HOSTNAME'), 'ATTESTOR_PUBLIC_HOSTNAME');
  const gatewayClassName = env('ATTESTOR_GATEWAY_CLASS_NAME') ?? 'managed-external';
  const useKeda = bool(arg('use-keda', env('ATTESTOR_HA_USE_KEDA')), true);
  const tlsMode = env('ATTESTOR_TLS_MODE') ?? 'secret';
  const otelEndpoint = env('ATTESTOR_HA_OTEL_ENDPOINT');

  const tempRoot = mkdtempSync(resolve(tmpdir(), 'attestor-ha-release-'));
  const profileOut = resolve(tempRoot, 'profile');
  const credentialsOut = resolve(tempRoot, 'credentials');

  try {
    runTsx('scripts/render-ha-profile.ts', [`--input=${benchmarkPath}`, `--profile=${profilePath}`, `--output-dir=${profileOut}`], process.env);
    runTsx('scripts/render-ha-credentials.ts', [`--provider=${provider}`, `--output-dir=${credentialsOut}`], process.env);

    mkdirSync(outputDir, { recursive: true });

    let configmap = read('ops/kubernetes/ha/configmap.yaml');
    let apiDeployment = read('ops/kubernetes/ha/api-deployment.yaml');
    let workerDeployment = read('ops/kubernetes/ha/worker-deployment.yaml');
    let httpRoute = read('ops/kubernetes/ha/httproute.yaml');
    const apiService = read('ops/kubernetes/ha/api-service.yaml');
    const namespaceYaml = read('ops/kubernetes/ha/namespace.yaml');
    const apiPdb = read('ops/kubernetes/ha/api-pdb.yaml');
    const workerPdb = read('ops/kubernetes/ha/worker-pdb.yaml');

    apiDeployment = replaceContainerImage(apiDeployment, 'api', apiImage);
    if (imagePullPolicy !== 'IfNotPresent') {
      apiDeployment = replaceOne(apiDeployment, /imagePullPolicy:\s*\S+/, `imagePullPolicy: ${imagePullPolicy}`);
    }
    workerDeployment = replaceContainerImage(workerDeployment, 'worker', workerImage);
    if (imagePullPolicy !== 'IfNotPresent') {
      workerDeployment = replaceOne(workerDeployment, /imagePullPolicy:\s*\S+/, `imagePullPolicy: ${imagePullPolicy}`);
    }
    httpRoute = ensureHttpRouteHostname(httpRoute, hostname);
    if (otelEndpoint) {
      configmap = replaceOne(
        configmap,
        /OTEL_EXPORTER_OTLP_ENDPOINT:\s*"[^"]+"/,
        `OTEL_EXPORTER_OTLP_ENDPOINT: "${otelEndpoint}"`,
      );
    }

    const resources: string[] = ['namespace.yaml', 'configmap.yaml', 'api-service.yaml', 'api-deployment.yaml', 'worker-deployment.yaml', 'api-pdb.yaml', 'worker-pdb.yaml'];
    write(resolve(outputDir, 'namespace.yaml'), namespaceYaml);
    write(resolve(outputDir, 'configmap.yaml'), configmap);
    write(resolve(outputDir, 'api-service.yaml'), apiService);
    write(resolve(outputDir, 'api-deployment.yaml'), apiDeployment);
    write(resolve(outputDir, 'worker-deployment.yaml'), workerDeployment);
    write(resolve(outputDir, 'api-pdb.yaml'), apiPdb);
    write(resolve(outputDir, 'worker-pdb.yaml'), workerPdb);

    const runtimeSecretMode = arg('runtime-secret-mode', env('ATTESTOR_HA_RUNTIME_SECRET_MODE') ?? (provider === 'generic' ? 'secret' : 'external-secret'))!;
    if (runtimeSecretMode === 'external-secret') {
      write(resolve(outputDir, 'runtime-secrets.yaml'), read(resolve(credentialsOut, 'runtime-secrets.external-secret.yaml')));
    } else {
      write(resolve(outputDir, 'runtime-secrets.yaml'), read(resolve(credentialsOut, 'runtime-secrets.secret.yaml')));
    }
    resources.push('runtime-secrets.yaml');

    if (provider === 'aws' && tlsMode === 'aws-acm') {
      let ingress = read('ops/kubernetes/ha/providers/aws/alb-ingress.yaml');
      const ingressPatch = read(resolve(credentialsOut, 'aws-alb-ingress.patch.yaml'));
      const tunedPatch = read(resolve(profileOut, 'alb-ingress.patch.yaml'));
      ingress = replaceOne(ingress, '- host: attestor.example.com', `- host: ${hostname}`);
      for (const annotation of [
        'alb.ingress.kubernetes.io/healthcheck-interval-seconds',
        'alb.ingress.kubernetes.io/healthcheck-timeout-seconds',
        'alb.ingress.kubernetes.io/healthy-threshold-count',
        'alb.ingress.kubernetes.io/unhealthy-threshold-count',
        'alb.ingress.kubernetes.io/target-group-attributes',
        'alb.ingress.kubernetes.io/load-balancer-attributes',
      ]) {
        const value = scalarFromYaml(tunedPatch, annotation);
        if (value) {
          ingress = replaceYamlLine(ingress, annotation, `    ${annotation}: "${value}"`);
        }
      }
      for (const annotation of [
        'alb.ingress.kubernetes.io/certificate-arn',
        'alb.ingress.kubernetes.io/ssl-policy',
        'alb.ingress.kubernetes.io/wafv2-acl-arn',
        'alb.ingress.kubernetes.io/group.name',
      ]) {
        const value = scalarFromYaml(ingressPatch, annotation);
        if (value) {
          const escaped = annotation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pattern = new RegExp(`^\\s*${escaped}:.*$`, 'm');
          ingress = pattern.test(ingress)
            ? replaceYamlLine(ingress, annotation, `    ${annotation}: "${value}"`)
            : ingress.replace('spec:\n', `    ${annotation}: "${value}"\nspec:\n`);
        }
      }
      write(resolve(outputDir, 'ingress.yaml'), ingress);
      resources.push('ingress.yaml');
    } else {
      write(resolve(outputDir, 'gateway.yaml'), read(resolve(credentialsOut, 'gateway.patch.yaml')));
      write(resolve(outputDir, 'httproute.yaml'), httpRoute);
      resources.push('gateway.yaml', 'httproute.yaml');

      if (provider === 'gke') {
        const healthcheck = read('ops/kubernetes/ha/providers/gke/healthcheckpolicy.yaml');
        let backendPolicy = read('ops/kubernetes/ha/providers/gke/gcpbackendpolicy.yaml');
        let gatewayPolicy = read('ops/kubernetes/ha/providers/gke/gcpgatewaypolicy.yaml');
        const backendPatch = read(resolve(profileOut, 'gcpbackendpolicy.patch.yaml'));
        const gatewayPatch = read(resolve(credentialsOut, 'gke-gateway-policy.patch.yaml'));

        const timeout = scalarFromYaml(backendPatch, 'timeoutSec');
        const draining = scalarFromYaml(backendPatch, 'drainingTimeoutSec');
        const sampleRate = scalarFromYaml(backendPatch, 'sampleRate');
        const sslPolicy = scalarFromYaml(gatewayPatch, 'sslPolicy');
        if (timeout) backendPolicy = replaceYamlLine(backendPolicy, 'timeoutSec', `    timeoutSec: ${timeout}`);
        if (draining) backendPolicy = replaceYamlLine(backendPolicy, 'drainingTimeoutSec', `      drainingTimeoutSec: ${draining}`);
        if (sampleRate) backendPolicy = replaceYamlLine(backendPolicy, 'sampleRate', `      sampleRate: ${sampleRate}`);
        if (sslPolicy) gatewayPolicy = replaceYamlLine(gatewayPolicy, 'sslPolicy', `    sslPolicy: ${sslPolicy}`);

        write(resolve(outputDir, 'healthcheckpolicy.yaml'), healthcheck);
        write(resolve(outputDir, 'gcpbackendpolicy.yaml'), backendPolicy);
        write(resolve(outputDir, 'gcpgatewaypolicy.yaml'), gatewayPolicy);
        resources.push('healthcheckpolicy.yaml', 'gcpbackendpolicy.yaml', 'gcpgatewaypolicy.yaml');
      }

      if (tlsMode === 'cert-manager') {
        const certificate = read(resolve(credentialsOut, 'cert-manager.certificate.yaml'));
        write(resolve(outputDir, 'certificate.yaml'), certificate);
        resources.push('certificate.yaml');
      } else if (tlsMode === 'external-secret') {
        const tlsExternal = read(resolve(credentialsOut, 'tls.external-secret.yaml'));
        write(resolve(outputDir, 'tls.yaml'), tlsExternal);
        resources.push('tls.yaml');
      } else if (tlsMode === 'secret') {
        const tlsSecret = read(resolve(credentialsOut, 'tls.secret.yaml'));
        write(resolve(outputDir, 'tls.yaml'), tlsSecret);
        resources.push('tls.yaml');
      }
    }

    if (useKeda) {
      let apiScaled = read('ops/kubernetes/ha/providers/keda/api-scaledobject.yaml');
      let workerScaled = read('ops/kubernetes/ha/providers/keda/worker-scaledobject.yaml');
      const workerTrigger = read('ops/kubernetes/ha/providers/keda/worker-triggerauthentication.yaml');
      const apiPatch = read(resolve(profileOut, 'api-scaledobject.patch.yaml'));
      const workerPatch = read(resolve(profileOut, 'worker-scaledobject.patch.yaml'));

      for (const [key, pattern, quoted] of [
        ['pollingInterval', /pollingInterval:\s*\d+/, false],
        ['cooldownPeriod', /cooldownPeriod:\s*\d+/, false],
        ['minReplicaCount', /minReplicaCount:\s*\d+/, false],
        ['maxReplicaCount', /maxReplicaCount:\s*\d+/, false],
        ['threshold', /threshold:\s*"[^"]+"/, true],
        ['activationThreshold', /activationThreshold:\s*"[^"]+"/, true],
      ] as const) {
        const value = scalarFromYaml(apiPatch, key);
        if (value) apiScaled = replaceOne(apiScaled, pattern, quoted ? `${key}: "${value}"` : `${key}: ${value}`);
      }
      const apiFallback = scalarFromYaml(apiPatch, 'replicas');
      if (apiFallback) apiScaled = replaceOne(apiScaled, /replicas:\s*\d+/, `replicas: ${apiFallback}`);

      for (const [key, pattern, quoted] of [
        ['pollingInterval', /pollingInterval:\s*\d+/, false],
        ['cooldownPeriod', /cooldownPeriod:\s*\d+/, false],
        ['minReplicaCount', /minReplicaCount:\s*\d+/, false],
        ['maxReplicaCount', /maxReplicaCount:\s*\d+/, false],
        ['listLength', /listLength:\s*"[^"]+"/, true],
        ['activationListLength', /activationListLength:\s*"[^"]+"/, true],
      ] as const) {
        const value = scalarFromYaml(workerPatch, key);
        if (value) workerScaled = replaceOne(workerScaled, pattern, quoted ? `${key}: "${value}"` : `${key}: ${value}`);
      }
      const workerFallback = scalarFromYaml(workerPatch, 'replicas');
      if (workerFallback) workerScaled = replaceOne(workerScaled, /replicas:\s*\d+/, `replicas: ${workerFallback}`);

      write(resolve(outputDir, 'api-scaledobject.yaml'), apiScaled);
      write(resolve(outputDir, 'worker-scaledobject.yaml'), workerScaled);
      write(resolve(outputDir, 'worker-triggerauthentication.yaml'), workerTrigger);
      resources.push('api-scaledobject.yaml', 'worker-scaledobject.yaml', 'worker-triggerauthentication.yaml');
    } else {
      write(resolve(outputDir, 'api-hpa.yaml'), read('ops/kubernetes/ha/api-hpa.yaml'));
      write(resolve(outputDir, 'worker-hpa.yaml'), read('ops/kubernetes/ha/worker-hpa.yaml'));
      resources.push('api-hpa.yaml', 'worker-hpa.yaml');
    }

    write(
      resolve(outputDir, 'kustomization.yaml'),
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${namespace}
resources:
${resources.map((resource) => `  - ${resource}`).join('\n')}
`,
    );

    const summary = {
      provider,
      namespace,
      hostname,
      apiImage,
      workerImage,
      useKeda,
      runtimeSecretMode,
      tlsMode,
      resources,
    };
    write(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    write(
      resolve(outputDir, 'README.md'),
      `# Attestor HA release bundle

Generated from:

- benchmark: ${benchmarkPath}
- HA profile: ${profilePath}
- provider: ${provider}
- hostname: ${hostname}

This bundle is self-contained and meant to be applied as:

\`\`\`powershell
kubectl apply -k ${outputDir}
\`\`\`

Notes:

1. It bakes in the selected image refs, runtime-secret mode, TLS mode, and autoscaling strategy.
2. Re-render whenever traffic shape, certificate material, or cloud policy inputs change.
3. For AWS ACM mode, the bundle emits an ALB ingress instead of the base Gateway/HTTPRoute pair.
`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
