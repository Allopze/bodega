import { createHash } from "node:crypto"
import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelProducts,
  fuelSupplyMedia,
  fuelTaeLoadingPoints,
  fuelTaePublicLinks,
  fuelTaeSubmissions,
  fuelVehicleProducts,
  fuelVehicles,
  workers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanRut } from "@/lib/rut"
import { recordAudit } from "@/lib/audit"
import type { TaeAccessConfig } from "./types"

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export async function getActiveLink(accessToken: string) {
  if (!accessToken) throw new Error("Enlace de acceso requerido")
  const link = await db.query.fuelTaePublicLinks.findFirst({
    where: eq(fuelTaePublicLinks.tokenHash, hashToken(accessToken)),
  })
  if (!link || link.revokedAt || (link.expiresAt && new Date(link.expiresAt) <= new Date())) {
    throw new Error("Este enlace TAE no está disponible")
  }
  return link
}

/** Faena fijada por un enlace TAE activo, sin cargar vehículos ni tocar `lastUsedAt`. */
export async function getTaeLinkWorksiteId(accessToken: string): Promise<string> {
  const link = await getActiveLink(accessToken)
  return link.worksiteId
}

/** Busca un trabajador activo por RUT, acotado a la faena indicada (nunca fuera de ella). */
export async function findTaeWorkerByRut(rut: string, worksiteId: string): Promise<{ id: string; firstName: string; lastName: string } | null> {
  if (!rut) return null
  const cleaned = cleanRut(rut)
  const worker = await db.query.workers.findFirst({
    where: and(eq(workers.rut, cleaned), eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)),
    columns: { id: true, firstName: true, lastName: true },
  })
  return worker ?? null
}

/**
 * Configuración del formulario de terreno para una faena y un lugar de carga.
 * La usan el enlace QR (`getTaeAccessConfig`) y el registro autenticado; el
 * llamador ya comprobó que el usuario o el enlace puede operar esa faena.
 */
export async function buildFieldLoadConfig(worksiteId: string, loadingPointId: string | null): Promise<TaeAccessConfig> {
  const [worksite, point, vehicles, media] = await Promise.all([
    db.query.worksites.findFirst({ where: eq(worksites.id, worksiteId), columns: { id: true, name: true } }),
    loadingPointId
      ? db.query.fuelTaeLoadingPoints.findFirst({
          where: and(
            eq(fuelTaeLoadingPoints.id, loadingPointId),
            eq(fuelTaeLoadingPoints.worksiteId, worksiteId),
            eq(fuelTaeLoadingPoints.isActive, true),
          ),
          columns: { id: true, name: true, type: true },
        })
      : Promise.resolve(null),
    db.query.fuelVehicles.findMany({
      where: and(eq(fuelVehicles.worksiteId, worksiteId), eq(fuelVehicles.isActive, true)),
      columns: { id: true, code: true, plate: true, type: true, meterType: true, tankCapacityLiters: true },
      orderBy: [fuelVehicles.code, fuelVehicles.plate],
    }),
    db.select({ id: fuelSupplyMedia.id, name: fuelSupplyMedia.name }).from(fuelSupplyMedia)
      .where(eq(fuelSupplyMedia.isActive, true)).orderBy(asc(fuelSupplyMedia.sortOrder), asc(fuelSupplyMedia.name)),
  ])
  if (!worksite || (loadingPointId && !point)) throw new Error("El enlace TAE está incompleto")
  const compatibility = vehicles.length === 0 ? [] : await db.select({
    vehicleId: fuelVehicleProducts.vehicleId,
    id: fuelProducts.id,
    name: fuelProducts.name,
    unit: fuelProducts.unit,
  }).from(fuelVehicleProducts)
    .innerJoin(fuelProducts, eq(fuelProducts.id, fuelVehicleProducts.productId))
    .where(and(inArray(fuelVehicleProducts.vehicleId, vehicles.map((vehicle) => vehicle.id)), eq(fuelProducts.isActive, true)))
    .orderBy(fuelProducts.name)
  const productsByVehicle = new Map<string, Array<{ id: string; name: string; unit: string }>>()
  for (const item of compatibility) {
    const current = productsByVehicle.get(item.vehicleId) ?? []
    current.push({ id: item.id, name: item.name, unit: item.unit })
    productsByVehicle.set(item.vehicleId, current)
  }
  return {
    worksite,
    loadingPoint: point ?? null,
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      code: vehicle.code,
      plate: vehicle.plate,
      type: vehicle.type,
      meterType: vehicle.meterType as "odometer" | "hour_meter" | "none",
      tankCapacityLiters: vehicle.tankCapacityLiters,
      products: productsByVehicle.get(vehicle.id) ?? [],
    })),
    supplyMedia: media,
  }
}

export async function getTaeAccessConfig(accessToken: string): Promise<TaeAccessConfig> {
  const link = await getActiveLink(accessToken)
  const config = await buildFieldLoadConfig(link.worksiteId, link.loadingPointId)
  await db.update(fuelTaePublicLinks).set({ lastUsedAt: new Date().toISOString() }).where(eq(fuelTaePublicLinks.id, link.id))
  return config
}

export async function createTaePublicLink({
  worksiteId,
  loadingPointId,
  label,
  createdBy,
}: {
  worksiteId: string
  loadingPointId: string
  label: string
  createdBy: string
}): Promise<{ id: string; accessToken: string }> {
  const worksite = await db.query.worksites.findFirst({ where: eq(worksites.id, worksiteId), columns: { id: true } })
  if (!worksite) throw new Error("Faena no encontrada")
  const point = await db.query.fuelTaeLoadingPoints.findFirst({
    where: and(
      eq(fuelTaeLoadingPoints.id, loadingPointId),
      eq(fuelTaeLoadingPoints.worksiteId, worksiteId),
      eq(fuelTaeLoadingPoints.isActive, true),
    ),
    columns: { id: true },
  })
  if (!point) throw new Error("El punto de carga no pertenece a la faena o está inactivo")
  const id = nanoid()
  const accessToken = nanoid(40)
  await db.insert(fuelTaePublicLinks).values({
    id,
    worksiteId,
    loadingPointId,
    label,
    tokenHash: hashToken(accessToken),
    createdBy,
  })
  await recordAudit({ userId: createdBy, action: "create", entityType: "fuel_tae_public_link", entityId: id, newState: { worksiteId, loadingPointId, label } })
  return { id, accessToken }
}

export async function revokeTaePublicLink(id: string, userId: string) {
  const link = await db.query.fuelTaePublicLinks.findFirst({ where: eq(fuelTaePublicLinks.id, id) })
  if (!link) throw new Error("Enlace TAE no encontrado")
  if (link.revokedAt) return
  await db.update(fuelTaePublicLinks).set({ revokedAt: new Date().toISOString() }).where(eq(fuelTaePublicLinks.id, id))
  await recordAudit({ userId, action: "update", entityType: "fuel_tae_public_link", entityId: id, oldState: { revokedAt: null }, newState: { revokedAt: new Date().toISOString() } })
}

export async function getTaeSubmissionByToken(publicResultToken: string) {
  if (!publicResultToken) return null
  const submission = await db.query.fuelTaeSubmissions.findFirst({
    where: eq(fuelTaeSubmissions.publicResultToken, publicResultToken),
    with: { worksite: { columns: { name: true } }, loadingPoint: { columns: { name: true } } },
  })
  if (!submission || submission.publicResultRevokedAt) return null
  return submission
}
