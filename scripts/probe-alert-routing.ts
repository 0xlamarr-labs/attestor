import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

type AlertLabels = Record<string, string>;

interface RouteMatcher {
  name: string;
  value: string;
}

interface RouteDefinition {
  matchers: RouteMatcher[];
  receiver: string;
  continueMatching: boolean;
}

interface ReceiverDefinition {
  name: string;
  deliveryKinds: string[];
}

interface AlertScenario {
  id: string;
  description: string;
  labels: AlertLabels;
  expectedReceivers: string[];
  requiresDelivery: boolean;
}

export interface AlertRoutingScenarioSummary {
  id: string;
  description: string;
  labels: AlertLabels;
  expectedReceivers: string[];
  actualReceivers: string[];
  matchesExpected: boolean;
  requiresDelivery: boolean;
  receiversWithoutDelivery: string[];
}

export interface AlertRoutingProbeSummary {
  productionMode: boolean;
  renderedConfigPath: string;
  rootReceiver: string;
  receivers: Array<ReceiverDefinition & { hasDelivery: boolean }>;
  scenarios: AlertRoutingScenarioSummary[];
  releaseReadiness: {
    routingValid: boolean;
    deliveryCoverageValid: boolean;
    issues: string[];
  };
}

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function renderConfig(outputPath: string): void {
  const render = spawnSync(
    process.execPath,
    ['scripts/render-alertmanager-config.mjs', outputPath],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (render.status !== 0) {
    throw new Error((render.stderr || render.stdout || 'Alertmanager render failed.').trim());
  }
}

function parseRouteMatcher(line: string): RouteMatcher | null {
  const match = line.match(/^\s*-\s+([A-Za-z0-9_]+)="([^"]*)"$/);
  if (!match) return null;
  return { name: match[1], value: match[2] };
}

function parseRenderedAlertmanagerConfig(rendered: string): {
  rootReceiver: string;
  routes: RouteDefinition[];
  receivers: ReceiverDefinition[];
} {
  const lines = rendered.split(/\r?\n/);
  const routes: RouteDefinition[] = [];
  const receivers: ReceiverDefinition[] = [];
  let rootReceiver = 'default';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === 'route:') {
      for (let inner = index + 1; inner < lines.length; inner += 1) {
        const routeLine = lines[inner];
        if (routeLine.startsWith('  receiver: ')) {
          rootReceiver = routeLine.slice('  receiver: '.length).trim();
        }
        if (routeLine === '  routes:') {
          for (let child = inner + 1; child < lines.length; child += 1) {
            const childLine = lines[child];
            if (childLine === 'inhibit_rules:') break;
            if (!childLine.startsWith('    - matchers:')) continue;
            const definition: RouteDefinition = {
              matchers: [],
              receiver: '',
              continueMatching: false,
            };
            for (let offset = child + 1; offset < lines.length; offset += 1) {
              const offsetLine = lines[offset];
              if (offsetLine.startsWith('    - matchers:') || offsetLine === 'inhibit_rules:') {
                child = offset - 1;
                break;
              }
              const matcher = parseRouteMatcher(offsetLine.trimStart());
              if (matcher) {
                definition.matchers.push(matcher);
                continue;
              }
              if (offsetLine.startsWith('      receiver: ')) {
                definition.receiver = offsetLine.slice('      receiver: '.length).trim();
                continue;
              }
              if (offsetLine.startsWith('      continue: ')) {
                definition.continueMatching = offsetLine.slice('      continue: '.length).trim() === 'true';
                continue;
              }
              if (offset === lines.length - 1) {
                child = offset;
              }
            }
            if (!definition.receiver) {
              throw new Error('Unable to parse Alertmanager route receiver.');
            }
            routes.push(definition);
          }
          break;
        }
      }
    }

    if (line === 'receivers:') {
      for (let inner = index + 1; inner < lines.length; inner += 1) {
        const receiverLine = lines[inner];
        if (!receiverLine.startsWith('  - name: ')) continue;
        const receiver: ReceiverDefinition = {
          name: receiverLine.slice('  - name: '.length).trim(),
          deliveryKinds: [],
        };
        for (let offset = inner + 1; offset < lines.length; offset += 1) {
          const offsetLine = lines[offset];
          if (offsetLine.startsWith('  - name: ')) {
            inner = offset - 1;
            break;
          }
          const trimmed = offsetLine.trim();
          if (trimmed === 'webhook_configs:') receiver.deliveryKinds.push('webhook');
          if (trimmed === 'slack_configs:') receiver.deliveryKinds.push('slack');
          if (trimmed === 'pagerduty_configs:') receiver.deliveryKinds.push('pagerduty');
          if (trimmed === 'email_configs:') receiver.deliveryKinds.push('email');
          if (offset === lines.length - 1) {
            inner = offset;
          }
        }
        receivers.push(receiver);
      }
      break;
    }
  }

  return { rootReceiver, routes, receivers };
}

function routeMatches(route: RouteDefinition, labels: AlertLabels): boolean {
  return route.matchers.every((matcher) => labels[matcher.name] === matcher.value);
}

function evaluateRoutes(rootReceiver: string, routes: RouteDefinition[], labels: AlertLabels): string[] {
  const receivers: string[] = [];
  let matchedAny = false;
  for (const route of routes) {
    if (!routeMatches(route, labels)) continue;
    matchedAny = true;
    receivers.push(route.receiver);
    if (!route.continueMatching) break;
  }
  return matchedAny ? receivers : [rootReceiver];
}

const SCENARIOS: AlertScenario[] = [
  {
    id: 'watchdog',
    description: 'Deadman signal stays on the dedicated watchdog receiver.',
    labels: { alertname: 'Watchdog', severity: 'warning' },
    expectedReceivers: ['watchdog'],
    requiresDelivery: false,
  },
  {
    id: 'critical-default',
    description: 'Critical alerts land on the critical receiver.',
    labels: { alertname: 'AttestorApiDown', severity: 'critical' },
    expectedReceivers: ['critical'],
    requiresDelivery: true,
  },
  {
    id: 'warning-default',
    description: 'Warning alerts land on the warning receiver.',
    labels: { alertname: 'AttestorHttp5xxBurst', severity: 'warning' },
    expectedReceivers: ['warning'],
    requiresDelivery: true,
  },
  {
    id: 'default-fallback',
    description: 'Non-matching alerts fall back to the default receiver.',
    labels: { alertname: 'AttestorInfo', severity: 'info' },
    expectedReceivers: ['default'],
    requiresDelivery: true,
  },
  {
    id: 'security-critical',
    description: 'Security alerts fan out into security and critical receivers.',
    labels: { alertname: 'SecurityBoundary', severity: 'critical', team: 'security' },
    expectedReceivers: ['security', 'critical'],
    requiresDelivery: false,
  },
  {
    id: 'billing-warning',
    description: 'Billing alerts fan out into billing and warning receivers.',
    labels: { alertname: 'BillingLag', severity: 'warning', team: 'billing' },
    expectedReceivers: ['billing', 'warning'],
    requiresDelivery: false,
  },
  {
    id: 'security-informational',
    description: 'Team-specific routes should not fall through to default when continue routes do not match further.',
    labels: { alertname: 'SecurityAudit', severity: 'info', team: 'security' },
    expectedReceivers: ['security'],
    requiresDelivery: false,
  },
];

export async function probeAlertRouting(options?: { outputDir?: string }): Promise<AlertRoutingProbeSummary> {
  const outputDir = resolve(options?.outputDir ?? arg('output-dir', '.attestor/observability/alert-routing/latest')!);
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-alert-routing-'));

  try {
    const renderedConfigPath = resolve(tempDir, 'alertmanager.yml');
    renderConfig(renderedConfigPath);
    const rendered = readFileSync(renderedConfigPath, 'utf8');
    const parsed = parseRenderedAlertmanagerConfig(rendered);
    const receiverMap = new Map(parsed.receivers.map((receiver) => [receiver.name, receiver]));
    const issues: string[] = [];
    const persistedConfigPath = resolve(outputDir, 'alertmanager.rendered.yml');

    const scenarios = SCENARIOS.map<AlertRoutingScenarioSummary>((scenario) => {
      const actualReceivers = evaluateRoutes(parsed.rootReceiver, parsed.routes, scenario.labels);
      const matchesExpected = JSON.stringify(actualReceivers) === JSON.stringify(scenario.expectedReceivers);
      if (!matchesExpected) {
        issues.push(`${scenario.id} resolved to [${actualReceivers.join(', ')}] instead of [${scenario.expectedReceivers.join(', ')}].`);
      }
      const receiversWithoutDelivery = actualReceivers.filter((receiverName) => {
        if (receiverName === 'watchdog') return false;
        const receiver = receiverMap.get(receiverName);
        return !receiver || receiver.deliveryKinds.length === 0;
      });
      if (scenario.requiresDelivery && receiversWithoutDelivery.length > 0) {
        issues.push(`${scenario.id} resolved to receiver(s) without delivery targets: ${receiversWithoutDelivery.join(', ')}.`);
      }
      return {
        id: scenario.id,
        description: scenario.description,
        labels: scenario.labels,
        expectedReceivers: scenario.expectedReceivers,
        actualReceivers,
        matchesExpected,
        requiresDelivery: scenario.requiresDelivery,
        receiversWithoutDelivery,
      };
    });

    const summary: AlertRoutingProbeSummary = {
      productionMode: process.env.ALERTMANAGER_PRODUCTION_MODE === 'true',
      renderedConfigPath: persistedConfigPath,
      rootReceiver: parsed.rootReceiver,
      receivers: parsed.receivers.map((receiver) => ({
        ...receiver,
        hasDelivery: receiver.deliveryKinds.length > 0,
      })),
      scenarios,
      releaseReadiness: {
        routingValid: scenarios.every((scenario) => scenario.matchesExpected),
        deliveryCoverageValid: scenarios.every((scenario) => !scenario.requiresDelivery || scenario.receiversWithoutDelivery.length === 0),
        issues,
      },
    };

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(persistedConfigPath, rendered, 'utf8');
    writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeFileSync(
      resolve(outputDir, 'README.md'),
      `# Alert routing probe

Generated from the rendered Alertmanager configuration.

- Root receiver: ${summary.rootReceiver}
- Routing valid: ${summary.releaseReadiness.routingValid}
- Delivery coverage valid: ${summary.releaseReadiness.deliveryCoverageValid}
- Production mode: ${summary.productionMode}

Scenarios:
${summary.scenarios.map((scenario) => `- ${scenario.id}: ${scenario.actualReceivers.join(' -> ')}${scenario.receiversWithoutDelivery.length ? ` (missing delivery: ${scenario.receiversWithoutDelivery.join(', ')})` : ''}`).join('\n')}
`,
      'utf8',
    );

    return summary;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const summary = await probeAlertRouting();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
