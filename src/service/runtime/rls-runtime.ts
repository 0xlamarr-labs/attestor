import { autoActivateRLS } from '../tenant-rls.js';

export interface RlsActivationResult {
  activated: boolean;
  policiesFound: number;
  tablesProtected: string[];
  error: string | null;
}

export let rlsActivationResult: RlsActivationResult = {
  activated: false,
  policiesFound: 0,
  tablesProtected: [],
  error: null,
};

if (process.env.ATTESTOR_PG_URL) {
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>);
    const Pool = pg.Pool ?? pg.default?.Pool;
    const pool = new Pool({ connectionString: process.env.ATTESTOR_PG_URL });
    rlsActivationResult = await autoActivateRLS(pool);
    if (rlsActivationResult.activated) {
      console.log(`[rls] Active: ${rlsActivationResult.policiesFound} policies on [${rlsActivationResult.tablesProtected.join(', ')}]`);
    } else {
      console.log(`[rls] Not activated: ${rlsActivationResult.error ?? 'unknown'}`);
    }
    await pool.end();
  } catch (err: any) {
    rlsActivationResult.error = err.message;
    console.log(`[rls] Skipped: ${err.message}`);
  }
}
