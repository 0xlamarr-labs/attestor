import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_ROOT = join(process.cwd(), 'src', 'service');

function collectTypeScriptFiles(root: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith('.ts')) {
      results.push(fullPath);
    }
  }

  return results;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function testServiceLayerUsesReleaseLayerSurface(): void {
  const offenders = collectTypeScriptFiles(SERVICE_ROOT)
    .map((filePath) => ({
      filePath,
      contents: readFileSync(filePath, 'utf8'),
    }))
    .filter(({ contents }) => contents.includes('release-kernel/'))
    .map(({ filePath }) => normalizePath(filePath));

  assert.deepEqual(
    offenders,
    [],
    `service layer should consume the release-layer surface instead of direct release-kernel imports: ${offenders.join(', ')}`,
  );
}

testServiceLayerUsesReleaseLayerSurface();

console.log('Release layer service adoption tests: 1 passed, 0 failed');
