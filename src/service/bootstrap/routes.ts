import type { Hono } from 'hono';
import { registerAccountRoutes } from '../http/routes/account-routes.js';
import { registerAdminRoutes } from '../http/routes/admin-routes.js';
import { registerCoreRoutes } from '../http/routes/core-routes.js';
import { registerPipelineRoutes } from '../http/routes/pipeline-routes.js';
import { registerPublicSiteRoutes } from '../http/routes/public-site-routes.js';
import { registerReleasePolicyControlRoutes } from '../http/routes/release-policy-control-routes.js';
import { registerReleaseReviewRoutes } from '../http/routes/release-review-routes.js';
import { registerWebhookRoutes } from '../http/routes/webhook-routes.js';
import type { AppRuntime } from './runtime.js';

export function createPublicSiteRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.publicSite;
}

export function createCoreRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.core;
}

export function createAccountRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.account;
}

export function createAdminRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.admin;
}

export function createPipelineRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.pipeline;
}

export function createWebhookRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.webhook;
}

export function createReleaseReviewRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.releaseReview;
}

export function createReleasePolicyControlRouteDeps<Packet>(runtime: AppRuntime<Packet>) {
  return runtime.routeDeps.releasePolicyControl;
}

export function registerAllRoutes<Packet>(app: Hono, runtime: AppRuntime<Packet>): void {
  registerPublicSiteRoutes(app, createPublicSiteRouteDeps(runtime));
  registerCoreRoutes(app, createCoreRouteDeps(runtime));
  registerAccountRoutes(app, createAccountRouteDeps(runtime));
  registerAdminRoutes(app, createAdminRouteDeps(runtime));
  registerReleaseReviewRoutes(app, createReleaseReviewRouteDeps(runtime));
  registerReleasePolicyControlRoutes(app, createReleasePolicyControlRouteDeps(runtime));
  registerWebhookRoutes(app, createWebhookRouteDeps(runtime));
  registerPipelineRoutes(app, createPipelineRouteDeps(runtime));
}
