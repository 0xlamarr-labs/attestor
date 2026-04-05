/**
 * Structured logger for Attestor pipeline.
 * All output goes to stderr so stdout remains clean for CLI output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: '  ·',
  info: '  ▸',
  warn: '  ⚠',
  error: '  ✗',
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function log(level: LogLevel, stage: string, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const time = new Date().toISOString().slice(11, 23);
  const prefix = LEVEL_PREFIX[level];
  const stageTag = stage ? `[${stage}]` : '';

  let line = `${time} ${prefix} ${stageTag} ${message}`;
  if (data) {
    const compact = JSON.stringify(data, null, 0);
    if (compact.length < 200) {
      line += ` ${compact}`;
    }
  }

  process.stderr.write(line + '\n');
}

export const logger = {
  debug: (stage: string, msg: string, data?: Record<string, unknown>) => log('debug', stage, msg, data),
  info: (stage: string, msg: string, data?: Record<string, unknown>) => log('info', stage, msg, data),
  warn: (stage: string, msg: string, data?: Record<string, unknown>) => log('warn', stage, msg, data),
  error: (stage: string, msg: string, data?: Record<string, unknown>) => log('error', stage, msg, data),
};
