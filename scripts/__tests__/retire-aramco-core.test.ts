import { describe, expect, it, vi } from "vitest"
import { retireAramco, type SqlExecutor } from "../retire-aramco-core"

function executor(blocker = false): SqlExecutor {
  return { query: vi.fn(async (sql: string) => {
    if (sql.includes("AS inventory")) return [{ inventory: { sync_runs: 6, settings: 1, cron_runs: 0, suppliers: 1, media: 1, blockers: blocker ? 1 : 0 } }]
    if (sql.includes("FROM users")) return [{ id: "operator", email: "operator@example.test" }]
    return []
  }) }
}

describe("retiro de Aramco", () => {
  it("solo inventaría sin borrar en modo predeterminado", async () => {
    const db = executor()
    const result = await retireAramco(db, { mode: "inventory" })
    expect(result.inventory.sync_runs).toBe(6)
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => /\bDELETE\b|\bINSERT\b/.test(sql))).toBe(false)
  })

  it("rechaza registros que necesitan tratamiento específico antes de cualquier borrado", async () => {
    const db = executor(true)
    await expect(retireAramco(db, { mode: "apply", actor: "operator@example.test", backupRef: "backup-verificado", expectedHash: "any" })).rejects.toThrow(/dependencias/)
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => /\bDELETE\b|\bINSERT\b/.test(sql))).toBe(false)
  })

  it("exige inventario idéntico y deja traza con responsable antes de confirmar", async () => {
    const db = executor()
    const snapshot = await retireAramco(db, { mode: "inventory" })
    await expect(retireAramco(db, { mode: "apply", actor: "operator@example.test", backupRef: "backup-verificado", expectedHash: "stale" })).rejects.toThrow(/inventario cambió/)
    await retireAramco(db, { mode: "apply", actor: "operator@example.test", backupRef: "backup-verificado", expectedHash: snapshot.hash })
    const queries = vi.mocked(db.query).mock.calls.map(([sql]) => sql)
    expect(queries.some(sql => sql.includes("INSERT INTO audit_log"))).toBe(true)
    expect(queries.some(sql => /DELETE FROM dte_documents/.test(sql))).toBe(false)
  })
})
