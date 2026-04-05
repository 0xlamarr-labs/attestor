/**
 * Evidence Chain v1 — End-to-end linked artifact chain.
 *
 * Binds all financial run artifacts into one deterministic chain.
 * Each link: stage → artifact type → hash → previous hash.
 * The chain is verifiable: re-compute any hash and check linkage.
 */

import { createHash } from 'node:crypto';
import type { EvidenceChain, EvidenceChainLink } from './types.js';

function h(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export interface ChainInput {
  runId: string;
  inputHash: string;
  sqlHash: string;
  schemaHash: string | null;
  contractHash: string | null;
  reportHash: string | null;
  provenanceHash: string | null;
  lineageHash: string | null;
  scoringHash: string | null;
  auditHash: string | null;
  decisionHash: string;
}

export function buildEvidenceChain(input: ChainInput): EvidenceChain {
  const links: EvidenceChainLink[] = [];
  let prev = h(`chain_root:${input.runId}`);

  function addLink(stage: string, artifactType: string, hash: string | null): void {
    if (hash === null) return;
    const link: EvidenceChainLink = { stage, artifactType, hash, previousHash: prev };
    links.push(link);
    prev = h(JSON.stringify(link));
  }

  addLink('input', 'request', input.inputHash);
  addLink('sql_governance', 'sql', input.sqlHash);
  addLink('execution', 'schema', input.schemaHash);
  addLink('data_contracts', 'contract_result', input.contractHash);
  addLink('report_validation', 'report', input.reportHash);
  addLink('provenance', 'provenance', input.provenanceHash);
  addLink('lineage', 'lineage', input.lineageHash);
  addLink('scoring', 'scoring', input.scoringHash);
  addLink('audit', 'audit_trail', input.auditHash);
  addLink('decision', 'decision', input.decisionHash);

  return {
    runId: input.runId,
    links,
    rootHash: h(`chain_root:${input.runId}`),
    terminalHash: prev,
    length: links.length,
    intact: true, // chain is built deterministically, always intact on creation
  };
}

/** Verify a chain by re-computing each link hash and checking linkage. */
export function verifyEvidenceChain(chain: EvidenceChain): boolean {
  if (chain.links.length === 0) return true;
  let prev = chain.rootHash;
  for (const link of chain.links) {
    if (link.previousHash !== prev) return false;
    prev = h(JSON.stringify(link));
  }
  return prev === chain.terminalHash;
}
