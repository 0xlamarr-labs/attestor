import type { Queue } from 'bullmq';
import type { Context, Hono } from 'hono';
import type { FinancialPipelineInput } from '../../../financial/pipeline.js';
import type { FinancialRunReport } from '../../../financial/types.js';
import type { AttestorKeyPair } from '../../../signing/keys.js';
import type { KeylessSigner } from '../../../signing/keyless-signer.js';
import type { VerificationKit } from '../../../signing/bundle.js';
import type {
  AsyncQueueSummary,
  AsyncRetryPolicy,
  PipelineJobData,
  PipelineJobResult,
  PipelineJobTenantContext,
  TenantAsyncQueueSnapshot,
} from '../../async-pipeline.js';
import type { AsyncDeadLetterRecord } from '../../async-dead-letter-store.js';
import type { TenantRateLimitContext, TenantRateLimitDecision } from '../../rate-limit.js';
import type { TenantContext } from '../../tenant-isolation.js';
import type { InProcessAsyncJob, TenantAsyncBackendMode } from '../../runtime/tenant-runtime.js';
import type { UsageContext } from '../../usage-meter.js';

interface RequestSignerPair {
  signer: KeylessSigner;
  reviewer: KeylessSigner;
}

export interface PipelineAsyncRoutesDeps {
  currentTenant(context: Context): TenantContext;
  canConsumePipelineRunState(
    tenantId: string,
    planId: string | null | undefined,
    quota: number | null | undefined,
  ): Promise<{ allowed: boolean; usage: UsageContext }>;
  reserveTenantPipelineRequest(
    tenantId: string,
    planId: string | null | undefined,
  ): Promise<TenantRateLimitDecision>;
  applyRateLimitHeaders(
    context: Context,
    rateLimit: TenantRateLimitContext,
    options?: { includeRetryAfter?: boolean },
  ): void;
  createRequestSigners(identitySource: string, reviewerName?: string): RequestSignerPair;
  runFinancialPipeline(input: FinancialPipelineInput): FinancialRunReport;
  buildVerificationKit(report: FinancialRunReport, publicKeyPem: string): VerificationKit | null;
  consumePipelineRunState(
    tenantId: string,
    planId: string | null | undefined,
    quota: number | null | undefined,
  ): Promise<UsageContext>;
  asyncBackendMode: TenantAsyncBackendMode;
  bullmqQueue: Queue<PipelineJobData, PipelineJobResult> | null;
  canEnqueueTenantAsyncJob(
    queue: Queue<PipelineJobData, PipelineJobResult>,
    tenantId: string,
    planId: string | null,
  ): Promise<{ allowed: boolean; snapshot: TenantAsyncQueueSnapshot }>;
  currentAsyncSubmissionReservations(tenantId: string): number;
  reserveAsyncSubmission(tenantId: string): void;
  releaseAsyncSubmission(tenantId: string): void;
  getAsyncRetryPolicy(): AsyncRetryPolicy;
  getAsyncQueueSummary(
    queue: Queue<PipelineJobData, PipelineJobResult>,
    tenantId?: string,
    planId?: string | null,
  ): Promise<AsyncQueueSummary>;
  submitPipelineJob(
    queue: Queue<PipelineJobData, PipelineJobResult>,
    input: FinancialPipelineInput,
    tenant: PipelineJobTenantContext,
    sign?: boolean,
  ): Promise<{ jobId: string }>;
  getTenantPipelineRateLimit(
    tenantId: string,
    planId: string | null | undefined,
  ): Promise<TenantRateLimitContext>;
  inProcessTenantQueueSnapshot(tenantId: string, planId: string | null): TenantAsyncQueueSnapshot;
  inProcessJobs: Map<string, InProcessAsyncJob>;
  pki: { signer: { keyPair: AttestorKeyPair } };
  upsertAsyncDeadLetterRecordState(
    input: AsyncDeadLetterRecord,
  ): Promise<{ record: AsyncDeadLetterRecord; path: string | null }>;
  getJobStatus(
    queue: Queue<PipelineJobData, PipelineJobResult>,
    jobId: string,
  ): Promise<{
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'prioritized' | 'not_found';
    result: PipelineJobResult | null;
    error: string | null;
    submittedAt: string | null;
    attemptsMade: number;
    maxAttempts: number;
    tenant: PipelineJobTenantContext | null;
    failedAt: string | null;
  }>;
}

export function registerPipelineAsyncRoutes(app: Hono, deps: PipelineAsyncRoutesDeps): void {
  const {
    currentTenant,
    canConsumePipelineRunState,
    reserveTenantPipelineRequest,
    applyRateLimitHeaders,
    createRequestSigners,
    runFinancialPipeline,
    buildVerificationKit,
    consumePipelineRunState,
    asyncBackendMode,
    bullmqQueue,
    canEnqueueTenantAsyncJob,
    currentAsyncSubmissionReservations,
    reserveAsyncSubmission,
    releaseAsyncSubmission,
    getAsyncRetryPolicy,
    getAsyncQueueSummary,
    submitPipelineJob,
    getTenantPipelineRateLimit,
    inProcessTenantQueueSnapshot,
    inProcessJobs,
    pki,
    upsertAsyncDeadLetterRecordState,
    getJobStatus,
  } = deps;

app.post('/api/v1/pipeline/run-async', async (c) => {
  try {
    const body = await c.req.json();
    const { candidateSql, intent, sign } = body;
    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    const tenant = currentTenant(c);
    const quotaCheck = await canConsumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Monthly pipeline run quota exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
      }, 429);
    }
    const submittedAt = new Date().toISOString();

    if (asyncBackendMode === 'bullmq' && bullmqQueue) {
      reserveAsyncSubmission(tenant.tenantId);
      const queueAllowance = await canEnqueueTenantAsyncJob(bullmqQueue, tenant.tenantId, tenant.planId);
      const effectivePendingJobs = queueAllowance.snapshot.pendingJobs + currentAsyncSubmissionReservations(tenant.tenantId);
      if (
        !queueAllowance.allowed ||
        (queueAllowance.snapshot.enforced &&
          queueAllowance.snapshot.pendingLimit !== null &&
          effectivePendingJobs > queueAllowance.snapshot.pendingLimit)
      ) {
        releaseAsyncSubmission(tenant.tenantId);
        return c.json({
          error: 'Too many unfinished async jobs are already queued for this tenant.',
          tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
          usage: quotaCheck.usage,
          rateLimit: await getTenantPipelineRateLimit(tenant.tenantId, tenant.planId),
          asyncQueue: {
          tenantPendingJobs: effectivePendingJobs,
          tenantPendingLimit: queueAllowance.snapshot.pendingLimit,
          tenantIsolationEnforced: queueAllowance.snapshot.enforced,
          tenantActiveExecutions: queueAllowance.snapshot.activeExecutions,
          tenantActiveExecutionLimit: queueAllowance.snapshot.activeExecutionLimit,
          tenantActiveExecutionEnforced: queueAllowance.snapshot.activeExecutionEnforced,
          tenantActiveExecutionBackend: queueAllowance.snapshot.activeExecutionBackend,
          tenantWeightedDispatchEnforced: queueAllowance.snapshot.weightedDispatchEnforced,
          tenantWeightedDispatchBackend: queueAllowance.snapshot.weightedDispatchBackend,
          tenantWeightedDispatchWeight: queueAllowance.snapshot.weightedDispatchWeight,
          tenantWeightedDispatchWindowMs: queueAllowance.snapshot.weightedDispatchWindowMs,
          tenantWeightedDispatchNextEligibleAt: queueAllowance.snapshot.weightedDispatchNextEligibleAt,
          tenantWeightedDispatchWaitMs: queueAllowance.snapshot.weightedDispatchWaitMs,
          retryPolicy: getAsyncRetryPolicy(),
        },
      }, 429);
      }

      const rateReservation = await reserveTenantPipelineRequest(tenant.tenantId, tenant.planId);
      if (!rateReservation.allowed) {
        releaseAsyncSubmission(tenant.tenantId);
        applyRateLimitHeaders(c, rateReservation.rateLimit, { includeRetryAfter: true });
        return c.json({
          error: 'Pipeline request rate limit exceeded for this tenant plan.',
          tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
          usage: quotaCheck.usage,
          rateLimit: rateReservation.rateLimit,
        }, 429);
      }

      // BullMQ path
      const input = {
        runId: `async-bullmq-${Date.now().toString(36)}`,
        intent, candidateSql,
        fixtures: body.fixtures ?? [],
        generatedReport: body.generatedReport,
        reportContract: body.reportContract,
        signingKeyPair: sign ? pki.signer.keyPair : undefined,
      };
      let jobId: string;
      try {
        ({ jobId } = await submitPipelineJob(
          bullmqQueue,
          input,
          {
            tenantId: tenant.tenantId,
            planId: tenant.planId,
            source: tenant.source,
          },
          sign,
        ));
      } finally {
        releaseAsyncSubmission(tenant.tenantId);
      }
      const rateLimit = rateReservation.rateLimit;
      applyRateLimitHeaders(c, rateLimit);
      const usage = await consumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
      const asyncQueue = await getAsyncQueueSummary(bullmqQueue, tenant.tenantId, tenant.planId);
      return c.json({
        jobId,
        status: 'queued',
        backendMode: 'bullmq',
        submittedAt,
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage,
        rateLimit,
        asyncQueue: {
          tenantPendingJobs: asyncQueue.tenant?.pendingJobs ?? 0,
          tenantPendingLimit: asyncQueue.tenant?.pendingLimit ?? null,
          tenantIsolationEnforced: asyncQueue.tenant?.enforced ?? false,
          tenantActiveExecutions: asyncQueue.tenant?.activeExecutions ?? 0,
          tenantActiveExecutionLimit: asyncQueue.tenant?.activeExecutionLimit ?? null,
          tenantActiveExecutionEnforced: asyncQueue.tenant?.activeExecutionEnforced ?? false,
          tenantActiveExecutionBackend: asyncQueue.tenant?.activeExecutionBackend ?? 'memory',
          tenantWeightedDispatchEnforced: asyncQueue.tenant?.weightedDispatchEnforced ?? false,
          tenantWeightedDispatchBackend: asyncQueue.tenant?.weightedDispatchBackend ?? 'memory',
          tenantWeightedDispatchWeight: asyncQueue.tenant?.weightedDispatchWeight ?? null,
          tenantWeightedDispatchWindowMs: asyncQueue.tenant?.weightedDispatchWindowMs ?? null,
          tenantWeightedDispatchNextEligibleAt: asyncQueue.tenant?.weightedDispatchNextEligibleAt ?? null,
          tenantWeightedDispatchWaitMs: asyncQueue.tenant?.weightedDispatchWaitMs ?? 0,
          retryPolicy: asyncQueue.retryPolicy,
        },
      }, 202);
    }

    // In-process fallback (explicit about mode)
    const inProcessSnapshot = inProcessTenantQueueSnapshot(tenant.tenantId, tenant.planId);
    reserveAsyncSubmission(tenant.tenantId);
    const effectiveInProcessPendingJobs = inProcessSnapshot.pendingJobs + currentAsyncSubmissionReservations(tenant.tenantId);
    if (inProcessSnapshot.enforced && inProcessSnapshot.pendingLimit !== null && effectiveInProcessPendingJobs > inProcessSnapshot.pendingLimit) {
      releaseAsyncSubmission(tenant.tenantId);
      return c.json({
        error: 'Too many unfinished async jobs are already queued for this tenant.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
        rateLimit: await getTenantPipelineRateLimit(tenant.tenantId, tenant.planId),
        asyncQueue: {
          tenantPendingJobs: effectiveInProcessPendingJobs,
          tenantPendingLimit: inProcessSnapshot.pendingLimit,
          tenantIsolationEnforced: inProcessSnapshot.enforced,
          tenantActiveExecutions: inProcessSnapshot.activeExecutions,
          tenantActiveExecutionLimit: inProcessSnapshot.activeExecutionLimit,
          tenantActiveExecutionEnforced: inProcessSnapshot.activeExecutionEnforced,
          tenantActiveExecutionBackend: inProcessSnapshot.activeExecutionBackend,
          tenantWeightedDispatchEnforced: inProcessSnapshot.weightedDispatchEnforced,
          tenantWeightedDispatchBackend: inProcessSnapshot.weightedDispatchBackend,
          tenantWeightedDispatchWeight: inProcessSnapshot.weightedDispatchWeight,
          tenantWeightedDispatchWindowMs: inProcessSnapshot.weightedDispatchWindowMs,
          tenantWeightedDispatchNextEligibleAt: inProcessSnapshot.weightedDispatchNextEligibleAt,
          tenantWeightedDispatchWaitMs: inProcessSnapshot.weightedDispatchWaitMs,
          retryPolicy: {
            attempts: 1,
            backoffMs: 0,
            maxStalledCount: 0,
            workerConcurrency: 1,
            completedTtlSeconds: 0,
            failedTtlSeconds: 0,
          },
        },
      }, 429);
    }

    const rateReservation = await reserveTenantPipelineRequest(tenant.tenantId, tenant.planId);
    if (!rateReservation.allowed) {
      releaseAsyncSubmission(tenant.tenantId);
      applyRateLimitHeaders(c, rateReservation.rateLimit, { includeRetryAfter: true });
      return c.json({
        error: 'Pipeline request rate limit exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
        rateLimit: rateReservation.rateLimit,
      }, 429);
    }
    const rateLimit = rateReservation.rateLimit;
    applyRateLimitHeaders(c, rateLimit);
    const usage = await consumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const job: InProcessAsyncJob = {
      id: jobId,
      status: 'queued',
      submittedAt,
      completedAt: null,
      tenantId: tenant.tenantId,
      planId: tenant.planId,
      result: null,
      error: null,
    };
    inProcessJobs.set(jobId, job);
    releaseAsyncSubmission(tenant.tenantId);

    setImmediate(async () => {
      job.status = 'running';
      try {
        const asyncSigners = sign ? createRequestSigners('ephemeral') : null;
        const keyPair = asyncSigners?.signer.signingKeyPair;
        const input = {
          runId: `async-${jobId}`, intent, candidateSql,
          fixtures: body.fixtures ?? [],
          generatedReport: body.generatedReport,
          reportContract: body.reportContract,
          signingKeyPair: keyPair,
        };
        const report = runFinancialPipeline(input);
        let kit = null;
        if (keyPair && report.certificate) {
          kit = buildVerificationKit(report, keyPair.publicKeyPem);
        }
        job.result = {
          runId: report.runId, decision: report.decision,
          proofMode: report.liveProof.mode,
          certificateId: report.certificate?.certificateId ?? null,
          certificate: report.certificate ?? null,
          verification: kit?.verification ?? null,
          publicKeyPem: keyPair?.publicKeyPem ?? null,
          trustChain: asyncSigners?.signer.trustChain ?? null,
          caPublicKeyPem: asyncSigners?.signer.caPublicKeyPem ?? null,
        };
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.completedAt = new Date().toISOString();
        await upsertAsyncDeadLetterRecordState({
          jobId: job.id,
          name: 'pipeline-run',
          backendMode: 'in_process',
          tenantId: job.tenantId,
          planId: job.planId,
          state: 'failed',
          failedReason: job.error,
          attemptsMade: 1,
          maxAttempts: 1,
          requestedAt: job.submittedAt,
          submittedAt: job.submittedAt,
          processedAt: job.completedAt,
          failedAt: job.completedAt,
          recordedAt: job.completedAt,
        });
      }
    });

    return c.json({
      jobId,
      status: 'queued',
      backendMode: 'in_process',
      submittedAt,
      tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
      usage,
      rateLimit,
      asyncQueue: {
        tenantPendingJobs: inProcessSnapshot.pendingJobs + 1,
        tenantPendingLimit: inProcessSnapshot.pendingLimit,
        tenantIsolationEnforced: inProcessSnapshot.enforced,
        tenantActiveExecutions: inProcessSnapshot.activeExecutions,
        tenantActiveExecutionLimit: inProcessSnapshot.activeExecutionLimit,
        tenantActiveExecutionEnforced: inProcessSnapshot.activeExecutionEnforced,
        tenantActiveExecutionBackend: inProcessSnapshot.activeExecutionBackend,
        tenantWeightedDispatchEnforced: inProcessSnapshot.weightedDispatchEnforced,
        tenantWeightedDispatchBackend: inProcessSnapshot.weightedDispatchBackend,
        tenantWeightedDispatchWeight: inProcessSnapshot.weightedDispatchWeight,
        tenantWeightedDispatchWindowMs: inProcessSnapshot.weightedDispatchWindowMs,
        tenantWeightedDispatchNextEligibleAt: inProcessSnapshot.weightedDispatchNextEligibleAt,
        tenantWeightedDispatchWaitMs: inProcessSnapshot.weightedDispatchWaitMs,
        retryPolicy: {
          attempts: 1,
          backoffMs: 0,
          maxStalledCount: 0,
          workerConcurrency: 1,
          completedTtlSeconds: 0,
          failedTtlSeconds: 0,
        },
      },
    }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get('/api/v1/pipeline/status/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  // Try BullMQ first
  if (asyncBackendMode === 'bullmq' && bullmqQueue) {
    const bmStatus = await getJobStatus(bullmqQueue, jobId);
    if (bmStatus.status !== 'not_found') {
      return c.json({
        jobId,
        backendMode: 'bullmq',
        status: bmStatus.status,
        submittedAt: bmStatus.submittedAt,
        completedAt: bmStatus.result?.completedAt ?? bmStatus.failedAt,
        result: bmStatus.result,
        error: bmStatus.error,
        attemptsMade: bmStatus.attemptsMade,
        maxAttempts: bmStatus.maxAttempts,
        tenantContext: bmStatus.tenant
          ? {
              tenantId: bmStatus.tenant.tenantId,
              source: bmStatus.tenant.source,
              planId: bmStatus.tenant.planId,
            }
          : null,
        failedAt: bmStatus.failedAt,
      });
    }
  }

  // In-process fallback
  const job = inProcessJobs.get(jobId);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json({
    jobId: job.id,
    backendMode: 'in_process',
    status: job.status,
    submittedAt: job.submittedAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
    attemptsMade: 0,
    maxAttempts: 1,
    tenantContext: { tenantId: job.tenantId, source: 'in_process', planId: job.planId },
    failedAt: job.status === 'failed' ? job.completedAt : null,
  });
});
}
