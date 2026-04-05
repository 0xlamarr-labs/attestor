/**
 * Error types for Attestor pipeline.
 */

export class AttestorError extends Error {
  constructor(
    public readonly stage: string,
    message: string,
    public readonly recoverable: boolean = false,
  ) {
    super(`[${stage}] ${message}`);
    this.name = 'AttestorError';
  }
}

export class ApiError extends AttestorError {
  constructor(
    stage: string,
    public readonly provider: 'openai' | 'anthropic',
    message: string,
    public readonly statusCode?: number,
  ) {
    super(stage, `${provider} API: ${message}`, true);
    this.name = 'ApiError';
  }
}

export class ParseError extends AttestorError {
  constructor(stage: string, message: string, public readonly rawContent?: string) {
    super(stage, `Failed to parse response: ${message}`, false);
    this.name = 'ParseError';
  }
}
