import postgres from 'postgres'

export function assertWritableServer(server, expected) {
  if (server?.in_recovery !== false) throw new Error('servidor en réplica o estado de réplica desconocido')
  if (server.version < 160000 || server.version >= 170000 || !Number.isInteger(server.version)) throw new Error('versión PostgreSQL no verificada')
  if (server.cluster_id !== expected.clusterId || server.role !== expected.role) throw new Error('clúster o rol inesperado')
}

/**
 * Only use after all application and scheduler processes are stopped.
 * Database access remains on a single-session pool while new connections
 * are refused. This is not a database backup or a deployment orchestrator.
 */
export async function withDatabaseQuiesced(databaseUrl, expectedDatabase, work, expected) {
  if (!expectedDatabase || !databaseUrl || !expected?.clusterId || !expected?.role) throw new Error('base, clúster, rol y URL son obligatorios')
  const targetUrl = new URL(databaseUrl)
  if (decodeURIComponent(targetUrl.pathname.slice(1)) !== expectedDatabase || expectedDatabase === 'postgres') {
    throw new Error('base inesperada')
  }
  const adminUrl = new URL(targetUrl); adminUrl.pathname = '/postgres'
  const target = postgres(targetUrl.toString(), { max: 1, connect_timeout: 5, idle_timeout: null, max_lifetime: null })
  const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5, idle_timeout: null, max_lifetime: null, connection: { application_name: 'aramco-cutover-admin' } })
  let mustReopen = false
  let callbackStarted = false
  let finished = false
  let adminPid
  let adminStarted
  try {
    const [adminServer] = await admin`select (pg_control_system()).system_identifier::text as cluster_id, current_user as role, pg_is_in_recovery() as in_recovery, current_setting('server_version_num')::int as version`
    assertWritableServer(adminServer, expected)
    const [lock] = await admin`select pg_try_advisory_lock(hashtextextended(${`aramco-cutover:${expectedDatabase}`}, 0)) as acquired, pg_backend_pid() as pid, (select backend_start::text from pg_stat_activity where pid = pg_backend_pid()) as started`
    if (!lock?.acquired) throw new Error('ya existe un corte en curso')
    adminPid = lock.pid
    adminStarted = lock.started
    const [identity] = await target`select current_database() as name, pg_backend_pid() as pid, (pg_control_system()).system_identifier::text as cluster_id, current_user as role, pg_is_in_recovery() as in_recovery, current_setting('server_version_num')::int as version`
    if (identity.name !== expectedDatabase) throw new Error('base inesperada')
    assertWritableServer(identity, expected)
    const [current] = await admin`select datallowconn from pg_database where datname = ${expectedDatabase}`
    if (!current?.datallowconn) throw new Error('la base no acepta conexiones antes del corte')
    // Mark first: even an interrupted command might have succeeded server-side.
    mustReopen = true
    await admin`alter database ${admin(expectedDatabase)} allow_connections false`
    // A backend can have passed CheckMyDatabase but not yet be visible in
    // pg_stat_activity. In PostgreSQL 16 it holds a RowExclusiveLock on the
    // shared pg_database object until after registering its backend status.
    // Check the startup lock FIRST, then pg_stat_activity, so a backend which
    // transitions between the checks is present in at least one of them.
    const starting = await admin`select pid from pg_locks
      where locktype='object' and classid='pg_database'::regclass
      and objid=(select oid from pg_database where datname=${expectedDatabase})
      and mode='RowExclusiveLock' and granted and pid <> ${identity.pid}`
    if (starting.length) throw new Error(`conexiones en inicio: ${starting.length}`)
    const sessions = await admin`select pid from pg_stat_activity where datname = ${expectedDatabase} and pid <> ${identity.pid}`
    if (sessions.length) throw new Error(`sesiones ajenas activas: ${sessions.length}`)
    callbackStarted = true
    const result = await work(target)
    const [after] = await target`select current_database() as name, pg_backend_pid() as pid`
    if (after.name !== expectedDatabase || after.pid !== identity.pid) throw new Error('conexión de mantenimiento reemplazada')
    finished = true
    return result
  } finally {
    try {
      if (mustReopen && (finished || !callbackStarted)) {
        let identity
        try {
          ;[identity] = await admin`select pg_backend_pid() as pid, (select backend_start::text from pg_stat_activity where pid = pg_backend_pid()) as started`
        } catch {
          throw new Error('conexión administrativa perdida; base permanece cerrada')
        }
        if (identity.pid !== adminPid || identity.started !== adminStarted) throw new Error('conexión administrativa reemplazada; base permanece cerrada')
        await admin`alter database ${admin(expectedDatabase)} allow_connections true`
      }
    } finally {
      await Promise.allSettled([target.end({ timeout: 5 }), admin.end({ timeout: 5 })])
    }
  }
}
