/**
 * Mapa de riesgos espacial: un plano de planta por faena con marcadores
 * ubicados sobre la imagen, cada uno enlazado a una entrada de la MIPER
 * vigente. Requisito Oro de la certificación CPHS Mutual
 * (`risk_map` en lib/prevention/cphs-certification.ts).
 *
 * Reusa el alcance y los permisos de MIPER (`prevention:risk:view`/`:edit`):
 * es una vista adicional sobre los mismos datos, no un dominio nuevo con
 * permisos propios. La imagen se sube por separado
 * (POST /api/prevencion/miper/mapa) — este servicio sólo registra la
 * referencia y los marcadores.
 */
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  preventionRiskEntries,
  preventionRiskMapLayouts,
  preventionRiskMapMarkers,
  preventionRiskMatrices,
  preventionRiskLegalHistory,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { RiskLegalAccess } from "@/lib/services/prevention-risk-legal"

type Client = DB | Tx

const NOT_FOUND = "Registro preventivo no encontrado o fuera de alcance."

function scopeAllows(scope: RiskLegalAccess["scope"], worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: RiskLegalAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

async function history(client: Client, args: {
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  actorUserId?: string | null
}) {
  await client.insert(preventionRiskLegalHistory).values({
    id: `prlh-${nanoid()}`,
    domain: "risk",
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    actorUserId: args.actorUserId ?? null,
  })
}

/* ── Plano ────────────────────────────────────────────────────────────────── */

const uploadLayoutSchema = z.object({
  worksiteId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  imagePath: z.string().trim().min(1).max(500),
  imageMimeType: z.string().trim().min(1).max(100),
})

/**
 * Un plano vigente por faena: subir uno nuevo archiva el anterior (no lo
 * borra — sus marcadores y el archivo quedan como historial).
 */
export async function uploadRiskMapLayout(input: unknown, access: RiskLegalAccess) {
  const data = uploadLayoutSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)

  return db.transaction(async (tx) => {
    const [worksite] = await tx.select({ id: worksites.id }).from(worksites)
      .where(eq(worksites.id, data.worksiteId)).limit(1)
    if (!worksite) throw new Error(NOT_FOUND)

    await tx.update(preventionRiskMapLayouts).set({ status: "archived", updatedAt: new Date().toISOString() })
      .where(and(eq(preventionRiskMapLayouts.worksiteId, data.worksiteId), eq(preventionRiskMapLayouts.status, "active")))

    const [created] = await tx.insert(preventionRiskMapLayouts).values({
      id: `riskmap-${nanoid()}`,
      worksiteId: data.worksiteId,
      title: data.title,
      imagePath: data.imagePath,
      imageMimeType: data.imageMimeType,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar el plano.")

    await history(tx, { entityType: "risk_map_layout", entityId: created.id, worksiteId: data.worksiteId, changeType: "uploaded", reason: `Plano "${data.title}" cargado`, actorUserId: access.userId })
    return created
  })
}

/* ── Marcadores ───────────────────────────────────────────────────────────── */

const addMarkerSchema = z.object({
  layoutId: z.string().min(1),
  riskEntryId: z.string().min(1),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  label: z.string().trim().max(200).nullable().optional(),
})

export async function addRiskMapMarker(input: unknown, access: RiskLegalAccess) {
  const data = addMarkerSchema.parse(input)

  return db.transaction(async (tx) => {
    const [layout] = await tx.select().from(preventionRiskMapLayouts)
      .where(eq(preventionRiskMapLayouts.id, data.layoutId)).limit(1)
    if (!layout) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:risk:edit", layout.worksiteId)

    // El peligro debe venir de una matriz de la MISMA faena que el plano: un
    // marcador no puede apuntar al riesgo de otro centro de trabajo.
    const [entry] = await tx.select({ id: preventionRiskEntries.id, worksiteId: preventionRiskMatrices.worksiteId })
      .from(preventionRiskEntries)
      .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
      .where(eq(preventionRiskEntries.id, data.riskEntryId)).limit(1)
    if (!entry || entry.worksiteId !== layout.worksiteId) {
      throw new Error("El peligro debe pertenecer a la matriz MIPER de esta misma faena.")
    }

    const [created] = await tx.insert(preventionRiskMapMarkers).values({
      id: `riskmapmk-${nanoid()}`,
      layoutId: data.layoutId,
      riskEntryId: data.riskEntryId,
      xPct: data.xPct,
      yPct: data.yPct,
      label: data.label ?? null,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo ubicar el marcador.")
    return created
  })
}

const removeMarkerSchema = z.object({ markerId: z.string().min(1) })

export async function removeRiskMapMarker(input: unknown, access: RiskLegalAccess) {
  const data = removeMarkerSchema.parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ marker: preventionRiskMapMarkers, worksiteId: preventionRiskMapLayouts.worksiteId })
      .from(preventionRiskMapMarkers)
      .innerJoin(preventionRiskMapLayouts, eq(preventionRiskMapLayouts.id, preventionRiskMapMarkers.layoutId))
      .where(eq(preventionRiskMapMarkers.id, data.markerId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:risk:edit", row.worksiteId)

    await tx.delete(preventionRiskMapMarkers).where(eq(preventionRiskMapMarkers.id, data.markerId))
    return { removed: true }
  })
}

/* ── Lectura ──────────────────────────────────────────────────────────────── */

export interface RiskMapView {
  layout: typeof preventionRiskMapLayouts.$inferSelect
  markers: Array<{
    id: string
    xPct: number
    yPct: number
    label: string | null
    riskEntryId: string
    hazard: string
    residualLevel: string
  }>
}

/**
 * Trae el plano activo y sus marcadores para todas las faenas del alcance en
 * un solo par de consultas — evita N+1 al cargar el panel con varias faenas.
 */
export async function listRiskMapsForScope(worksiteIds: string[], access: RiskLegalAccess): Promise<Map<string, RiskMapView>> {
  requireAccess(access, "prevention:risk:view")
  if (worksiteIds.length === 0) return new Map()

  const layouts = await db.select().from(preventionRiskMapLayouts)
    .where(and(inArray(preventionRiskMapLayouts.worksiteId, worksiteIds), eq(preventionRiskMapLayouts.status, "active")))
  if (layouts.length === 0) return new Map()

  const markerRows = await db.select({
    marker: preventionRiskMapMarkers,
    hazard: preventionRiskEntries.hazard,
    residualLevel: preventionRiskEntries.residualLevel,
  })
    .from(preventionRiskMapMarkers)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskMapMarkers.riskEntryId))
    .where(inArray(preventionRiskMapMarkers.layoutId, layouts.map((layout) => layout.id)))

  const markersByLayout = new Map<string, RiskMapView["markers"]>()
  for (const row of markerRows) {
    const list = markersByLayout.get(row.marker.layoutId) ?? []
    list.push({
      id: row.marker.id,
      xPct: row.marker.xPct,
      yPct: row.marker.yPct,
      label: row.marker.label,
      riskEntryId: row.marker.riskEntryId,
      hazard: row.hazard,
      residualLevel: row.residualLevel,
    })
    markersByLayout.set(row.marker.layoutId, list)
  }

  const result = new Map<string, RiskMapView>()
  for (const layout of layouts) {
    result.set(layout.worksiteId, { layout, markers: markersByLayout.get(layout.id) ?? [] })
  }
  return result
}
