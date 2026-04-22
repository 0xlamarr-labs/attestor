import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_SERVER = join(process.cwd(), 'src', 'service', 'api-server.ts');
const BOOTSTRAP_ROOT = join(process.cwd(), 'src', 'service', 'bootstrap');

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function testApiServerUsesBootstrapComposition(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');

  assert.match(apiServer, /from '\.\/bootstrap\/registries\.js'/u);
  assert.match(apiServer, /from '\.\/bootstrap\/runtime\.js'/u);
  assert.match(apiServer, /from '\.\/bootstrap\/routes\.js'/u);
  assert.match(apiServer, /from '\.\/bootstrap\/server\.js'/u);
  assert.match(apiServer, /registerAllRoutes\(app, runtime\);/u);
}

function testApiServerDoesNotOwnNodeServerLifecycle(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');

  assert.doesNotMatch(apiServer, /from ['"]@hono\/node-server['"]/u);
  assert.doesNotMatch(apiServer, /serve\(\{\s*fetch:\s*app\.fetch/u);
  assert.doesNotMatch(apiServer, /configureTenantRuntimeBackends\(/u);
  assert.doesNotMatch(apiServer, /shutdownTenantRuntimeBackends\(/u);
}

function testApiServerDoesNotRegisterRoutesDirectly(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');

  for (const directRegistration of [
    'registerPublicSiteRoutes(app,',
    'registerCoreRoutes(app,',
    'registerAccountRoutes(app,',
    'registerAdminRoutes(app,',
    'registerReleaseReviewRoutes(app,',
    'registerReleasePolicyControlRoutes(app,',
    'registerWebhookRoutes(app,',
    'registerPipelineRoutes(app,',
  ]) {
    assert.equal(
      apiServer.includes(directRegistration),
      false,
      `api-server.ts should delegate ${directRegistration} through bootstrap/routes.ts`,
    );
  }
}

function testBootstrapModulesOwnTheirBoundaries(): void {
  const registries = readFileSync(join(BOOTSTRAP_ROOT, 'registries.ts'), 'utf8');
  const routes = readFileSync(join(BOOTSTRAP_ROOT, 'routes.ts'), 'utf8');
  const server = readFileSync(join(BOOTSTRAP_ROOT, 'server.ts'), 'utf8');
  const runtime = readFileSync(join(BOOTSTRAP_ROOT, 'runtime.ts'), 'utf8');
  const httpRouteBuilders = readFileSync(join(BOOTSTRAP_ROOT, 'http-route-builders.ts'), 'utf8');

  assert.match(registries, /export function createRegistries\(\): AppRegistries/u);
  assert.match(routes, /export function registerAllRoutes<Packet>\(app: Hono, runtime: AppRuntime<Packet>\): void/u);
  assert.match(server, /export function startHttpServer\(app: Hono, port: number = 3700\): HttpServerHandle/u);
  assert.match(server, /export function installGracefulShutdown\(handle: HttpServerHandle\): void/u);
  assert.match(runtime, /export interface AppRuntime<Packet = unknown>/u);
  assert.match(runtime, /export function createRuntimeInfra\(input: CreateRuntimeInfraInput\): AppRuntimeInfra/u);
  assert.match(runtime, /export function createHttpRouteRuntime<Packet>/u);
  assert.match(httpRouteBuilders, /export function buildAccountRouteDeps/u);
  assert.match(httpRouteBuilders, /export function buildAdminRouteDeps/u);
  assert.match(httpRouteBuilders, /export function buildPipelineRouteDeps/u);
  assert.match(httpRouteBuilders, /export function buildWebhookRouteDeps/u);
}

function testRuntimeUsesStructuredComposition(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const routes = readFileSync(join(BOOTSTRAP_ROOT, 'routes.ts'), 'utf8');
  const runtime = readFileSync(join(BOOTSTRAP_ROOT, 'runtime.ts'), 'utf8');

  assert.match(runtime, /export interface AppRuntimeInfra/u);
  assert.match(runtime, /export interface AppRuntimeServices<Packet = unknown>/u);
  assert.match(runtime, /infra: AppRuntimeInfra/u);
  assert.match(runtime, /stores: AppRuntimeStores/u);
  assert.match(runtime, /services: AppRuntimeServices<Packet>/u);
  assert.doesNotMatch(runtime, /routeDeps: AppRouteDeps/u);

  assert.match(routes, /runtime\.services\.httpRoutes\.publicSite/u);
  assert.match(routes, /runtime\.services\.httpRoutes\.account/u);
  assert.doesNotMatch(routes, /runtime\.routeDeps/u);

  assert.match(apiServer, /createRuntimeInfra\(\{/u);
  assert.match(apiServer, /createHttpRouteRuntime\(\{/u);
  assert.match(apiServer, /httpRoutes:\s*\{/u);
  assert.doesNotMatch(apiServer, /routeDeps:\s*\{/u);
}

function testRegistriesOwnStaticPlatformRegistration(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const registries = readProjectFile('src', 'service', 'bootstrap', 'registries.ts');

  for (const platformRegistration of [
    'financeDomainPack',
    'healthcareDomainPack',
    'snowflakeConnector',
    'xbrlUsGaapAdapter',
    'xbrlCsvEbaAdapter',
  ]) {
    assert.equal(
      apiServer.includes(platformRegistration),
      false,
      `api-server.ts should not own ${platformRegistration} static registration`,
    );
    assert.equal(
      registries.includes(platformRegistration),
      true,
      `bootstrap/registries.ts should own ${platformRegistration} static registration`,
    );
  }
}

function testHttpRouteBuildersOwnApplicationServiceConstruction(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const httpRouteBuilders = readProjectFile('src', 'service', 'bootstrap', 'http-route-builders.ts');

  assert.match(apiServer, /from '\.\/bootstrap\/http-route-builders\.js'/u);

  for (const serviceFactory of [
    'createAccountAuthService',
    'createAccountApiKeyService',
    'createAccountUserManagementService',
    'createAccountStateService',
    'createAdminMutationService',
    'createAdminControlService',
    'createAdminQueryService',
    'createPipelineUsageService',
    'createPipelineDeadLetterService',
    'createStripeWebhookService',
    'createStripeWebhookBillingProcessor',
    'createEmailWebhookService',
  ]) {
    assert.equal(
      apiServer.includes(`${serviceFactory}(`),
      false,
      `api-server.ts should delegate ${serviceFactory} wiring through bootstrap/http-route-builders.ts`,
    );
    assert.equal(
      httpRouteBuilders.includes(`${serviceFactory}(`),
      true,
      `bootstrap/http-route-builders.ts should own ${serviceFactory} wiring`,
    );
  }

  for (const routeDepsConstant of [
    'const accountRouteDeps = {',
    'const adminRouteDeps = {',
    'const pipelineRouteDeps = {',
    'const webhookRouteDeps = {',
  ]) {
    assert.equal(
      apiServer.includes(routeDepsConstant),
      false,
      `api-server.ts should not build ${routeDepsConstant} directly`,
    );
  }
}

testApiServerUsesBootstrapComposition();
testApiServerDoesNotOwnNodeServerLifecycle();
testApiServerDoesNotRegisterRoutesDirectly();
testBootstrapModulesOwnTheirBoundaries();
testRuntimeUsesStructuredComposition();
testRegistriesOwnStaticPlatformRegistration();
testHttpRouteBuildersOwnApplicationServiceConstruction();

console.log('Service bootstrap boundary tests: 7 passed, 0 failed');
