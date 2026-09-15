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
const PROGRAM_ID = "pdtp-cmp-prog"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.preventionCampaigns)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
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

describe("Prevention Campaigns Service (R9) — checklist + evidencia", () => {
  const access: CampaignAccess = {
    userId: USER_ID,
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:campaign:view", "prevention:campaign:manage"],
  }

  it("crea una campaña preventiva pendiente", async () => {
    const { createCampaign } = await import("@/lib/services/prevention-campaigns")

    const created = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña Uso Correcto de EPP",
      description: "Difusión masiva en terreno",
      pdtpActivityNumbers: [85],
    }, access)

    expect(created!.id).toBeDefined()
    expect(created!.status).toBe("pending")

    const rows = await inMemoryDb.select().from(schema.preventionCampaigns)
      .where(eq(schema.preventionCampaigns.worksiteId, WS_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toBe("Campaña Uso Correcto de EPP")
  })

  it("marca la campaña como hecha con evidencia y auto-acredita en PDTP (R9)", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña Uso Correcto de EPP",
      pdtpActivityNumbers: [85],
    }, access)

    const result = await closeCampaign({
      campaignId: campaign!.id,
      heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)

    expect(result.campaign!.status).toBe("done")
    expect(result.campaign!.completedByUserId).toBe(USER_ID)
    expect(result.pdtpAccredited).toBe(true)

    // Verificar auto-acreditación PDTP
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, campaign!.id))

    expect(executions).toHaveLength(1)
    expect(executions[0]!.origin).toBe("integration")
    expect(executions[0]!.sourceType).toBe("campana")
    expect(executions[0]!.executedQuantity).toBe(1)
  })

  /**
   * EMG-002 (auditoría 2026-09-14), patrón P4: `evidenceUrl` era
   * `z.string().optional()` —sin longitud, sin formato, sin comprobar nada— y
   * ese texto viajaba como evidencia a la acreditación PDTP. Tras la
   * simplificación (2026-09-14) la evidencia además es obligatoria: una
   * campaña no puede quedar `done` sin ella.
   */
  describe("EMG-002 — la evidencia de una campaña", () => {
    async function campañaAbierta(titulo: string) {
      const { createCampaign } = await import("@/lib/services/prevention-campaigns")
      const campaign = await createCampaign({
        worksiteId: WS_ID, title: titulo, pdtpActivityNumbers: [85],
      }, access)
      return campaign!.id
    }

    it("es obligatoria: no se puede marcar hecha sin evidencia", async () => {
      const { closeCampaign } = await import("@/lib/services/prevention-campaigns")
      const id = await campañaAbierta("Campaña sin evidencia")
      await expect(closeCampaign({ campaignId: id, heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "" }, access)).rejects.toThrow()
    })

    it("si se declara, tiene que ser evidencia de verdad", async () => {
      const { closeCampaign } = await import("@/lib/services/prevention-campaigns")
      const id = await campañaAbierta("Campaña con texto suelto")
      await expect(closeCampaign({
        campaignId: id, heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "las fotos están en la carpeta compartida",
      }, access)).rejects.toThrow()
    })

    it("acepta una URL navegable y un archivo del storage de campañas", async () => {
      const { closeCampaign } = await import("@/lib/services/prevention-campaigns")

      const conUrl = await campañaAbierta("Campaña con URL")
      await expect(closeCampaign({
        campaignId: conUrl, heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "https://drive.chome.cl/acta-campana",
      }, access)).resolves.toBeTruthy()

      const conArchivo = await campañaAbierta("Campaña con archivo")
      await expect(closeCampaign({
        campaignId: conArchivo, heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "storage/campaign-evidence/acta-2026.pdf",
      }, access)).resolves.toBeTruthy()
    })
  })

  it("marca hecha sin acreditar PDTP cuando no declara actividades (F-14)", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña sin actividades PDTP",
      pdtpActivityNumbers: [],
    }, access)

    const result = await closeCampaign({
      campaignId: campaign!.id,
      heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)

    expect(result.campaign!.status).toBe("done")
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
   * reprocesar. El hecho tiene que sobrevivir como evento durable para que
   * `reconcilePdtpFulfillmentEvents` lo recupere al activar el programa. */
  it("deja un evento durable reprocesable cuando el programa no está activo", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña con el programa en borrador",
      pdtpActivityNumbers: [85],
    }, access)

    const result = await closeCampaign({
      campaignId: campaign!.id,
      heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)

    // La campaña se marca hecha igual: el PDTP no manda sobre el módulo fuente.
    expect(result.campaign!.status).toBe("done")
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

  /* La campaña se marca después de hecha, así que la fecha que acredita es la
   * del hecho y no la de digitación: el motor resuelve mes y semana con
   * `occurredAt`. Con `now()` una campaña de marzo marcada hoy se anotaba en
   * el mes de la carga. */
  it("acredita en el período de la campaña, no en el de la digitación", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID, title: "Campaña de marzo", pdtpActivityNumbers: [85],
    }, access)

    // 12 de marzo: mes 3, semana 2 (ceil(12/7)).
    await closeCampaign({
      campaignId: campaign!.id, heldOn: `${PROGRAM_YEAR}-03-12`,
      evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, "act-85"))
    expect(execution).toBeTruthy()
    expect(execution!.year).toBe(PROGRAM_YEAR)
    expect(execution!.month).toBe(3)
    expect(execution!.week).toBe(2)
  })

  /* La fecha civil se ancla al mediodía UTC: a medianoche, el día 1 cae en el
   * mes anterior en Chile y la campaña se archivaría en el mes equivocado. */
  it("el primer día del mes se acredita en ese mes, no en el anterior", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID, title: "Campaña del día 1", pdtpActivityNumbers: [85],
    }, access)
    await closeCampaign({
      campaignId: campaign!.id, heldOn: `${PROGRAM_YEAR}-04-01`,
      evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, "act-85"))
    expect(execution!.month).toBe(4)
    expect(execution!.week).toBe(1)
  })

  it("exige la fecha en que se hizo la campaña", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")
    const campaign = await createCampaign({
      worksiteId: WS_ID, title: "Campaña sin fecha", pdtpActivityNumbers: [85],
    }, access)

    await expect(closeCampaign({
      campaignId: campaign!.id, heldOn: "", evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)).rejects.toThrow()
  })

  it("no permite marcar hecha dos veces la misma campaña", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña doble cierre",
      pdtpActivityNumbers: [85],
    }, access)

    await closeCampaign({ campaignId: campaign!.id, heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "https://drive.chome.cl/acta-1" }, access)

    await expect(closeCampaign({
      campaignId: campaign!.id, heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "https://drive.chome.cl/acta-2",
    }, access)).rejects.toThrow(/ya está marcada como hecha/i)
  })

  it("no permite cambiar la actividad de una campaña ya hecha", async () => {
    const { createCampaign, closeCampaign, setCampaignPdtpActivities } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña actividad fija",
      pdtpActivityNumbers: [85],
    }, access)

    await closeCampaign({ campaignId: campaign!.id, heldOn: `${PROGRAM_YEAR}-03-12`, evidenceUrl: "https://drive.chome.cl/acta" }, access)

    await expect(setCampaignPdtpActivities({
      campaignId: campaign!.id, pdtpActivityNumbers: [86],
    }, access)).rejects.toThrow(/ya está hecha/i)
  })
})
