import { access } from "node:fs/promises"
import { desc, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordPhotos } from "@/db/schema"
import { resolveMantencionFile } from "@/lib/storage/config"
import type { MantUnit } from "@/lib/mantencion/types"
import type { MantViewer } from "../access"
import { unitFromMeter } from "../fleet"
import { correctiveScope, parseDrivers, type UnionRow } from "./corrective-union"
import type { CorrectivePage, CorrectiveWorkRow, LookerFilters, ResolvedCrossFilters } from "./types"

/**
 * Tabla «Trabajos del período» de la pestaña Correctivo, paginada en SQL sobre la unión de `corrective-union.ts`.
 * La tabla no se filtra por la OT que ella misma emite (`x_ot`) y sí por todo lo demás: el conductor, el mes, el
 * equipo y las faenas elegidos. La página y el Excel comparten la misma consulta, para que den siempre las mismas filas.
 */

const PAGE_SIZE = 25

function toWorkRow(row: UnionRow): CorrectiveWorkRow {
  return {
    id: row.id,
    source: row.source === "ot" ? "ot" : row.source === "registro" ? "registro" : "historial",
    date: row.date,
    vehicleId: row.vehicleId,
    recordId: row.recordId,
    code: row.code,
    plate: row.plate,
    typeName: row.typeName ?? "",
    unit: unitFromMeter(row.unit ?? "") as MantUnit | null,
    reading: row.reading == null ? null : Number(row.reading),
    readingText: row.readingText,
    reference: row.reference,
    workPerformed: row.workPerformed,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    hours: row.hours == null ? null : Number(row.hours),
    photoId: row.photoId,
    photoUrl: row.photoUrl,
    drivers: parseDrivers(row.driverText),
  }
}

/**
 * TODAS las filas de la tabla de trabajos correctivos con los mismos filtros que `loadCorrectivePage`, sin
 * paginar: es lo que exporta el Excel. Trae hasta `limit` filas (las más recientes primero) y el total, para
 * que quien exporta pueda decir cuándo cortó. No consulta las fotos: el libro no las lleva.
 */
export async function loadCorrectiveRows(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  options: { limit: number },
): Promise<{ rows: CorrectiveWorkRow[]; total: number }> {
  const scope = await correctiveScope(viewer, filters, cross, ["work"])
  if (!scope) return { rows: [], total: 0 }
  const { union, where } = scope
  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(union).where(where)
  const rawRows = await db.select().from(union).where(where)
    .orderBy(desc(union.date), desc(union.id))
    .limit(options.limit)
  return { rows: rawRows.map((row) => toWorkRow(row as UnionRow)), total: Number(countRow?.n ?? 0) }
}

/** Página de la tabla de trabajos correctivos. */
export async function loadCorrectivePage(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
): Promise<CorrectivePage> {
  const scope = await correctiveScope(viewer, filters, cross, ["work"])
  if (!scope) return { rows: [], total: 0, page: 1, pageSize: PAGE_SIZE }
  const { union, where } = scope
  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(union).where(where)
  const total = Number(countRow?.n ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(Math.max(1, filters.page), totalPages)
  const rawRows = await db.select().from(union).where(where)
    .orderBy(desc(union.date), desc(union.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
  // Una foto puede tener fila y no archivo (storage incompleto o borrado): se comprueba la
  // existencia antes de pintar la miniatura, si no el navegador pide una imagen que da 404.
  const photoIds = [...new Set(rawRows.map((row) => row.photoId).filter((id): id is string => !!id))]
  const availablePhotos = new Set<string>()
  if (photoIds.length > 0) {
    const photos = await db.select({ id: mantRecordPhotos.id, storageKey: mantRecordPhotos.storageKey })
      .from(mantRecordPhotos)
      .where(inArray(mantRecordPhotos.id, photoIds))
    await Promise.all(photos.map(async (photo) => {
      const absolute = resolveMantencionFile(photo.storageKey)
      if (!absolute) return
      try {
        await access(absolute)
        availablePhotos.add(photo.id)
      } catch {
        // El archivo no está: la fila conserva su «Sin foto».
      }
    }))
  }
  const rows = rawRows.map((row) => ({
    ...row,
    photoId: row.photoId && availablePhotos.has(row.photoId) ? row.photoId : null,
  }))
  return { rows: rows.map((row) => toWorkRow(row as UnionRow)), total, page, pageSize: PAGE_SIZE }
}
