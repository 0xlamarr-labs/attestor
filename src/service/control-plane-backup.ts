/**
 * Control Plane Backup / Restore â€” first-slice operational safety tooling.
 *
 * BOUNDARY:
 * - Logical snapshot of file-backed control-plane state plus optional shared billing ledger export
 * - Intended for operator backup/restore and DR drills, not point-in-time replication
 * - Critical and ephemeral state are separated so restores do not blindly replay short-lived caches
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  exportBillingEventLedgerSnapshot,
  isBillingEventLedgerConfigured,
  restoreBillingEventLedgerSnapshot,
  type BillingEventLedgerSnapshot,
} from './billing-event-ledger.js';
import {
  exportAdminAuditLogStoreSnapshot,
  exportAsyncDeadLetterStoreSnapshot,
  exportAdminIdempotencyStoreSnapshot,
  exportAccountSessionStoreSnapshot,
  exportAccountUserActionTokenStoreSnapshot,
  exportAccountUserStoreSnapshot,
  exportHostedBillingEntitlementStoreSnapshot,
  exportStripeWebhookStoreSnapshot,
  controlPlaneStoreMode,
  controlPlaneStoreSource,
  exportHostedAccountStoreSnapshot,
  exportTenantKeyStoreSnapshot,
  exportUsageLedgerStoreSnapshot,
  restoreAdminAuditLogStoreSnapshot,
  restoreAsyncDeadLetterStoreSnapshot,
  restoreAdminIdempotencyStoreSnapshot,
  restoreAccountSessionStoreSnapshot,
  restoreAccountUserActionTokenStoreSnapshot,
  restoreAccountUserStoreSnapshot,
  restoreHostedBillingEntitlementStoreSnapshot,
  restoreStripeWebhookStoreSnapshot,
  restoreHostedAccountStoreSnapshot,
  restoreTenantKeyStoreSnapshot,
  restoreUsageLedgerStoreSnapshot,
  type AdminAuditLogStoreSnapshot,
  type AsyncDeadLetterStoreSnapshot,
  type AdminIdempotencyStoreSnapshot,
  type AccountSessionStoreSnapshot,
  type AccountUserActionTokenStoreSnapshot,
  type AccountUserStoreSnapshot,
  type BillingEntitlementStoreSnapshot,
  type HostedAccountStoreSnapshot,
  type StripeWebhookStoreSnapshot,
  type TenantKeyStoreSnapshot,
  type UsageLedgerStoreSnapshot,
} from './control-plane-store.js';

type ControlPlaneComponentTier = 'critical' | 'ephemeral' | 'shared_postgres';

interface ControlPlaneComponentSpec {
  id:
    | 'account_store'
    | 'account_user_store'
    | 'account_session_store'
    | 'account_user_action_token_store'
    | 'tenant_key_store'
    | 'usage_ledger'
    | 'billing_entitlement_store'
    | 'async_dead_letter_store'
    | 'admin_audit_log'
    | 'admin_idempotency_store'
    | 'stripe_webhook_store'
    | 'billing_event_ledger';
  tier: ControlPlaneComponentTier;
  sourcePath: string | null;
  snapshotFilename: string;
}

export interface ControlPlaneBackupManifestComponent {
  id: ControlPlaneComponentSpec['id'];
  tier: ControlPlaneComponentTier;
  sourcePath: string | null;
  snapshotPath: string | null;
  present: boolean;
  sha256: string | null;
  bytes: number | null;
  recordCount: number | null;
}

export interface ControlPlaneBackupManifest {
  version: 2;
  snapshotId: string;
  generatedAt: string;
  includeEphemeral: boolean;
  sharedControlPlaneMode: 'postgres' | 'file';
  sharedBillingLedgerConfigured: boolean;
  components: ControlPlaneBackupManifestComponent[];
}

export interface ControlPlaneBackupResult {
  snapshotDir: string;
  manifestPath: string;
  manifest: ControlPlaneBackupManifest;
}

function defaultPath(envName: string, fallback: string): string {
  return resolve(process.env[envName]?.trim() || fallback);
}

function redactedConnectionSource(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'postgres://configured';
  }
}

function componentSpecs(includeEphemeral: boolean): ControlPlaneComponentSpec[] {
  const sharedControlPlane = controlPlaneStoreMode() === 'postgres';
  const base: ControlPlaneComponentSpec[] = [
    {
      id: 'account_store',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_ACCOUNT_STORE_PATH', '.attestor/accounts.json'),
      snapshotFilename: 'account-store.json',
    },
    {
      id: 'account_user_store',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_ACCOUNT_USER_STORE_PATH', '.attestor/account-users.json'),
      snapshotFilename: 'account-user-store.json',
    },
    {
      id: 'account_session_store',
      tier: sharedControlPlane ? 'shared_postgres' : 'ephemeral',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_ACCOUNT_SESSION_STORE_PATH', '.attestor/account-sessions.json'),
      snapshotFilename: 'account-session-store.json',
    },
    {
      id: 'account_user_action_token_store',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH', '.attestor/account-user-tokens.json'),
      snapshotFilename: 'account-user-action-token-store.json',
    },
    {
      id: 'tenant_key_store',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_TENANT_KEY_STORE_PATH', '.attestor/tenant-keys.json'),
      snapshotFilename: 'tenant-key-store.json',
    },
    {
      id: 'usage_ledger',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_USAGE_LEDGER_PATH', '.attestor/usage-ledger.json'),
      snapshotFilename: 'usage-ledger.json',
    },
    {
      id: 'billing_entitlement_store',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH', '.attestor/billing-entitlements.json'),
      snapshotFilename: 'billing-entitlement-store.json',
    },
    {
      id: 'async_dead_letter_store',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_ASYNC_DLQ_STORE_PATH', '.attestor/async-dead-letter.json'),
      snapshotFilename: 'async-dead-letter-store.json',
    },
    {
      id: 'admin_audit_log',
      tier: sharedControlPlane ? 'shared_postgres' : 'critical',
      sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_ADMIN_AUDIT_LOG_PATH', '.attestor/admin-audit-log.json'),
      snapshotFilename: 'admin-audit-log.json',
    },
    {
      id: 'billing_event_ledger',
      tier: 'shared_postgres',
      sourcePath: null,
      snapshotFilename: 'billing-event-ledger.json',
    },
  ];

  if (includeEphemeral) {
    base.push(
      {
        id: 'admin_idempotency_store',
        tier: 'ephemeral',
        sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH', '.attestor/admin-idempotency.json'),
        snapshotFilename: 'admin-idempotency.json',
      },
      {
        id: 'stripe_webhook_store',
        tier: 'ephemeral',
        sourcePath: sharedControlPlane ? null : defaultPath('ATTESTOR_STRIPE_WEBHOOK_STORE_PATH', '.attestor/stripe-webhooks.json'),
        snapshotFilename: 'stripe-webhook-store.json',
      },
    );
  }

  return base;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256String(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJsonFile(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function copyCriticalFile(sourcePath: string, destinationPath: string): {
  sha256: string;
  bytes: number;
} {
  ensureDir(dirname(destinationPath));
  copyFileSync(sourcePath, destinationPath);
  return {
    sha256: sha256File(destinationPath),
    bytes: statSync(destinationPath).size,
  };
}

function snapshotSubdirForTier(tier: ControlPlaneComponentTier): string {
  switch (tier) {
    case 'critical':
      return 'critical';
    case 'ephemeral':
      return 'ephemeral';
    case 'shared_postgres':
      return 'shared';
  }
}

export async function createControlPlaneBackupSnapshot(options?: {
  snapshotDir?: string;
  includeEphemeral?: boolean;
}): Promise<ControlPlaneBackupResult> {
  const includeEphemeral = options?.includeEphemeral ?? false;
  const snapshotDir = resolve(
    options?.snapshotDir
      ?? join('.attestor', 'backups', `control-plane-${new Date().toISOString().replace(/[:.]/g, '-')}`),
  );
  if (existsSync(snapshotDir)) {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
  ensureDir(snapshotDir);

  const sharedBillingLedgerConfigured = isBillingEventLedgerConfigured();
  const components: ControlPlaneBackupManifestComponent[] = [];
  const manifest: ControlPlaneBackupManifest = {
    version: 2,
    snapshotId: `cpbak_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    includeEphemeral,
    sharedControlPlaneMode: controlPlaneStoreMode(),
    sharedBillingLedgerConfigured,
    components,
  };

  for (const component of componentSpecs(includeEphemeral)) {
    const snapshotPath = join(snapshotDir, snapshotSubdirForTier(component.tier), component.snapshotFilename);
    if (
      component.sourcePath === null &&
      (
        component.id === 'account_store'
        || component.id === 'account_user_store'
        || component.id === 'account_session_store'
        || component.id === 'account_user_action_token_store'
        || component.id === 'tenant_key_store'
        || component.id === 'usage_ledger'
        || component.id === 'billing_entitlement_store'
        || component.id === 'async_dead_letter_store'
        || component.id === 'admin_audit_log'
        || component.id === 'admin_idempotency_store'
        || component.id === 'stripe_webhook_store'
      )
    ) {
      let snapshot:
        | HostedAccountStoreSnapshot
        | AccountUserStoreSnapshot
        | AccountSessionStoreSnapshot
        | AccountUserActionTokenStoreSnapshot
        | TenantKeyStoreSnapshot
        | UsageLedgerStoreSnapshot
        | BillingEntitlementStoreSnapshot
        | AsyncDeadLetterStoreSnapshot
        | AdminAuditLogStoreSnapshot
        | AdminIdempotencyStoreSnapshot
        | StripeWebhookStoreSnapshot;
      if (component.id === 'account_store') {
        snapshot = await exportHostedAccountStoreSnapshot();
      } else if (component.id === 'account_user_store') {
        snapshot = await exportAccountUserStoreSnapshot();
      } else if (component.id === 'account_session_store') {
        snapshot = await exportAccountSessionStoreSnapshot();
      } else if (component.id === 'account_user_action_token_store') {
        snapshot = await exportAccountUserActionTokenStoreSnapshot();
      } else if (component.id === 'tenant_key_store') {
        snapshot = await exportTenantKeyStoreSnapshot();
      } else if (component.id === 'usage_ledger') {
        snapshot = await exportUsageLedgerStoreSnapshot();
      } else if (component.id === 'billing_entitlement_store') {
        snapshot = await exportHostedBillingEntitlementStoreSnapshot();
      } else if (component.id === 'async_dead_letter_store') {
        snapshot = await exportAsyncDeadLetterStoreSnapshot();
      } else if (component.id === 'admin_audit_log') {
        snapshot = await exportAdminAuditLogStoreSnapshot();
      } else if (component.id === 'admin_idempotency_store') {
        snapshot = await exportAdminIdempotencyStoreSnapshot();
      } else {
        snapshot = await exportStripeWebhookStoreSnapshot();
      }
      writeJsonFile(snapshotPath, snapshot);
      components.push({
        id: component.id,
        tier: component.tier === 'ephemeral' ? 'ephemeral' : 'shared_postgres',
        sourcePath: null,
        snapshotPath: relative(snapshotDir, snapshotPath),
        present: true,
        sha256: sha256File(snapshotPath),
        bytes: statSync(snapshotPath).size,
        recordCount: snapshot.recordCount,
      });
      continue;
    }

    if (component.id === 'billing_event_ledger') {
      if (!sharedBillingLedgerConfigured) {
        components.push({
          id: component.id,
          tier: component.tier,
          sourcePath: null,
          snapshotPath: null,
          present: false,
          sha256: null,
          bytes: null,
          recordCount: null,
        });
        continue;
      }

      const ledgerSnapshot = await exportBillingEventLedgerSnapshot();
      writeJsonFile(snapshotPath, ledgerSnapshot);
      components.push({
        id: component.id,
        tier: component.tier,
        sourcePath: redactedConnectionSource(process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim() ?? null),
        snapshotPath: relative(snapshotDir, snapshotPath),
        present: true,
        sha256: sha256File(snapshotPath),
        bytes: statSync(snapshotPath).size,
        recordCount: ledgerSnapshot.recordCount,
      });
      continue;
    }

    if (!component.sourcePath || !existsSync(component.sourcePath)) {
      components.push({
        id: component.id,
        tier: component.tier,
        sourcePath: component.sourcePath,
        snapshotPath: null,
        present: false,
        sha256: null,
        bytes: null,
        recordCount: null,
      });
      continue;
    }

    const copied = copyCriticalFile(component.sourcePath, snapshotPath);
    components.push({
      id: component.id,
      tier: component.tier,
      sourcePath: component.sourcePath,
      snapshotPath: relative(snapshotDir, snapshotPath),
      present: true,
      sha256: copied.sha256,
      bytes: copied.bytes,
      recordCount: null,
    });
  }

  const manifestPath = join(snapshotDir, 'manifest.json');
  writeJsonFile(manifestPath, manifest);

  return {
    snapshotDir,
    manifestPath,
    manifest,
  };
}

function loadManifest(snapshotDir: string): ControlPlaneBackupManifest {
  const manifestPath = join(snapshotDir, 'manifest.json');
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as
    | ControlPlaneBackupManifest
    | (Omit<ControlPlaneBackupManifest, 'version' | 'sharedControlPlaneMode'> & { version: 1 });
  if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.components)) {
    throw new Error(`Unsupported control-plane backup manifest at '${manifestPath}'.`);
  }
  if (parsed.version === 1) {
    return {
      ...parsed,
      version: 2,
      sharedControlPlaneMode: 'file',
    };
  }
  return parsed;
}

function verifySnapshotFile(snapshotDir: string, component: ControlPlaneBackupManifestComponent): string {
  if (!component.snapshotPath) {
    throw new Error(`Component '${component.id}' is marked present but has no snapshotPath.`);
  }
  const absolutePath = join(snapshotDir, component.snapshotPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Snapshot file missing for component '${component.id}': ${absolutePath}`);
  }
  if (component.sha256) {
    const actualHash = sha256File(absolutePath);
    if (actualHash !== component.sha256) {
      throw new Error(`Checksum mismatch for component '${component.id}'. Expected ${component.sha256}, got ${actualHash}.`);
    }
  }
  return absolutePath;
}

export async function restoreControlPlaneBackupSnapshot(options: {
  snapshotDir: string;
  includeEphemeral?: boolean;
  replaceExisting?: boolean;
}): Promise<{
  restoredComponents: string[];
  skippedComponents: string[];
}> {
  const snapshotDir = resolve(options.snapshotDir);
  const manifest = loadManifest(snapshotDir);
  const includeEphemeral = options.includeEphemeral ?? false;
  const restoredComponents: string[] = [];
  const skippedComponents: string[] = [];

  for (const component of manifest.components) {
    if (!component.present) {
      skippedComponents.push(component.id);
      continue;
    }
    if (component.tier === 'ephemeral' && !includeEphemeral) {
      skippedComponents.push(component.id);
      continue;
    }

    const absoluteSnapshotPath = verifySnapshotFile(snapshotDir, component);
    if (
      component.sourcePath === null &&
      (
        component.id === 'account_store'
        || component.id === 'account_user_store'
        || component.id === 'account_session_store'
        || component.id === 'account_user_action_token_store'
        || component.id === 'tenant_key_store'
        || component.id === 'usage_ledger'
        || component.id === 'billing_entitlement_store'
        || component.id === 'async_dead_letter_store'
        || component.id === 'admin_audit_log'
        || component.id === 'admin_idempotency_store'
        || component.id === 'stripe_webhook_store'
      )
    ) {
      if (controlPlaneStoreMode() !== 'postgres') {
        throw new Error(
          'Shared control-plane snapshot present, but ATTESTOR_CONTROL_PLANE_PG_URL is not configured for restore.',
        );
      }
      if (component.id === 'account_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as HostedAccountStoreSnapshot;
        await restoreHostedAccountStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'account_user_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as AccountUserStoreSnapshot;
        await restoreAccountUserStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'account_session_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as AccountSessionStoreSnapshot;
        await restoreAccountSessionStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'account_user_action_token_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as AccountUserActionTokenStoreSnapshot;
        await restoreAccountUserActionTokenStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'tenant_key_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as TenantKeyStoreSnapshot;
        await restoreTenantKeyStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'usage_ledger') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as UsageLedgerStoreSnapshot;
        await restoreUsageLedgerStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'billing_entitlement_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as BillingEntitlementStoreSnapshot;
        await restoreHostedBillingEntitlementStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'async_dead_letter_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as AsyncDeadLetterStoreSnapshot;
        await restoreAsyncDeadLetterStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'admin_audit_log') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as AdminAuditLogStoreSnapshot;
        await restoreAdminAuditLogStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else if (component.id === 'admin_idempotency_store') {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as AdminIdempotencyStoreSnapshot;
        await restoreAdminIdempotencyStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      } else {
        const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as StripeWebhookStoreSnapshot;
        await restoreStripeWebhookStoreSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      }
      restoredComponents.push(component.id);
      continue;
    }

    if (component.id === 'billing_event_ledger') {
      if (!isBillingEventLedgerConfigured()) {
        throw new Error(
          "Shared billing ledger snapshot present, but ATTESTOR_BILLING_LEDGER_PG_URL is not configured for restore.",
        );
      }
      const snapshot = JSON.parse(readFileSync(absoluteSnapshotPath, 'utf8')) as BillingEventLedgerSnapshot;
      await restoreBillingEventLedgerSnapshot(snapshot, { replaceExisting: options.replaceExisting ?? true });
      restoredComponents.push(component.id);
      continue;
    }

    if (!component.sourcePath) {
      skippedComponents.push(component.id);
      continue;
    }
    if (existsSync(component.sourcePath) && !options.replaceExisting) {
      throw new Error(
        `Refusing to overwrite existing component '${component.id}' at '${component.sourcePath}' without replaceExisting=true.`,
      );
    }
    ensureDir(dirname(component.sourcePath));
    copyFileSync(absoluteSnapshotPath, component.sourcePath);
    const restoredHash = sha256File(component.sourcePath);
    if (component.sha256 && restoredHash !== component.sha256) {
      throw new Error(`Restored checksum mismatch for component '${component.id}'.`);
    }
    restoredComponents.push(component.id);
  }

  return { restoredComponents, skippedComponents };
}

export function describeControlPlaneSnapshot(snapshotDir: string): {
  manifest: ControlPlaneBackupManifest;
  integrityHash: string;
} {
  const manifest = loadManifest(resolve(snapshotDir));
  return {
    manifest,
    integrityHash: sha256String(JSON.stringify(manifest)),
  };
}
