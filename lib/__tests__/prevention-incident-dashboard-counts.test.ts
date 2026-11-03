/**
 * Fase 0.7 (AUDITORIA_VISUALIZACIONES_CHOME): las cuatro tarjetas de
 * /prevencion/incidentes contaban todo el alcance del usuario aunque la lista de
 * abajo estuviera filtrada por faena, período, indicador, tipo o estado. Se fija
 * el invariante: cada tarjeta es lo que la lista mostraría al activarla con los
 * mismos filtros, y se arma con la misma cláusula (`incidentListConditions`),
 * así que no pueden separarse.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { IncidentAccess } from "@/lib/services/prevention-incidents"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const USER_ID = "u-inc-counts"
const WS_A = "ws-inc-a"
const WS_B = "ws-inc-b"
const WS_FOREIGN = "ws-inc-foreign"

function access(overrides: Partial<IncidentAccess> = {}): IncidentAccess {
  return {
    ctx: { userId: USER_ID },
    scope: { mode: "some", ids: [WS_A, WS_B] },
    permissions: ["prevention:incidents:view"],
    ...overrides,
  }
}

type IncidentSeed = {
  id: string
  worksiteId: string
  eventType: string
  status: string
  occurredAt: string
  isFatalOrSerious?: boolean
  overdueNotification?: boolean
  pendingPerson?: boolean
}

// Cuadro del conjunto (alcance del visor: A y B; la ajena nunca se cuenta):
//  a-reportado      A  accidente laboral   reportado             2026-03  —
//  a-investigando   A  accidente laboral   en investigación      2026-05  fatal · plazo vencido
//  a-cerrado        A  incidente peligroso cerrado               2026-05  —
//  b-medidas        B  daño material       medidas inmediatas    2026-05  grave
//  b-2025           B  accidente laboral   reportado             2025-11  —
//  ajena            C  accidente laboral   en investigación      2026-05  fatal · plazo vencido
const SEED: IncidentSeed[] = [
  { id: "a-reportado", worksiteId: WS_A, eventType: "work_accident", status: "reported", occurredAt: "2026-03-10T15:00:00.000Z", pendingPerson: true },
  { id: "a-investigando", worksiteId: WS_A, eventType: "work_accident", status: "under_investigation", occurredAt: "2026-05-20T15:00:00.000Z", isFatalOrSerious: true, overdueNotification: true },
  { id: "a-cerrado", worksiteId: WS_A, eventType: "dangerous_incident", status: "closed", occurredAt: "2026-05-02T15:00:00.000Z" },
  { id: "b-medidas", worksiteId: WS_B, eventType: "material_damage", status: "immediate_measures", occurredAt: "2026-05-15T15:00:00.000Z", isFatalOrSerious: true },
  { id: "b-2025", worksiteId: WS_B, eventType: "work_accident", status: "reported", occurredAt: "2025-11-12T15:00:00.000Z" },
  { id: "ajena", worksiteId: WS_FOREIGN, eventType: "work_accident", status: "under_investigation", occurredAt: "2026-05-20T15:00:00.000Z", isFatalOrSerious: true, overdueNotification: true },
]

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionIncidentPeople)
  await inMemoryDb.delete(schema.preventionIncidentNotifications)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values({ id: USER_ID, name: "Prevencionista", email: "inc-counts@example.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "INCA", isActive: true },
    { id: WS_B, name: "Faena B", code: "INCB", isActive: true },
    { id: WS_FOREIGN, name: "Faena ajena", code: "INCX", isActive: true },
  ])

  for (const seed of SEED) {
    const occurred = new Date(seed.occurredAt)
    const known = new Date(occurred.getTime() + 30 * 60_000).toISOString()
    await inMemoryDb.insert(schema.preventionIncidents).values({
      id: seed.id,
      code: `INC-${seed.id}`,
      clientSubmissionId: `sub-${seed.id}`,
      worksiteId: seed.worksiteId,
      companyName: "Empresa Test",
      eventType: seed.eventType,
      status: seed.status,
      occurredAt: seed.occurredAt,
      knownAt: known,
      location: "Planta",
      initialNarrative: "Evento de prueba para las tarjetas.",
      reportedByUserId: USER_ID,
      isFatalOrSerious: seed.isFatalOrSerious ?? false,
      createdAt: known,
      updatedAt: known,
    })
    if (seed.overdueNotification) {
      await inMemoryDb.insert(schema.preventionIncidentNotifications).values({
        id: `n-${seed.id}`, incidentId: seed.id, notificationType: "diat", status: "overdue", createdAt: known, updatedAt: known,
      })
    }
    if (seed.pendingPerson) {
      // Persona sin clasificar para el indicador (`pending` es el valor por defecto).
      await inMemoryDb.insert(schema.preventionIncidentPeople).values({
        id: `p-${seed.id}`, incidentId: seed.id, displayLabel: "Trabajador 1", employerName: "Empresa Test",
        relationshipType: "employee", createdAt: known, updatedAt: known,
      })
    }
  }
})

type Filters = {
  status?: string
  worksiteId?: string
  eventType?: string
  year?: number
  monthFrom?: number
  monthTo?: number
  indicator?: "accidentability" | "frequency" | "severity" | "pending"
}

/** Lo que la tarjeta dice y lo que la lista da al activarla (mismos filtros, regla de cada tarjeta). */
async function tiles(filters: Filters = {}, who: IncidentAccess = access()) {
  const { getIncidentDashboardCounts, listPreventionIncidents } = await import("@/lib/services/prevention-incidents")
  const counts = await getIncidentDashboardCounts(who, filters as Parameters<typeof getIncidentDashboardCounts>[1])
  const rows = await listPreventionIncidents({ access: who, ...filters } as Parameters<typeof listPreventionIncidents>[0])
  const fromList = {
    totalOpen: rows.filter((row) => row.status !== "closed").length,
    overdueNotifications: rows.filter((row) => row.hasOverdueNotifications).length,
    fatalOrSerious: rows.filter((row) => row.isFatalOrSerious && row.status !== "closed").length,
    pendingInvestigation: rows.filter((row) => ["immediate_measures", "under_investigation"].includes(row.status)).length,
  }
  return { counts, fromList }
}

describe("tarjetas de incidentes — responden a los mismos filtros que la lista", () => {
  // Causa raíz aparte: en un FROM de una sola tabla Drizzle emitía `n.incident_id = "id"` sin
  // calificar, y dentro del EXISTS `"id"` es la `id` de la notificación: la tarjeta era siempre 0.
  it("«Plazos atrasados» cuenta los incidentes con un carril vencido (antes quedaba siempre en 0)", async () => {
    const { getIncidentDashboardCounts } = await import("@/lib/services/prevention-incidents")

    expect((await getIncidentDashboardCounts(access())).overdueNotifications).toBe(1)
  })

  it("sin filtros cuenta todo el alcance (sin la faena ajena), como antes", async () => {
    const { counts, fromList } = await tiles()

    expect(counts).toEqual({ totalOpen: 4, overdueNotifications: 1, fatalOrSerious: 2, pendingInvestigation: 2 })
    expect(counts).toEqual(fromList)
  })

  it("con una faena elegida cuenta sólo esa faena", async () => {
    const { counts, fromList } = await tiles({ worksiteId: WS_A })

    expect(counts).toEqual({ totalOpen: 2, overdueNotifications: 1, fatalOrSerious: 1, pendingInvestigation: 1 })
    expect(counts).toEqual(fromList)
  })

  it("con un año elegido cuenta sólo ese año (Chile)", async () => {
    const y2026 = await tiles({ year: 2026 })
    const y2025 = await tiles({ year: 2025 })

    expect(y2026.counts).toEqual({ totalOpen: 3, overdueNotifications: 1, fatalOrSerious: 2, pendingInvestigation: 2 })
    expect(y2026.counts).toEqual(y2026.fromList)
    expect(y2025.counts).toEqual({ totalOpen: 1, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 })
    expect(y2025.counts).toEqual(y2025.fromList)
  })

  it("con un rango de meses elegido cuenta sólo ese rango", async () => {
    const { counts, fromList } = await tiles({ year: 2026, monthFrom: 5, monthTo: 5 })

    expect(counts).toEqual({ totalOpen: 2, overdueNotifications: 1, fatalOrSerious: 2, pendingInvestigation: 2 })
    expect(counts).toEqual(fromList)
  })

  it("con el drill-down de un indicador cuenta sólo las fuentes de ese indicador", async () => {
    const { counts, fromList } = await tiles({ year: 2026, indicator: "pending" })

    expect(counts).toEqual({ totalOpen: 1, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 })
    expect(counts).toEqual(fromList)
  })

  it("con un tipo de evento elegido cuenta sólo ese tipo", async () => {
    const { counts, fromList } = await tiles({ eventType: "work_accident" })

    expect(counts).toEqual({ totalOpen: 3, overdueNotifications: 1, fatalOrSerious: 1, pendingInvestigation: 1 })
    expect(counts).toEqual(fromList)
  })

  it("con un estado elegido cuenta lo que la lista mostraría en ese estado", async () => {
    const { counts, fromList } = await tiles({ status: "under_investigation" })

    expect(counts).toEqual({ totalOpen: 1, overdueNotifications: 1, fatalOrSerious: 1, pendingInvestigation: 1 })
    expect(counts).toEqual(fromList)
  })

  it("combina faena, tipo y período igual que la lista", async () => {
    const { counts, fromList } = await tiles({ worksiteId: WS_A, eventType: "work_accident", year: 2026, monthFrom: 1, monthTo: 4 })

    expect(counts).toEqual({ totalOpen: 1, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 })
    expect(counts).toEqual(fromList)
  })
})

describe("tarjetas de incidentes — alcance y permiso intactos", () => {
  it("pedir una faena fuera del alcance falla igual que la lista, sin abrir datos ajenos", async () => {
    const { getIncidentDashboardCounts, listPreventionIncidents } = await import("@/lib/services/prevention-incidents")

    await expect(getIncidentDashboardCounts(access(), { worksiteId: WS_FOREIGN })).rejects.toThrow("fuera de alcance")
    await expect(listPreventionIncidents({ access: access(), worksiteId: WS_FOREIGN })).rejects.toThrow("fuera de alcance")
  })

  it("un usuario sin alcance (none) ve las tarjetas en cero", async () => {
    const { counts } = await tiles({}, access({ scope: { mode: "none", ids: [] } }))

    expect(counts).toEqual({ totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 })
  })

  it("sin el permiso de ver incidentes falla aunque se pasen filtros", async () => {
    const { getIncidentDashboardCounts } = await import("@/lib/services/prevention-incidents")

    await expect(getIncidentDashboardCounts(access({ permissions: [] }), { worksiteId: WS_A })).rejects.toThrow("fuera de alcance")
  })

  it("con alcance total (all) cuenta también la faena ajena cuando se la pide", async () => {
    const { counts, fromList } = await tiles({ worksiteId: WS_FOREIGN }, access({ scope: { mode: "all", ids: [] } }))

    expect(counts).toEqual({ totalOpen: 1, overdueNotifications: 1, fatalOrSerious: 1, pendingInvestigation: 1 })
    expect(counts).toEqual(fromList)
  })
})
