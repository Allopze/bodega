/**
 * modules/reports/services/export.ts
 *
 * Forward shim → lib/reports/export.ts
 */

export type {
  ReportCell,
  ReportData,
} from "@/lib/reports/export"

export {
  buildXlsxBuffer,
  getReportData,
} from "@/lib/reports/export"
