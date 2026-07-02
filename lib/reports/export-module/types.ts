export type ReportCell = string | number | null | undefined

export interface ExportFilters {
  fromDate?:  string
  toDate?:    string
  worksiteId?: string
  supplierId?: string
  vehicleId?: string
  status?:    string
  /** Free-text query (matched against code). */
  q?:         string
}

export interface ReportData {
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
  sheets?: ReportSheet[]
  rowLimitApplied?: boolean
}

export interface ReportSheet {
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
}
