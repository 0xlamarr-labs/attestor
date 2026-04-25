import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = join(fileURLToPath(new URL('..', import.meta.url)));

function readPackageJson(root = rootDir) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}

function npmCommand(scriptName) {
  return {
    label: scriptName,
    command: `npm run ${scriptName}`,
  };
}

function shellCommand(label, command) {
  return { label, command };
}

function listTestFiles(prefix, root = rootDir) {
  const testDir = join(root, 'tests');
  if (!existsSync(testDir)) return [];
  return readdirSync(testDir)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith('.test.ts'))
    .sort()
    .map((fileName) => `tsx ${relative(root, join(testDir, fileName)).replaceAll('\\', '/')}`);
}

function isPackageSurfaceProbe(scriptName) {
  return scriptName.endsWith('-package-surface');
}

function isLiveOrOpsScript(scriptName) {
  return (
    scriptName.startsWith('test:live') ||
    scriptName.startsWith('test:observability') ||
    scriptName.startsWith('test:alert') ||
    scriptName.startsWith('test:kubernetes') ||
    scriptName.startsWith('test:ha-') ||
    scriptName.startsWith('test:gke-') ||
    scriptName.startsWith('test:secret-manager') ||
    scriptName === 'test:dr-bundle' ||
    scriptName === 'test:production-readiness-packet'
  );
}

function isServiceScript(scriptName) {
  return scriptName.startsWith('test:service-');
}

function fastScriptNames(packageJson) {
  return Object.keys(packageJson.scripts)
    .filter((scriptName) => scriptName.startsWith('test:'))
    .filter((scriptName) => !isPackageSurfaceProbe(scriptName))
    .filter((scriptName) => !isLiveOrOpsScript(scriptName))
    .filter((scriptName) => !isServiceScript(scriptName));
}

function directFastTestCommands(root = rootDir) {
  const directCommands = [
    'tsx tests/account-session-cookie-security.test.ts',
    'tsx tests/proof-showcase.test.ts',
    'tsx tests/financial-reporting-acceptance-surface.test.ts',
    ...listTestFiles('release-kernel-', root),
    ...listTestFiles('release-layer-', root),
    ...listTestFiles('release-policy-control-plane-', root),
    ...listTestFiles('release-enforcement-plane-', root),
    ...listTestFiles('crypto-authorization-core-', root),
  ];
  return [...new Set(directCommands)];
}

function serviceScriptNames(packageJson) {
  return Object.keys(packageJson.scripts)
    .filter((scriptName) => isServiceScript(scriptName));
}

function packageSurfaceProbeScriptNames(packageJson) {
  return Object.keys(packageJson.scripts)
    .filter((scriptName) => isPackageSurfaceProbe(scriptName));
}

export function resolveSuite(suiteName, options = {}) {
  const root = options.root ?? rootDir;
  const packageJson = readPackageJson(root);

  if (suiteName === 'test') {
    return [
      ...fastScriptNames(packageJson).map(npmCommand),
      ...directFastTestCommands(root).map((command) => shellCommand(command, command)),
    ];
  }

  if (suiteName === 'verify') {
    return [
      shellCommand('typecheck', 'npm run typecheck'),
      ...resolveSuite('test', { root }),
      ...serviceScriptNames(packageJson).map(npmCommand),
      shellCommand('build', 'npm run build'),
      ...packageSurfaceProbeScriptNames(packageJson).map(npmCommand),
    ];
  }

  throw new Error(`Unknown suite "${suiteName}". Expected "test" or "verify".`);
}

export function runSuite(suiteName, options = {}) {
  const root = options.root ?? rootDir;
  const commands = resolveSuite(suiteName, { root });
  console.log(`[suite:${suiteName}] ${commands.length} commands`);

  for (const [index, item] of commands.entries()) {
    const ordinal = `${index + 1}/${commands.length}`.padStart(7);
    console.log(`\n[suite:${suiteName}] ${ordinal} ${item.label}`);
    const result = spawnSync(item.command, {
      cwd: root,
      shell: true,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSuite(process.argv[2] ?? 'test');
}
