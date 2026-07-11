import * as ExcelJS from "exceljs"
import type { ReactNode } from "react"

export function downloadErrorsXlsx(
  errors: Array<{ rowIndex: number; field: string; message: string }>,
  filename: string,
) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Errores")
  sheet.columns = [
    { header: "Fila", key: "rowIndex", width: 8 },
    { header: "Campo", key: "field", width: 22 },
    { header: "Error", key: "message", width: 50 },
  ]
  errors.forEach((e) => sheet.addRow({ rowIndex: e.rowIndex, field: e.field, message: e.message }))
  workbook.xlsx.writeBuffer().then((buf) => {
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  })
}

export function importErrorKey(error: { rowIndex: number; field: string; message: string }) {
  return `${error.rowIndex}-${error.field}-${error.message}`
}

export function Stat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-md border border-[var(--color-border)]">
      {icon}
      <div>
        <p className="text-lg font-bold leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
