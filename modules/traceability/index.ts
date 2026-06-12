/**
 * modules/traceability/index.ts — Barrel público del módulo traceability
 */

// Manifest (para registry)
export { traceabilityModule } from "./manifest"

// Servicios públicos
export { getTrazabilidadXlsx } from "./services/trazabilidad-export"

export type { TrazabilidadExportRow } from "./services/trazabilidad-export-format"
export { buildTrazabilidadReportData } from "./services/trazabilidad-export-format"
