"use client"

/**
 * Entrega de la versión vigente del RIOHS a la dotación, faena por faena (PDTP
 * N°18). La entrega se cierra sola cuando cada trabajador activo acusó recibo o
 * quedó exento: el acuse es propio, así que quien no tiene cuenta se exime
 * —en lote— con el motivo de cómo recibió el reglamento.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import { assignSstDocumentToWorkforceAction, exemptSstDocumentRecipientsAction } from "../actions"

export type RiohsRolloutRow = {
  worksiteId: string
  worksiteName: string
  active: number
  acknowledged: number
  exempt: number
  pending: number
  unassigned: number
  complete: boolean
  /** Asignaciones pendientes de la faena, para eximirlas en lote. */
  pendingTargetIds: string[]
  obligation: { status: string; dueAt: string | null; overdue: boolean } | null
}

const OBLIGATION_LABEL: Record<string, { label: string; variant: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Entrega abierta", variant: "info" },
  overdue: { label: "Entrega vencida", variant: "danger" },
  reported: { label: "Reportada, por aprobar", variant: "info" },
  completed: { label: "Entrega cerrada", variant: "success" },
  cancelled: { label: "Cancelada", variant: "neutral" },
}

export function RiohsRolloutCard({
  documentId,
  versionId,
  versionNumber,
  rows,
  canDistribute,
}: {
  documentId: string
  versionId: string
  versionNumber: number
  rows: RiohsRolloutRow[]
  canDistribute: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [exempting, setExempting] = React.useState<RiohsRolloutRow | null>(null)
  const [reason, setReason] = React.useState("")

  function assign(row: RiohsRolloutRow) {
    startTransition(async () => {
      const result = await assignSstDocumentToWorkforceAction({
        documentId,
        versionId,
        worksiteId: row.worksiteId,
        assignmentReason: `Nueva versión del Reglamento Interno (v${versionNumber}): entrega a toda la dotación (PDTP N°18).`,
        dueAt: row.obligation?.dueAt ?? null,
      })
      if (result.ok) toast.success(result.message ?? "Dotación asignada.")
      else toast.error(result.message ?? "No se pudo asignar la dotación.")
      router.refresh()
    })
  }

  function exempt() {
    if (!exempting) return
    const row = exempting
    startTransition(async () => {
      const result = await exemptSstDocumentRecipientsAction({
        documentId,
        versionId,
        targetIds: row.pendingTargetIds.slice(0, 200),
        reason,
      })
      if (result.ok) {
        toast.success(result.message ?? "Destinatarios eximidos.")
        setExempting(null)
        setReason("")
      } else {
        toast.error(result.message ?? "No se pudo registrar la exención.")
      }
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="riohs-rollout-title"
      className="mb-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs sm:p-5"
    >
      <h2 id="riohs-rollout-title" className="text-h3 text-[var(--color-text)]">Entrega de la versión v{versionNumber} a la dotación</h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Programa preventivo N°18: la entrega de cada faena se cierra cuando toda su dotación activa acusó recibo o quedó exenta con motivo.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          No hay faenas del programa preventivo activo en tu alcance. La entrega se abre cuando el programa está activo.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Avance de la entrega por faena</caption>
            <thead>
              <tr className="text-left text-xs text-[var(--color-text-muted)]">
                <th scope="col" className="py-2 pr-3 font-medium">Faena</th>
                <th scope="col" className="py-2 pr-3 font-medium">Dotación</th>
                <th scope="col" className="py-2 pr-3 font-medium">Acusados</th>
                <th scope="col" className="py-2 pr-3 font-medium">Exentos</th>
                <th scope="col" className="py-2 pr-3 font-medium">Pendientes</th>
                <th scope="col" className="py-2 pr-3 font-medium">Estado</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => {
                const obligation = row.obligation
                  ? (row.obligation.overdue ? OBLIGATION_LABEL.overdue : OBLIGATION_LABEL[row.obligation.status]) ?? { label: row.obligation.status, variant: "neutral" as const }
                  : { label: row.complete ? "Dotación completa" : "Sin entrega abierta", variant: row.complete ? "success" as const : "neutral" as const }
                const outstanding = row.pending + row.unassigned
                return (
                  <tr key={row.worksiteId}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium text-[var(--color-text)]">{row.worksiteName}</th>
                    <td className="py-2 pr-3 tabular-nums">{row.active}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.acknowledged}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.exempt}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {outstanding}
                      {row.unassigned > 0 ? <span className="ml-1 text-xs text-[var(--color-text-muted)]">({row.unassigned} sin asignar)</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <MetaBadge meta={obligation} size="sm" />
                      {row.obligation?.dueAt ? (
                        <span className="ml-2 text-xs text-[var(--color-text-muted)]">plazo {formatDate(row.obligation.dueAt)}</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      {canDistribute && outstanding > 0 && (
                        <div className="flex justify-end gap-2">
                          {row.unassigned > 0 && (
                            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => assign(row)}>
                              Asignar pendientes
                            </Button>
                          )}
                          {row.pendingTargetIds.length > 0 && (
                            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => { setExempting(row); setReason("") }}>
                              Eximir pendientes…
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={exempting !== null} onOpenChange={(open) => { if (!open) setExempting(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eximir pendientes de {exempting?.worksiteName}</DialogTitle>
            <DialogDescription>
              {exempting ? `${Math.min(exempting.pendingTargetIds.length, 200)} destinatario(s) sin acuse quedarán exentos con este motivo. ` : ""}
              Quien tiene cuenta en la plataforma debería acusar recibo por sí mismo.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Motivo"
            htmlFor="riohs-exempt-reason"
            required
            helper="Por ejemplo: «Entregado por Talana el 2026-10-02; sin cuenta en la plataforma»."
          >
            <Textarea id="riohs-exempt-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExempting(null)} disabled={pending}>Cancelar</Button>
            <Button type="button" size="sm" onClick={exempt} disabled={pending || reason.trim().length < 3}>
              {pending ? "Registrando..." : "Eximir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
