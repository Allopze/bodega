"use client"

import * as React from "react"
import { PencilSimple } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { describeRuleTrigger } from "@/lib/combustibles/control/catalogs"
import { ANOMALY_RULE_SEVERITY_LABELS } from "@/lib/combustibles/validation"
import { toast } from "@/lib/toast"
import { formatQty } from "@/lib/utils"
import { setAnomalyRuleStatusAction } from "./actions"
import { AnomalyRuleForm, type AnomalyRuleRow } from "./rule-form"

const SEVERITY_VARIANT: Record<string, "danger" | "warning" | "success" | "info"> = {
  low: "info", medium: "warning", high: "danger", critical: "danger",
}

export function AnomalyRuleCatalog({ rows, caseCounts, caseCountsFailed, emptyAction }: {
  rows: AnomalyRuleRow[]
  /** Casos abiertos este mes por código de regla. */
  caseCounts: Record<string, number>
  /** La lectura de casos falló: se muestra «—» en vez de un cero que sería falso. */
  caseCountsFailed: boolean
  emptyAction?: React.ReactNode
}) {
  const [editRow, setEditRow] = React.useState<AnomalyRuleRow | null>(null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  // Estado mostrado de cada interruptor mientras la acción responde; si falla, vuelve al real.
  const [shown, setShown] = React.useState<Record<string, boolean>>({})

  async function toggle(row: AnomalyRuleRow, next: boolean) {
    setPendingId(row.id)
    setShown((current) => ({ ...current, [row.id]: next }))
    const result = await setAnomalyRuleStatusAction(row.id, next)
    if (result.ok) toast.success(result.message ?? "Estado actualizado")
    else {
      toast.error(result.message ?? "No se pudo cambiar el estado")
      setShown((current) => { const { [row.id]: _failed, ...rest } = current; return rest })
    }
    setPendingId(null)
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        align="start"
        title="Aún no hay reglas de detección"
        description="Las reglas abren un caso cuando una carga o un equipo cumple su condición. Las del catálogo se crean solas con la primera revisión diaria; también puedes crear una a mano."
        action={emptyAction}
      />
    )
  }

  return (
    <>
      <TableRoot aria-label="Reglas de detección">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>Regla</TableHead>
              <TableHead>Gravedad</TableHead>
              <TableHead>Cuándo se activa</TableHead>
              <TableHead className="text-right">Casos este mes</TableHead>
              <TableHead>Activa</TableHead>
              <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const active = row.id in shown ? shown[row.id]! : row.isActive
              return (
                <TableRow key={row.id}>
                  <TableCell className="max-w-sm">
                    <span className="font-medium">{row.name}</span>
                    {row.description ? <span className="block text-xs text-[var(--color-text-muted)]">{row.description}</span> : null}
                  </TableCell>
                  <TableCell><MetaBadge meta={{ label: ANOMALY_RULE_SEVERITY_LABELS[row.severity as keyof typeof ANOMALY_RULE_SEVERITY_LABELS] ?? row.severity, variant: SEVERITY_VARIANT[row.severity] ?? "info" }} /></TableCell>
                  <TableCell className="max-w-xs text-[var(--color-text-muted)]">{describeRuleTrigger(row.code, row.config)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{caseCountsFailed ? "—" : formatQty(caseCounts[row.code] ?? 0)}</TableCell>
                  <TableCell>
                    <Switch checked={active} disabled={pendingId === row.id} label={`Regla «${row.name}» activa`} onCheckedChange={(next) => void toggle(row, next)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditRow(row)} aria-label={`Editar ${row.name}`}><PencilSimple size={15} aria-hidden />Editar</Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>

      <details className="mt-4 rounded-xl border border-[var(--color-border)] p-4 [&_summary]:cursor-pointer">
        <summary className="text-sm font-semibold text-[var(--color-text)]">Avanzado: código de cada regla y configuración en JSON</summary>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Sólo para administración del sistema. El código de una regla del catálogo no se puede cambiar.</p>
        <TableRoot framed={false} aria-label="Código y configuración de cada regla" className="mt-3">
          <Table className="min-w-[680px]">
            <TableHeader><TableRow><TableHead>Regla</TableHead><TableHead>Código</TableHead><TableHead>Configuración</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">{row.code}</TableCell>
                  <TableCell className="max-w-[320px] truncate font-mono text-xs text-[var(--color-text-muted)]" title={row.config ?? "{}"}>{row.config ?? "{}"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      </details>

      {editRow ? (
        <AnomalyRuleForm key={editRow.id} open onClose={() => setEditRow(null)} editRow={editRow} existingCodes={rows.map((row) => row.code)} />
      ) : null}
    </>
  )
}
