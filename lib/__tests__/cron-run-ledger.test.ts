/**
 * OBS-002 (auditoría 2026-09-14): diecinueve de los veintiséis crones no
 * dejaban rastro de haber corrido. Varios son el único mecanismo que hace
 * visible un vencimiento —`MIP-001`, `MNT-001`, `FLO-002` describen lo que pasa
 * cuando no hay cron—, de modo que «el cron existe» y «el cron se está
 * ejecutando» eran dos cosas distintas y sólo la primera era comprobable.
 *
 * La bitácora se escribe en `withCronLock`, que es por donde pasan todos: una
 * sola corrección para los veintiséis.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { withCronLock, getCronJobHealth } = await import("@/lib/services/cron-lock")

const runs = async () =>
  testDb.select().from(schema.cronRuns).orderBy(asc(schema.cronRuns.startedAt))

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
})
beforeEach(async () => { await testDb.delete(schema.cronRuns) })

describe("withCronLock deja constancia de la corrida", () => {
  it("una corrida exitosa queda cerrada, con duración y sin detalle", async () => {
    const result = await withCronLock("prueba-ok", async () => ({ opened: 3 }))
    expect(result).toEqual({ opened: 3 })

    const [row] = await runs()
    expect(row?.jobName).toBe("prueba-ok")
    expect(row?.outcome).toBe("success")
    expect(row?.finishedAt).toBeTruthy()
    expect(row?.durationMs).toBeGreaterThanOrEqual(0)
    expect(row?.detail).toBeNull()
  })

  it("una corrida que falla queda registrada, y el error sigue subiendo", async () => {
    await expect(withCronLock("prueba-falla", async () => {
      throw new Error("la integración respondió 500")
    })).rejects.toThrow("la integración respondió 500")

    const [row] = await runs()
    expect(row?.outcome).toBe("failed")
    expect(row?.detail).toContain("respondió 500")
    // El contrato HTTP y el código de salida los decide cada ruta, no la
    // bitácora: por eso el error se relanza en vez de tragarse.
    expect(row?.finishedAt).toBeTruthy()
  })

  it("el detalle se recorta: es una tabla, no un volcado de stack", async () => {
    await expect(withCronLock("prueba-larga", async () => {
      throw new Error("x".repeat(2000))
    })).rejects.toThrow()
    expect((await runs())[0]?.detail?.length).toBe(500)
  })

  it("cada corrida es una fila: se puede ver la cadencia, no sólo la última", async () => {
    await withCronLock("prueba-cadencia", async () => null)
    await withCronLock("prueba-cadencia", async () => null)
    await withCronLock("prueba-cadencia", async () => null)
    expect(await runs()).toHaveLength(3)
  })

  it("un job que nunca corrió simplemente no tiene filas: eso es la señal", async () => {
    await withCronLock("prueba-si-corre", async () => null)
    const salud = await getCronJobHealth()
    expect(salud.map((s) => s.jobName)).toEqual(["prueba-si-corre"])
    expect(salud.find((s) => s.jobName === "prueba-nunca-corrio")).toBeUndefined()
  })
})

describe("getCronJobHealth", () => {
  it("devuelve la última corrida de cada job, no todas", async () => {
    await withCronLock("job-a", async () => null)
    await expect(withCronLock("job-b", async () => { throw new Error("cayó") })).rejects.toThrow()
    await withCronLock("job-a", async () => null)

    const salud = await getCronJobHealth()
    expect(salud).toHaveLength(2)
    expect(salud.find((s) => s.jobName === "job-a")?.lastOutcome).toBe("success")
    expect(salud.find((s) => s.jobName === "job-b")?.lastOutcome).toBe("failed")
    expect(salud.find((s) => s.jobName === "job-b")?.lastDetail).toContain("cayó")
  })

  it("la última corrida es la más reciente, aunque la anterior haya fallado", async () => {
    await expect(withCronLock("job-c", async () => { throw new Error("primera") })).rejects.toThrow()
    await withCronLock("job-c", async () => null)

    const salud = await getCronJobHealth()
    expect(salud.find((s) => s.jobName === "job-c")?.lastOutcome).toBe("success")
  })

  it("no mira más atrás de la ventana pedida", async () => {
    await withCronLock("job-viejo", async () => null)
    await testDb.update(schema.cronRuns)
      .set({ startedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(schema.cronRuns.jobName, "job-viejo"))

    expect(await getCronJobHealth(30)).toEqual([])
  })
})
