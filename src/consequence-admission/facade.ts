import {
  createCryptoExecutionPlanAdmissionRequest,
  createCryptoExecutionPlanAdmissionResponse,
  type CreateCryptoExecutionPlanAdmissionResponseInput,
  type CryptoExecutionPlanAdmissionRequestInput,
} from './crypto.js';
import {
  FINANCE_PIPELINE_ADMISSION_ROUTE,
  createFinancePipelineAdmissionRequest,
  createFinancePipelineAdmissionResponse,
  type CreateFinancePipelineAdmissionResponseInput,
  type FinancePipelineAdmissionRequestInput,
} from './finance.js';
import {
  CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
  type CryptoExecutionAdmissionPlan,
} from '../crypto-execution-admission/index.js';
import type {
  ConsequenceAdmissionConstraint,
  ConsequenceAdmissionRequest,
  ConsequenceAdmissionResponse,
} from './index.js';

export const CONSEQUENCE_ADMISSION_FACADE_SPEC_VERSION =
  'attestor.consequence-admission-facade.v1';
export const CONSEQUENCE_ADMISSION_PUBLIC_SUBPATH =
  'attestor/consequence-admission';

export const CONSEQUENCE_ADMISSION_FACADE_SURFACES = [
  'finance-pipeline-run',
  'crypto-execution-plan',
] as const;
export type ConsequenceAdmissionFacadeSurface =
  typeof CONSEQUENCE_ADMISSION_FACADE_SURFACES[number];

type OperationalPrimitive = string | number | boolean | null;

export interface FinancePipelineFacadeAdmissionInput {
  readonly surface: 'finance-pipeline-run';
  readonly run: CreateFinancePipelineAdmissionResponseInput['run'];
  readonly decidedAt: string;
  readonly requestedAt?: string | null;
  readonly request?: ConsequenceAdmissionRequest | null;
  readonly requestInput?: Omit<
    FinancePipelineAdmissionRequestInput,
    'requestedAt'
  > | null;
  readonly constraints?: readonly ConsequenceAdmissionConstraint[];
  readonly operationalContext?: Readonly<Record<string, OperationalPrimitive>>;
}

export interface CryptoExecutionPlanFacadeAdmissionInput {
  readonly surface: 'crypto-execution-plan';
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly decidedAt: string;
  readonly requestedAt?: string | null;
  readonly request?: ConsequenceAdmissionRequest | null;
  readonly requestInput?: Omit<
    CryptoExecutionPlanAdmissionRequestInput,
    'requestedAt' | 'plan'
  > | null;
  readonly operationalContext?: Readonly<Record<string, OperationalPrimitive>>;
}

export type ConsequenceAdmissionFacadeInput =
  | FinancePipelineFacadeAdmissionInput
  | CryptoExecutionPlanFacadeAdmissionInput;

export interface ConsequenceAdmissionFacadeDescriptor {
  readonly version: typeof CONSEQUENCE_ADMISSION_FACADE_SPEC_VERSION;
  readonly publicSubpath: typeof CONSEQUENCE_ADMISSION_PUBLIC_SUBPATH;
  readonly surfaces: typeof CONSEQUENCE_ADMISSION_FACADE_SURFACES;
  readonly explicitSurfaceRequired: true;
  readonly automaticPackDetection: false;
  readonly entryPoints: {
    readonly financePipelineRun: {
      readonly surface: 'finance-pipeline-run';
      readonly kind: 'hosted-route';
      readonly route: typeof FINANCE_PIPELINE_ADMISSION_ROUTE;
      readonly packageSubpath: null;
    };
    readonly cryptoExecutionPlan: {
      readonly surface: 'crypto-execution-plan';
      readonly kind: 'package-boundary';
      readonly route: null;
      readonly packageSubpath: typeof CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH;
    };
  };
  readonly publicHostedCryptoRouteClaimed: false;
}

function unknownSurfaceError(surface: unknown): Error {
  return new Error(
    `Consequence admission facade requires an explicit supported surface; received ${String(
      surface ?? 'missing',
    )}.`,
  );
}

function financeRequestFor(
  input: FinancePipelineFacadeAdmissionInput,
): ConsequenceAdmissionRequest {
  if (input.request) return input.request;
  return createFinancePipelineAdmissionRequest({
    requestedAt: input.requestedAt ?? input.decidedAt,
    runId: input.run.runId,
    tenantId: input.run.tenantContext?.tenantId ?? null,
    environment: input.run.tenantContext?.source ?? null,
    ...(input.requestInput ?? {}),
  });
}

function cryptoRequestFor(
  input: CryptoExecutionPlanFacadeAdmissionInput,
): ConsequenceAdmissionRequest {
  if (input.request) return input.request;
  return createCryptoExecutionPlanAdmissionRequest({
    requestedAt: input.requestedAt ?? input.decidedAt,
    plan: input.plan,
    ...(input.requestInput ?? {}),
  });
}

export function isConsequenceAdmissionFacadeSurface(
  value: string,
): value is ConsequenceAdmissionFacadeSurface {
  return CONSEQUENCE_ADMISSION_FACADE_SURFACES.includes(
    value as ConsequenceAdmissionFacadeSurface,
  );
}

export function createConsequenceAdmissionFacadeResponse(
  input: ConsequenceAdmissionFacadeInput,
): ConsequenceAdmissionResponse {
  if (input.surface === 'finance-pipeline-run') {
    return createFinancePipelineAdmissionResponse({
      run: input.run,
      decidedAt: input.decidedAt,
      request: financeRequestFor(input),
      constraints: input.constraints,
      operationalContext: input.operationalContext,
    });
  }

  if (input.surface === 'crypto-execution-plan') {
    return createCryptoExecutionPlanAdmissionResponse({
      plan: input.plan,
      decidedAt: input.decidedAt,
      request: cryptoRequestFor(input),
      operationalContext: input.operationalContext,
    });
  }

  throw unknownSurfaceError((input as { readonly surface?: unknown }).surface);
}

export function consequenceAdmissionFacadeDescriptor(): ConsequenceAdmissionFacadeDescriptor {
  return Object.freeze({
    version: CONSEQUENCE_ADMISSION_FACADE_SPEC_VERSION,
    publicSubpath: CONSEQUENCE_ADMISSION_PUBLIC_SUBPATH,
    surfaces: CONSEQUENCE_ADMISSION_FACADE_SURFACES,
    explicitSurfaceRequired: true,
    automaticPackDetection: false,
    entryPoints: Object.freeze({
      financePipelineRun: Object.freeze({
        surface: 'finance-pipeline-run',
        kind: 'hosted-route',
        route: FINANCE_PIPELINE_ADMISSION_ROUTE,
        packageSubpath: null,
      }),
      cryptoExecutionPlan: Object.freeze({
        surface: 'crypto-execution-plan',
        kind: 'package-boundary',
        route: null,
        packageSubpath: CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
      }),
    }),
    publicHostedCryptoRouteClaimed: false,
  });
}
