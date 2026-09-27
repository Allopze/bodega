/**
 * lib/__tests__/pdtp-scheduled-start.test.ts
 *
 * PREV-M08: `startPdtpScheduledInstance` no tenía prueba. Reserva una
 * ocurrencia programada contra su conector de destino y devuelve el enlace al
 * módulo operativo; las garantías que importan son que dos clics no abran dos
 * trabajos, que un enlace manipulado no reserve contra otro instrumento o
 * destino, y que no se inicie nada sobre un programa, actividad o faena que ya
 * no operan.
 *
 * Pruebas de caracterización sobre el código existente. Encontraron un defecto:
 * `created` salía siempre `false`, porque comparaba el `startedAt` que devuelve
 * la base (texto en formato Postgres) con un ISO de JavaScript. Hoy ningún
 * llamador lo lee, pero la API lo prometía.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { startPdtpScheduledInstance } = await import("@/lib/services/pdtp/scheduled-execution")

const PROGRAM = "prog-start"
const ACT = "act-start"
const WS = "ws-start"
const WS_OTHER = "ws-start-other"
const INSTANCE = "inst-start"
const USER_A = "user-start-a"
const USER_B = "user-start-b"
const now = new Date().toISOString()

async function instanceRow() {
  const [row] = await inMemoryDb.select().from(schema.pdtpScheduledInstances).where(eq(schema.pdtpScheduledInstances.id, INSTANCE))
  return row!
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpActivityExecutionConfigs)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([USER_A, USER_B].map((id) => ({ id, name: id, email: `${id}@test`, hashedPassword: "x" })))
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS, name: "Faena inicio", code: "FI", isActive: true },
    { id: WS_OTHER, name: "Otra faena", code: "OF", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM, year: 2026, version: 1, status: "active", appliesToAllWorksites: true, title: "PDTP inicio",
    elaboratedByName: "X", elaboratedByTitle: "Y", activatedAt: "2026-01-01T00:00:00.000Z", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT, programId: PROGRAM, n: 1, activity: "Capacitación ODI", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivityExecutionConfigs).values({
    id: "cfg-start", activityId: ACT, destinationConnectorKey: "training", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
    id: INSTANCE, programId: PROGRAM, activityId: ACT, worksiteId: WS, scheduledFor: "2026-03-02",
    isoWeekYear: 2026, isoWeek: 10, status: "pending", idempotencyKey: "inst-start-key", createdAt: now, updatedAt: now,
  })
})

describe("startPdtpScheduledInstance", () => {
  it("reserva la instancia y devuelve el enlace contextual al módulo de destino", async () => {
    const result = await startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })
    expect(result.created).toBe(true)
    expect(result.connector.key).toBe("training")
    expect(result.startIdempotencyKey).toBe(`pdtp-start:${INSTANCE}:training:none`)
    const href = new URL(result.startHref, "http://app")
    expect(href.pathname).toBe("/prevencion/capacitacion")
    expect(Object.fromEntries(href.searchParams)).toMatchObject({ faena: WS, programa: PROGRAM, actividad: ACT, instancia: INSTANCE })

    const row = await instanceRow()
    expect(row.status).toBe("in_progress")
    expect(row.startedByUserId).toBe(USER_A)
    expect(row.sourceMetadataJson).toMatchObject({ startIdempotencyKey: result.startIdempotencyKey, destinationConnectorKey: "training" })
  })

  it("es idempotente: un segundo clic, aun de otra persona, no reinicia ni cambia quién la inició", async () => {
    await startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })
    const first = await instanceRow()
    const second = await startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_B })
    expect(second.created).toBe(false)
    const row = await instanceRow()
    expect(row.startedAt).toBe(first.startedAt)
    expect(row.startedByUserId).toBe(USER_A)
  })

  it("una instancia ya enviada sigue enviada al volver a abrirla", async () => {
    await inMemoryDb.update(schema.pdtpScheduledInstances).set({ status: "submitted" }).where(eq(schema.pdtpScheduledInstances.id, INSTANCE))
    await startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })
    expect((await instanceRow()).status).toBe("submitted")
  })

  it("una instancia terminal no se toca", async () => {
    await inMemoryDb.update(schema.pdtpScheduledInstances).set({ status: "completed", completedAt: now })
      .where(eq(schema.pdtpScheduledInstances.id, INSTANCE))
    const result = await startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })
    expect(result.instance.status).toBe("completed")
    expect((await instanceRow()).startedByUserId).toBeNull()
  })

  it("un instrumento pedido por el enlace que la configuración no tiene se rechaza", async () => {
    await expect(startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A, instrumentId: "binding-falso" }))
      .rejects.toThrow(/instrumento/i)
    expect((await instanceRow()).status).toBe("pending")
  })

  it("un conector distinto del configurado se rechaza", async () => {
    await expect(startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A, connectorKey: "inspections" }))
      .rejects.toThrow(/destino operativo/i)
  })

  it("sin destino configurado no hay a dónde ir", async () => {
    await inMemoryDb.delete(schema.pdtpActivityExecutionConfigs)
    await expect(startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })).rejects.toThrow(/destino operativo/i)
  })

  it("no inicia sobre un programa que no está activo", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed" }).where(eq(schema.pdtpPrograms.id, PROGRAM))
    await expect(startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })).rejects.toThrow(/programa no está activo/i)
  })

  it("no inicia una actividad retirada", async () => {
    await inMemoryDb.update(schema.pdtpActivities).set({
      status: "retired", retiredReason: "Retirada por la revisión anual", retiredEffectiveFrom: "2026-01-01", retiredAt: now,
    }).where(eq(schema.pdtpActivities.id, ACT))
    await expect(startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })).rejects.toThrow(/actividad ya no está activa/i)
  })

  it("no inicia en una faena fuera de la membresía del programa", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ appliesToAllWorksites: false }).where(eq(schema.pdtpPrograms.id, PROGRAM))
    await inMemoryDb.insert(schema.pdtpProgramWorksites).values({ id: "pw-start", programId: PROGRAM, worksiteId: WS_OTHER, addedAt: now })
    await expect(startPdtpScheduledInstance({ instanceId: INSTANCE, userId: USER_A })).rejects.toThrow(/faena no está habilitada/i)
  })

  it("una instancia inexistente se informa", async () => {
    await expect(startPdtpScheduledInstance({ instanceId: "no-existe", userId: USER_A })).rejects.toThrow(/no encontrada/i)
  })
})
