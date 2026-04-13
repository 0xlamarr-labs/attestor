import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function parseBoolean(value: string): boolean | null {
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return null;
}

function inferSummaryReady(payload: unknown): boolean | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  for (const key of ['ok', 'passed', 'success']) {
    if (typeof record[key] === 'boolean') return record[key] as boolean;
  }
  for (const key of ['status', 'state', 'result']) {
    const value = record[key];
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['ok', 'pass', 'passed', 'success', 'ready', 'ready-for-environment-promotion'].includes(normalized)) return true;
      if (['fail', 'failed', 'error', 'blocked', 'blocked-on-environment-inputs'].includes(normalized)) return false;
    }
  }
  if (record.readiness && typeof record.readiness === 'object') {
    const nested = record.readiness as Record<string, unknown>;
    if (typeof nested.repoPipelineReady === 'boolean') return nested.repoPipelineReady;
    if (typeof nested.promotionGatePassed === 'boolean') return nested.promotionGatePassed;
  }
  return null;
}

export interface RepoPipelineReadiness {
  ready: boolean;
  source: 'env' | 'summary' | 'missing' | 'invalid';
  issue: string | null;
  missingInput: string | null;
  summaryPath: string | null;
}

export function resolveRepoPipelineReadiness(): RepoPipelineReadiness {
  const explicit = env('ATTESTOR_REPO_PIPELINE_READY');
  if (explicit) {
    const parsed = parseBoolean(explicit);
    if (parsed === null) {
      return {
        ready: false,
        source: 'invalid',
        issue: 'ATTESTOR_REPO_PIPELINE_READY must be a boolean-like value (true/false).',
        missingInput: null,
        summaryPath: null,
      };
    }
    return {
      ready: parsed,
      source: 'env',
      issue: parsed ? null : 'ATTESTOR_REPO_PIPELINE_READY is explicitly false, so the repo pipeline gate is not satisfied.',
      missingInput: null,
      summaryPath: null,
    };
  }

  const summaryPath = env('ATTESTOR_REPO_PIPELINE_SUMMARY_PATH');
  if (!summaryPath) {
    return {
      ready: false,
      source: 'missing',
      issue: 'Repo pipeline proof is missing. Set ATTESTOR_REPO_PIPELINE_READY=true or point ATTESTOR_REPO_PIPELINE_SUMMARY_PATH at a passing CI summary.',
      missingInput: 'ATTESTOR_REPO_PIPELINE_READY or ATTESTOR_REPO_PIPELINE_SUMMARY_PATH',
      summaryPath: null,
    };
  }

  const resolvedPath = resolve(summaryPath);
  if (!existsSync(resolvedPath)) {
    return {
      ready: false,
      source: 'invalid',
      issue: `ATTESTOR_REPO_PIPELINE_SUMMARY_PATH does not exist: ${resolvedPath}`,
      missingInput: null,
      summaryPath: resolvedPath,
    };
  }

  try {
    const summary = JSON.parse(readFileSync(resolvedPath, 'utf8')) as unknown;
    const inferred = inferSummaryReady(summary);
    if (inferred === null) {
      return {
        ready: false,
        source: 'invalid',
        issue: `ATTESTOR_REPO_PIPELINE_SUMMARY_PATH did not contain a recognizable pass/fail signal: ${resolvedPath}`,
        missingInput: null,
        summaryPath: resolvedPath,
      };
    }
    return {
      ready: inferred,
      source: 'summary',
      issue: inferred ? null : `Repo pipeline summary reports a non-passing state: ${resolvedPath}`,
      missingInput: null,
      summaryPath: resolvedPath,
    };
  } catch (error) {
    return {
      ready: false,
      source: 'invalid',
      issue: `ATTESTOR_REPO_PIPELINE_SUMMARY_PATH could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      missingInput: null,
      summaryPath: resolvedPath,
    };
  }
}
