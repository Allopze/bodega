/**
 * D11 (diseño 2026-08-12), Fase 0: la cola traía cada acción correctiva del
 * PDTP dos veces. `pdtp_action_plan` es un espejo de `prevention_capa_actions`
 * —`createActionPlanItem` y `generateActionPlanFromChecklist` llaman los dos a
 * `createCapaActionWithClient` con `sourceType: 'pdtp'`— y la fuente `capa` de
 * la cola no filtra por origen, así que ya las trae todas. Quien tenía
 * `prevention:pdtp:view` y `prevention:capa:view` veía el mismo hallazgo dos
 * veces, con dos títulos distintos y dos destinos distintos.
 *
 * PGlite propio: los fixtures compartidos tienen asserts sobre totales globales
 * de la cola y agregar filas ahí los correría.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { getOperationalWorkQueue, getOperationalWorkCount } from "@/lib/services/operational-work-queue"

describe("cola operacional — la acción del PDTP no se cuenta dos veces", () => {
  const now = "2026-08-13T12:00:00.000Z"
  const year = new Date().getUTCFullYear()
  const month = new Date().getUTCMonth() + 1
  const worksiteId = "ws-dup"
  const userId = "user-dup"
  const executionId = "exec-dup"
  const capaId = "capa-dup"

  function makeSession(permissions: string[]): Session {
    return {
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        id: userId, name: "Test", email: "dup@chome.cl",
        roles: ["prevencionista"], permissions, worksiteIds: [worksiteId],
        primaryWorksiteId: worksiteId,
        avatarColor: null, isActive: true,
      },
    } as Session
  }

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena Dup", code: "DUP", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Test", email: "dup@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "prog-dup", year, version: 1, title: "Programa Dup", status: "active",
      periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
      elaboratedByName: "Test", elaboratedByTitle: "Prevención",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "act-dup", programId: "prog-dup", n: 1, displayOrder: 1, status: "active",
      activity: "Actividad con hallazgo", program: "Guía",
      responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista",
      scheduleMode: "on_demand", sourceSheetRow: 1, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: executionId, activityId: "act-dup", worksiteId,
      year, month, week: 1, executedQuantity: 1, status: "submitted",
      createdAt: now, updatedAt: now,
    })

    // El par espejo tal como lo produce hoy `createActionPlanItem`: la CAPA
    // primero, la fila del PDTP apuntándola.
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: capaId, code: "CAPA-DUP-001", sourceType: "pdtp", sourceId: executionId,
      sourceItemId: `${executionId}-ap-001`, worksiteId,
      finding: "Extintor sin carga", actionDescription: "Recargar el extintor",
      responsibleUserId: userId, responsibleSnapshot: "prevencionista_faena",
      responsibleRole: "prevencionista_faena",
      priority: "high", targetDate: `${year}-12-31`, status: "pending",
      evidenceRequired: true, createdByUserId: userId,
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  const ambos = ["prevention:pdtp:view", "prevention:capa:view"]

  const acciones = async (session: Session) =>
    (await getOperationalWorkQueue(session)).items.filter((item) => item.sourceType === "capa")

  it("aparece una sola vez para quien ve PDTP y CAPA", async () => {
    expect(await acciones(makeSession(ambos))).toHaveLength(1)
  })

  it("se lee de CAPA, que es donde vive el estado", async () => {
    const [accion] = await acciones(makeSession(ambos))
    expect(accion!.sourceId).toBe(capaId)
    expect(accion!.status).toBe("pending")
  })

  it("queda bajo el módulo PDTP, que es de donde nació", async () => {
    const [accion] = await acciones(makeSession(ambos))
    expect(accion!.module).toBe("pdtp")
    expect(accion!.href).toBe("/prevencion/pdtp/acciones")
  })

  /**
   * `jefe_terreno`, `admin_contrato` y `supervisor_terreno` tienen
   * `prevention:pdtp:view` y `prevention:pdtp:action:manage` pero no
   * `prevention:capa:view`. Son justamente quienes gestionan la acción: si la
   * unificación los dejara fuera, les borraría el trabajo de la cola.
   */
  it("quien sólo ve PDTP la sigue viendo, y no la manda a un módulo sin permiso", async () => {
    const items = await acciones(makeSession(["prevention:pdtp:view"]))
    expect(items).toHaveLength(1)
    expect(items[0]!.href).toBe("/prevencion/pdtp/acciones")
  })

  it("quien sólo ve CAPA la sigue viendo, desde su propia pantalla", async () => {
    const items = await acciones(makeSession(["prevention:capa:view"]))
    expect(items).toHaveLength(1)
    expect(items[0]!.href).toBe(`/prevencion/capa/${capaId}`)
  })

  it("el contador del shell tampoco la cuenta dos veces", async () => {
    expect(await getOperationalWorkCount(makeSession(ambos))).toBe(1)
    expect(await getOperationalWorkCount(makeSession(["prevention:pdtp:view"]))).toBe(1)
    expect(await getOperationalWorkCount(makeSession(["prevention:capa:view"]))).toBe(1)
  })

  /**
   * El daño #2 de D11: mientras la cola leía el espejo, avanzar la acción desde
   * `/prevencion/capa/[id]` la dejaba mostrando el estado viejo — la
   * sincronización PDTP→CAPA era unidireccional. Al leer de CAPA no hay dos
   * estados que puedan separarse.
   */
  it("refleja el avance hecho desde la pantalla de CAPA", async () => {
    await inMemoryDb.update(schema.preventionCapaActions)
      .set({ status: "in_progress" })
      .where(eq(schema.preventionCapaActions.id, capaId))

    const [accion] = await acciones(makeSession(ambos))
    expect(accion!.status).toBe("in_progress")
    expect(accion!.statusLabel).toBe("En proceso")

    await inMemoryDb.update(schema.preventionCapaActions)
      .set({ status: "pending" })
      .where(eq(schema.preventionCapaActions.id, capaId))
  })
})
