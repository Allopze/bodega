// `boolean` cubre el retorno de `sanitizeCell` (excel-builder.ts) — sigue pasando
// booleanos reales sin convertirlos a texto. Un `Date` válido se escribe como celda de fecha de
// Excel (ver `lib/reports/excel-dates.ts` para convertir un instante a la hora de pared de
// Chile); uno inválido se escribe vacío. Antes cualquier objeto se volvía texto JSON.
export type ReportCell = string | number | boolean | Date | null | undefined

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
  /** Formato de número de Excel por columna (índice desde 0) de la hoja primaria. */
  columnFormats?: Record<number, string>
}

export interface ReportSheet {
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
  /** Formato de número de Excel por columna (índice desde 0), p. ej. `dd-mm-yyyy`. */
  columnFormats?: Record<number, string>
}
