import { and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { mantHistoricalScheduleChecks, mantHistoricalScheduleItems, mantRecordItems, mantRecordPhotos, mantRecords } from "@/db/schema"
import { driveLink } from "@/lib/mantencion/drive-link"
import type { MantViewer } from "../access"
import { HISTORICAL_OBSERVATIONS, loadComplianceChecks } from "./preventive-checks"
import { matrixRows } from "./preventive-summary"
import type { ChecklistMatrix, CrossDimension, LookerFilters, MatrixCheck, ResolvedCrossFilters } from "./types"

type HistoricalMeta = { sourceKey: string; observations: string | null; filtersPhotoUrl: string | null; stickerPhotoUrl: string | null }
type NativeMeta = { id: string; notes: string | null }

/**
 * Últimas pautas con detalle por ítem. Los históricos sin detalle no entran como columna: se
 * cuentan en `withoutDetail` para que la UI diga cuántos quedaron fuera.
 */
export async function loadChecklistMatrix(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
  limit = 8,
): Promise<ChecklistMatrix> {
  const checks = await loadComplianceChecks(viewer, filters, cross, ignore)
  const candidates = checks.slice(0, Math.max(limit * 4, 16))
  const historicalCandidates = candidates.filter((check) => check.source === "historial")
  const nativeCandidates = candidates.filter((check) => check.source === "registro")
  const historicalKeys = historicalCandidates.map((check) => check.id.slice(2))
  const nativeIds = nativeCandidates.map((check) => check.id.slice(2))

  const [historicalItems, nativeItems] = await Promise.all([
    historicalKeys.length
      ? db.select({
        checkSourceKey: mantHistoricalScheduleItems.checkSourceKey,
        itemName: mantHistoricalScheduleItems.itemName,
        result: mantHistoricalScheduleItems.result,
        sortOrder: mantHistoricalScheduleItems.sortOrder,
      }).from(mantHistoricalScheduleItems)
        .where(inArray(mantHistoricalScheduleItems.checkSourceKey, historicalKeys))
        .orderBy(mantHistoricalScheduleItems.checkSourceKey, mantHistoricalScheduleItems.sortOrder)
      : Promise.resolve([]),
    nativeIds.length
      ? db.select({
        recordId: mantRecordItems.recordId,
        itemName: mantRecordItems.itemName,
        groupName: mantRecordItems.groupName,
        value: mantRecordItems.value,
        sortOrder: mantRecordItems.sortOrder,
      }).from(mantRecordItems)
        .where(inArray(mantRecordItems.recordId, nativeIds))
        .orderBy(mantRecordItems.recordId, mantRecordItems.sortOrder)
      : Promise.resolve([]),
  ])

  const historicalWithItems = new Set(historicalItems.map((item) => item.checkSourceKey))
  const nativeWithItems = new Set(nativeItems.map((item) => item.recordId))
  const selectedHistorical = historicalCandidates.filter((check) => historicalWithItems.has(check.id.slice(2))).slice(0, limit)
  const selectedNative = nativeCandidates.filter((check) => nativeWithItems.has(check.id.slice(2))).slice(0, limit)
  const selected = [...selectedHistorical, ...selectedNative]
    .sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code, "es", { numeric: true }))
    .slice(0, limit)
  const selectedHistoricalKeys = selected.filter((check) => check.source === "historial").map((check) => check.id.slice(2))
  const selectedNativeIds = selected.filter((check) => check.source === "registro").map((check) => check.id.slice(2))

  const [historicalMeta, nativeMeta, photos] = await Promise.all([
    selectedHistoricalKeys.length
      ? db.select({
        sourceKey: mantHistoricalScheduleChecks.sourceKey,
        observations: HISTORICAL_OBSERVATIONS,
        filtersPhotoUrl: mantHistoricalScheduleChecks.filtersPhotoUrl,
        stickerPhotoUrl: mantHistoricalScheduleChecks.stickerPhotoUrl,
      }).from(mantHistoricalScheduleChecks).where(inArray(mantHistoricalScheduleChecks.sourceKey, selectedHistoricalKeys))
      : Promise.resolve([]),
    selectedNativeIds.length
      ? db.select({ id: mantRecords.id, notes: mantRecords.notes }).from(mantRecords).where(inArray(mantRecords.id, selectedNativeIds))
      : Promise.resolve([]),
    selectedNativeIds.length
      ? db.select({
        id: mantRecordPhotos.id,
        recordId: mantRecordPhotos.recordId,
        kind: mantRecordPhotos.kind,
        sortOrder: mantRecordPhotos.sortOrder,
        stampedAt: mantRecordPhotos.stampedAt,
        receivedAt: mantRecordPhotos.receivedAt,
      }).from(mantRecordPhotos)
        .where(and(inArray(mantRecordPhotos.recordId, selectedNativeIds), inArray(mantRecordPhotos.kind, ["filtros", "sticker"])))
        .orderBy(mantRecordPhotos.recordId, mantRecordPhotos.sortOrder)
      : Promise.resolve([]),
  ])

  const metaByKey = new Map<string, HistoricalMeta>(historicalMeta.map((row) => [row.sourceKey, row]))
  const nativeByKey = new Map<string, NativeMeta>(nativeMeta.map((row) => [row.id, row]))
  const photosByRecord = new Map<string, Array<{ id: string; kind: string; stampedAt: string; receivedAt: string }>>()
  for (const photo of photos) {
    if (!photo.recordId) continue
    const list = photosByRecord.get(photo.recordId) ?? []
    list.push({ id: photo.id, kind: photo.kind, stampedAt: photo.stampedAt, receivedAt: photo.receivedAt })
    photosByRecord.set(photo.recordId, list)
  }

  const itemsByHistorical = new Map<string, typeof historicalItems>()
  for (const item of historicalItems) {
    const list = itemsByHistorical.get(item.checkSourceKey) ?? []
    list.push(item)
    itemsByHistorical.set(item.checkSourceKey, list)
  }
  const itemsByNative = new Map<string, typeof nativeItems>()
  for (const item of nativeItems) {
    const list = itemsByNative.get(item.recordId) ?? []
    list.push(item)
    itemsByNative.set(item.recordId, list)
  }

  const matrixChecks: MatrixCheck[] = selected.map((check) => {
    const key = check.id.slice(2)
    const meta = check.source === "historial" ? metaByKey.get(key) : undefined
    const native = check.source === "registro" ? nativeByKey.get(key) : undefined
    const nativePhotos = check.source === "registro" ? photosByRecord.get(key) ?? [] : []
    const items: MatrixCheck["items"] = {}
    const itemOrder: Record<string, number> = {}
    const itemGroups: Record<string, string | null> = {}
    if (check.source === "historial") {
      for (const item of itemsByHistorical.get(key) ?? []) {
        items[item.itemName] = item.result === "realizado" ? "realizado" : item.result === "no_realizado" ? "no_realizado" : "no_aplica"
        itemOrder[item.itemName] = item.sortOrder
        itemGroups[item.itemName] = null
      }
    } else {
      for (const item of itemsByNative.get(key) ?? []) {
        items[item.itemName] = item.value === "R" ? "realizado" : item.value === "NR" ? "no_realizado" : "no_aplica"
        itemOrder[item.itemName] = item.sortOrder
        itemGroups[item.itemName] = item.groupName
      }
    }
    // Texto libre de una celda de Excel: sólo viajan al cliente los enlaces https a Drive/Docs.
    const filtersUrl = driveLink(meta?.filtersPhotoUrl)
    const stickerUrl = driveLink(meta?.stickerPhotoUrl)
    const photoUrls = [
      filtersUrl ? { label: "Filtros usados", url: filtersUrl } : null,
      stickerUrl ? { label: "Sticker", url: stickerUrl } : null,
    ].filter((value): value is { label: string; url: string } => value !== null)
    return {
      id: check.id,
      source: check.source,
      vehicleId: check.vehicleId,
      date: check.date,
      label: `${check.code || check.plate} · ${check.level}`,
      code: check.code,
      plate: check.plate,
      worksiteName: check.worksiteName,
      level: check.level,
      mechanic: check.mechanic,
      photoIds: nativePhotos.map((photo) => ({
        id: photo.id,
        caption: photo.kind === "filtros" ? "Filtros usados" : "Sticker",
        stampedAt: photo.stampedAt,
        receivedAt: photo.receivedAt,
      })),
      photoUrls,
      observations: meta?.observations ?? native?.notes ?? null,
      items,
      itemOrder,
      itemGroups,
    }
  })

  return {
    checks: matrixChecks,
    items: matrixRows(matrixChecks),
    withoutDetail: candidates.filter((check) => check.source === "historial" && !historicalWithItems.has(check.id.slice(2))).length,
  }
}
