export const ATTESTOR_RUNTIME_PROFILE_ENV = 'ATTESTOR_RUNTIME_PROFILE';

export type AttestorRuntimeProfileId =
  | 'local-dev'
  | 'single-node-durable'
  | 'production-shared';

export type ReleaseRuntimeStoreMode = 'memory' | 'file' | 'shared';

export type ReleaseRuntimeStoreComponent =
  | 'release-decision-log'
  | 'release-reviewer-queue'
  | 'release-token-introspection'
  | 'release-evidence-pack-store'
  | 'release-degraded-mode-grants'
  | 'policy-control-plane-store'
  | 'policy-activation-approval-store'
  | 'policy-mutation-audit-log';

export type ReleaseRuntimeStoreModes = Readonly<
  Record<ReleaseRuntimeStoreComponent, ReleaseRuntimeStoreMode>
>;

export interface RuntimeProfileStoreRequirement {
  component: ReleaseRuntimeStoreComponent;
  allowedModes: readonly ReleaseRuntimeStoreMode[];
}

export interface AttestorRuntimeProfile {
  id: AttestorRuntimeProfileId;
  label: string;
  purpose: string;
  production: boolean;
  releaseStoreRequirements: readonly RuntimeProfileStoreRequirement[];
}

export interface RuntimeProfileDurabilityViolation {
  component: ReleaseRuntimeStoreComponent;
  observedMode: ReleaseRuntimeStoreMode;
  allowedModes: readonly ReleaseRuntimeStoreMode[];
}

export interface RuntimeProfileDurabilityEvaluation {
  profile: AttestorRuntimeProfile;
  ready: boolean;
  violations: readonly RuntimeProfileDurabilityViolation[];
}

const RELEASE_STORE_COMPONENTS: readonly ReleaseRuntimeStoreComponent[] = Object.freeze([
  'release-decision-log',
  'release-reviewer-queue',
  'release-token-introspection',
  'release-evidence-pack-store',
  'release-degraded-mode-grants',
  'policy-control-plane-store',
  'policy-activation-approval-store',
  'policy-mutation-audit-log',
]);

function requirementsFor(
  allowedModes: readonly ReleaseRuntimeStoreMode[],
): readonly RuntimeProfileStoreRequirement[] {
  return RELEASE_STORE_COMPONENTS.map((component) => ({
    component,
    allowedModes,
  }));
}

function requirementsWithOverrides(
  defaultAllowedModes: readonly ReleaseRuntimeStoreMode[],
  overrides: Partial<Record<ReleaseRuntimeStoreComponent, readonly ReleaseRuntimeStoreMode[]>>,
): readonly RuntimeProfileStoreRequirement[] {
  return RELEASE_STORE_COMPONENTS.map((component) => ({
    component,
    allowedModes: overrides[component] ?? defaultAllowedModes,
  }));
}

export const ATTESTOR_RUNTIME_PROFILES: readonly AttestorRuntimeProfile[] = Object.freeze([
  {
    id: 'local-dev',
    label: 'Local development',
    purpose:
      'Fast local development and repeatable tests. In-memory release stores are allowed.',
    production: false,
    releaseStoreRequirements: requirementsFor(['memory', 'file', 'shared']),
  },
  {
    id: 'single-node-durable',
    label: 'Single-node durable evaluation',
    purpose:
      'Customer-operated or hosted evaluation where restart survival matters on one runtime.',
    production: false,
    releaseStoreRequirements: requirementsWithOverrides(['file', 'shared'], {
      'release-degraded-mode-grants': ['file', 'shared'],
      'policy-control-plane-store': ['file', 'shared'],
      'policy-activation-approval-store': ['file', 'shared'],
      'policy-mutation-audit-log': ['file', 'shared'],
    }),
  },
  {
    id: 'production-shared',
    label: 'Production shared authority plane',
    purpose:
      'Multi-node production runtime where authoritative release, policy, proof, and token state must be shared.',
    production: true,
    releaseStoreRequirements: requirementsFor(['shared']),
  },
]);

export const CURRENT_RELEASE_RUNTIME_STORE_MODES: ReleaseRuntimeStoreModes = Object.freeze({
  'release-decision-log': 'file',
  'release-reviewer-queue': 'file',
  'release-token-introspection': 'file',
  'release-evidence-pack-store': 'file',
  'release-degraded-mode-grants': 'file',
  'policy-control-plane-store': 'file',
  'policy-activation-approval-store': 'file',
  'policy-mutation-audit-log': 'file',
});

export class RuntimeProfileConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeProfileConfigurationError';
  }
}

export class RuntimeProfileDurabilityError extends Error {
  readonly evaluation: RuntimeProfileDurabilityEvaluation;

  constructor(evaluation: RuntimeProfileDurabilityEvaluation) {
    const violations = evaluation.violations
      .map((violation) => {
        const allowed = violation.allowedModes.join(' or ');
        return `${violation.component} uses ${violation.observedMode}; requires ${allowed}`;
      })
      .join('; ');
    super(`Runtime profile ${evaluation.profile.id} is not satisfied: ${violations}`);
    this.name = 'RuntimeProfileDurabilityError';
    this.evaluation = evaluation;
  }
}

export function runtimeProfileIds(): readonly AttestorRuntimeProfileId[] {
  return ATTESTOR_RUNTIME_PROFILES.map((profile) => profile.id);
}

export function findRuntimeProfile(id: string): AttestorRuntimeProfile | null {
  return ATTESTOR_RUNTIME_PROFILES.find((profile) => profile.id === id) ?? null;
}

export function resolveRuntimeProfile(input: {
  env?: Readonly<Record<string, string | undefined>>;
  defaultProfile?: AttestorRuntimeProfileId;
} = {}): AttestorRuntimeProfile {
  const env = input.env ?? process.env;
  const requested = env[ATTESTOR_RUNTIME_PROFILE_ENV]?.trim();
  const id = requested && requested.length > 0
    ? requested
    : input.defaultProfile ?? 'local-dev';
  const profile = findRuntimeProfile(id);

  if (!profile) {
    throw new RuntimeProfileConfigurationError(
      `Unsupported ${ATTESTOR_RUNTIME_PROFILE_ENV}: ${id}. Supported profiles: ${runtimeProfileIds().join(', ')}`,
    );
  }

  return profile;
}

export function evaluateReleaseRuntimeDurability(
  profile: AttestorRuntimeProfile,
  observedModes: ReleaseRuntimeStoreModes = CURRENT_RELEASE_RUNTIME_STORE_MODES,
): RuntimeProfileDurabilityEvaluation {
  const violations = profile.releaseStoreRequirements
    .map((requirement) => {
      const observedMode = observedModes[requirement.component];
      if (requirement.allowedModes.includes(observedMode)) return null;
      return {
        component: requirement.component,
        observedMode,
        allowedModes: requirement.allowedModes,
      };
    })
    .filter((violation): violation is RuntimeProfileDurabilityViolation => violation !== null);

  return {
    profile,
    ready: violations.length === 0,
    violations,
  };
}

export function assertReleaseRuntimeDurability(
  profile: AttestorRuntimeProfile,
  observedModes: ReleaseRuntimeStoreModes = CURRENT_RELEASE_RUNTIME_STORE_MODES,
): RuntimeProfileDurabilityEvaluation {
  const evaluation = evaluateReleaseRuntimeDurability(profile, observedModes);
  if (!evaluation.ready) {
    throw new RuntimeProfileDurabilityError(evaluation);
  }
  return evaluation;
}

export function releaseRuntimeDurabilitySummary(
  evaluation: RuntimeProfileDurabilityEvaluation,
): string {
  if (evaluation.ready) {
    return `${evaluation.profile.id}: release runtime durability requirements satisfied`;
  }
  return `${evaluation.profile.id}: ${evaluation.violations.length} release runtime durability violation(s)`;
}
