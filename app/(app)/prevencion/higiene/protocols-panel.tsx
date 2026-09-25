"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ProgramSlotList, type ProgramSlotRow } from "@/components/prevention/program-slot-list"
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
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import {
  MINSAL_PROTOCOLS,
  PROTOCOL_APPLICABILITY_LABELS,
  summarizeProtocolCoverage,
  type ProtocolApplicabilityStatus,
} from "@/lib/prevention/minsal-protocols"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"
import { recordHygieneMeasurementSlotStatusAction, setProtocolApplicabilityAction } from "./actions"

export interface ApplicabilityRow {
  worksiteId: string
  worksiteName: string
  protocolCode: string
  status: string
  justification: string | null
  nextAssessmentOn: string | null
  version: number
}

/** Casilla N°45 de una faena: la fila del checklist compartido, con su faena. */
export type MeasurementSlotRow = ProgramSlotRow & { worksiteId: string }

function statusVariant(status: ProtocolApplicabilityStatus): "success" | "outline" | "warning" {
  if (status === "applicable") return "success"
  if (status === "not_applicable") return "outline"
  return "warning"
}

/**
 * Lo que el programa anual le pide a la higiene de cada faena: la evaluación
 * cuantitativa (N°45) y los ocho protocolos del MINSAL frente a lo que declaró.
 *
 * La pregunta que resuelve —"¿qué % del PREXOR tengo cumplido?"— no se podía
 * responder mientras el protocolo fue texto libre en el programa de vigilancia.
 * La casilla N°45 vive acá y no en el detalle del GES porque es de la faena, no
 * de un grupo: la cumple la primera medición del año, de cualquier GES.
 */
export function ProtocolsPanel({
  worksites, applicabilities, measurementSlots, slotYear, activationPeriods, canRecordMeasurementSlots, today, canManage,
}: {
  worksites: { id: string; name: string }[]
  applicabilities: ApplicabilityRow[]
  measurementSlots: MeasurementSlotRow[]
  slotYear: number
  activationPeriods: Record<string, PdtpPeriod | null>
  canRecordMeasurementSlots: boolean
  today: string
  canManage: boolean
}) {
  /* La faena viaja en la URL (`?faena=`) y no en un `useState`: el panel sólo
   * se pinta en la pestaña "protocols", así que cambiar de pestaña lo desmonta
   * y un estado local volvería a la primera faena. Hasta 2026-09-24 pasaba
   * además después de cada acción —declarar un protocolo, resolver la casilla
   * N°45—, porque revalidar volvía a montar la plataforma entera: quien acababa
   * de declarar algo en la cuarta faena veía la primera y creía que la acción
   * no había hecho nada. */
  const { getFilter, setFilter } = useUrlFilters()
  const requestedWorksiteId = getFilter("faena")
  const worksiteId = worksites.some((item) => item.id === requestedWorksiteId)
    ? requestedWorksiteId
    : worksites[0]?.id ?? ""
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
        <Select value={worksiteId} onValueChange={(value) => setFilter("faena", value)}>
          <SelectTrigger className="w-64" aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        {pending > 0 && <MetaBadge meta={{ label: `${pending} sin pronunciamiento`, variant: "warning" }} />}
        {overdue > 0 && <MetaBadge meta={{ label: `${overdue} con reevaluación vencida`, variant: "danger" }} />}
      </div>

      <section aria-labelledby="hygiene-n45-heading" className="space-y-2">
        <div>
          <h2 id="hygiene-n45-heading" className="text-sm font-semibold">Evaluación cuantitativa por mutual</h2>
          <p className="text-xs text-[var(--color-text-subtle)]">
            Actividad N°45 del programa anual. La cumple la primera medición del año en esta faena, con su informe de laboratorio adjunto.
          </p>
        </div>
        <ProgramSlotList
          rows={measurementSlots.filter((row) => row.worksiteId === worksiteId)}
          year={slotYear}
          canRecord={canRecordMeasurementSlots}
          emptyHint="Esta faena todavía no tiene la casilla del programa; se genera al activarla."
          activationPeriod={activationPeriods[worksiteId] ?? null}
          onRecord={(input) => recordHygieneMeasurementSlotStatusAction(input)}
        />
      </section>

      <h2 className="text-sm font-semibold">Protocolos MINSAL</h2>

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
