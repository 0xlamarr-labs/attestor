import type { Hono, MiddlewareHandler } from 'hono';
import type { AppRuntime } from './runtime.js';

export const PRODUCTION_SHARED_REQUEST_GUARD_SPEC_VERSION =
  'attestor.production-shared-request-guard.v1';

const ALLOWED_PREFLIGHT_PATHS = Object.freeze([
  '/api/v1/health',
  '/api/v1/ready',
]);

interface ReleaseRuntimeRequestPathDiagnosticsLike {
  readonly version?: unknown;
  readonly usesSharedAuthorityStores?: unknown;
  readonly blockers?: unknown;
}

interface RuntimeSecurityLike {
  readonly runtimeProfile?: unknown;
  readonly releaseRuntimeRequestPathDiagnostics?: ReleaseRuntimeRequestPathDiagnosticsLike;
}

export interface ProductionSharedRequestGuardDecision {
  readonly version: typeof PRODUCTION_SHARED_REQUEST_GUARD_SPEC_VERSION;
  readonly blocked: boolean;
  readonly runtimeProfile: string | null;
  readonly requestPathUsesSharedStores: boolean;
  readonly allowedPreflightPaths: readonly string[];
  readonly blockers: readonly string[];
}

function securityFor(runtime: AppRuntime<unknown>): RuntimeSecurityLike {
  return (runtime.infra.security ?? {}) as RuntimeSecurityLike;
}

function requestPathDiagnosticsFor(
  runtime: AppRuntime<unknown>,
): ReleaseRuntimeRequestPathDiagnosticsLike {
  return securityFor(runtime).releaseRuntimeRequestPathDiagnostics ?? {};
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? Object.freeze(value.filter((item): item is string => typeof item === 'string'))
    : Object.freeze([]);
}

export function evaluateProductionSharedRequestGuard(
  runtime: AppRuntime<unknown>,
): ProductionSharedRequestGuardDecision {
  const security = securityFor(runtime);
  const diagnostics = requestPathDiagnosticsFor(runtime);
  const runtimeProfile =
    typeof security.runtimeProfile === 'string' ? security.runtimeProfile : null;
  const requestPathUsesSharedStores =
    diagnostics.usesSharedAuthorityStores === true;
  const blocked = runtimeProfile === 'production-shared' && !requestPathUsesSharedStores;

  return Object.freeze({
    version: PRODUCTION_SHARED_REQUEST_GUARD_SPEC_VERSION,
    blocked,
    runtimeProfile,
    requestPathUsesSharedStores,
    allowedPreflightPaths: ALLOWED_PREFLIGHT_PATHS,
    blockers: stringArray(diagnostics.blockers),
  });
}

export function createProductionSharedRequestGuard(
  runtime: AppRuntime<unknown>,
): MiddlewareHandler {
  return async (c, next) => {
    const decision = evaluateProductionSharedRequestGuard(runtime);

    if (!decision.blocked || ALLOWED_PREFLIGHT_PATHS.includes(c.req.path)) {
      await next();
      return;
    }

    return c.json(
      {
        error: 'production_shared_request_path_not_ready',
        message:
          'Production-shared request handling is fail-closed until the release/policy runtime request path completes shared-store contract cutover.',
        guard: decision,
      },
      503,
    );
  };
}

export function installProductionSharedRequestGuard<Packet>(
  app: Hono,
  runtime: AppRuntime<Packet>,
): void {
  app.use('/api/v1/*', createProductionSharedRequestGuard(runtime as AppRuntime<unknown>));
}
