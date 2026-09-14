import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { CampaignAccess } from "@/lib/services/prevention-campaigns"
import { chileDateParts } from "@/lib/utils"

/* El motor sólo acredita cuando el año del programa coincide con el del evento
 * (ver `accreditation.ts`: "El evento ocurrió fuera del año del programa
 * activo"). Con el año fijo en 2026 estas pruebas dejaban de ejercitar el
 * camino feliz al cambiar de año civil. Se siembran con el año en curso. */
const PROGRAM_YEAR = chileDateParts().year


const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite compatibility
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const USER_ID = "u-cmp-1"
const WS_ID = "ws-cmp-1"
const WORKER_1 = "wrk-cmp-1"
const WORKER_2 = "wrk-cmp-2"
const PROGRAM_ID = "pdtp-cmp-prog"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.preventionCampaignAttendance)
  await inMemoryDb.delete(schema.preventionCampaigns)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Prevencionista Campañas",
    email: "camp@example.test",
    hashedPassword: "x",
  })

  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID,
    name: "Faena Campañas",
    code: "FCMP",
    isActive: true,
  })

  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_1,
    worksiteId: WS_ID,
    rut: "11.111.111-1",
    firstName: "Juan",
    lastName: "Pérez",
    isActive: true,
  })

  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_2,
    worksiteId: WS_ID,
    rut: "22.222.222-2",
    firstName: "Maria",
    lastName: "Gomez",
    isActive: true,
  })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    year: PROGRAM_YEAR,
    version: 1,
    title: `PDTP ${PROGRAM_YEAR} Campañas Test`,
    status: "active",
    elaboratedByName: "Prevencionista",
    elaboratedByTitle: "Experto",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: "act-85",
    programId: PROGRAM_ID,
    n: 85,
    activity: "Campaña Uso de EPP",
    program: "Prevención",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    indicatorMode: "coverage",
    sourceSheetRow: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
})

describe("Prevention Campaigns Service (R9)", () => {
  const access: CampaignAccess = {
    userId: USER_ID,
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:campaign:view", "prevention:campaign:manage"],
  }

  it("crea una campaña preventiva activa", async () => {
    const { createCampaign } = await import("@/lib/services/prevention-campaigns")

    const created = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña Uso Correcto de EPP",
      description: "Difusión masiva en terreno",
      pdtpActivityNumbers: [85],
    }, access)

    expect(created!.id).toBeDefined()
    expect(created!.status).toBe("active")

    const rows = await inMemoryDb.select().from(schema.preventionCampaigns)
      .where(eq(schema.preventionCampaigns.worksiteId, WS_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toBe("Campaña Uso Correcto de EPP")
  })

  it("registra asistencia y al cerrar la campaña auto-acredita en PDTP (R9)", async () => {
    const { createCampaign, recordCampaignAttendance, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña Uso Correcto de EPP",
      pdtpActivityNumbers: [85],
    }, access)

    await recordCampaignAttendance({
      campaignId: campaign!.id,
      workerIds: [WORKER_1, WORKER_2],
    }, access)

    const result = await closeCampaign({
      campaignId: campaign!.id,
    }, access)

    expect(result.campaign!.status).toBe("completed")
    expect(result.reachedWorkers).toBe(2)
    expect(result.pdtpAccredited).toBe(true)

    // Verificar auto-acreditación PDTP
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, campaign!.id))

    expect(executions).toHaveLength(1)
    expect(executions[0]!.origin).toBe("integration")
    expect(executions[0]!.sourceType).toBe("campana")
    expect(executions[0]!.executedQuantity).toBe(2) // 2 trabajadores alcanzados
  })

  /**
   * EMG-002 (auditoría 2026-09-14), patrón P4: `evidenceUrl` y `evidenceRef`
   * eran `z.string().optional()` —sin longitud, sin formato, sin comprobar
   * nada— y ese texto viajaba como evidencia a la acreditación PDTP.
   */
  describe("EMG-002 — la evidencia de una campaña", () => {
    async function campañaAbierta(titulo: string) {
      const { createCampaign } = await import("@/lib/services/prevention-campaigns")
      const campaign = await createCampaign({
        worksiteId: WS_ID, title: titulo, pdtpActivityNumbers: [85],
      }, access)
      return campaign!.id
    }

    it("sigue siendo opcional: el registro de asistencia vale por sí mismo", async () => {
      const { recordCampaignAttendance, closeCampaign } = await import("@/lib/services/prevention-campaigns")
      const id = await campañaAbierta("Campaña sin evidencia")
      await recordCampaignAttendance({ campaignId: id, workerIds: [WORKER_1] }, access)
      const result = await closeCampaign({ campaignId: id }, access)
      expect(result.campaign!.status).toBe("completed")
    })

    it("pero si se declara algo, tiene que ser evidencia de verdad", async () => {
      const { closeCampaign } = await import("@/lib/services/prevention-campaigns")
      const id = await campañaAbierta("Campaña con texto suelto")
      await expect(closeCampaign({
        campaignId: id, evidenceUrl: "las fotos están en la carpeta compartida",
      }, access)).rejects.toThrow()
    })

    it("acepta una URL navegable y un archivo del storage de campañas", async () => {
      const { closeCampaign } = await import("@/lib/services/prevention-campaigns")

      const conUrl = await campañaAbierta("Campaña con URL")
      await expect(closeCampaign({
        campaignId: conUrl, evidenceUrl: "https://drive.chome.cl/acta-campana",
      }, access)).resolves.toBeTruthy()

      const conArchivo = await campañaAbierta("Campaña con archivo")
      await expect(closeCampaign({
        campaignId: conArchivo, evidenceUrl: "storage/pdtp-evidence/acta-2026.pdf",
      }, access)).resolves.toBeTruthy()
    })

    it("la asistencia sigue la misma regla", async () => {
      const { recordCampaignAttendance } = await import("@/lib/services/prevention-campaigns")
      const id = await campañaAbierta("Campaña asistencia")
      await expect(recordCampaignAttendance({
        campaignId: id, workerIds: [WORKER_1], evidenceRef: "lista firmada en papel",
      }, access)).rejects.toThrow()
      await expect(recordCampaignAttendance({
        campaignId: id, workerIds: [WORKER_1], evidenceRef: "storage/pdtp-evidence/lista.pdf",
      }, access)).resolves.toBeTruthy()
    })
  })

  it("cierra la campaña sin acreditar PDTP cuando no declara actividades (F-14)", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña sin actividades PDTP",
      pdtpActivityNumbers: [],
    }, access)

    const result = await closeCampaign({
      campaignId: campaign!.id,
    }, access)

    expect(result.campaign!.status).toBe("completed")
    expect(result.pdtpAccredited).toBe(false)
    // Sin actividades declaradas no hay nada pendiente: no debe avisarle nada
    // al operador.
    expect(result.pdtpPending).toBe(false)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, campaign!.id))
    expect(executions).toHaveLength(0)
  })

  /* Con el programa en borrador el motor lanza ("El programa … no está
   * activo"). Antes eso se perdía en un `logger.error` y no quedaba nada que
   * reprocesar: las 35 campañas del 2026 se habrían cerrado en el vacío. El
   * hecho tiene que sobrevivir como evento durable para que
   * `reconcilePdtpFulfillmentEvents` lo recupere al activar el programa. */
  it("deja un evento durable reprocesable cuando el programa no está activo", async () => {
    const { createCampaign, recordCampaignAttendance, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña con el programa en borrador",
      pdtpActivityNumbers: [85],
    }, access)

    await recordCampaignAttendance({ campaignId: campaign!.id, workerIds: [WORKER_1] }, access)

    const result = await closeCampaign({ campaignId: campaign!.id }, access)

    // La campaña se cierra igual: el PDTP no manda sobre el módulo fuente.
    expect(result.campaign!.status).toBe("completed")
    expect(result.pdtpAccredited).toBe(false)
    // Declaró actividades y no acreditó: es el caso "queda pendiente", distinto
    // de "no había nada que acreditar".
    expect(result.pdtpPending).toBe(true)

    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, campaign!.id))

    expect(events).toHaveLength(1)
    expect(events[0]!.sourceType).toBe("campana")
    expect(events[0]!.activityNumbers).toEqual([85])
    expect(events[0]!.quantity).toBe(1)
    // `pending` o `error`: las dos las reprocesa `reconcilePdtpFulfillmentEvents`.
    expect(["pending", "error"]).toContain(events[0]!.status)
  })

  it("rechaza asistencia de un trabajador de otra faena o inactivo (F-06)", async () => {
    const { createCampaign, recordCampaignAttendance } = await import("@/lib/services/prevention-campaigns")

    const OTHER_WS_ID = "ws-cmp-other"
    const OTHER_WORKER_ID = "wrk-cmp-other"
    await inMemoryDb.insert(schema.worksites).values({
      id: OTHER_WS_ID,
      name: "Otra Faena",
      code: "FOTRA",
      isActive: true,
    })
    await inMemoryDb.insert(schema.workers).values({
      id: OTHER_WORKER_ID,
      worksiteId: OTHER_WS_ID,
      rut: "33.333.333-3",
      firstName: "Pedro",
      lastName: "Soto",
      isActive: true,
    })

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña con trabajador ajeno",
      pdtpActivityNumbers: [85],
    }, access)

    await expect(recordCampaignAttendance({
      campaignId: campaign!.id,
      workerIds: [WORKER_1, OTHER_WORKER_ID],
    }, access)).rejects.toThrow(/no pertenecen a la faena/i)

    const attendance = await inMemoryDb.select().from(schema.preventionCampaignAttendance)
      .where(eq(schema.preventionCampaignAttendance.campaignId, campaign!.id))
    expect(attendance).toHaveLength(0)
  })
})
