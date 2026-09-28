"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { INCIDENT_EVENT_LABELS } from "@/lib/prevention/incidents"
import { convertPublicIncidentReportAction, discardPublicIncidentReportAction } from "./actions"

/**
 * Las dos salidas del triage de un reporte del buzón: abrir el incidente formal
 * o descartarlo con motivo. Lo que escribió el trabajador (faena, fecha, lugar,
 * relato) pasa tal cual; aquí sólo se pide lo que el canal no pregunta.
 */
export function PublicReportActions({ reportId, reportCode, occurredAt, canConvert }: {
  reportId: string
  reportCode: string
  occurredAt: string
  /** Abrir el incidente desde el buzón es parte del triage: basta `incidents:triage`. */
  canConvert: boolean
}) {
  const router = useRouter()
  const [convertOpen, setConvertOpen] = React.useState(false)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const [eventType, setEventType] = React.useState("dangerous_incident")
  const convert = useOperation()
  const discard = useOperation({ feedback: "toast" })
  const prefix = `report-${reportId}`

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {canConvert && <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogTrigger asChild><Button size="sm" variant="secondary">Abrir incidente</Button></DialogTrigger>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              convert.run(() => convertPublicIncidentReportAction({
                reportId,
                eventType,
                companyName: String(form.get("companyName") ?? ""),
                occurredTime: String(form.get("occurredTime") ?? ""),
                notes: String(form.get("notes") ?? ""),
              }), (result) => {
                setConvertOpen(false)
                const incidentId = (result as { incidentId?: string }).incidentId
                if (incidentId) router.push(`/prevencion/incidentes/${incidentId}`)
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>Abrir incidente desde {reportCode}</DialogTitle>
              <DialogDescription>
                El incidente se abre con la faena, la fecha ({occurredAt}), el lugar y el relato del reporte. Los plazos legales corren desde que el reporte llegó al buzón.
              </DialogDescription>
            </DialogHeader>
            <Field label="Tipo de evento" htmlFor={`${prefix}-event`} error={convert.fieldError("eventType")}>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger id={`${prefix}-event`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(INCIDENT_EVENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Empresa del evento" htmlFor={`${prefix}-company`} error={convert.fieldError("companyName")}>
              <Input id={`${prefix}-company`} name="companyName" required minLength={2} maxLength={300} />
            </Field>
            <Field label="Hora aproximada del evento" htmlFor={`${prefix}-time`} hint="El reporte sólo trae la fecha." error={convert.fieldError("occurredTime")}>
              <Input id={`${prefix}-time`} name="occurredTime" type="time" required />
            </Field>
            <Field label="Fundamento del triage" htmlFor={`${prefix}-notes`} hint="Mínimo 10 caracteres." error={convert.fieldError("notes")}>
              <Textarea id={`${prefix}-notes`} name="notes" required minLength={10} maxLength={1000} rows={3} />
            </Field>
            {convert.message && <p role="alert" className="text-sm text-[var(--color-danger)]">{convert.message}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setConvertOpen(false)} disabled={convert.pending}>Cancelar</Button>
              <Button type="submit" loading={convert.pending}>Abrir incidente</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>}

      <Button size="sm" variant="ghost" onClick={() => setDiscardOpen(true)}>Descartar</Button>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={`Descartar ${reportCode}`}
        description="El reporte sale del buzón sin abrir un incidente. Queda registrado quién lo descartó y por qué."
        confirmLabel="Descartar reporte"
        variant="warning"
        reasonLabel="Motivo del descarte"
        reasonPlaceholder="Ej.: repetido del reporte RPT-…, ya investigado en el incidente INC-…"
        loading={discard.pending}
        onConfirm={(reason) => discard.run(() => discardPublicIncidentReportAction({ reportId, reason }), () => setDiscardOpen(false))}
      />
    </div>
  )
}
