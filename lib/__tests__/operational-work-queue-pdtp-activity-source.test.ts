/**
 * D1 + D2 + D3 del diseño 2026-08-12: las actividades `scheduled` del programa
 * no producían tarea en ninguna parte, y la planilla se la mostraba igual a
 * todos. Esta fuente las trae a la cola filtradas por responsable.
 *
 * PGlite propio: el fixture compartido de operational-assignments.test.ts
 * tiene asserts sobre totales globales de la cola y agregar filas ahí los
 * correría.
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

import { getOperationalWorkQueue } from "@/lib/services/operational-work-queue"
import { chileDateParts } from "@/lib/utils"

describe("cola operacional — actividades programadas del PDTP", () => {
  const now = "2026-08-13T12:00:00.000Z"
  /* En hora de Chile, no UTC: la consulta deriva el período con `chileNow`
   * (`operational-work-queue.ts`), así que sembrar con `getUTCMonth()` dejaba
   * el test rojo cada fin de mes entre las 20:00 y la medianoche — el schedule
   * nacía en el mes siguiente y el filtro `month <= currentMonth` lo excluía. */
  const { year, month } = chileDateParts()
  const worksiteA = "ws-pdtpq-a"
  const worksiteB = "ws-pdtpq-b"
  const programId = "prog-pdtpq"

  /** El mes en curso y uno anterior, para distinguir pendiente de vencida.
   *  En enero no hay mes anterior dentro del año: el caso "vencida" se apoya
   *  en el mes en curso y se verifica sólo la rama que aplica. */
  const previousMonth = month > 1 ? month - 1 : null

  function makeSession(roles: string[], worksiteIds: string[] = [worksiteA, worksiteB]): Session {
    return {
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        id: "user-pdtpq", name: "Test", email: "pdtpq@chome.cl",
        roles, permissions: ["prevention:pdtp:view"], worksiteIds,
        primaryWorksiteId: worksiteIds[0] ?? null,
        avatarColor: null, isActive: true,
      },
    } as Session
  }

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena PDTPQ A", code: "PDTPQ-A", isActive: true, createdAt: now, updatedAt: now },
      { id: worksiteB, name: "Faena PDTPQ B", code: "PDTPQ-B", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.users).values({
      id: "user-pdtpq", name: "Test", email: "pdtpq@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
      { slug: "jt", displayName: "Jefe de terreno PDTPQ", roleName: "jefe_terreno", kind: "rbac_role", isActive: true },
      { slug: "prf", displayName: "Prevencionista PDTPQ", roleName: "prevencionista_faena", kind: "rbac_role", isActive: true },
    ])
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: programId, year, version: 1, title: "Programa PDTPQ", status: "active",
      periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
      elaboratedByName: "Test PDTPQ", elaboratedByTitle: "Prevención",
      createdAt: now, updatedAt: now,
    })

    // N°1 le toca al jefe de terreno; N°2 al prevencionista de faena.
    await inMemoryDb.insert(schema.pdtpActivities).values([
      {
        id: "act-pdtpq-jt", programId, n: 1, displayOrder: 1, status: "active",
        activity: "Actividad del jefe de terreno", program: "Guía",
        responsibleSlugs: ["jt"], responsibleDisplay: "Jefe de terreno PDTPQ",
        scheduleMode: "scheduled", mechanism: "constancia", sourceSheetRow: 1, createdAt: now, updatedAt: now,
      },
      {
        id: "act-pdtpq-prf", programId, n: 10, displayOrder: 2, status: "active",
        activity: "Actividad del prevencionista", program: "Guía",
        responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista PDTPQ",
        /* n=10 y no un número cualquiera: es una de las que el contrato mapea a
         * Inspecciones. Con un número fuera del mapa este caso caía al fallback
         * de la planilla y pasaba en verde sin ejercitar el enrutamiento. */
        scheduleMode: "scheduled", mechanism: "enganche", sourceSheetRow: 2, createdAt: now, updatedAt: now,
      },
      {
        id: "act-pdtpq-ondemand", programId, n: 3, displayOrder: 3, status: "active",
        activity: "Actividad a demanda del jefe de terreno", program: "Guía",
        responsibleSlugs: ["jt"], responsibleDisplay: "Jefe de terreno PDTPQ",
        scheduleMode: "on_demand", sourceSheetRow: 3, createdAt: now, updatedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values([
      { id: "sch-jt", activityId: "act-pdtpq-jt", year, month, week: 1, plannedQuantity: 1, sourceColumn: "test" },
      { id: "sch-prf", activityId: "act-pdtpq-prf", year, month, week: 1, plannedQuantity: 1, sourceColumn: "test" },
      // Una `on_demand` con calendario no debe aparecer: su denominador son los
      // casos reales, no el plan.
      { id: "sch-od", activityId: "act-pdtpq-ondemand", year, month, week: 1, plannedQuantity: 1, sourceColumn: "test" },
    ])
  })

  afterAll(async () => { await pg.close() })

  const pdtpItems = async (session: Session) =>
    (await getOperationalWorkQueue(session, { module: "pdtp" })).items
      .filter((item) => item.sourceType === "pdtp_activity")

  it("le muestra al jefe de terreno sólo lo suyo", async () => {
    const items = await pdtpItems(makeSession(["jefe_terreno"]))
    expect(items.every((item) => item.sourceId.startsWith("act-pdtpq-jt:"))).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })

  it("le muestra al prevencionista sólo lo suyo", async () => {
    const items = await pdtpItems(makeSession(["prevencionista_faena"]))
    expect(items.every((item) => item.sourceId.startsWith("act-pdtpq-prf:"))).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })

  it("no le muestra nada a un rol que no es responsable de ninguna actividad", async () => {
    expect(await pdtpItems(makeSession(["bodeguero"]))).toHaveLength(0)
    expect(await pdtpItems(makeSession([]))).toHaveLength(0)
  })

  it("deja fuera las actividades on_demand: su denominador son los casos, no el plan", async () => {
    const items = await pdtpItems(makeSession(["jefe_terreno"]))
    expect(items.some((item) => item.sourceId.startsWith("act-pdtpq-ondemand:"))).toBe(false)
  })

  it("sin membresía de faenas declarada, aplica a todas las del alcance", async () => {
    const items = await pdtpItems(makeSession(["jefe_terreno"]))
    expect(new Set(items.map((item) => item.worksiteId))).toEqual(new Set([worksiteA, worksiteB]))
  })

  it("respeta el alcance de faenas del usuario", async () => {
    const items = await pdtpItems(makeSession(["jefe_terreno"], [worksiteA]))
    expect(items.map((item) => item.worksiteId)).toEqual([worksiteA])
  })

  it("una ejecución registrada saca la actividad de la cola de esa faena", async () => {
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-pdtpq", activityId: "act-pdtpq-jt", worksiteId: worksiteA,
      year, month, week: 1, executedQuantity: 1, status: "submitted",
      createdAt: now, updatedAt: now,
    })
    const items = await pdtpItems(makeSession(["jefe_terreno"]))
    expect(items.map((item) => item.worksiteId)).toEqual([worksiteB])
    await inMemoryDb.delete(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, "exec-pdtpq"))
  })

  it("una ejecución rechazada no la saca: el trabajo se vuelve a deber", async () => {
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-pdtpq-rej", activityId: "act-pdtpq-jt", worksiteId: worksiteA,
      year, month, week: 1, executedQuantity: 1, status: "rejected",
      createdAt: now, updatedAt: now,
    })
    const items = await pdtpItems(makeSession(["jefe_terreno"]))
    expect(new Set(items.map((item) => item.worksiteId))).toEqual(new Set([worksiteA, worksiteB]))
    await inMemoryDb.delete(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, "exec-pdtpq-rej"))
  })

  it("una exclusión por faena la saca sólo de esa faena", async () => {
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-pdtpq", activityId: "act-pdtpq-jt", worksiteId: worksiteB,
      reason: "No aplica en esta faena", createdAt: now,
    })
    const items = await pdtpItems(makeSession(["jefe_terreno"]))
    expect(items.map((item) => item.worksiteId)).toEqual([worksiteA])
    await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
      .where(eq(schema.pdtpActivityWorksiteExclusions.id, "excl-pdtpq"))
  })

  it("un programa que no está activo no genera trabajo", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, programId))
    expect(await pdtpItems(makeSession(["jefe_terreno"]))).toHaveLength(0)
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" })
      .where(eq(schema.pdtpPrograms.id, programId))
  })

  it("lo planificado en un mes anterior sin ejecutar sale como vencida", async () => {
    if (previousMonth === null) return // enero: no hay mes anterior dentro del año
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sch-jt-prev", activityId: "act-pdtpq-jt", year, month: previousMonth,
      week: 1, plannedQuantity: 1, sourceColumn: "test",
    })
    const items = await pdtpItems(makeSession(["jefe_terreno"], [worksiteA]))
    expect(items).toHaveLength(1)
    expect(items[0]!.status).toBe("overdue")
    expect(items[0]!.statusLabel).toBe("Vencida")
    await inMemoryDb.delete(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.id, "sch-jt-prev"))
  })

  /* D12: cada mecanismo manda a donde el trabajo se registra de verdad. El
   * enganche va al módulo que dice el contrato anual —no a la planilla, que es
   * lo que hacía el CASE de SQL cuando el contrato no existía—: el responsable
   * que abre su tarjeta tiene que aterrizar donde puede cumplirla. */
  it("cada mecanismo manda al módulo donde se cumple (D12)", async () => {
    const [constancia] = await pdtpItems(makeSession(["jefe_terreno"], [worksiteA]))
    expect(constancia!.href).toContain("/prevencion/constancias")
    expect(constancia!.ctaLabel).toBe("Dejar constancia")

    const [enganche] = await pdtpItems(makeSession(["prevencionista_faena"], [worksiteA]))
    expect(enganche!.href).toContain("/prevencion/inspecciones")
    expect(enganche!.href).toContain(worksiteA)
    expect(enganche!.ctaLabel).toBe("Ir a cumplirla")
    // El módulo de la fila sigue siendo `pdtp`: es lo que filtran los chips.
    expect(enganche!.module).toBe("pdtp")
  })

  /* Un enganche sin entrada en el contrato —una actividad nueva todavía sin
   * cablear— cae a la planilla en vez de a un href inventado. */
  it("un enganche sin destino declarado cae a la planilla", async () => {
    await inMemoryDb.update(schema.pdtpActivities).set({ n: 998 })
      .where(eq(schema.pdtpActivities.id, "act-pdtpq-prf"))
    try {
      const [enganche] = await pdtpItems(makeSession(["prevencionista_faena"], [worksiteA]))
      expect(enganche!.href).toContain("/prevencion/pdtp/actividades")
      expect(enganche!.ctaLabel).toBe("Ver cómo se cumple")
    } finally {
      await inMemoryDb.update(schema.pdtpActivities).set({ n: 10 })
        .where(eq(schema.pdtpActivities.id, "act-pdtpq-prf"))
    }
  })

  it("lo planificado en el mes en curso sin ejecutar sale como pendiente", async () => {
    const items = await pdtpItems(makeSession(["jefe_terreno"], [worksiteA]))
    expect(items).toHaveLength(1)
    expect(items[0]!.status).toBe("pending")
    expect(items[0]!.statusLabel).toBe("Pendiente")
  })
})
