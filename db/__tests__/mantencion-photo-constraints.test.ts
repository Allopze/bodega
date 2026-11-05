import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Composición de las fotos de un registro, garantizada por la base
 * (auditoría 2026-11-04, hallazgo 3.5 · migración 0371).
 *
 * La regla 8 —preventiva = exactamente 1 `filtros` + 1 `sticker`; correctiva =
 * 1..3 `correctiva`— vivía sólo en `checkPhotoComposition`. Una carga directa,
 * una importación o un bug de la app podía dejar un registro firmado con dos
 * filtros y sin sticker, y nada lo delataba después. Esta suite fija las tres
 * redes que ahora impone la base y, sobre todo, la que NO debe imponer: las
 * fotos huérfanas (`record_id` nulo) se suben antes que el registro, así que
 * los índices son parciales y no las restringen.
 */

const pg = new PGlite()
const db = drizzle(pg, { schema })

const NOW = new Date().toISOString()

afterAll(async () => { await pg.close() })

/** El error viaja envuelto por Drizzle: el mensaje de Postgres queda en `cause`. */
async function expectRejected(operation: Promise<unknown>, expected: RegExp): Promise<void> {
  const thrown = await operation.then(() => null, (error: unknown) => error as Error & { cause?: Error })
  expect(thrown, "la base debía rechazar la fila").not.toBeNull()
  expect(`${thrown!.message}\n${thrown!.cause?.message ?? ""}`).toMatch(expected)
}

/** Nombres reales de los objetos: si el rechazo viene de otro lado, la prueba falla. */
const PREVENTIVE_UNIQUE = /mant_record_photos_preventive_unique/
const ORDER_UNIQUE = /mant_record_photos_record_order_unique/
const SORT_ORDER_CHECK = /mant_record_photos_sort_order_valid/

let photoSeq = 0
async function insertPhoto(input: { recordId: string | null; kind: "filtros" | "sticker" | "correctiva"; sortOrder: number }): Promise<void> {
  photoSeq += 1
  const id = `photo-${photoSeq}`
  await db.insert(schema.mantRecordPhotos).values({
    id, recordId: input.recordId, kind: input.kind, sortOrder: input.sortOrder,
    storageKey: `storage/mantencion/${id}.jpg`, mimeType: "image/jpeg",
    sha256: String(photoSeq).padStart(64, "0"), bytes: 1_000, width: 100, height: 100,
    stampedAt: NOW, uploadedBy: "u-mec-fotos",
  })
}

async function insertRecord(id: string, kind: "P" | "C"): Promise<void> {
  await db.insert(schema.mantRecords).values({
    id, folio: `MF-${id}`, kind, vehicleId: "v-ka-fotos",
    equipmentSnapshot: { code: "KA-001", plate: "FOTO-01", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena Fotos", unit: "km" },
    worksiteId: "ws-fotos", reading: 10_000, unit: "km", workDate: "2026-11-01",
    registeredBy: "u-mec-fotos", executorKind: "yo", executorUserId: "u-mec-fotos", executorWorkshopId: null,
    executorName: "Mecánica de Prueba", signedAt: NOW,
    ...(kind === "P"
      ? { scheduleVersion: 1, scheduleNameSnapshot: "Camiones y tractos", intervalValue: 10_000, suggestedIntervalValue: 10_000, notes: "Sin novedad" }
      : {}),
  })
}

async function photosOf(recordId: string) {
  return db.select().from(schema.mantRecordPhotos).where(eq(schema.mantRecordPhotos.recordId, recordId))
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.users).values({ id: "u-mec-fotos", name: "Mecánica de Prueba", email: "mec-fotos@test", hashedPassword: "x", isActive: true })
  await db.insert(schema.worksites).values({ id: "ws-fotos", name: "Faena Fotos", code: "WS-FOTOS", isActive: true })
  await db.insert(schema.fuelEquipmentTypes).values({ id: "fet-fotos", slug: "t-camion-fotos", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await db.insert(schema.fuelVehicles).values({
    id: "v-ka-fotos", plate: "FOTO-01", code: "KA-001", type: "Camión",
    equipmentTypeId: "fet-fotos", worksiteId: "ws-fotos", isActive: true,
  })
  await insertRecord("r-preventiva", "P")
  await insertRecord("r-correctiva-1", "C")
  await insertRecord("r-correctiva-2", "C")
}, 60_000)

describe("fotos de un registro de mantención (migración 0371)", () => {
  it("acepta la composición válida de una preventiva: un filtros y un sticker", async () => {
    await insertPhoto({ recordId: "r-preventiva", kind: "filtros", sortOrder: 0 })
    await insertPhoto({ recordId: "r-preventiva", kind: "sticker", sortOrder: 1 })
    const rows = await photosOf("r-preventiva")
    expect(rows.map((row) => row.kind).sort()).toEqual(["filtros", "sticker"])
  })

  it("acepta tres correctivas con distinto sort_order", async () => {
    for (const sortOrder of [0, 1, 2]) {
      await insertPhoto({ recordId: "r-correctiva-1", kind: "correctiva", sortOrder })
    }
    const rows = await photosOf("r-correctiva-1")
    expect(rows.map((row) => row.sortOrder).sort()).toEqual([0, 1, 2])
  })

  it("rechaza dos fotos filtros ancladas al mismo registro", async () => {
    await insertPhoto({ recordId: "r-correctiva-2", kind: "filtros", sortOrder: 0 })
    await expectRejected(insertPhoto({ recordId: "r-correctiva-2", kind: "filtros", sortOrder: 1 }), PREVENTIVE_UNIQUE)
  })

  it("rechaza dos fotos sticker ancladas al mismo registro", async () => {
    await insertPhoto({ recordId: "r-correctiva-2", kind: "sticker", sortOrder: 2 })
    await expectRejected(insertPhoto({ recordId: "r-correctiva-2", kind: "sticker", sortOrder: 3 }), PREVENTIVE_UNIQUE)
  })

  it("rechaza dos fotos con el mismo (record_id, sort_order)", async () => {
    await insertPhoto({ recordId: "r-correctiva-2", kind: "correctiva", sortOrder: 7 })
    await expectRejected(insertPhoto({ recordId: "r-correctiva-2", kind: "correctiva", sortOrder: 7 }), ORDER_UNIQUE)
  })

  it("rechaza un sort_order negativo", async () => {
    await expectRejected(insertPhoto({ recordId: "r-correctiva-1", kind: "correctiva", sortOrder: -1 }), SORT_ORDER_CHECK)
  })

  it("no restringe las fotos huérfanas: se suben antes que el registro", async () => {
    // Tres filtros con sort_order 0 y sin registro: el flujo real sube las fotos
    // primero y recién después llega el registro que las nombra (PUT idempotente).
    for (let index = 0; index < 3; index++) {
      await insertPhoto({ recordId: null, kind: "filtros", sortOrder: 0 })
    }
    const rows = await db.select().from(schema.mantRecordPhotos).where(eq(schema.mantRecordPhotos.kind, "filtros"))
    expect(rows.filter((row) => row.recordId === null)).toHaveLength(3)
  })

  it("deja creados los índices de FK de la misma migración (E2)", async () => {
    // Índices aditivos —no únicos— que el generador no emite para las tablas de
    // otro carril y que viajan como SQL custom en la 0371: si el nombre o la
    // columna cambian, esto falla en vez de quedar en silencio.
    const expected = [
      "mant_record_drivers_driver_id_idx",
      "mant_record_jobs_work_type_id_idx",
      "mant_records_corrects_record_id_idx",
      "mant_records_duplicate_of_record_id_idx",
      "mant_records_executor_workshop_id_idx",
      "mant_schedule_brand_rules_brand_id_idx",
      "mant_work_orders_requested_by_user_id_idx",
    ]
    const found = await db.execute(
      sql`select indexname from pg_indexes where schemaname = 'public' and indexname in (${sql.join(expected.map((name) => sql`${name}`), sql`, `)})`,
    )
    expect(found.rows.map((row) => (row as { indexname: string }).indexname).sort()).toEqual(expected)
  })
})
