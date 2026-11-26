// LOCAL MODE / TESTS ONLY. Runs the real SQL migrations inside PGlite
// (Postgres compiled to WebAssembly) so the app can run without Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

export async function createLocalDb(dataDir?: string): Promise<PGlite> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;
    create table if not exists _local_migrations (name text primary key, applied_at timestamptz default now());
  `);
  const applied = new Set((await db.query<{ name: string }>('select name from _local_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      await tx.query('insert into _local_migrations (name) values ($1)', [file]);
    });
  }
  return db;
}

/** Same calling convention as supabase.rpc(fn, { p: args }) in production. */
export function makeRpc(db: PGlite) {
  return async (fn: string, args: Record<string, unknown> = {}) => {
    if (!/^[a-z_]+$/.test(fn)) throw new Error(`bad function name ${fn}`);
    const res = await db.query<{ r: unknown }>(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(args)]);
    return res.rows[0]?.r;
  };
}
