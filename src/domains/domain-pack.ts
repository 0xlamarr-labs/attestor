/**
 * Attestor Domain Pack Interface
 *
 * A domain pack is a pluggable collection of governance components for a
 * specific high-stakes analytical domain. The governance engine is domain-
 * independent; domain packs provide the domain-specific contracts, semantic
 * clauses, scoring logic, and evidence obligations.
 *
 * Architecture:
 * - Engine core: authority chain, signing, verification, reviewer endorsement
 * - Domain pack: contracts, clauses, scoring, guardrails, evidence obligations
 * - Registry: activates domain packs, routes governance through them
 */

// ─── Core Interfaces ────────────────────────────────────────────────────────

export interface DomainPack {
  /** Unique domain identifier (e.g., 'finance', 'healthcare'). */
  readonly id: string;
  /** Semantic version. */
  readonly version: string;
  /** Human-readable domain name. */
  readonly displayName: string;
  /** Short description. */
  readonly description: string;

  /** Semantic clause definitions for this domain. */
  readonly clauses: SemanticClauseDefinition[];
  /** Execution guardrail definitions. */
  readonly guardrails: GuardrailDefinition[];
  /** Evidence obligation definitions. */
  readonly evidenceObligations: EvidenceObligationDefinition[];
}

export interface SemanticClauseDefinition {
  /** Clause identifier (e.g., 'balance_identity', 'rate_bound'). */
  readonly id: string;
  /** Clause type for evaluation dispatch. */
  readonly type: string;
  /** Human-readable description. */
  readonly description: string;
  /** Severity: blocking stops acceptance, warning is advisory. */
  readonly severity: 'blocking' | 'warning' | 'info';
  /** Which domain this clause belongs to. */
  readonly domain: string;
}

export interface GuardrailDefinition {
  readonly id: string;
  readonly description: string;
  readonly domain: string;
}

export interface EvidenceObligationDefinition {
  readonly id: string;
  readonly description: string;
  /** Whether this obligation must be fulfilled for authority to be granted. */
  readonly required: boolean;
  readonly domain: string;
}

// ─── Domain Pack Registry ───────────────────────────────────────────────────

export class DomainPackRegistry {
  private packs = new Map<string, DomainPack>();

  register(pack: DomainPack): void {
    if (this.packs.has(pack.id)) {
      throw new Error(`Domain pack "${pack.id}" is already registered`);
    }
    this.packs.set(pack.id, pack);
  }

  get(domainId: string): DomainPack | undefined {
    return this.packs.get(domainId);
  }

  has(domainId: string): boolean {
    return this.packs.has(domainId);
  }

  list(): DomainPack[] {
    return [...this.packs.values()];
  }

  listIds(): string[] {
    return [...this.packs.keys()];
  }
}

/** Global registry instance. */
export const domainRegistry = new DomainPackRegistry();
