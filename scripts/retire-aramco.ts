/** Inventory by default; --apply requires a matching inventory, operator and verified backup reference. */
import postgres from "postgres"
import { retireAramco, type SqlExecutor } from "./retire-aramco-core"

const arg = (name: string) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? "" : process.argv[index + 1] ?? ""
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es requerido")
  const apply = process.argv.includes("--apply")
  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  try {
    const result = await sql.begin(async tx => {
      await tx.unsafe(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE${apply ? "" : " READ ONLY"}`)
      const db: SqlExecutor = { query: async (statement, params = []) => Array.from(await tx.unsafe(statement, params as never[])) }
      return retireAramco(db, apply
        ? { mode: "apply", actor: arg("--actor"), backupRef: arg("--backup-ref"), expectedHash: arg("--inventory-hash") }
        : { mode: "inventory" })
    })
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await sql.end()
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Error desconocido"); process.exitCode = 1 })
