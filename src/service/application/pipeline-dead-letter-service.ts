import type { AsyncDeadLetterRecord } from '../async-dead-letter-store.js';

export interface PipelineDeadLetterService {
  record(input: AsyncDeadLetterRecord): Promise<{
    record: AsyncDeadLetterRecord;
    path: string | null;
  }>;
}

export interface PipelineDeadLetterServiceDeps {
  upsertDeadLetterRecord(input: AsyncDeadLetterRecord): Promise<{
    record: AsyncDeadLetterRecord;
    path: string | null;
  }>;
}

export function createPipelineDeadLetterService(
  deps: PipelineDeadLetterServiceDeps,
): PipelineDeadLetterService {
  return {
    record(input) {
      return deps.upsertDeadLetterRecord(input);
    },
  };
}
