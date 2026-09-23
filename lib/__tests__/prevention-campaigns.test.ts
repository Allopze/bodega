import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { CampaignAccess } from "@/lib/services/prevention-campaigns"
import type { TrainingOccurrenceAccess } from "@/lib/services/prevention-training-occurrences"
import type { DB } from "@/db"
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
  // Las tres tablas de ocurrencias de capacitación (usadas por el test de
  // doble conteo 85-89 más abajo, que cierra una campaña y además completa su
  // CAM-* equivalente) tienen FK `restrict` hacia `worksites`/`users`: hay que
  // vaciarlas antes o el `delete` de esas dos tablas falla.
  await inMemoryDb.delete(schema.preventionTrainingOccurrenceEvidence)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.pdtpTriggerEvents)
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
    appliesToAllWorksites: true,
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

  /**
   * Ronda de corrección 1/5 (2026-09-23, doble conteo 85-89): antes de esta
   * ronda, cerrar la campaña SÍ creaba una fila `pdtpExecutions` propia (vía
   * `recordPdtpFulfillmentEvent`) y este test lo verificaba. Eso es
   * exactamente lo que producía el doble conteo cuando la ocurrencia `CAM-*`
   * equivalente del catálogo de capacitación también se completaba para el
   * mismo período: el motor de cumplimiento no deduplica entre `"campana"` y
   * `"capacitacion_ocurrencia"`, así que las dos ejecuciones se sumaban (ver
   * el test de doble conteo más abajo). El cierre de campaña ya no acredita
   * el PDTP en absoluto — sigue marcando la campaña como hecha, con su
   * evidencia y su historial.
   */
  it("marca la campaña como hecha con evidencia, pero ya no acredita el PDTP (evita doble conteo con CAM-*)", async () => {
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
    expect(result.campaign!.evidenceUrl).toBe("https://drive.chome.cl/acta-campana")
    expect(result.pdtpAccredited).toBe(false)
    expect(result.pdtpPending).toBe(false)

    // Ya no hay auto-acreditación PDTP desde el cierre de campaña.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, campaign!.id))
    expect(executions).toHaveLength(0)

    const fulfillmentEvents = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, campaign!.id))
    expect(fulfillmentEvents).toHaveLength(0)
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

  // F-14 en su origen distinguía "no declaró actividades" de "declaró y no
  // acreditó" por `pdtpPending`. Desde la ronda de corrección 1/5 el cierre de
  // campaña nunca acredita (declare o no actividades), así que ambos casos
  // terminan en `pdtpAccredited: false, pdtpPending: false` — se conserva el
  // test para que declarar `pdtpActivityNumbers: []` siga sin lanzar ni crear
  // nada en `pdtpExecutions`.
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

  /* Ronda de corrección 1/5 (2026-09-23): antes, con el programa en borrador,
   * el motor de acreditación lanzaba ("El programa … no está activo") y
   * `recordPdtpFulfillmentEvent` dejaba un evento durable `pending`/`error`
   * para que `reconcilePdtpFulfillmentEvents` lo reprocesara al activar el
   * programa. Ese mecanismo entero se retiró de `closeCampaign`: el estado del
   * programa PDTP ya no puede afectar si una campaña se cierra o no, porque el
   * cierre no depende de él. */
  it("cierra la campaña igual cuando el programa PDTP está en borrador, sin dejar nada pendiente de acreditar", async () => {
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
    expect(result.pdtpPending).toBe(false)

    // Ya no se intenta acreditar en absoluto, así que no queda ningún evento
    // de acreditación durable esperando reproceso.
    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, campaign!.id))
    expect(events).toHaveLength(0)
  })

  /* La fecha civil de una campaña se ancla al mediodía UTC (08:00-09:00 en
   * Chile): a medianoche UTC, el día 1 cae en el mes anterior en Chile. Antes
   * de esta ronda esto se verificaba mirando el mes/semana de la ejecución
   * PDTP que `closeCampaign` creaba; como el cierre ya no crea ninguna
   * ejecución, se verifica en el único artefacto fechado que el cierre sigue
   * escribiendo: el evento disparador (`pdtpTriggerEvents`, conector
   * "campaigns") que alimenta el libro de obligaciones — no el de
   * cumplimiento, pero pasa por la misma `occurredAtFromChileDate`. */
  it("ancla `occurredAt` al mediodía UTC del día en que se hizo la campaña, no al de la digitación", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID, title: "Campaña de marzo", pdtpActivityNumbers: [85],
    }, access)

    await closeCampaign({
      campaignId: campaign!.id, heldOn: `${PROGRAM_YEAR}-03-12`,
      evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)

    const [triggerEvent] = await inMemoryDb.select().from(schema.pdtpTriggerEvents)
      .where(eq(schema.pdtpTriggerEvents.sourceId, campaign!.id))
    expect(triggerEvent).toBeTruthy()
    expect(new Date(triggerEvent!.occurredAt).toISOString()).toBe(`${PROGRAM_YEAR}-03-12T12:00:00.000Z`)
  })

  it("el primer día del mes ancla `occurredAt` en ese mes, no en el anterior", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID, title: "Campaña del día 1", pdtpActivityNumbers: [85],
    }, access)
    await closeCampaign({
      campaignId: campaign!.id, heldOn: `${PROGRAM_YEAR}-04-01`,
      evidenceUrl: "https://drive.chome.cl/acta-campana",
    }, access)

    const [triggerEvent] = await inMemoryDb.select().from(schema.pdtpTriggerEvents)
      .where(eq(schema.pdtpTriggerEvents.sourceId, campaign!.id))
    expect(new Date(triggerEvent!.occurredAt).toISOString()).toBe(`${PROGRAM_YEAR}-04-01T12:00:00.000Z`)
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

/**
 * Ronda de corrección 1/5 (2026-09-23). Reproduce el hallazgo tal cual lo
 * describió la revisión: `closeCampaign` acreditaba la N°85-89 y, en paralelo,
 * completar la ocurrencia `CAM-*` equivalente del catálogo de capacitación
 * (`recordTrainingOccurrenceStatus`) TAMBIÉN la acreditaba — el motor de
 * cumplimiento (`effectiveApprovedExecutionsByCell`,
 * lib/services/pdtp/compliance.ts) sólo deduplica `"inspeccion"` contra la
 * ejecución manual (toma el máximo); `"campana"` y `"capacitacion_ocurrencia"`
 * caen en el mismo acumulador (`otherIntegrationQuantity`) y se SUMAN. Cerrar
 * la campaña legado de la N°88 y completar CAM-07 (su equivalente, Task 13)
 * del mismo período dejaba `executedQuantity = 2` contra `plannedQuantity = 1`.
 *
 * Usa un programa PDTP propio, dedicado y fijado al año del catálogo de
 * capacitación (`PREDEFINED_TRAINING_CATALOG_YEAR`, hoy 2026): el catálogo
 * `CAM-*` sólo existe para ese año exacto
 * (`assertPredefinedTrainingCatalogYear`), así que no puede parametrizarse con
 * el año en curso como el resto de este archivo. Para no competir con el
 * programa de `beforeEach` (mismo año en curso hoy, lo que crearía dos
 * programas `active` candidatos para el mismo año y una resolución ambigua),
 * ese programa compartido se pasa a `draft` al inicio del test: desde esta
 * ronda `closeCampaign` no lo necesita `active` para nada. Se le da además
 * `version: 2` porque `pdtp_programs_year_version_unique` es sobre
 * `(year, version)` sin importar el status — pasar el compartido a `draft` no
 * libera su fila `(YEAR, 1)`.
 */
describe("Ronda de corrección 1/5 — doble conteo 85-89 (campaña legado + CAM-* del catálogo)", () => {
  it("cerrar la campaña N°88 y completar CAM-07 del mismo período deja la celda en executedQuantity=1, no 2", async () => {
    const { createCampaign, closeCampaign } = await import("@/lib/services/prevention-campaigns")
    const {
      ensurePreventionTrainingOccurrencesForWorksiteTx,
      listTrainingOccurrences,
      recordTrainingOccurrenceStatus,
    } = await import("@/lib/services/prevention-training-occurrences")
    const { effectiveApprovedExecutionsByCell } = await import("@/lib/services/pdtp/compliance")
    const { PREDEFINED_TRAINING_CATALOG_YEAR } = await import("@/lib/prevention/training-occurrences-catalog")

    const YEAR = PREDEFINED_TRAINING_CATALOG_YEAR
    const DUP_PROGRAM_ID = "pdtp-dup88-prog"
    const DUP_ACTIVITY_ID = "pdtp-dup88-act"
    const access: CampaignAccess = {
      userId: USER_ID,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:campaign:view", "prevention:campaign:manage"],
    }
    const trainingAccess: TrainingOccurrenceAccess = {
      userId: USER_ID,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:training:view", "prevention:training:record"],
    }

    // Neutraliza el programa compartido de `beforeEach`: mismo año hoy, y ya
    // no hace falta que esté activo porque `closeCampaign` no lo consulta.
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: DUP_PROGRAM_ID,
      year: YEAR,
      // v2, no v1: `pdtp_programs_year_version_unique` es sobre (year, version)
      // sin importar el status, y el programa compartido de `beforeEach` ya
      // ocupa (YEAR, 1) hoy que su año en curso coincide con el del catálogo.
      // Pasarlo a `draft` (arriba) lo saca de la resolución de acreditación
      // (que sólo mira status active/closed), pero no libera la fila v1.
      version: 2,
      title: `PDTP ${YEAR} Doble Conteo N88`,
      status: "active",
      appliesToAllWorksites: true,
      elaboratedByName: "Prevencionista",
      elaboratedByTitle: "Experto",
      creationMode: "blank",
      complianceTarget: 0.9,
      pesoEjecucion: 0.5,
      pesoVerificacion: 0.3,
      pesoCierre: 0.2,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: DUP_ACTIVITY_ID,
      programId: DUP_PROGRAM_ID,
      n: 88,
      activity: "Campaña Seguridad Vial",
      program: "Prevención",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista",
      scheduleMode: "scheduled",
      scheduleClassificationStatus: "confirmed",
      indicatorMode: "coverage",
      sourceSheetRow: 36,
      createdAt: now,
      updatedAt: now,
    })

    // 1) Cierra la campaña legado que declara la N°88 (CAM-07 la absorbe desde
    // Task 13). Con el fix, esto ya NO debe crear una ejecución PDTP.
    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña Seguridad Vial (legado)",
      pdtpActivityNumbers: [88],
    }, access)

    // CAM-07 empieza en m06-w1: el 5 de junio (semana 1) es el mismo período.
    await closeCampaign({
      campaignId: campaign!.id,
      heldOn: `${YEAR}-06-05`,
      evidenceUrl: "https://drive.chome.cl/acta-vial",
    }, access)

    const executionsAfterCampaignClose = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, DUP_ACTIVITY_ID))
    expect(executionsAfterCampaignClose).toHaveLength(0)

    // 2) Completa la ocurrencia CAM-07 equivalente, mismo período (m06-w1).
    await ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb as unknown as DB, WS_ID, YEAR)
    const occurrence = (await listTrainingOccurrences(trainingAccess))
      .find((row) => row.code === "CAM-07" && row.slotKey === "m06-w1")
    if (!occurrence) throw new Error("No se encontró la ocurrencia CAM-07 m06-w1 de prueba.")

    await inMemoryDb.insert(schema.preventionTrainingOccurrenceEvidence).values({
      id: "training-occ-evidence-dup88",
      occurrenceId: occurrence.id,
      fileName: "acta-vial.pdf",
      storagePath: "storage/prevention-training-evidence/test-acta-vial-dup88.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 128,
      sha256: "e".repeat(64),
      state: "active",
      uploadedByUserId: USER_ID,
    })

    await recordTrainingOccurrenceStatus({
      occurrenceId: occurrence.id,
      expectedVersion: occurrence.version,
      status: "completed",
    }, trainingAccess)

    // 3) Sólo debe existir la ejecución de la ocurrencia CAM-07: la campaña ya
    // no aportó una segunda fila para la misma actividad/período.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, DUP_ACTIVITY_ID))
    expect(executions).toHaveLength(1)
    expect(executions[0]!.sourceType).toBe("capacitacion_ocurrencia")
    expect(executions[0]!.month).toBe(6)
    expect(executions[0]!.week).toBe(1)

    // 4) Y el motor de cumplimiento no suma una segunda ejecución para la
    // misma celda: `executedQuantity` queda en 1, no en 2 — el hallazgo
    // original. Se filtra por `status === "approved"` porque es exactamente lo
    // que hace `getPdtpComplianceIndicators` antes de deduplicar.
    const approved = executions.filter((row) => row.status === "approved")
    expect(approved).toHaveLength(1)
    const cells = effectiveApprovedExecutionsByCell(approved)
    expect(cells).toHaveLength(1)
    expect(cells[0]!.executedQuantity).toBe(1)
  })
})
