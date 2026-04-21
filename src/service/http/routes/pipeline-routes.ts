import type { Hono } from 'hono';
import {
  registerPipelineExecutionRoutes,
  type PipelineExecutionRoutesDeps,
} from './pipeline-execution-routes.js';
import {
  registerPipelineVerificationRoutes,
  type PipelineVerificationRoutesDeps,
} from './pipeline-verification-routes.js';
import {
  registerPipelineFilingRoutes,
  type PipelineFilingRoutesDeps,
} from './pipeline-filing-routes.js';
import {
  registerPipelineAsyncRoutes,
  type PipelineAsyncRoutesDeps,
} from './pipeline-async-routes.js';

export type PipelineRouteDeps =
  PipelineExecutionRoutesDeps &
  PipelineVerificationRoutesDeps &
  PipelineFilingRoutesDeps &
  PipelineAsyncRoutesDeps;

export function registerPipelineRoutes(app: Hono, deps: PipelineRouteDeps): void {
  registerPipelineExecutionRoutes(app, deps);
  registerPipelineVerificationRoutes(app, deps);
  registerPipelineFilingRoutes(app, deps);
  registerPipelineAsyncRoutes(app, deps);
}
