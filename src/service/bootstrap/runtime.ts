import type { AccountRouteDeps } from '../http/routes/account-routes.js';
import type { AdminRouteDeps } from '../http/routes/admin-routes.js';
import type { CoreRouteDeps } from '../http/routes/core-routes.js';
import type { PipelineRouteDeps } from '../http/routes/pipeline-routes.js';
import type { PublicSiteRouteDeps } from '../http/routes/public-site-routes.js';
import type { ReleasePolicyControlRouteDeps } from '../http/routes/release-policy-control-routes.js';
import type { ReleaseReviewRouteDeps } from '../http/routes/release-review-routes.js';
import type { WebhookRouteDeps } from '../http/routes/webhook-routes.js';
import type { AppRegistries } from './registries.js';

export type AppRuntimeResourceMap = Readonly<Record<string, unknown>>;

export interface AppRouteDeps<Packet = unknown> {
  publicSite: PublicSiteRouteDeps<Packet>;
  core: CoreRouteDeps;
  account: AccountRouteDeps;
  admin: AdminRouteDeps;
  releaseReview: ReleaseReviewRouteDeps;
  releasePolicyControl: ReleasePolicyControlRouteDeps;
  pipeline: PipelineRouteDeps;
  webhook: WebhookRouteDeps;
}

export interface AppRuntimeServiceIdentity {
  instanceId: string;
  startedAtEpochMs: number;
}

export interface AppRuntimeInfra {
  service: AppRuntimeServiceIdentity;
  asyncExecution?: AppRuntimeResourceMap;
  telemetry?: AppRuntimeResourceMap;
  security?: AppRuntimeResourceMap;
}

export type AppRuntimeStores = AppRuntimeResourceMap;

export interface AppRuntimeServices<Packet = unknown> extends AppRuntimeResourceMap {
  httpRoutes: AppRouteDeps<Packet>;
}

export interface AppRuntime<Packet = unknown> {
  registries: AppRegistries;
  infra: AppRuntimeInfra;
  stores: AppRuntimeStores;
  services: AppRuntimeServices<Packet>;
}

export interface CreateAppRuntimeInput<Packet = unknown> {
  registries: AppRegistries;
  infra: AppRuntimeInfra;
  stores?: AppRuntimeStores;
  services: AppRuntimeServices<Packet>;
}

export function createRuntime<Packet>(input: CreateAppRuntimeInput<Packet>): AppRuntime<Packet> {
  return {
    registries: input.registries,
    infra: input.infra,
    stores: input.stores ?? {},
    services: input.services,
  };
}
