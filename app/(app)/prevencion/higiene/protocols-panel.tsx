"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  MINSAL_PROTOCOLS,
  PROTOCOL_APPLICABILITY_LABELS,
  summarizeProtocolCoverage,
  type ProtocolApplicabilityStatus,
} from "@/lib/prevention/minsal-protocols"
import { setProtocolApplicabilityAction } from "./actions"

export interface ApplicabilityRow {
  worksiteId: string
  worksiteName: string
  protocolCode: string
  status: string
  justification: string | null
  nextAssessmentOn: string | null
  version: number
}

function statusVariant(status: ProtocolApplicabilityStatus): "success" | "outline" | "warning" {
  if (status === "applicable") return "success"
  if (status === "not_applicable") return "outline"
  return "warning"
}

/**
 * Los ocho protocolos del MINSAL frente a lo que declaró cada faena.
 *
 * La pregunta que resuelve —"¿qué % del PREXOR tengo cumplido?"— no se podía
 * responder mientras el protocolo fue texto libre en el programa de vigilancia.
 */
export function ProtocolsPanel({ worksites, applicabilities, today, canManage }: {
  worksites: { id: string; name: string }[]
  applicabilities: ApplicabilityRow[]
  today: string
  canManage: boolean
}) {
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [editing, setEditing] = React.useState<{ code: string; shortName: string; row?: ApplicabilityRow } | null>(null)

  const scoped = applicabilities.filter((row) => row.worksiteId === worksiteId)
  const coverage = summarizeProtocolCoverage(scoped, today)
  const pending = coverage.filter((item) => item.status === "pending_assessment").length
  const overdue = coverage.filter((item) => item.overdue).length

  if (worksites.length === 0) {
    return <EmptyState title="Sin faenas visibles" description="No hay faenas en tu alcance para declarar protocolos." />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger className="w-64" aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        {pending > 0 && <MetaBadge meta={{ label: `${pending} sin pronunciamiento`, variant: "warning" }} />}
        {overdue > 0 && <MetaBadge meta={{ label: `${overdue} con reevaluación vencida`, variant: "danger" }} />}
      </div>

      {pending > 0 && (
        <div role="status" className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-4 text-sm">
          <strong>Hay protocolos sin pronunciamiento en esta faena.</strong>
          <p className="mt-1">
            No declararse no equivale a que el protocolo no aplique: descartarlo exige justificarlo por escrito.
          </p>
        </div>
      )}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[10rem]">Protocolo</TableHead>
              <TableHead className="min-w-[20rem]">Nombre</TableHead>
              <TableHead>Base legal</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Reevaluación</TableHead>
              {canManage && <TableHead>Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {coverage.map((item) => {
              const row = scoped.find((entry) => entry.protocolCode === item.code)
              return (
                <TableRow key={item.code}>
                  <TableCell className="font-medium">{item.shortName}</TableCell>
                  <TableCell className="text-sm">{item.name}</TableCell>
                  <TableCell className="text-xs text-[var(--color-text-muted)]">{item.legalBasis}</TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: PROTOCOL_APPLICABILITY_LABELS[item.status], variant: statusVariant(item.status) }} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {item.nextAssessmentOn
                      ? <span className={item.overdue ? "text-[var(--color-danger)]" : undefined}>{item.nextAssessmentOn}</span>
                      : <span className="text-[var(--color-text-muted)]">—</span>}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setEditing({ code: item.code, shortName: item.shortName, row })}>
                        Declarar
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>

      <DeclareDialog
        target={editing}
        worksiteId={worksiteId}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function DeclareDialog({ target, worksiteId, onClose }: {
  target: { code: string; shortName: string; row?: ApplicabilityRow } | null
  worksiteId: string
  onClose: () => void
}) {
  const router = useRouter()
  const operation = useOperation()
  const [status, setStatus] = React.useState<ProtocolApplicabilityStatus>("applicable")

  React.useEffect(() => {
    if (target) setStatus((target.row?.status as ProtocolApplicabilityStatus) ?? "applicable")
  }, [target])

  const protocol = target ? MINSAL_PROTOCOLS.find((item) => item.code === target.code) : undefined

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target) return
    const form = new FormData(event.currentTarget)
    const periodicity = form.get("periodicityMonths")
    operation.run(() => setProtocolApplicabilityAction({
      worksiteId,
      protocolCode: target.code,
      status,
      justification: form.get("justification"),
      periodicityMonths: periodicity ? Number(periodicity) : undefined,
      expectedVersion: target.row?.version,
    }), () => { onClose(); router.refresh() })
  }

  return (
    <Dialog open={target !== null} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{target?.shortName}</DialogTitle>
            <DialogDescription>{protocol?.name} · {protocol?.legalBasis}</DialogDescription>
          </DialogHeader>

          <Field label="¿Aplica a esta faena?">
            <Select value={status} onValueChange={(value) => setStatus(value as ProtocolApplicabilityStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="applicable">Aplicable</SelectItem>
                <SelectItem value="not_applicable">No aplicable</SelectItem>
                <SelectItem value="pending_assessment">Por evaluar</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label={status === "not_applicable" ? "Justificación (obligatoria)" : "Observaciones"}>
            <Textarea
              name="justification"
              defaultValue={target?.row?.justification ?? ""}
              required={status === "not_applicable"}
              minLength={status === "not_applicable" ? 10 : undefined}
              placeholder={status === "not_applicable" ? "Por qué este protocolo no aplica a la faena." : undefined}
            />
          </Field>

          {status === "applicable" && (
            <Field label="Periodicidad de reevaluación (meses)">
              <Input
                name="periodicityMonths"
                type="number"
                min={1}
                max={120}
                defaultValue={target?.row ? undefined : protocol?.defaultPeriodicityMonths}
              />
            </Field>
          )}

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
