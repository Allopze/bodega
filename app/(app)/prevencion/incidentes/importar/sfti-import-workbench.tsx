"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INCIDENT_EVENT_LABELS, SFTI_INCIDENT_DICTIONARY } from "@/lib/prevention/incidents"
import {
  activateSftiIncidentImportBatchAction,
  approveSftiIncidentImportBatchAction,
  resolveSftiIncidentImportRowAction,
  stageSftiIncidentImportAction,
} from "../actions"

interface BatchRow {
  id: string
  rowNumber: number
  sourceExternalId: string | null
  normalized: Record<string, unknown>
  resolutionStatus: string
  worksiteId: string | null
  workerId: string | null
  issues: string[]
  incidentId: string | null
}

interface BatchBundle {
  batch: {
    id: string
    sourceFileName: string
    sourceChecksumSha256: string
    status: string
    totalRows: number
    readyRows: number
    duplicateRows: number
    reviewRows: number
    errorRows: number
    activatedRows: number
    createdAt: string
  }
  rows: BatchRow[]
}

interface Props {
  batches: BatchBundle[]
  worksites: Array<{ id: string; name: string; code: string }>
  canApprove: boolean
}

function statusVariant(status: string): "default" | "warning" | "success" | "danger" | "info" {
  if (["activated", "approved", "ready"].includes(status)) return "success"
  if (["error", "rejected"].includes(status)) return "danger"
  if (["review", "needs_review"].includes(status)) return "warning"
  if (status === "duplicate") return "info"
  return "default"
}

export function SftiImportWorkbench({ batches, worksites, canApprove }: Props) {
  const [pending, startTransition] = useTransition()
  const [rowWorksites, setRowWorksites] = useState<Record<string, string>>({})
  const [rowTypes, setRowTypes] = useState<Record<string, string>>({})
  function run(operation: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await operation()
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <form action={(formData) => run(() => stageSftiIncidentImportAction(formData))} className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-2"><Label htmlFor="sfti-file">Exportación SFTI en XLSX</Label><Input id="sfti-file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></div>
          <Button type="submit" disabled={pending}>Cargar a staging cifrado</Button>
        </form>
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">Máximo 20 MB. El mismo checksum retorna el lote existente; ninguna fila se activa durante la carga.</p>
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Diccionario de campos aceptados</summary><div className="mt-2 grid gap-2 md:grid-cols-2">{SFTI_INCIDENT_DICTIONARY.map((field) => <p key={field.key}><strong>{field.label}{field.required ? " *" : ""}</strong><br /><span className="text-xs text-[var(--color-text-subtle)]">Aliases: {field.aliases.join(", ")}</span></p>)}</div></details>
      </section>

      {batches.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-subtle)]">No hay lotes SFTI en staging. Carga primero una exportación real.</p> : batches.map(({ batch, rows }) => {
        const unresolved = rows.filter((row) => ["needs_review", "error"].includes(row.resolutionStatus))
        return <section key={batch.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{batch.sourceFileName}</h2><Badge variant={statusVariant(batch.status)}>{batch.status}</Badge></div><p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">SHA-256 {batch.sourceChecksumSha256}</p></div><div className="flex gap-2">{canApprove && ["staging", "review"].includes(batch.status) && <Button type="button" variant="secondary" disabled={pending || unresolved.length > 0 || batch.readyRows === 0} onClick={() => run(() => approveSftiIncidentImportBatchAction(batch.id))}>Aprobar lote</Button>}{canApprove && ["approved", "activated"].includes(batch.status) && <Button type="button" disabled={pending} onClick={() => run(() => activateSftiIncidentImportBatchAction(batch.id))}>{batch.status === "activated" ? "Revalidar activación" : "Activar incidentes"}</Button>}</div></div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-6"><p>Total <strong>{batch.totalRows}</strong></p><p>Listas <strong>{batch.readyRows}</strong></p><p>Duplicadas <strong>{batch.duplicateRows}</strong></p><p>Revisión <strong>{batch.reviewRows}</strong></p><p>Error <strong>{batch.errorRows}</strong></p><p>Activadas <strong>{batch.activatedRows}</strong></p></div>
          {unresolved.length > 0 && <div className="mt-4 space-y-3"><h3 className="font-medium">Filas por conciliar</h3>{unresolved.map((row) => <div key={row.id} className="grid gap-3 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 lg:grid-cols-[7rem_1fr_14rem_16rem_auto] lg:items-end"><div><p className="text-eyebrow">Fila</p><p>{row.rowNumber} · {row.sourceExternalId ?? "sin ID"}</p></div><div><p className="text-eyebrow">Problemas</p><p className="text-sm">{row.issues.join(" · ")}</p></div><div className="space-y-1"><Label>Faena</Label><Select value={rowWorksites[row.id] ?? row.worksiteId ?? ""} onValueChange={(value) => setRowWorksites((current) => ({ ...current, [row.id]: value }))}><SelectTrigger><SelectValue placeholder="Resolver" /></SelectTrigger><SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Tipo de evento</Label><Select value={rowTypes[row.id] ?? String(row.normalized.eventType ?? "")} onValueChange={(value) => setRowTypes((current) => ({ ...current, [row.id]: value }))}><SelectTrigger><SelectValue placeholder="Resolver" /></SelectTrigger><SelectContent>{Object.entries(INCIDENT_EVENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><Button type="button" size="sm" disabled={pending || !(rowWorksites[row.id] ?? row.worksiteId) || !(rowTypes[row.id] ?? row.normalized.eventType)} onClick={() => run(() => resolveSftiIncidentImportRowAction({ rowId: row.id, worksiteId: rowWorksites[row.id] ?? row.worksiteId, eventType: rowTypes[row.id] ?? row.normalized.eventType, reason: "Conciliación manual desde staging SFTI" }))}>Conciliar</Button></div>)}</div>}
          {rows.some((row) => row.incidentId) && <div className="mt-4 text-xs text-[var(--color-text-subtle)]">Los IDs canónicos activados quedan vinculados fila por fila y la reactivación es idempotente.</div>}
        </section>
      })}
    </div>
  )
}
