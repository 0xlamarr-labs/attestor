import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { probeAlertRouting } from '../scripts/probe-alert-routing.ts';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-alert-routing-probe-'));
  const previous = {
    ALERTMANAGER_DEFAULT_WEBHOOK_URL: process.env.ALERTMANAGER_DEFAULT_WEBHOOK_URL,
    ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY: process.env.ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY,
    ALERTMANAGER_WARNING_WEBHOOK_URL: process.env.ALERTMANAGER_WARNING_WEBHOOK_URL,
    ALERTMANAGER_SECURITY_WEBHOOK_URL: process.env.ALERTMANAGER_SECURITY_WEBHOOK_URL,
    ALERTMANAGER_BILLING_WEBHOOK_URL: process.env.ALERTMANAGER_BILLING_WEBHOOK_URL,
    ALERTMANAGER_PRODUCTION_MODE: process.env.ALERTMANAGER_PRODUCTION_MODE,
  };

  try {
    process.env.ALERTMANAGER_DEFAULT_WEBHOOK_URL = 'https://alerts.example.invalid/default';
    process.env.ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY = 'pagerduty-key';
    process.env.ALERTMANAGER_WARNING_WEBHOOK_URL = 'https://alerts.example.invalid/warning';
    process.env.ALERTMANAGER_SECURITY_WEBHOOK_URL = 'https://alerts.example.invalid/security';
    process.env.ALERTMANAGER_BILLING_WEBHOOK_URL = 'https://alerts.example.invalid/billing';
    process.env.ALERTMANAGER_PRODUCTION_MODE = 'true';

    const ready = await probeAlertRouting({
      outputDir: resolve(tempDir, 'ready'),
    });
    ok(ready.releaseReadiness.routingValid === true, 'Alert routing probe: routing graph matches expected receiver fanout');
    ok(ready.releaseReadiness.deliveryCoverageValid === true, 'Alert routing probe: required delivery routes have backing receivers');
    ok(ready.scenarios.find((scenario) => scenario.id === 'critical-default')?.actualReceivers.join(',') === 'critical', 'Alert routing probe: critical alerts resolve to the critical receiver');
    ok(ready.scenarios.find((scenario) => scenario.id === 'warning-default')?.actualReceivers.join(',') === 'warning', 'Alert routing probe: warning alerts resolve to the warning receiver');
    ok(ready.scenarios.find((scenario) => scenario.id === 'default-fallback')?.actualReceivers.join(',') === 'default', 'Alert routing probe: unmatched alerts fall back to default');
    ok(ready.scenarios.find((scenario) => scenario.id === 'security-critical')?.actualReceivers.join(',') === 'security,critical', 'Alert routing probe: security critical alerts fan out through continue routes');
    ok(ready.scenarios.find((scenario) => scenario.id === 'billing-warning')?.actualReceivers.join(',') === 'billing,warning', 'Alert routing probe: billing warning alerts fan out through continue routes');
    ok(ready.scenarios.find((scenario) => scenario.id === 'security-informational')?.actualReceivers.join(',') === 'security', 'Alert routing probe: team routes do not fall back to default after a continue chain ends');

    delete process.env.ALERTMANAGER_WARNING_WEBHOOK_URL;
    let missingWarningFailed = false;
    try {
      await probeAlertRouting({
        outputDir: resolve(tempDir, 'missing-warning'),
      });
    } catch (error) {
      missingWarningFailed = error instanceof Error && error.message.includes('warning alert routing');
    }
    ok(missingWarningFailed, 'Alert routing probe: missing warning delivery now fails fast at render time');

    console.log(`\nAlert routing probe tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error('\nAlert routing probe tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
