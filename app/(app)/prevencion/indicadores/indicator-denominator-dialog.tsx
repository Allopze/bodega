"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import {
  approveSafetyIndicatorDenominatorAction,
  saveSafetyIndicatorDenominatorAction,
} from "./actions"

interface DenominatorRow {
  id: string
  workerCount: number
  workedHours: number
  sourceType: string
  sourceReference: string
  evidenceReference: string | null
  evidenceChecksumSha256: string | null
  status: string
  reconciliationStatus: string
  reconciliationNotes: string | null
  version: number
  createdByUserId: string
  updatedByUserId: string
}

interface Props {
  worksiteId: string
  year: number
  month: number
  denominator: DenominatorRow | null
  canManage: boolean
  canApprove: boolean
  currentUserId: string
}

export function IndicatorDenominatorDialog({ worksiteId, year, month, denominator, canManage, canApprove, currentUserId }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [sourceType, setSourceType] = useState(denominator?.sourceType ?? "rrhh")
  const [reconciliationStatus, setReconciliationStatus] = useState(denominator?.reconciliationStatus ?? "pending")
  const [decisionReason, setDecisionReason] = useState("")
  const preparedByCurrentUser = denominator?.createdByUserId === currentUserId || denominator?.updatedByUserId === currentUserId

  function save(formData: FormData) {
    startTransition(async () => {
      const result = await saveSafetyIndicatorDenominatorAction({
        worksiteId,
        year,
        month,
        workerCount: Number(formData.get("workerCount") ?? 0),
        workedHours: Number(formData.get("workedHours") ?? 0),
        sourceType,
        sourceReference: formData.get("sourceReference"),
        evidenceReference: formData.get("evidenceReference"),
        evidenceChecksumSha256: formData.get("evidenceChecksumSha256") || null,
        reconciliationStatus,
        reconciliationNotes: formData.get("reconciliationNotes") || null,
        submitForReview: formData.get("submitForReview") === "on",
        expectedVersion: denominator?.version ?? null,
        correctionReason: formData.get("correctionReason") || null,
      })
      if (result.ok) {
        toast.success("Denominador guardado")
        setOpen(false)
      } else toast.error(result.message ?? "No se pudo guardar el denominador")
    })
  }

  function decide(decision: "approved" | "rejected") {
    if (!denominator) return
    startTransition(async () => {
      const result = await approveSafetyIndicatorDenominatorAction({
        denominatorId: denominator.id,
        expectedVersion: denominator.version,
        decision,
        reason: decisionReason,
      })
      if (result.ok) {
        toast.success(decision === "approved" ? "Denominador aprobado" : "Denominador rechazado")
        setOpen(false)
      } else toast.error(result.message ?? "No se pudo registrar la decisión")
    })
  }

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {denominator ? (denominator.status === "pending_review" ? "Revisar" : "Gestionar") : "Registrar"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Denominador · {String(month).padStart(2, "0")}/{year}</DialogTitle>
            <DialogDescription>Dotación y horas requieren fuente, evidencia, conciliación y aprobación segregada antes del cierre.</DialogDescription>
          </DialogHeader>

          {canManage && denominator?.status !== "pending_review" && (
            <form action={save} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor={`workers-${month}`}>Dotación del mes</Label><Input id={`workers-${month}`} name="workerCount" type="number" min={0} required defaultValue={denominator?.workerCount ?? 0} /></div>
              <div className="space-y-2"><Label htmlFor={`hours-${month}`}>Horas trabajadas</Label><Input id={`hours-${month}`} name="workedHours" type="number" min={0} step="0.01" required defaultValue={denominator?.workedHours ?? 0} /></div>
              <div className="space-y-2"><Label>Procedencia</Label><Select value={sourceType} onValueChange={setSourceType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rrhh">RR.HH.</SelectItem><SelectItem value="xlsx_import">Importación XLSX</SelectItem><SelectItem value="manual">Carga manual controlada</SelectItem><SelectItem value="other_system">Otro sistema</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor={`source-${month}`}>Referencia de fuente</Label><Input id={`source-${month}`} name="sourceReference" required minLength={3} defaultValue={denominator?.sourceReference ?? ""} placeholder="Nómina RR.HH. julio 2026" /></div>
              <div className="space-y-2 md:col-span-2"><Label htmlFor={`evidence-${month}`}>Evidencia</Label><Input id={`evidence-${month}`} name="evidenceReference" required minLength={3} defaultValue={denominator?.evidenceReference ?? ""} placeholder="Documento, folio o ruta controlada" /></div>
              <div className="space-y-2 md:col-span-2"><Label htmlFor={`checksum-${month}`}>SHA-256 de evidencia (opcional)</Label><Input id={`checksum-${month}`} name="evidenceChecksumSha256" pattern="[a-f0-9]{64}" defaultValue={denominator?.evidenceChecksumSha256 ?? ""} /></div>
              <div className="space-y-2"><Label>Conciliación</Label><Select value={reconciliationStatus} onValueChange={setReconciliationStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendiente</SelectItem><SelectItem value="matched">Cuadra con la fuente</SelectItem><SelectItem value="difference">Con diferencia explicada</SelectItem><SelectItem value="exception">Excepción aceptada</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor={`notes-${month}`}>Notas</Label><Textarea id={`notes-${month}`} name="reconciliationNotes" defaultValue={denominator?.reconciliationNotes ?? ""} rows={2} /></div>
              {denominator?.status === "approved" && <div className="space-y-2 md:col-span-2"><Label htmlFor={`correction-${month}`}>Motivo de corrección del aprobado</Label><Textarea id={`correction-${month}`} name="correctionReason" required minLength={10} rows={2} /></div>}
              <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="submitForReview" /> Enviar a revisión al guardar</label>
              <DialogFooter className="md:col-span-2"><Button type="submit" disabled={pending}>Guardar denominador</Button></DialogFooter>
            </form>
          )}

          {denominator?.status === "pending_review" && (
            <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-4">
              <dl className="grid gap-2 text-sm md:grid-cols-2"><div><dt className="text-[var(--color-text-subtle)]">Dotación</dt><dd>{denominator.workerCount}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Horas</dt><dd>{denominator.workedHours}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Fuente</dt><dd>{denominator.sourceReference}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Evidencia</dt><dd>{denominator.evidenceReference}</dd></div></dl>
              {canApprove && !preparedByCurrentUser ? <><div className="space-y-2"><Label htmlFor={`decision-${month}`}>Fundamento de decisión</Label><Textarea id={`decision-${month}`} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} minLength={10} rows={3} /></div><DialogFooter><Button type="button" variant="destructive" disabled={pending || decisionReason.trim().length < 10} onClick={() => decide("rejected")}>Rechazar</Button><Button type="button" disabled={pending || decisionReason.trim().length < 10} onClick={() => decide("approved")}>Aprobar</Button></DialogFooter></> : <p className="text-sm text-[var(--color-warning-ink)]">La aprobación requiere otro usuario con permiso de cierre.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
