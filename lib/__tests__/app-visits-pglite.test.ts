/**
 * Visitas por app (`app_visits`): entrar a una app suma una visita; moverse
 * entre sus pantallas antes de 30 minutos no suma otra; Inicio no es una app.
 * La regla vive en el `ON CONFLICT` de `recordAppVisit`, por eso se prueba
 * contra Postgres y no con dobles.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof inMemoryDb }
testGlobal.__db = inMemoryDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
await inMemoryDb.insert(schema.users).values([
  { id: "u-visit-1", name: "QA Visitas", email: "qa-visitas-1@example.com", hashedPassword: "x" },
  { id: "u-visit-2", name: "QA Visitas 2", email: "qa-visitas-2@example.com", hashedPassword: "x" },
])

const { recordAppVisit, getRecentAppIds } = await import("@/lib/services/app-visits")

const at = (iso: string) => new Date(iso)

describe("visitas por app", () => {
  it("cuenta entradas, no pantallas, y separa por día y persona", async () => {
    // 10:00 hora de Chile = 13:00 UTC (noviembre, UTC-3)
    expect(await recordAppVisit("u-visit-1", "/combustibles", at("2026-11-19T13:00:00Z"))).toBe("combustibles")
    await recordAppVisit("u-visit-1", "/combustibles/cargas", at("2026-11-19T13:10:00Z"))
    await recordAppVisit("u-visit-1", "/combustibles/revisar", at("2026-11-19T13:35:00Z"))
    // Más de 30 minutos desde la última pantalla: otra visita.
    await recordAppVisit("u-visit-1", "/combustibles", at("2026-11-19T14:30:00Z"))
    await recordAppVisit("u-visit-2", "/combustibles", at("2026-11-19T14:31:00Z"))
    await recordAppVisit("u-visit-1", "/reportes", at("2026-11-19T15:00:00Z"))

    const rows = await inMemoryDb.select().from(schema.appVisits)
    const fuel = rows.find((row) => row.userId === "u-visit-1" && row.moduleId === "combustibles")
    expect(fuel?.views).toBe(2)
    expect(rows).toHaveLength(3)

  })

  it("Inicio y rutas sin app no se registran", async () => {
    expect(await recordAppVisit("u-visit-2", "/dashboard", at("2026-11-19T16:00:00Z"))).toBeNull()
    expect(await recordAppVisit("u-visit-2", "/perfil", at("2026-11-19T16:00:00Z"))).toBeNull()
  })

  it("las recientes van de la más nueva a la más vieja", async () => {
    expect(await getRecentAppIds("u-visit-1", 4, at("2026-11-19T20:00:00Z"))).toEqual(["reports", "combustibles"])
  })
})
