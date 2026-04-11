import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type Provider = 'generic' | 'grafana-cloud' | 'grafana-alloy';
type SecretMode = 'secret' | 'external-secret';

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
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

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function replaceAll(contents: string, search: string | RegExp, replacement: string): string {
  return contents.replace(search, replacement);
}

function replaceYamlScalar(contents: string, key: string, replacementLine: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(\\s*${escaped}:).*$`, 'm');
  if (!pattern.test(contents)) throw new Error(`Expected replacement did not match: ${key}`);
  return contents.replace(pattern, replacementLine);
}

function replaceNamespace(contents: string, namespace: string): string {
  return replaceAll(contents, /^(\s*namespace:\s*).*$/gm, `$1${namespace}`);
}

function replaceFirst(contents: string, pattern: RegExp, replacement: string): string {
  if (!pattern.test(contents)) {
    throw new Error(`Expected replacement did not match: ${pattern}`);
  }
  return contents.replace(pattern, replacement);
}

function runNode(script: string, args: string[], envVars: NodeJS.ProcessEnv): void {
  const run = spawnSync(process.execPath, [resolve(script), ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: envVars,
  });
  if (run.status !== 0) {
    throw new Error(`${script} failed.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  }
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
  const provider = (arg('provider', env('ATTESTOR_OBSERVABILITY_PROVIDER') ?? 'grafana-alloy') as Provider);
  if (!['generic', 'grafana-cloud', 'grafana-alloy'].includes(provider)) {
    throw new Error('provider must be one of generic, grafana-cloud, grafana-alloy');
  }

  const benchmarkPath = required(arg('benchmark', env('ATTESTOR_OBSERVABILITY_BENCHMARK_PATH')), '--benchmark');
  const profilePath = arg(
    'profile',
    env('ATTESTOR_OBSERVABILITY_PROFILE_PATH') ?? 'ops/observability/profiles/regulated-production.json',
  )!;
  const outputDir = resolve(arg('output-dir', `.attestor/observability/release/${provider}`)!);
  const namespace = env('ATTESTOR_OBSERVABILITY_NAMESPACE') ?? 'attestor-observability';
  const collectorImage = env('ATTESTOR_OBSERVABILITY_COLLECTOR_IMAGE')
    ?? (provider === 'grafana-alloy' ? 'grafana/alloy:latest' : 'otel/opentelemetry-collector-contrib:latest');
  const imagePullPolicy = env('ATTESTOR_OBSERVABILITY_COLLECTOR_IMAGE_PULL_POLICY') ?? 'IfNotPresent';
  const tempoEndpoint = env('ATTESTOR_OBSERVABILITY_TEMPO_OTLP_ENDPOINT') ?? 'tempo.monitoring.svc.cluster.local:4317';
  const lokiEndpoint = env('ATTESTOR_OBSERVABILITY_LOKI_OTLP_ENDPOINT') ?? 'http://loki.monitoring.svc.cluster.local:3100/otlp';
  const secretMode = (arg(
    'secret-mode',
    env('ATTESTOR_OBSERVABILITY_SECRET_MODE') ?? ((provider === 'grafana-cloud' || provider === 'grafana-alloy') ? 'external-secret' : 'secret'),
  ) as SecretMode);
  if (!['secret', 'external-secret'].includes(secretMode)) {
    throw new Error('secret-mode must be one of secret, external-secret');
  }
  const externalSecretStore = env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE');
  const externalSecretStoreKind = env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE_KIND') ?? 'ClusterSecretStore';
  const externalSecretRefreshInterval = env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_REFRESH_INTERVAL') ?? '1h';
  const externalSecretCreationPolicy = env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_CREATION_POLICY') ?? 'Owner';
  const externalSecretDeletionPolicy = env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_DELETION_POLICY');

  const tempRoot = mkdtempSync(resolve(tmpdir(), 'attestor-observability-release-'));
  const profileOut = resolve(tempRoot, 'profile');
  const credentialsOut = resolve(tempRoot, 'credentials');
  const alertmanagerOut = resolve(tempRoot, 'alertmanager.generated.yml');

  try {
    runTsx(
      'scripts/render-observability-profile.ts',
      [`--input=${benchmarkPath}`, `--profile=${profilePath}`, `--output-dir=${profileOut}`],
      process.env,
    );
    runTsx(
      'scripts/render-observability-credentials.ts',
      [`--output-dir=${credentialsOut}`],
      process.env,
    );
    runNode('scripts/render-alertmanager-config.mjs', [alertmanagerOut], process.env);

    const profileSummary = JSON.parse(read(resolve(profileOut, 'summary.json'))) as {
      profile: { name: string };
      retention: { prometheusDays: number; lokiHours: number; tempoHours: number };
    };
    const credentialSummary = JSON.parse(read(resolve(credentialsOut, 'summary.json'))) as {
      grafanaCloud: { configured: boolean };
      alertmanager: { configuredKeys: string[] };
    };

    if ((provider === 'grafana-cloud' || provider === 'grafana-alloy') && !credentialSummary.grafanaCloud.configured) {
      throw new Error('Grafana Cloud providers require GRAFANA_CLOUD_OTLP_* credentials.');
    }

    mkdirSync(outputDir, { recursive: true });

    let namespaceYaml = read('ops/kubernetes/observability/namespace.yaml');
    let serviceAccount = read('ops/kubernetes/observability/serviceaccount.yaml');
    let clusterRole = read('ops/kubernetes/observability/clusterrole.yaml');
    let clusterRoleBinding = read('ops/kubernetes/observability/clusterrolebinding.yaml');
    let configmap = (provider === 'grafana-cloud' || provider === 'grafana-alloy')
      ? read(`ops/kubernetes/observability/providers/${provider}/patch-configmap.yaml`)
      : read('ops/kubernetes/observability/configmap.yaml');
    let deployment = read('ops/kubernetes/observability/deployment.yaml');
    let service = read('ops/kubernetes/observability/service.yaml');
    let hpa = read('ops/kubernetes/observability/hpa.yaml');
    let pdb = read('ops/kubernetes/observability/pdb.yaml');

    namespaceYaml = replaceYamlScalar(namespaceYaml, 'name', `  name: ${namespace}`);
    serviceAccount = replaceNamespace(serviceAccount, namespace);
    clusterRoleBinding = replaceAll(clusterRoleBinding, /namespace:\s*attestor-observability/g, `namespace: ${namespace}`);
    configmap = replaceNamespace(configmap, namespace);
    deployment = replaceNamespace(deployment, namespace);
    service = replaceNamespace(service, namespace);
    hpa = replaceNamespace(hpa, namespace);
    pdb = replaceNamespace(pdb, namespace);

    deployment = replaceAll(
      deployment,
      /image:\s*otel\/opentelemetry-collector-contrib:latest/,
      `image: ${collectorImage}`,
    );
    if (imagePullPolicy !== 'IfNotPresent') {
      deployment = replaceAll(deployment, /imagePullPolicy:\s*\S+/, `imagePullPolicy: ${imagePullPolicy}`);
    }

    if (provider === 'generic') {
      deployment = replaceAll(deployment, /value:\s*tempo\.monitoring\.svc\.cluster\.local:4317/, `value: ${tempoEndpoint}`);
      deployment = replaceAll(
        deployment,
        /value:\s*http:\/\/loki\.monitoring\.svc\.cluster\.local:3100\/otlp/,
        `value: ${lokiEndpoint}`,
      );
    } else {
      const secretEnvBlock = `          env:
            - name: GRAFANA_CLOUD_OTLP_ENDPOINT
              valueFrom:
                secretKeyRef:
                  name: attestor-otel-gateway-grafana-cloud
                  key: grafana-cloud-otlp-endpoint
            - name: GRAFANA_CLOUD_OTLP_USERNAME
              valueFrom:
                secretKeyRef:
                  name: attestor-otel-gateway-grafana-cloud
                  key: grafana-cloud-otlp-username
            - name: GRAFANA_CLOUD_OTLP_TOKEN
              valueFrom:
                secretKeyRef:
                  name: attestor-otel-gateway-grafana-cloud
                  key: grafana-cloud-otlp-token`;
      deployment = deployment.replace(
        /          env:\n(?:            - name: TEMPO_OTLP_ENDPOINT[\s\S]*?)          ports:/,
        `${secretEnvBlock}\n          ports:`,
      );
      if (provider === 'grafana-alloy') {
        deployment = replaceFirst(
          deployment,
          /        - name: otel-collector\r?\n          image: .*?\r?\n/,
          `        - name: otel-collector\n          image: ${collectorImage}\n          command:\n            - bin/otelcol\n`,
        );
      }
    }

    write(resolve(outputDir, 'namespace.yaml'), namespaceYaml);
    write(resolve(outputDir, 'serviceaccount.yaml'), serviceAccount);
    write(resolve(outputDir, 'clusterrole.yaml'), clusterRole);
    write(resolve(outputDir, 'clusterrolebinding.yaml'), clusterRoleBinding);
    write(resolve(outputDir, 'configmap.yaml'), configmap);
    write(resolve(outputDir, 'deployment.yaml'), deployment);
    write(resolve(outputDir, 'service.yaml'), service);
    write(resolve(outputDir, 'hpa.yaml'), hpa);
    write(resolve(outputDir, 'pdb.yaml'), pdb);

    const resources = [
      'namespace.yaml',
      'serviceaccount.yaml',
      'clusterrole.yaml',
      'clusterrolebinding.yaml',
      'configmap.yaml',
      'deployment.yaml',
      'service.yaml',
      'hpa.yaml',
      'pdb.yaml',
    ];

    if (provider === 'grafana-cloud' || provider === 'grafana-alloy') {
      if (secretMode === 'external-secret') {
        let external = read('ops/kubernetes/observability/providers/external-secrets/grafana-cloud-external-secret.yaml');
        external = replaceNamespace(external, namespace);
        external = replaceFirst(external, /refreshInterval:\s*\S+/, `refreshInterval: ${externalSecretRefreshInterval}`);
        external = replaceFirst(external, /kind:\s*ClusterSecretStore/, `kind: ${externalSecretStoreKind}`);
        external = replaceFirst(external, /creationPolicy:\s*\S+/, `creationPolicy: ${externalSecretCreationPolicy}`);
        if (externalSecretStore) {
          external = replaceFirst(external, /name:\s*REPLACE_WITH_CLUSTER_SECRET_STORE/, `name: ${externalSecretStore}`);
        }
        if (externalSecretDeletionPolicy) {
          external = external.includes('deletionPolicy:')
            ? replaceFirst(external, /deletionPolicy:\s*\S+/, `deletionPolicy: ${externalSecretDeletionPolicy}`)
            : external.replace(/creationPolicy:\s*\S+/, `creationPolicy: ${externalSecretCreationPolicy}\n    deletionPolicy: ${externalSecretDeletionPolicy}`);
        }
        write(resolve(outputDir, 'grafana-cloud.external-secret.yaml'), external);
        resources.push('grafana-cloud.external-secret.yaml');
      } else {
        let secret = read(resolve(credentialsOut, 'grafana-cloud.secret.yaml'));
        secret = replaceNamespace(secret, namespace);
        write(resolve(outputDir, 'grafana-cloud.secret.yaml'), secret);
        resources.push('grafana-cloud.secret.yaml');
      }
    }

    if (credentialSummary.alertmanager.configuredKeys.length > 0) {
      if (secretMode === 'external-secret') {
        let alertExternal = read('ops/kubernetes/observability/providers/external-secrets/alertmanager-routing-external-secret.yaml');
        alertExternal = replaceNamespace(alertExternal, namespace);
        alertExternal = replaceFirst(alertExternal, /refreshInterval:\s*\S+/, `refreshInterval: ${externalSecretRefreshInterval}`);
        alertExternal = replaceFirst(alertExternal, /kind:\s*ClusterSecretStore/, `kind: ${externalSecretStoreKind}`);
        alertExternal = replaceFirst(alertExternal, /creationPolicy:\s*\S+/, `creationPolicy: ${externalSecretCreationPolicy}`);
        if (externalSecretStore) {
          alertExternal = replaceFirst(alertExternal, /name:\s*REPLACE_WITH_CLUSTER_SECRET_STORE/, `name: ${externalSecretStore}`);
        }
        if (externalSecretDeletionPolicy) {
          alertExternal = alertExternal.includes('deletionPolicy:')
            ? replaceFirst(alertExternal, /deletionPolicy:\s*\S+/, `deletionPolicy: ${externalSecretDeletionPolicy}`)
            : alertExternal.replace(/creationPolicy:\s*\S+/, `creationPolicy: ${externalSecretCreationPolicy}\n    deletionPolicy: ${externalSecretDeletionPolicy}`);
        }
        write(resolve(outputDir, 'alertmanager-routing.external-secret.yaml'), alertExternal);
        resources.push('alertmanager-routing.external-secret.yaml');
      } else {
        let alertSecret = read(resolve(credentialsOut, 'alertmanager-routing.secret.yaml'));
        alertSecret = replaceNamespace(alertSecret, namespace);
        write(resolve(outputDir, 'alertmanager-routing.secret.yaml'), alertSecret);
        resources.push('alertmanager-routing.secret.yaml');
      }
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

    write(resolve(outputDir, 'recording-rules.generated.yml'), read(resolve(profileOut, 'recording-rules.generated.yml')));
    write(resolve(outputDir, 'alerts.generated.yml'), read(resolve(profileOut, 'alerts.generated.yml')));
    write(resolve(outputDir, 'retention.env'), read(resolve(profileOut, 'retention.env')));
    write(resolve(outputDir, 'profile-summary.json'), read(resolve(profileOut, 'summary.json')));
    write(resolve(outputDir, 'credential-summary.json'), read(resolve(credentialsOut, 'summary.json')));
    write(resolve(outputDir, 'alertmanager.generated.yml'), read(alertmanagerOut));

    const summary = {
      provider,
      runtimeEngine: provider === 'grafana-alloy' ? 'grafana-alloy-otel' : 'upstream-otelcol',
      namespace,
      secretMode,
      collectorImage,
      profile: profileSummary.profile.name,
      grafanaCloudConfigured: credentialSummary.grafanaCloud.configured,
      alertmanagerConfigured: credentialSummary.alertmanager.configuredKeys.length > 0,
      externalSecretPolicy:
        secretMode === 'external-secret'
          ? {
            storeKind: externalSecretStoreKind,
            refreshInterval: externalSecretRefreshInterval,
            creationPolicy: externalSecretCreationPolicy,
            deletionPolicy: externalSecretDeletionPolicy ?? null,
          }
          : null,
      resources,
      retention: profileSummary.retention,
    };
    write(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    write(
      resolve(outputDir, 'README.md'),
      `# Attestor observability release bundle

Generated from:

- benchmark: ${benchmarkPath}
- profile: ${profilePath}
- provider: ${provider}
- runtime engine: ${provider === 'grafana-alloy' ? 'Grafana Alloy OTel Engine' : 'upstream OpenTelemetry Collector'}
- secret mode: ${secretMode}

This bundle includes:

1. A Kubernetes collector gateway rollout (\`kustomization.yaml\` + resources).
2. Rendered SLO tuning artifacts (\`recording-rules.generated.yml\`, \`alerts.generated.yml\`, \`retention.env\`).
3. A rendered Alertmanager config (\`alertmanager.generated.yml\`).
4. Provider/credential summaries for auditability.

Apply the gateway bundle with:

\`\`\`powershell
kubectl apply -k ${outputDir}
\`\`\`

Then feed the generated alert/rule/retention artifacts into the managed or local observability backend workflow.
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
