"use client"

import * as React from "react"
import { FileXls } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import type { TaeCopecFilters } from "@/lib/combustibles/tae-copec-reconciliation"
import { exportTaeCopecReconciliationAction } from "./actions"

export function TaeCopecExportButton({ filters }: { filters: TaeCopecFilters }) {
  const [pending, startTransition] = React.useTransition()
  return <Button size="sm" variant="secondary" disabled={pending} onClick={() => startTransition(async () => {
    const result = await exportTaeCopecReconciliationAction(filters)
    if (!result.ok || !result.data) { toast.error(result.message ?? "No se pudo exportar"); return }
    const link = document.createElement("a")
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data.base64}`
    link.download = result.data.filename
    link.click()
    if (result.data.truncated) toast.warning("El XLSX alcanzó el límite de 10.000 filas")
    else toast.success("Conciliación exportada")
  })}><FileXls size={16} />{pending ? "Exportando…" : "Exportar XLSX"}</Button>
}
