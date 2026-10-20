import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { countOverdueInspectionPrograms, listInspectionPrograms } from "@/lib/services/prevention-inspections"
import { inspectionProgramIsOverdue } from "@/lib/prevention/inspections"

/**
 * El aviso «N programaciones vencidas» de la bandeja se contaba trayendo todas las programaciones con
 * sus joins y filtrando en memoria con `inspectionProgramIsOverdue`. Ahora es un COUNT en SQL: la
 * prueba fija que sigue siendo la misma regla —activa, plantilla aprobada, próxima fecha ya pasada— y
 * que respeta el alcance de faenas y el filtro de tipos, como la lista de la que salía.
 */

const TODAY = "2026-10-20"
const userId = "user-overdue-programs"
const wsA = "ws-overdue-a"
const wsB = "ws-overdue-b"

const access = (ids: string[], permissions = ["prevention:inspections:view"]) => ({
  userId,
  scope: { mode: "some", ids } as WorksiteScope,
  permissions,
})

let seq = 0
async function seedTemplate(id: string, status: string, kind = "inspection") {
  const now = new Date().toISOString()
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id,
    code: id,
    versionLabel: "01",
    name: `Plantilla ${id}`,
    kind,
    sourceDefinitionCode: null,
    definitionSnapshot: {},
    contentHash: id.padEnd(64, "0").slice(0, 64),
    status,
    authorUserId: userId,
    approvedByUserId: status === "approved" ? userId : null,
    approvedAt: status === "approved" ? now : null,
    createdAt: now,
    updatedAt: now,
  } as never)
}

async function seedProgram(over: { templateId: string; worksiteId?: string; nextDueOn: string; isActive?: boolean }) {
  seq += 1
  await testDb.insert(schema.preventionInspectionPrograms).values({
    id: `insprog-overdue-${seq}`,
    templateId: over.templateId,
    worksiteId: over.worksiteId ?? wsA,
    frequency: "monthly",
    intervalDays: 30,
    nextDueOn: over.nextDueOn,
    isActive: over.isActive ?? true,
    createdByUserId: userId,
  } as never)
}

describe("countOverdueInspectionPrograms", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: userId, name: "Prevencionista", email: "overdue-programs@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values([
      { id: wsA, name: "Faena A", code: "OVA", isActive: true, createdAt: now, updatedAt: now },
      { id: wsB, name: "Faena B", code: "OVB", isActive: true, createdAt: now, updatedAt: now },
    ])
    await seedTemplate("tpl-ok", "approved")
    await seedTemplate("tpl-audit", "approved", "audit")
    await seedTemplate("tpl-draft", "draft")
    await seedTemplate("tpl-retired", "superseded")

    await seedProgram({ templateId: "tpl-ok", nextDueOn: "2026-10-19" }) // vencida (ayer)
    await seedProgram({ templateId: "tpl-ok", nextDueOn: "2026-01-05" }) // vencida (hace meses)
    await seedProgram({ templateId: "tpl-ok", nextDueOn: TODAY }) // vence hoy: todavía no está vencida
    await seedProgram({ templateId: "tpl-ok", nextDueOn: "2026-11-01" }) // futura
    await seedProgram({ templateId: "tpl-ok", nextDueOn: "2026-02-01", isActive: false }) // detenida
    await seedProgram({ templateId: "tpl-draft", nextDueOn: "2026-02-01" }) // plantilla sin aprobar
    await seedProgram({ templateId: "tpl-retired", nextDueOn: "2026-02-01" }) // plantilla retirada
    await seedProgram({ templateId: "tpl-audit", nextDueOn: "2026-03-01" }) // vencida, de otro tipo
    await seedProgram({ templateId: "tpl-ok", worksiteId: wsB, nextDueOn: "2026-03-01" }) // vencida, de otra faena
  })

  afterAll(async () => pg.close())

  it("cuenta las activas con plantilla aprobada y fecha ya pasada, y nada más", async () => {
    // A: 2 de «ok» + 1 de «audit»; B: 1. La de hoy, la futura, la detenida, el borrador y la retirada no.
    expect(await countOverdueInspectionPrograms(access([wsA, wsB]), {}, TODAY)).toBe(4)
  })

  it("«vence hoy» no es vencida: el límite es estrictamente anterior a hoy", async () => {
    // Un día después, la que vencía el 20 ya cuenta.
    expect(await countOverdueInspectionPrograms(access([wsA]), {}, "2026-10-21")).toBe(4)
    expect(await countOverdueInspectionPrograms(access([wsA]), {}, TODAY)).toBe(3)
  })

  it("respeta el alcance de faenas", async () => {
    expect(await countOverdueInspectionPrograms(access([wsA]), {}, TODAY)).toBe(3)
    expect(await countOverdueInspectionPrograms(access([wsB]), {}, TODAY)).toBe(1)
    expect(await countOverdueInspectionPrograms(access([]), {}, TODAY)).toBe(0)
    expect(await countOverdueInspectionPrograms({ userId, scope: { mode: "none" } as WorksiteScope, permissions: ["prevention:inspections:view"] }, {}, TODAY)).toBe(0)
  })

  it("respeta el filtro de tipos de la bandeja", async () => {
    expect(await countOverdueInspectionPrograms(access([wsA]), { kinds: ["audit"] }, TODAY)).toBe(1)
    expect(await countOverdueInspectionPrograms(access([wsA]), { kinds: ["inspection"] }, TODAY)).toBe(2)
    expect(await countOverdueInspectionPrograms(access([wsA]), { kinds: ["observation"] }, TODAY)).toBe(0)
  })

  it("pide el permiso de ver, como la lista de programaciones", async () => {
    await expect(countOverdueInspectionPrograms(access([wsA], []), {}, TODAY)).rejects.toThrow()
  })

  it("es la misma cifra que traer todas las programaciones y filtrarlas con la regla compartida", async () => {
    // Es lo que hacía la pantalla antes: si la regla cambia en un lugar y no en el otro, esto lo delata.
    for (const filter of [{}, { kinds: ["audit"] }, { kinds: ["inspection"] }]) {
      const rows = await listInspectionPrograms(access([wsA, wsB]), filter)
      const enMemoria = rows.filter((row) => inspectionProgramIsOverdue(
        { isActive: row.program.isActive, templateApproved: row.templateStatus === "approved", nextDueOn: row.program.nextDueOn },
        TODAY,
      )).length
      expect(await countOverdueInspectionPrograms(access([wsA, wsB]), filter, TODAY), JSON.stringify(filter)).toBe(enMemoria)
    }
  })
})
