import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import postgres from 'postgres'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { withDatabaseQuiesced, assertWritableServer } from '../aramco-cutover-guard.mjs'

const dbUrl = process.env.ARAMCO_CUTOVER_TEST_DATABASE_URL
if (!dbUrl) throw new Error('ARAMCO_CUTOVER_TEST_DATABASE_URL es requerida')
const parsedUrl = new URL(dbUrl)
const database = decodeURIComponent(parsedUrl.pathname.slice(1))
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname) || !/^aramco_cutover_test_[a-z0-9_]+$/.test(database)) {
  throw new Error('Se exige una base local desechable con prefijo aramco_cutover_test_')
}
const adminUrl = new URL(parsedUrl); adminUrl.pathname = '/postgres'
const admin = postgres(adminUrl.toString(), { max: 1 })
const [server] = await admin`select (pg_control_system()).system_identifier::text as id, current_user as role`
const guardOpts = { clusterId: server.id, role: server.role }
const guarded = (url, name, callback) => withDatabaseQuiesced(url, name, callback, guardOpts)
const preflight = postgres(dbUrl, { max: 1 })
try {
  const [row] = await preflight`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S')`
  if (row.n !== 0) throw new Error('La base de prueba debe estar vacía')
} finally { await preflight.end() }

test('rejects a replica even when cluster and role match', () => {
  assert.throws(() => assertWritableServer({ cluster_id: server.id, role: server.role, in_recovery: true, version: 160015 }, guardOpts), /réplica/)
})

test('rejects a PostgreSQL major version whose startup locking was not verified', () => {
  assert.throws(() => assertWritableServer({ cluster_id: server.id, role: server.role, in_recovery: false, version: 170000 }, guardOpts), /versión/)
})
const tmp = await mkdtemp(path.join(os.tmpdir(), 'aramco-migrate-test-'))
await mkdir(path.join(tmp, 'meta'))
await writeFile(path.join(tmp, 'meta', '_journal.json'), JSON.stringify({version:'7',dialect:'postgresql',entries:[{idx:0,version:'7',when:1700000000000,tag:'0000_test',breakpoints:true}]}))
await writeFile(path.join(tmp, '0000_test.sql'), 'CREATE TABLE cutover_canonical_migration_test (id integer PRIMARY KEY);')
after(async () => { await admin.end(); await rm(tmp, { recursive: true, force: true }) })

test('drizzle migrates using the one reserved connection while new sessions are refused', async () => {
  await guarded(dbUrl, database, async sql => {
    const concurrent = postgres(dbUrl, { connect_timeout: 2, max: 1 })
    try { await assert.rejects(concurrent`select 1`, /not currently accepting connections/) } finally { await concurrent.end() }
    await migrate(drizzle(sql), { migrationsFolder: tmp })
  })
  const probe = postgres(dbUrl, { max: 1 })
  try {
    assert.equal((await probe`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n, 1)
    assert.equal((await probe`select count(*)::int as n from cutover_canonical_migration_test where id=-1`)[0].n, 0)
  } finally { await probe.end() }
})

test('existing client prevents work and connections are restored', async () => {
  const other = postgres(dbUrl, { max: 1 }); await other`select 1`
  let invoked = false
  try {
    await assert.rejects(guarded(dbUrl, database, async () => { invoked = true }), /sesiones ajenas/)
    assert.equal(invoked, false)
    assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, true)
  } finally { await other.end() }
})

test('failure after callback starts keeps database closed', async () => {
  try {
    await assert.rejects(guarded(dbUrl, database, async () => { throw new Error('deliberate') }), /deliberate/)
    assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, false)
  } finally { await admin`alter database ${admin(database)} allow_connections true` }
})

test('failure after cleanup begins keeps connections closed until explicit recovery', async () => {
  try {
    await assert.rejects(guarded(dbUrl, database, async (sql) => {
      await sql`insert into cutover_canonical_migration_test (id) values (10) on conflict do nothing`
      throw new Error('migration failed')
    }), /migration failed/)
    assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, false)
  } finally { await admin`alter database ${admin(database)} allow_connections true` }
  const probe = postgres(dbUrl, { max: 1 })
  try { assert.equal((await probe`select count(*)::int as n from cutover_canonical_migration_test where id=10`)[0].n, 1) } finally { await probe.end() }
})

test('rejects an unexpected database before changing connection settings', async () => {
  await assert.rejects(guarded(dbUrl, 'wrong-database', async () => {}), /base inesperada/)
  assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, true)
})

test('rejects an unexpected cluster or role without changing connection settings', async () => {
  for (const expected of [{ clusterId: '0', role: server.role }, { clusterId: server.id, role: 'wrong' }]) {
    await assert.rejects(withDatabaseQuiesced(dbUrl, database, async () => {}, expected), /clúster o rol inesperado/)
    assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, true)
  }
})

test('another cutover is rejected while the exclusive guard is active', async () => {
  await guarded(dbUrl, database, async () => {
    await assert.rejects(guarded(dbUrl, database, async () => {}), /corte en curso/)
    assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, false)
  })
})

test('loss of admin session never reopens the database', async () => {
  try {
    await assert.rejects(guarded(dbUrl, database, async () => {
      const [row] = await admin`select l.pid from pg_locks l join pg_stat_activity a on a.pid=l.pid
        where l.locktype='advisory' and a.application_name='aramco-cutover-admin' and a.datname='postgres'
          and l.classid=((hashtextextended(${`aramco-cutover:${database}`},0) >> 32) & 4294967295)::oid
          and l.objid=(hashtextextended(${`aramco-cutover:${database}`},0) & 4294967295)::oid and l.granted`
      assert.ok(row?.pid)
      await admin`select pg_terminate_backend(${row.pid})`
    }), /conexión administrativa (reemplazada|perdida)/)
    assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, false)
  } finally { await admin`alter database ${admin(database)} allow_connections true` }
})

test('blocks a client between database permission check and session registration', async () => {
  const starting = postgres(dbUrl, { max: 1, connection: { options: '-c post_auth_delay=3' } })
  const startup = starting`select 1 as ok`.catch(e => e)
  try {
    let found = false
    for (let i = 0; i < 50; i++) {
      const rows = await admin`select pid from pg_locks where locktype='object' and classid='pg_database'::regclass and objid=(select oid from pg_database where datname=${database}) and mode='RowExclusiveLock' and granted`
      if (rows.length) { found = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(found, true, 'client did not enter startup')
    let invoked = false
    await assert.rejects(guarded(dbUrl, database, async () => { invoked = true }), /conexiones en inicio/)
    assert.equal(invoked, false)
  } finally { await startup; await starting.end() }
})

test('a killed process leaves connections blocked until explicit recovery', async () => {
  const guardUrl = new URL('../aramco-cutover-guard.mjs', import.meta.url).href
  const childCode = `import { withDatabaseQuiesced } from ${JSON.stringify(guardUrl)}; await withDatabaseQuiesced(process.env.ARAMCO_CUTOVER_TEST_DATABASE_URL, ${JSON.stringify(database)}, async () => { process.stdout.write('ready\\n'); await new Promise(() => {}); }, ${JSON.stringify(guardOpts)});`
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const [chunk] = await once(child.stdout, 'data')
    assert.match(String(chunk), /ready/)
    child.kill('SIGKILL')
    await once(child, 'close')
    assert.equal((await admin`select datallowconn from pg_database where datname = ${database}`)[0].datallowconn, false)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await admin`alter database ${admin(database)} allow_connections true`
  }
  const probe = postgres(dbUrl, { max: 1 })
  try { assert.equal((await probe`select 1 as ok`)[0].ok, 1) } finally { await probe.end() }
})
