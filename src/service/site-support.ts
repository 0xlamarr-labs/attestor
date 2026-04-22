import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import {
  financialReportingEvidenceRoot,
  loadCommittedFinancialReportingPacket,
} from './site.js';

export function committedEvidenceContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case '.json':
      return 'application/json; charset=utf-8';
    case '.pem':
    case '.md':
      return 'text/plain; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export function readCommittedEvidence(
  relativePath: string,
): { path: string; content: string } | null {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/u, '');
  const safeSegments = normalized
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..');
  const baseDir = financialReportingEvidenceRoot();
  const resolvedPath = resolve(baseDir, ...safeSegments);
  if (!resolvedPath.startsWith(baseDir) || !existsSync(resolvedPath)) return null;
  return {
    path: resolvedPath,
    content: readFileSync(resolvedPath, 'utf8'),
  };
}

export const committedFinancialPacket = loadCommittedFinancialReportingPacket();
