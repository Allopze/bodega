/**
 * modules/reports/index.ts — Barrel público del módulo reports
 */

// Manifest (para registry)
export { reportsModule } from "./manifest"

// Servicios públicos
export type { ReportCell, ReportData } from "./services/export"
export { buildXlsxBuffer, getReportData } from "./services/export"
