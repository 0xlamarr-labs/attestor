import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH,
  cryptoAuthorizationCorePublicSurface,
} from '../src/crypto-authorization-core/index.js';
import {
  CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
  cryptoExecutionAdmissionPublicSurface,
} from '../src/crypto-execution-admission/index.js';
import {
  RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH,
  RELEASE_LAYER_PUBLIC_SUBPATH,
  releaseLayerPublicSurface,
} from '../src/release-layer/index.js';
import {
  financeReleaseLayerPublicSurface,
} from '../src/release-layer/finance.js';
import {
  PROOF_SCENARIO_IDS,
  PROOF_SURFACE_DECISIONS,
  getProofScenario,
  listProofScenarioIds,
  proofScenarioRegistry,
  proofScenariosByPack,
  proofSurfaceDescriptor,
} from '../src/proof-surface/index.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

function projectFileExists(path: string): boolean {
  return existsSync(join(process.cwd(), path));
}

function readProjectFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function exportedSymbolNeedle(symbol: string): string {
  return symbol.includes('.')
    ? symbol.slice(symbol.lastIndexOf('.') + 1)
    : symbol;
}

function testDescriptorBindsExistingPublicSurfaces(): void {
  const descriptor = proofSurfaceDescriptor();
  const releaseSurface = releaseLayerPublicSurface();
  const financeSurface = financeReleaseLayerPublicSurface();
  const cryptoAuthSurface = cryptoAuthorizationCorePublicSurface();
  const cryptoAdmissionSurface = cryptoExecutionAdmissionPublicSurface();

  equal(descriptor.version, 'attestor.proof-surface.v1', 'Proof registry: descriptor version is stable');
  equal(descriptor.scenarioCount, 5, 'Proof registry: seed scenario count is intentional');
  deepEqual(descriptor.scenarioIds, PROOF_SCENARIO_IDS, 'Proof registry: descriptor exposes scenario ids');
  deepEqual(listProofScenarioIds(), PROOF_SCENARIO_IDS, 'Proof registry: listProofScenarioIds is canonical');
  equal(descriptor.publicSubpaths.releaseLayer, RELEASE_LAYER_PUBLIC_SUBPATH, 'Proof registry: release layer subpath is imported');
  equal(descriptor.publicSubpaths.finance, RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH, 'Proof registry: finance subpath is imported');
  equal(descriptor.publicSubpaths.cryptoAuthorizationCore, CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH, 'Proof registry: crypto auth subpath is imported');
  equal(descriptor.publicSubpaths.cryptoExecutionAdmission, CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH, 'Proof registry: crypto admission subpath is imported');
  equal(descriptor.publicSubpaths.releaseLayer, releaseSurface.subpaths.core, 'Proof registry: release descriptor agrees with release surface');
  equal(descriptor.publicSubpaths.finance, financeSurface.subpath, 'Proof registry: finance descriptor agrees with finance surface');
  equal(descriptor.publicSubpaths.cryptoAuthorizationCore, cryptoAuthSurface.subpath, 'Proof registry: crypto auth descriptor agrees with crypto auth surface');
  equal(descriptor.publicSubpaths.cryptoExecutionAdmission, cryptoAdmissionSurface.subpath, 'Proof registry: crypto admission descriptor agrees with crypto admission surface');
}

function testRegistryHasHumanHooksAndMachineShape(): void {
  const registry = proofScenarioRegistry();
  const ids = new Set(registry.map((scenario) => scenario.id));

  equal(ids.size, registry.length, 'Proof registry: scenario ids are unique');
  deepEqual([...ids], [...PROOF_SCENARIO_IDS], 'Proof registry: scenario order is frozen by id list');

  for (const scenario of registry) {
    ok(scenario.title.length > 10, `Proof registry: ${scenario.id} has a usable title`);
    ok(scenario.categoryEntryPoint.length > 30, `Proof registry: ${scenario.id} has a category entry point`);
    ok(scenario.plainLanguageHook.length > 30, `Proof registry: ${scenario.id} has a plain-language hook`);
    ok(scenario.proposedConsequence.action.length > 15, `Proof registry: ${scenario.id} names the proposed action`);
    ok(scenario.proposedConsequence.downstreamSystem.length > 5, `Proof registry: ${scenario.id} names the downstream system`);
    ok(PROOF_SURFACE_DECISIONS.includes(scenario.expectedDecision), `Proof registry: ${scenario.id} uses a bounded decision`);
    ok(scenario.expectedReason.length > 40, `Proof registry: ${scenario.id} explains the expected reason`);
    ok(scenario.customerValue.length > 40, `Proof registry: ${scenario.id} explains customer value`);
    ok(scenario.nonGoals.length >= 3, `Proof registry: ${scenario.id} carries non-goals`);
  }
}

function testRegistryCoversFinanceCryptoAndFailClosedOutcomes(): void {
  const finance = proofScenariosByPack('finance');
  const crypto = proofScenariosByPack('crypto');
  const general = proofScenariosByPack('general');
  const decisions = new Set(proofScenarioRegistry().map((scenario) => scenario.expectedDecision));

  equal(finance.length, 2, 'Proof registry: finance gets admit and review proof scenarios');
  equal(crypto.length, 2, 'Proof registry: crypto gets admit and block proof scenarios');
  equal(general.length, 1, 'Proof registry: general fail-closed scenario is present');
  ok(decisions.has('admit'), 'Proof registry: admit outcome is covered');
  ok(decisions.has('review'), 'Proof registry: review outcome is covered');
  ok(decisions.has('block'), 'Proof registry: block outcome is covered');
  equal(getProofScenario('finance-filing-admit').packFamily, 'finance', 'Proof registry: finance admit lookup works');
  equal(getProofScenario('crypto-delegated-eoa-block').expectedDecision, 'block', 'Proof registry: crypto block lookup works');
}

function testEveryEntryPointAndProofMaterialIsGrounded(): void {
  for (const scenario of proofScenarioRegistry()) {
    ok(scenario.entryPoints.length > 0, `Proof registry: ${scenario.id} has entry points`);
    ok(scenario.proofMaterials.length > 0, `Proof registry: ${scenario.id} has proof material`);

    for (const entryPoint of scenario.entryPoints) {
      equal(entryPoint.kind, 'package-surface', `Proof registry: ${scenario.id} starts from package surfaces`);
      ok(entryPoint.packageSubpath !== null, `Proof registry: ${scenario.id} has package subpath`);
      ok(entryPoint.note.length > 25, `Proof registry: ${scenario.id} documents the entry point note`);

      for (const sourceFile of entryPoint.sourceFiles) {
        ok(projectFileExists(sourceFile), `Proof registry: ${scenario.id} source file exists: ${sourceFile}`);
      }

      for (const exportedSymbol of entryPoint.exportedSymbols) {
        const needle = exportedSymbolNeedle(exportedSymbol);
        ok(
          entryPoint.sourceFiles.some((sourceFile) => readProjectFile(sourceFile).includes(needle)),
          `Proof registry: ${scenario.id} exported symbol is grounded: ${exportedSymbol}`,
        );
      }
    }

    for (const material of scenario.proofMaterials) {
      ok(material.label.length > 10, `Proof registry: ${scenario.id} proof material has a label`);
      ok(material.verifyHint.length > 20, `Proof registry: ${scenario.id} proof material has a verify hint`);
      if (!material.source.startsWith('npm run ')) {
        ok(projectFileExists(material.source), `Proof registry: ${scenario.id} proof material exists: ${material.source}`);
      }
    }
  }
}

function testCryptoScenariosDoNotClaimHostedRoutes(): void {
  for (const scenario of proofScenariosByPack('crypto')) {
    ok(
      scenario.nonGoals.includes('not a public hosted crypto HTTP route') ||
        scenario.entryPoints.every((entryPoint) => entryPoint.route === null),
      `Proof registry: ${scenario.id} does not claim a hosted crypto route`,
    );
    ok(
      scenario.entryPoints.some(
        (entryPoint) => entryPoint.packageSubpath === 'attestor/crypto-execution-admission',
      ),
      `Proof registry: ${scenario.id} uses packaged crypto execution admission`,
    );
  }
}

testDescriptorBindsExistingPublicSurfaces();
testRegistryHasHumanHooksAndMachineShape();
testRegistryCoversFinanceCryptoAndFailClosedOutcomes();
testEveryEntryPointAndProofMaterialIsGrounded();
testCryptoScenariosDoNotClaimHostedRoutes();

console.log(`Proof surface scenario registry tests: ${passed} passed, 0 failed`);
