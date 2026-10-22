import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workers } from "@/db/schema"

/**
 * Reporte de mapeo sugerido del histórico TAE (Fase 5, dry-run de solo lectura):
 * parsea el Excel legado, lo compara contra los catálogos actuales y devuelve
 * un Excel con el detalle por faena/equipo/conductor/supervisor para revisión
 * manual. No escribe nada en la base de datos.
 */
export async function generateTaeImportDryRunReport(fileBuffer: ArrayBuffer | Buffer): Promise<Buffer> {
  const [{ parseTaeLegacyExcel }, { buildTaeImportReport, renderTaeImportReportXlsx }] = await Promise.all([
    import("@/lib/combustibles/tae-import"),
    import("@/lib/combustibles/tae-import-report"),
  ])
  const [parsed, catalogRows] = await Promise.all([
    parseTaeLegacyExcel(fileBuffer),
    Promise.all([
      db.query.worksites.findMany({ columns: { id: true, name: true } }),
      db.query.fuelVehicles.findMany({ columns: { id: true, code: true, plate: true }, with: { worksite: { columns: { name: true } } } }),
      db.query.workers.findMany({ where: eq(workers.isActive, true), columns: { id: true, firstName: true, lastName: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
    ]),
  ])
  const { rows, errors } = parsed
  const [worksitesList, vehiclesList, workersList] = catalogRows

  const report = buildTaeImportReport({
    rows,
    errors,
    worksites: worksitesList,
    vehicles: vehiclesList.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, plate: vehicle.plate, worksiteName: vehicle.worksite?.name ?? "" })),
    workers: workersList.map((worker) => ({ id: worker.id, name: `${worker.firstName} ${worker.lastName}`, worksiteId: worker.worksiteId, worksiteName: worker.worksite?.name ?? "" })),
  })
  return renderTaeImportReportXlsx(report)
}

/** Dry-run serializable para revisar identidades ambiguas antes de escribir el lote. */
export async function generateTaeImportPreview(fileBuffer: ArrayBuffer | Buffer, allowedWorksiteIds?: ReadonlySet<string>) {
  const [{ parseTaeLegacyExcel }, { buildTaeImportReport }, { buildTaeImportReview, vehicleMappingKey, workerMappingKey }] = await Promise.all([
    import("@/lib/combustibles/tae-import"),
    import("@/lib/combustibles/tae-import-report"),
    import("@/lib/combustibles/tae-import-service"),
  ])
  const [parsed, catalogRows] = await Promise.all([
    parseTaeLegacyExcel(fileBuffer),
    Promise.all([
      db.query.worksites.findMany({ columns: { id: true, name: true } }),
      db.query.fuelVehicles.findMany({ columns: { id: true, code: true, plate: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
      db.query.workers.findMany({ where: eq(workers.isActive, true), columns: { id: true, firstName: true, lastName: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
      db.query.fuelTaeVehicleMappings.findMany({ columns: { worksiteId: true, legacyCode: true, vehicleId: true } }),
      db.query.fuelTaeWorkerMappings.findMany({ columns: { worksiteId: true, role: true, legacyName: true, workerId: true } }),
    ]),
  ])
  const { rows, errors } = parsed
  const [worksitesList, vehiclesList, workersList, vehicleMappings, workerMappings] = catalogRows
  const catalogs = {
    worksites: worksitesList,
    vehicles: vehiclesList.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, plate: vehicle.plate, worksiteId: vehicle.worksiteId, worksiteName: vehicle.worksite?.name ?? "" })),
    workers: workersList.map((worker) => ({ id: worker.id, name: `${worker.firstName} ${worker.lastName}`, worksiteId: worker.worksiteId, worksiteName: worker.worksite?.name ?? "" })),
  }
  const mappings = {
    vehicles: new Map(vehicleMappings.map((row) => [vehicleMappingKey(row.worksiteId, row.legacyCode), row.vehicleId])),
    drivers: new Map(workerMappings.filter((row) => row.role === "driver").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
    supervisors: new Map(workerMappings.filter((row) => row.role === "supervisor").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
  }
  const report = buildTaeImportReport({
    rows,
    errors,
    worksites: worksitesList,
    vehicles: catalogs.vehicles,
    workers: catalogs.workers,
  })
  return buildTaeImportReview({ rows, report, catalogs, allowedWorksiteIds, mappings })
}
