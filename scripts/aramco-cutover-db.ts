import type postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { assertAllMigrationsApplied, inspectSkippedMigrations, runMigrationPreflight } from "./migration-preflight.mjs"
import { withDatabaseQuiesced } from "./aramco-cutover-guard.mjs"
import { retireAramco, type SqlExecutor } from "./retire-aramco-core"

/** One-way database stage. Caller must stop all application/scheduler writers,
 * verify a restorable backup, and keep the old runtime stopped. This function
 * never deploys, restores, or restarts anything. */
export async function retireAndMigrateUnderGuard(options: {
  databaseUrl: string
  expectedDatabase: string
  expectedClusterId: string
  expectedRole: string
  actor: string
  backupRef: string
  inventoryHash: string
  migrationsFolder: string
}) {
  return withDatabaseQuiesced(options.databaseUrl, options.expectedDatabase, async (sql: postgres.Sql) => {
    await runMigrationPreflight(sql)
    const before = await inspectSkippedMigrations(sql, options.migrationsFolder)
    if (before.skipped.length || before.missing.length !== 1 || before.missing[0] !== "0367_overconfident_luminals") {
      throw new Error("Se esperaba únicamente la migración 0367 pendiente")
    }
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      const db: SqlExecutor = { query: async (statement, params = []) => Array.from(await tx.unsafe(statement, params as never[])) }
      return retireAramco(db, {
        mode: "apply", actor: options.actor, backupRef: options.backupRef, expectedHash: options.inventoryHash,
      })
    })
    await migrate(drizzle(sql), { migrationsFolder: options.migrationsFolder })
    assertAllMigrationsApplied(await inspectSkippedMigrations(sql, options.migrationsFolder))
    return result
  }, { clusterId: options.expectedClusterId, role: options.expectedRole })
}
