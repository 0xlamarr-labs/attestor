declare module 'hono' {
  interface ContextVariableMap {
    'obs.tenantId': string | null;
    'obs.planId': string | null;
    'obs.accountId': string | null;
    'obs.accountStatus': string | null;
  }
}

export {};
