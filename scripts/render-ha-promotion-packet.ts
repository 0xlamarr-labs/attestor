import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { probeHaReleaseInputs } from './probe-ha-release-inputs.ts';
import { resolveRepoPipelineReadiness } from './repo-pipeline-readiness.ts';

type Provider = 'generic' | 'aws' | 'gke';

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
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

function formatChecklist(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function detectMissingInputs(provider: Provider, tlsMode: string): string[] {
  const missing: string[] = [];
  const requireOne = (name: string): void => {
    if (!env(name) && !env(`${name}_FILE`)) missing.push(name);
  };

  requireOne('ATTESTOR_API_IMAGE');
  requireOne('ATTESTOR_WORKER_IMAGE');
  requireOne('ATTESTOR_PUBLIC_HOSTNAME');
  requireOne('REDIS_URL');
  requireOne('ATTESTOR_CONTROL_PLANE_PG_URL');
  requireOne('ATTESTOR_BILLING_LEDGER_PG_URL');
  requireOne('ATTESTOR_ADMIN_API_KEY');
  requireOne('ATTESTOR_METRICS_API_KEY');
  requireOne('ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY');
  if (env('ATTESTOR_PUBLIC_HOSTNAME')) {
    requireOne('STRIPE_API_KEY');
    requireOne('STRIPE_WEBHOOK_SECRET');
    requireOne('ATTESTOR_STRIPE_PRICE_STARTER');
    requireOne('ATTESTOR_STRIPE_PRICE_PRO');
    requireOne('ATTESTOR_STRIPE_PRICE_ENTERPRISE');
    requireOne('ATTESTOR_BILLING_SUCCESS_URL');
    requireOne('ATTESTOR_BILLING_CANCEL_URL');
    requireOne('ATTESTOR_BILLING_PORTAL_RETURN_URL');
  }

  if (tlsMode === 'secret') {
    requireOne('ATTESTOR_TLS_CERT_PEM');
    requireOne('ATTESTOR_TLS_KEY_PEM');
  }
  if (tlsMode === 'cert-manager') {
    requireOne('ATTESTOR_TLS_CLUSTER_ISSUER');
  }
  if (provider === 'aws' && tlsMode === 'aws-acm') {
    requireOne('ATTESTOR_AWS_ALB_CERTIFICATE_ARNS');
  }
  if ((env('ATTESTOR_HA_RUNTIME_SECRET_MODE') ?? '') === 'external-secret' || tlsMode === 'external-secret') {
    requireOne('ATTESTOR_HA_SECRET_STORE');
  }
  if (env('ATTESTOR_HOSTED_OIDC_ISSUER_URL') && env('ATTESTOR_HOSTED_OIDC_CLIENT_ID')) {
    requireOne('ATTESTOR_HOSTED_OIDC_STATE_KEY');
  }
  if (env('ATTESTOR_HOSTED_SAML_IDP_METADATA_XML') || env('ATTESTOR_HOSTED_SAML_IDP_METADATA_PATH')) {
    requireOne('ATTESTOR_HOSTED_SAML_RELAY_STATE_KEY');
    if (/^(1|true|yes|on)$/i.test(env('ATTESTOR_HOSTED_SAML_SIGN_AUTHN_REQUESTS') ?? '')) {
      requireOne('ATTESTOR_HOSTED_SAML_SP_PRIVATE_KEY');
      requireOne('ATTESTOR_HOSTED_SAML_SP_CERT');
    }
  }

  return missing;
}

export interface HaPromotionPacket {
  provider: Provider;
  tlsMode: string;
  benchmarkPath: string;
  benchmark: {
    requestsPerSecond: number;
    p95LatencyMs: number;
    successRate: number | null;
  };
  readiness: {
    repoPipelineReady: boolean;
    environmentInputsComplete: boolean;
    promotionGatePassed: boolean;
    state: 'ready-for-environment-promotion' | 'blocked-on-environment-inputs';
    issues: string[];
    missingInputs: string[];
  };
  artifacts: {
    releaseBundleDir: string;
    releaseSummaryPath: string | null;
    promotionReadmePath: string;
  };
  probe: Awaited<ReturnType<typeof probeHaReleaseInputs>>;
}

export async function renderHaPromotionPacket(options?: {
  provider?: Provider;
  benchmarkPath?: string;
  outputDir?: string;
}): Promise<HaPromotionPacket> {
  const provider = (options?.provider ?? arg('provider', env('ATTESTOR_HA_PROVIDER') ?? 'gke')) as Provider;
  const benchmarkPath = resolve(options?.benchmarkPath ?? arg('benchmark', env('ATTESTOR_HA_BENCHMARK_PATH')) ?? '');
  if (!benchmarkPath) throw new Error('--benchmark or ATTESTOR_HA_BENCHMARK_PATH is required.');
  const outputDir = resolve(options?.outputDir ?? arg('output-dir', '.attestor/ha/promotion/latest')!);
  const tlsMode = env('ATTESTOR_TLS_MODE') ?? 'secret';
  const releaseBundleDir = resolve(outputDir, 'release-bundle');

  const benchmark = readJson<{ requestsPerSecond: number; p95LatencyMs: number; successRate?: number }>(benchmarkPath);
  const probe = await probeHaReleaseInputs({ provider, benchmarkPath });
  const repoPipeline = resolveRepoPipelineReadiness();
  const missingInputs = detectMissingInputs(provider, tlsMode);
  if (repoPipeline.missingInput) missingInputs.push(repoPipeline.missingInput);
  const issues = [...new Set([
    ...probe.rolloutReadiness.issues,
    ...missingInputs.map((item) => `${item} is still missing.`),
    ...(repoPipeline.issue ? [repoPipeline.issue] : []),
  ])];
  const environmentInputsComplete = missingInputs.length === 0 && probe.rolloutReadiness.envComplete;
  const promotionGatePassed = probe.rolloutReadiness.bundleRenderSucceeded && probe.rolloutReadiness.connectivityProbeSucceeded;

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(releaseBundleDir, { recursive: true });

  let releaseSummaryPath: string | null = null;
  if (environmentInputsComplete) {
    runTsx(
      'scripts/render-ha-release-bundle.ts',
      [`--provider=${provider}`, `--benchmark=${benchmarkPath}`, `--output-dir=${releaseBundleDir}`],
      process.env,
    );
    releaseSummaryPath = resolve(releaseBundleDir, 'summary.json');
  } else {
    writeFileSync(
      resolve(releaseBundleDir, 'README.md'),
      `# Release bundle skipped

The HA release bundle was not rendered because required production inputs are still missing.

Missing inputs:
${formatChecklist(missingInputs)}
`,
      'utf8',
    );
  }

  const packet: HaPromotionPacket = {
    provider,
    tlsMode,
    benchmarkPath,
    benchmark: {
      requestsPerSecond: benchmark.requestsPerSecond,
      p95LatencyMs: benchmark.p95LatencyMs,
      successRate: benchmark.successRate ?? null,
    },
    readiness: {
      repoPipelineReady: repoPipeline.ready,
      environmentInputsComplete,
      promotionGatePassed,
      state: repoPipeline.ready && environmentInputsComplete && promotionGatePassed
        ? 'ready-for-environment-promotion'
        : 'blocked-on-environment-inputs',
      issues,
      missingInputs,
    },
    artifacts: {
      releaseBundleDir,
      releaseSummaryPath,
      promotionReadmePath: resolve(outputDir, 'README.md'),
    },
    probe,
  };

  writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  writeFileSync(
    resolve(outputDir, 'README.md'),
    `# Attestor HA promotion packet

Generated from:

- benchmark: ${benchmarkPath}
- provider: ${provider}
- tls mode: ${tlsMode}

Readiness:

- repo pipeline ready: ${packet.readiness.repoPipelineReady}
- environment inputs complete: ${packet.readiness.environmentInputsComplete}
- promotion gate passed: ${packet.readiness.promotionGatePassed}
- state: ${packet.readiness.state}

Missing inputs:
${formatChecklist(packet.readiness.missingInputs)}

Issues:
${formatChecklist(packet.readiness.issues)}

Recommended apply flow:

1. Review \`${releaseBundleDir}\`
2. ${environmentInputsComplete ? `Apply the bundle: \`kubectl apply -k ${releaseBundleDir}\`` : 'Load the missing inputs listed above and re-render the promotion packet'}
3. Run \`npm run probe:ha-release-inputs -- --provider=${provider} --benchmark=${benchmarkPath}\`
4. Re-run this promotion packet generator and archive \`${resolve(outputDir, 'summary.json')}\` as the rollout checkpoint
`,
    'utf8',
  );

  return packet;
}

async function main(): Promise<void> {
  const packet = await renderHaPromotionPacket();
  console.log(JSON.stringify(packet, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
