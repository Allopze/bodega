"use client"

import * as React from "react"
import { PencilSimple, Power } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { ANOMALY_RULE_SEVERITY_LABELS } from "@/lib/combustibles/validation"
import { setAnomalyRuleStatusAction } from "./actions"
import { AnomalyRuleForm, type AnomalyRuleRow } from "./rule-form"

const SEVERITY_VARIANT: Record<string, "danger" | "warning" | "success" | "info"> = {
  low: "info", medium: "warning", high: "danger", critical: "danger",
}

export function AnomalyRuleCatalog({ rows }: { rows: AnomalyRuleRow[] }) {
  const [editRow, setEditRow] = React.useState<AnomalyRuleRow | null>(null)
  const [open, setOpen] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  function edit(row: AnomalyRuleRow) { setEditRow(row); setOpen(true) }
  function close() { setOpen(false); setEditRow(null) }

  async function toggle(row: AnomalyRuleRow) {
    setPendingId(row.id)
    const result = await setAnomalyRuleStatusAction(row.id, !row.isActive)
    if (result.ok) toast.success(result.message ?? "Estado actualizado")
    else toast.error(result.message ?? "No se pudo cambiar el estado")
    setPendingId(null)
  }

  return <>
    <div className="overflow-x-auto border border-[var(--color-border)]">
      <Table className="min-w-[880px]">
        <TableHeader><TableRow><TableHead>Regla</TableHead><TableHead>Severidad</TableHead><TableHead>Configuración</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
        <TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-[var(--color-text-muted)]">No hay reglas configuradas.</TableCell></TableRow> : rows.map((row) => <TableRow key={row.id}>
          <TableCell><span className="font-medium">{row.name}</span><span className="block font-mono text-xs text-[var(--color-text-muted)]">{row.code}</span></TableCell>
          <TableCell><Badge variant={SEVERITY_VARIANT[row.severity] ?? "info"} size="sm">{ANOMALY_RULE_SEVERITY_LABELS[row.severity as keyof typeof ANOMALY_RULE_SEVERITY_LABELS] ?? row.severity}</Badge></TableCell>
          <TableCell className="max-w-[280px] truncate font-mono text-xs text-[var(--color-text-muted)]" title={row.config ?? "{}"}>{row.config ?? "{}"}</TableCell>
          <TableCell><Badge variant={row.isActive ? "success" : "default"}>{row.isActive ? "Activa" : "Inactiva"}</Badge></TableCell>
          <TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => edit(row)}><PencilSimple size={15} />Editar</Button><Button size="sm" variant="secondary" disabled={pendingId === row.id} onClick={() => toggle(row)}><Power size={15} />{row.isActive ? "Desactivar" : "Activar"}</Button></div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
    <AnomalyRuleForm key={editRow?.id ?? "new"} open={open} onClose={close} editRow={editRow} />
  </>
}
