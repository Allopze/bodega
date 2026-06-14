const DISPOSABLE_DATABASE_MARKER = /(?:^|[_-])(test|e2e|capture|tmp|temp)(?:$|[_-])/i
const UNSAFE_HOST_MARKER = /(prod|production|staging|stage)/i

type DestructiveDatabaseGuardInput = {
  databaseUrl: string
  allowDestructiveReset: boolean
  context: string
}

export function assertSafeDestructiveDatabase({
  databaseUrl,
  allowDestructiveReset,
  context,
}: DestructiveDatabaseGuardInput) {
  const allowFlagName = `${context}_ALLOW_DESTRUCTIVE_RESET`

  if (!allowDestructiveReset) {
    throw new Error(
      `${allowFlagName}=true is required before resetting a database for ${context}.`,
    )
  }

  const parsed = parsePostgresUrl(databaseUrl)
  const databaseName = getDatabaseName(parsed)

  if (!databaseName || !DISPOSABLE_DATABASE_MARKER.test(databaseName)) {
    throw new Error(
      `Database "${databaseName || "(missing)"}" is not disposable. Use a database name containing _test, _e2e, _capture, _tmp, or _temp.`,
    )
  }

  if (parsed.hostname && UNSAFE_HOST_MARKER.test(parsed.hostname)) {
    throw new Error(`Host "${parsed.hostname}" does not look safe for destructive test resets.`)
  }
}

export function getRedactedDatabaseIdentifier(databaseUrl: string) {
  const parsed = parsePostgresUrl(databaseUrl)
  const host = parsed.host ? `${parsed.host}` : ""
  return `${parsed.protocol}//${host}${parsed.pathname}`
}

export function getMaintenanceDatabaseUrl(databaseUrl: string) {
  const parsed = parsePostgresUrl(databaseUrl)
  parsed.pathname = "/postgres"
  return parsed.toString()
}

export function getDatabaseNameFromUrl(databaseUrl: string) {
  return getDatabaseName(parsePostgresUrl(databaseUrl))
}

export function quotePostgresIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function parsePostgresUrl(databaseUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error("A Postgres connection URL is required for destructive database setup.")
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("A Postgres connection URL is required for destructive database setup.")
  }

  return parsed
}

function getDatabaseName(parsed: URL) {
  const rawName = parsed.pathname.replace(/^\//, "")
  return rawName ? decodeURIComponent(rawName) : ""
}
