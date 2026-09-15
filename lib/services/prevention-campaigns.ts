import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionCampaigns } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"
import { replacePdtpAccreditationBindings, resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import { checkEvidence, evidencePathSchema } from "@/lib/validation/evidence-contract"

export interface CampaignAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

/**
 * Error de dominio con mensaje pensado para el usuario. Existe para que la capa
 * de acciones pueda distinguirlo de un fallo inesperado (driver, SQL) y no
 * devolver detalles de infraestructura al navegador.
 */
export class CampaignDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CampaignDomainError"
  }
}

const NOT_FOUND = "Campaña preventiva no encontrada o fuera de alcance."

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: CampaignAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new CampaignDomainError(NOT_FOUND)
  }
}

const campaignCreateSchema = z.object({
  worksiteId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().optional(),
  pdtpActivityNumbers: z.array(z.number().int()).default([85]),
  catalogActivityIds: z.array(z.string().min(1)).min(1).optional(),
})

export async function createCampaign(input: unknown, access: CampaignAccess) {
  const data = campaignCreateSchema.parse(input)
  requireAccess(access, "prevention:campaign:manage", data.worksiteId)

  const code = `CMP-${nanoid(6).toUpperCase()}`
  const now = new Date().toISOString()

  const id = `cmp-${nanoid()}`
  return db.transaction(async (tx) => {
  const [created] = await tx.insert(preventionCampaigns).values({
    id,
    worksiteId: data.worksiteId,
    code,
    title: data.title,
    description: data.description ?? null,
    pdtpActivityNumbers: data.catalogActivityIds ? [] : data.pdtpActivityNumbers,
    status: "pending",
    createdByUserId: access.userId,
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (data.catalogActivityIds) await replacePdtpAccreditationBindings({ sourceType: "campana", sourceId: id, eventType: "close", catalogActivityIds: data.catalogActivityIds, updatedByUserId: access.userId }, tx)
  return created
  })
}

/**
 * La evidencia de una campaña, bajo el contrato único (`P4`). Una ruta del
 * storage de campañas —con su checksum implícito en la subida— o una URL
 * http/https alcanzable. Obligatoria al marcar la campaña como hecha: una
 * campaña sin evidencia no es oponible ante un fiscalizador.
 */
const campaignEvidenceSchema = z.string().trim().min(1, "Adjunta la evidencia de difusión de la campaña.").refine(
  (value) => evidencePathSchema().safeParse(value).success || checkEvidence({ kind: "url", reference: value }).length === 0,
  "La evidencia debe ser un archivo subido a la campaña o una URL http/https",
)

/**
 * Las cinco campañas que el programa 2026 planifica, con la actividad que cada
 * una acredita. El diálogo de creación las ofrece en vez de fijar la N°85
 * literal, que era el motivo por el que las N°86 a N°89 eran inalcanzables desde
 * la aplicación (D20). Se mantiene el re-export para no romper importadores;
 * el catálogo vive en `./prevention-campaigns.catalog` (seguro para cliente).
 */
export { PDTP_CAMPAIGN_ACTIVITIES } from "./prevention-campaigns.catalog"

const setCampaignActivitySchema = z.object({
  campaignId: z.string().min(1),
  pdtpActivityNumbers: z.array(z.number().int().positive()).default([]),
  catalogActivityIds: z.array(z.string().min(1)).min(1).optional(),
}).refine((value) => value.catalogActivityIds?.length || value.pdtpActivityNumbers.length, { message: "Selecciona la actividad que acredita" })

/**
 * Corrige qué actividad del PDTP acredita una campaña.
 *
 * Existe porque el número se declaraba sólo al crear y sin editor posterior: una
 * campaña mal declarada obligaba a borrarla y rehacerla. Sólo antes de marcarla
 * hecha: una campaña ya hecha acreditó, y cambiarle el número después dejaría
 * la ejecución apuntando a otra actividad.
 */
export async function setCampaignPdtpActivities(input: unknown, access: CampaignAccess) {
  const data = setCampaignActivitySchema.parse(input)
  const [campaign] = await db.select().from(preventionCampaigns)
    .where(eq(preventionCampaigns.id, data.campaignId)).limit(1)
  if (!campaign) throw new CampaignDomainError("Campaña no encontrada.")
  requireAccess(access, "prevention:campaign:manage", campaign.worksiteId)
  if (campaign.status === "done") {
    throw new CampaignDomainError("La campaña ya está hecha y acreditó su actividad: no se puede cambiar cuál acredita.")
  }

  return db.transaction(async (tx) => {
  const [updated] = await tx.update(preventionCampaigns)
    .set({ pdtpActivityNumbers: data.catalogActivityIds ? campaign.pdtpActivityNumbers : data.pdtpActivityNumbers, updatedAt: new Date().toISOString() })
    .where(eq(preventionCampaigns.id, data.campaignId))
    .returning()
  if (data.catalogActivityIds) await replacePdtpAccreditationBindings({ sourceType: "campana", sourceId: campaign.id, eventType: "close", catalogActivityIds: data.catalogActivityIds, updatedByUserId: access.userId }, tx)
  return updated
  })
}

const campaignCompleteSchema = z.object({
  campaignId: z.string().min(1),
  /** Fecha civil en que se hizo la campaña, no la de digitación. */
  heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la fecha en que se hizo la campaña (YYYY-MM-DD)."),
  evidenceUrl: campaignEvidenceSchema,
})

/**
 * Ancla una fecha civil al mediodía UTC (08:00–09:00 en Chile).
 *
 * El motor ubica el período contando el día en `America/Santiago`, así que
 * `new Date("2026-03-01")` —medianoche UTC, o sea las 21:00 del 28 de febrero
 * en Chile— archivaría la campaña en febrero semana 4. Mismo criterio que
 * `occurredAtFromChileDate` en el conector de higiene.
 */
function occurredAtFromChileDate(plainDate: string): string {
  return `${plainDate}T12:00:00.000Z`
}

/**
 * Marca una campaña preventiva como hecha (R9) y dispara la auto-acreditación
 * PDTP para las actividades que declara (ej. 85-89).
 */
export async function closeCampaign(input: unknown, access: CampaignAccess) {
  const data = campaignCompleteSchema.parse(input)
  const [campaign] = await db.select().from(preventionCampaigns).where(eq(preventionCampaigns.id, data.campaignId)).limit(1)
  if (!campaign) throw new CampaignDomainError(NOT_FOUND)
  requireAccess(access, "prevention:campaign:manage", campaign.worksiteId)

  if (campaign.status === "done") throw new CampaignDomainError("La campaña ya está marcada como hecha.")

  const now = new Date().toISOString()
  const [updated] = await db.update(preventionCampaigns)
    .set({
      status: "done",
      heldOn: data.heldOn,
      completedAt: now,
      completedByUserId: access.userId,
      evidenceUrl: data.evidenceUrl,
      updatedAt: now,
    })
    .where(eq(preventionCampaigns.id, campaign.id))
    .returning()

  if (!updated) throw new Error("No se pudo marcar la campaña como hecha.")

  // Auto-acreditación PDTP por la capa durable. Sin actividades declaradas en
  // la campaña es no-op: no inventamos un número por defecto para no acreditar
  // una actividad ajena a la campaña.
  //
  // Pasa por `recordPdtpFulfillmentEvent` y no por `accreditPdtpFromEvent` a
  // secas: el motor lanza cuando el programa está en borrador o la faena queda
  // fuera de él, y con un `try/catch` esos cierres se perderían en un
  // `logger.error`, sin fila que `reconcilePdtpFulfillmentEvents` pudiera
  // recuperar al activar el programa.
  //
  // `pdtpPending` separa "no había nada que acreditar" de "había y todavía no
  // pudo": el primero no es un problema y el segundo tampoco obliga a marcar a
  // mano, porque el evento quedó registrado.
  let pdtpAccredited = false
  let pdtpPending = false
  const activityNumbers = Array.isArray(campaign.pdtpActivityNumbers) ? campaign.pdtpActivityNumbers : []
  const accreditationTarget = await resolvePdtpAccreditationTarget({
    sourceType: "campana",
    sourceId: campaign.id,
    eventType: "close",
    legacyActivityNumbers: activityNumbers,
  })
  if (accreditationTarget.catalogActivityIds?.length || accreditationTarget.activityNumbers?.length) {
    const result = await recordPdtpFulfillmentEvent({
      sourceType: "campana",
      sourceId: campaign.id,
      worksiteId: campaign.worksiteId,
      ...accreditationTarget,
      // La fecha del hecho, no la de digitación: el motor resuelve el período
      // (mes y semana) y el año del programa con `occurredAt`.
      occurredAt: occurredAtFromChileDate(data.heldOn),
      executedQuantity: 1,
      evidenceRef: data.evidenceUrl,
    })
    pdtpAccredited = (result?.accredited.length ?? 0) > 0
    pdtpPending = !pdtpAccredited
  }

  return { campaign: updated, pdtpAccredited, pdtpPending }
}
