import {
  domainRegistry,
  type DomainPackRegistry,
} from '../../domains/domain-pack.js';
import { financeDomainPack } from '../../domains/finance-pack.js';
import { healthcareDomainPack } from '../../domains/healthcare-pack.js';
import {
  connectorRegistry,
  type ConnectorRegistry,
} from '../../connectors/connector-interface.js';
import { snowflakeConnector } from '../../connectors/snowflake-connector.js';
import {
  filingRegistry,
  type FilingAdapterRegistry,
} from '../../filing/filing-adapter.js';
import { xbrlUsGaapAdapter } from '../../filing/xbrl-adapter.js';
import { xbrlCsvEbaAdapter } from '../../filing/xbrl-csv-adapter.js';

export interface AppRegistries {
  domainRegistry: DomainPackRegistry;
  connectorRegistry: ConnectorRegistry;
  filingRegistry: FilingAdapterRegistry;
}

export function createRegistries(): AppRegistries {
  if (!domainRegistry.has('finance')) domainRegistry.register(financeDomainPack);
  if (!domainRegistry.has('healthcare')) domainRegistry.register(healthcareDomainPack);

  if (!connectorRegistry.has('snowflake')) connectorRegistry.register(snowflakeConnector);

  if (!filingRegistry.has('xbrl-us-gaap-2024')) filingRegistry.register(xbrlUsGaapAdapter);
  if (!filingRegistry.has('xbrl-csv-eba-dpm2')) filingRegistry.register(xbrlCsvEbaAdapter);

  return {
    domainRegistry,
    connectorRegistry,
    filingRegistry,
  };
}
