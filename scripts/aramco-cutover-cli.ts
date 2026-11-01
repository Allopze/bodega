import postgres from "postgres"
import { retireAndMigrateUnderGuard } from "./aramco-cutover-db"
import { retireAramco, type SqlExecutor } from "./retire-aramco-core"

const valueOptions = new Set(["--database", "--cluster", "--role", "--actor", "--backup-ref", "--inventory-hash"])
const flags = new Set(["--apply", "--services-stopped"])
const values = new Map<string, string>()
const selected = new Set<string>()

async function main() {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!
    if (selected.has(key) || (!valueOptions.has(key) && !flags.has(key))) throw new Error(`Opción inválida o repetida: ${key}`)
    selected.add(key)
    if (valueOptions.has(key)) {
      const value = args[++i]
      if (!value || value.startsWith("--")) throw new Error(`Falta valor para ${key}`)
      values.set(key, value)
    }
  }
  const url = process.env.DATABASE_URL
  const database = values.get("--database")
  const cluster = values.get("--cluster")
  const role = values.get("--role")
  if (!url || !database || !cluster || !role) throw new Error("Se requieren DATABASE_URL y --database, --cluster, --role")

  if (!selected.has("--apply")) {
    const sql = postgres(url, { max: 1, onnotice: () => {} })
    try {
      const [identity] = await sql`select current_database() as name, current_user as role, (pg_control_system()).system_identifier::text as cluster_id, pg_is_in_recovery() as in_recovery`
      if (identity?.name !== database || identity.role !== role || identity.cluster_id !== cluster || identity.in_recovery !== false) throw new Error("Base, clúster, rol o estado de réplica inesperado")
      const result = await sql.begin(async tx => {
        await tx.unsafe("SET TRANSACTION READ ONLY")
        const db: SqlExecutor = { query: async (statement, params = []) => Array.from(await tx.unsafe(statement, params as never[])) }
        return retireAramco(db, { mode: "inventory" })
      })
      console.log(JSON.stringify(result, null, 2))
    } finally { await sql.end({ timeout: 5 }) }
    return
  }

  const actor = values.get("--actor")
  const backupRef = values.get("--backup-ref")
  const inventoryHash = values.get("--inventory-hash")
  if (!selected.has("--services-stopped") || !actor || !backupRef || !inventoryHash || !/^[0-9a-f]{64}$/.test(inventoryHash)) {
    throw new Error("Aplicar requiere --services-stopped, --actor, --backup-ref y --inventory-hash válido")
  }
  const result = await retireAndMigrateUnderGuard({
    databaseUrl: url, expectedDatabase: database, expectedClusterId: cluster, expectedRole: role,
    actor, backupRef, inventoryHash, migrationsFolder: "./db/migrations",
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  const raw = error instanceof Error ? error.message : "Error desconocido"
  const message = process.env.DATABASE_URL ? raw.replaceAll(process.env.DATABASE_URL, "[DATABASE_URL]") : raw
  console.error(message)
  if (selected.has("--apply")) console.error("No reiniciar el runtime anterior ni reabrir conexiones sin verificar el estado del corte.")
  process.exitCode = 1
})
