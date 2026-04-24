import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import {
  activationApprovals,
  auditLog,
  bundleFormat,
  bundleSigning,
  objectModel,
  types,
} from '../src/release-policy-control-plane/index.js';
import { policy } from '../src/release-layer/index.js';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  RELEASE_AUTHORITY_SCHEMA,
  getReleaseAuthorityComponent,
  withReleaseAuthorityTransaction,
} from '../src/service/release-authority-store.js';
import {
  SharedPolicyAuthorityStoreError,
  createSharedPolicyActivationApprovalStore,
  createSharedPolicyControlPlaneStore,
  createSharedPolicyMutationAuditLogWriter,
  ensureSharedPolicyActivationApprovalStore,
  ensureSharedPolicyControlPlaneStore,
  ensureSharedPolicyMutationAuditLog,
  resetSharedPolicyAuthorityStoresForTests,
} from '../src/service/release-policy-authority-store.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function actor(id: string, role = 'policy-admin') {
  return {
    id,
    type: 'user',
    displayName: id.replaceAll('_', ' '),
    role,
  } as const;
}

function bundleReference(bundleId: string) {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: bundleId.replace('bundle_', '').replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
}

function target() {
  return types.createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'account-major',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  });
}

function createSignedBundle(bundleId: string) {
  const pack = objectModel.createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    lifecycleState: 'published',
    createdAt: '2026-04-24T19:00:00.000Z',
    latestBundleRef: bundleReference(bundleId),
  });
  const activationTarget = target();
  const provisional = objectModel.createPolicyBundleEntry({
    id: `entry-${bundleId}`,
    scopeTarget: activationTarget,
    definition: policy.createFirstHardGatewayReleasePolicy(),
    policyHash: 'sha256:placeholder',
  });
  const entry = objectModel.createPolicyBundleEntry({
    id: provisional.id,
    scopeTarget: activationTarget,
    definition: policy.createFirstHardGatewayReleasePolicy(),
    policyHash: bundleFormat.computePolicyBundleEntryDigest(provisional),
  });
  const manifest = objectModel.createPolicyBundleManifest({
    bundle: bundleReference(bundleId),
    pack,
    generatedAt: '2026-04-24T19:05:00.000Z',
    entries: [entry],
  });
  const artifact = bundleFormat.createSignablePolicyBundleArtifact(pack, manifest);
  const keyPair = generateKeyPair();
  const signer = bundleSigning.createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });

  return {
    target: activationTarget,
    pack,
    manifest,
    artifact,
    signedBundle: signer.sign({
      artifact,
      signedAt: '2026-04-24T19:06:00.000Z',
    }),
    verificationKey: signer.exportVerificationKey(),
  };
}

function createActivation(bundleId: string) {
  return objectModel.createPolicyActivationRecord({
    id: `activation-${bundleId}`,
    state: 'active',
    target: target(),
    bundle: bundleReference(bundleId),
    activatedBy: actor('policy_admin'),
    activatedAt: '2026-04-24T19:15:00.000Z',
    rationale: `Activate ${bundleId}.`,
  });
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-release-policy-authority-store-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'policy_authority',
    password: 'policy_authority',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://policy_authority:policy_authority@localhost:${pgPort}/attestor_release_authority`;

    const policyStore = createSharedPolicyControlPlaneStore();
    const approvalStore = createSharedPolicyActivationApprovalStore();
    const auditWriter = createSharedPolicyMutationAuditLogWriter();

    const policySummary = await ensureSharedPolicyControlPlaneStore();
    const approvalSummary = await ensureSharedPolicyActivationApprovalStore();
    const auditSummary = await ensureSharedPolicyMutationAuditLog();
    equal(policySummary.componentStatus, 'ready', 'Shared policy store: component is marked ready');
    equal(approvalSummary.componentStatus, 'ready', 'Shared approval store: component is marked ready');
    equal(auditSummary.componentStatus, 'ready', 'Shared policy audit log: component is marked ready');

    for (const componentId of [
      'policy-control-plane-store',
      'policy-activation-approval-store',
      'policy-mutation-audit-log',
    ] as const) {
      const component = await getReleaseAuthorityComponent(componentId);
      equal(
        String(component?.metadata.trackerStep),
        '06',
        `Shared policy authority: ${componentId} records Step 06 ownership`,
      );
      equal(
        String(component?.metadata.bootstrapWired),
        'false',
        `Shared policy authority: ${componentId} keeps runtime wiring truthful`,
      );
    }

    const bundle = createSignedBundle('bundle_finance_record_2026_04_24');
    const storedBundle = await policyStore.upsertBundle({
      manifest: bundle.manifest,
      artifact: bundle.artifact,
      signedBundle: bundle.signedBundle,
    });
    await policyStore.upsertPack(bundle.pack);
    const activation = await policyStore.upsertActivation(createActivation(storedBundle.bundleId));
    await policyStore.setMetadata(
      objectModel.createPolicyControlPlaneMetadata(
        'shared',
        'scoped-active',
        storedBundle.manifest.bundle,
        activation.id,
      ),
    );

    equal(
      (await policyStore.getBundle('finance-core', storedBundle.bundleId))?.signedBundle?.keyId,
      bundle.signedBundle.keyId,
      'Shared policy store: signed bundle reloads durably',
    );
    equal((await policyStore.listBundleHistory('finance-core')).length, 1, 'Shared policy store: bundle history lists persisted bundle');
    equal((await policyStore.exportSnapshot()).activations.length, 1, 'Shared policy store: snapshot includes persisted activation');

    const inMemoryApprovalStore = activationApprovals.createInMemoryPolicyActivationApprovalStore();
    const approval = activationApprovals.requestPolicyActivationApproval(inMemoryApprovalStore, {
      id: 'approval-finance-record',
      target: bundle.target,
      bundleRecord: storedBundle,
      requestedBy: actor('requester_policy_admin'),
      requestedAt: '2026-04-24T19:20:00.000Z',
      expiresAt: '2026-04-25T19:20:00.000Z',
      rationale: 'Promote finance record policy bundle.',
    });
    await approvalStore.upsert(approval);
    equal((await approvalStore.get(approval.id))?.state, 'pending', 'Shared approval store: approval request persists');
    equal((await approvalStore.list({ state: 'pending' })).length, 1, 'Shared approval store: state filter is backed by persisted records');

    const first = await auditWriter.append({
      occurredAt: '2026-04-24T19:30:00.000Z',
      action: 'publish-bundle',
      actor: actor('policy_admin'),
      subject: auditLog.createPolicyMutationAuditSubjectFromBundle(storedBundle),
      mutationSnapshot: storedBundle.manifest,
    });
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        auditWriter.append({
          occurredAt: `2026-04-24T19:30:0${index + 1}.000Z`,
          action: 'activate-bundle',
          actor: actor(`policy_admin_${index}`),
          subject: auditLog.createPolicyMutationAuditSubjectFromActivation(activation),
          reasonCode: 'production-shared-test',
          rationale: `Concurrent audit append ${index}.`,
          mutationSnapshot: { activationId: activation.id, index },
        }),
      ),
    );
    equal(first.sequence, 1, 'Shared policy audit log: first append starts at sequence 1');
    equal(concurrent.length, 5, 'Shared policy audit log: concurrent appends complete');
    const entries = await auditWriter.entries();
    equal(entries.length, 6, 'Shared policy audit log: all entries reload durably');
    equal(entries.at(-1)?.sequence, 6, 'Shared policy audit log: advisory lock keeps sequence contiguous');
    ok((await auditWriter.verify()).valid, 'Shared policy audit log: persisted hash chain verifies');

    await withReleaseAuthorityTransaction((client) =>
      client.query(
        `UPDATE ${RELEASE_AUTHORITY_SCHEMA}.policy_mutation_audit_entries
            SET entry_json = jsonb_set(entry_json, '{reasonCode}', to_jsonb('tampered'::text))
          WHERE sequence = 1`,
      ),
    );
    await assert.rejects(
      () => auditWriter.entries(),
      SharedPolicyAuthorityStoreError,
      'Shared policy audit log: tampered persisted entry fails closed',
    );
    passed += 1;
  } finally {
    await resetSharedPolicyAuthorityStoresForTests();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    await pg.stop().catch(() => undefined);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`release-policy-authority-store tests passed (${passed} assertions)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
