// `boolean` cubre el retorno de `sanitizeCell` (excel-builder.ts) — sigue pasando
// booleanos reales sin convertirlos a texto.
export type ReportCell = string | number | boolean | null | undefined

export interface ExportFilters {
  fromDate?:  string
  toDate?:    string
  worksiteId?: string
  supplierId?: string
  vehicleId?: string
  status?:    string
  /** Free-text query (matched against code). */
  q?:         string
  /** Compras: sólo OC que ya deberían tener factura y no la tienen. */
  invoicePending?: boolean
}

export interface ReportData {
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
  /**
   * Hojas **adicionales**, que se emiten después de la hoja primaria
   * (`worksheetName`/`headers`/`rows`) — no en lugar de ella. Un reporte que sólo
   * quiera hojas derivadas debe dejar `headers` vacío y declararlas todas acá.
   */
  sheets?: ReportSheet[]
  rowLimitApplied?: boolean
}

export interface ReportSheet {
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
}
