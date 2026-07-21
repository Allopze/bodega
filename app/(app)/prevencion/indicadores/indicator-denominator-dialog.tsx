"use client"

import { useRef, useState, useTransition } from "react"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
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

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export interface DenominatorRow {
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

/** Etiqueta del botón que abre el modal, según si ya existe registro y su estado. */
export function denominatorDialogLabel(denominator: DenominatorRow | null) {
  if (!denominator) return "Registrar"
  return denominator.status === "pending_review" ? "Revisar" : "Gestionar"
}

interface Props {
  worksiteId: string
  year: number
  month: number
  denominator: DenominatorRow | null
  canManage: boolean
  canApprove: boolean
  currentUserId: string
  onClose: () => void
  /** Cargar otro mes sin cerrar el modal; si hay cambios sin guardar, pide confirmación. */
  onNavigate?: (month: number) => void
}

export function IndicatorDenominatorDialog({ worksiteId, year, month, denominator, canManage, canApprove, currentUserId, onClose, onNavigate }: Props) {
  const [pending, startTransition] = useTransition()
  const [sourceType, setSourceType] = useState(denominator?.sourceType ?? "rrhh")
  const [reconciliationStatus, setReconciliationStatus] = useState(denominator?.reconciliationStatus ?? "pending")
  const [decisionReason, setDecisionReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pendingNavMonth, setPendingNavMonth] = useState<number | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const preparedByCurrentUser = denominator?.createdByUserId === currentUserId || denominator?.updatedByUserId === currentUserId

  function submitDenominator(formData: FormData, after: () => void) {
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
        setDirty(false)
        after()
      } else toast.error(result.message ?? "No se pudo guardar el denominador")
    })
  }

  function save(formData: FormData) {
    submitDenominator(formData, onClose)
  }

  function saveAndAdvance() {
    if (!formRef.current || pendingNavMonth === null) return
    const target = pendingNavMonth
    submitDenominator(new FormData(formRef.current), () => {
      setPendingNavMonth(null)
      onNavigate?.(target)
    })
  }

  function requestNavigate(target: number) {
    if (dirty) setPendingNavMonth(target)
    else onNavigate?.(target)
  }

  function discardAndNavigate() {
    if (pendingNavMonth === null) return
    setDirty(false)
    const target = pendingNavMonth
    setPendingNavMonth(null)
    onNavigate?.(target)
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
        onClose()
      } else toast.error(result.message ?? "No se pudo registrar la decisión")
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Denominador · {MONTHS[month - 1]} {year}</DialogTitle>
            {onNavigate && (
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={pending || month <= 1} onClick={() => requestNavigate(month - 1)} aria-label="Mes anterior">
                  <CaretLeft size={16} />
                </Button>
                <span className="font-mono text-xs text-[var(--color-text-subtle)]">{month}/12</span>
                <Button type="button" variant="ghost" size="sm" disabled={pending || month >= 12} onClick={() => requestNavigate(month + 1)} aria-label="Mes siguiente">
                  <CaretRight size={16} />
                </Button>
              </div>
            )}
          </div>
          <DialogDescription>Dotación y horas requieren fuente, evidencia, conciliación y aprobación segregada antes del cierre.</DialogDescription>
          <span className="sr-only" role="status" aria-live="polite">Mostrando datos de {MONTHS[month - 1]} de {year}</span>
        </DialogHeader>

        {pendingNavMonth !== null && (
          <div role="alertdialog" aria-label="Cambios sin guardar" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm">
            <p>Hay cambios sin guardar. ¿Qué deseas hacer antes de ir a {MONTHS[pendingNavMonth - 1]}?</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setPendingNavMonth(null)}>Seguir editando</Button>
              <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={discardAndNavigate}>Descartar</Button>
              <Button type="button" size="sm" disabled={pending} onClick={saveAndAdvance}>Guardar y continuar</Button>
            </div>
          </div>
        )}

        {canManage && denominator?.status !== "pending_review" && (
          <form ref={formRef} action={save} onChange={() => setDirty(true)} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor={`workers-${month}`}>Dotación del mes</Label><Input id={`workers-${month}`} name="workerCount" type="number" min={0} required defaultValue={denominator?.workerCount ?? 0} /></div>
            <div className="space-y-2"><Label htmlFor={`hours-${month}`}>Horas trabajadas</Label><Input id={`hours-${month}`} name="workedHours" type="number" min={0} step="0.01" required defaultValue={denominator?.workedHours ?? 0} /></div>
            <div className="space-y-2"><Label>Procedencia</Label><Select value={sourceType} onValueChange={(value) => { setSourceType(value); setDirty(true) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rrhh">RR.HH.</SelectItem><SelectItem value="xlsx_import">Importación XLSX</SelectItem><SelectItem value="manual">Carga manual controlada</SelectItem><SelectItem value="other_system">Otro sistema</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor={`source-${month}`}>Referencia de fuente</Label><Input id={`source-${month}`} name="sourceReference" required minLength={3} defaultValue={denominator?.sourceReference ?? ""} placeholder="Nómina RR.HH. julio 2026" /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor={`evidence-${month}`}>Evidencia</Label><Input id={`evidence-${month}`} name="evidenceReference" required minLength={3} defaultValue={denominator?.evidenceReference ?? ""} placeholder="Documento, folio o ruta controlada" /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor={`checksum-${month}`}>SHA-256 de evidencia (opcional)</Label><Input id={`checksum-${month}`} name="evidenceChecksumSha256" pattern="[a-f0-9]{64}" defaultValue={denominator?.evidenceChecksumSha256 ?? ""} /></div>
            <div className="space-y-2"><Label>Conciliación</Label><Select value={reconciliationStatus} onValueChange={(value) => { setReconciliationStatus(value); setDirty(true) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendiente</SelectItem><SelectItem value="matched">Cuadra con la fuente</SelectItem><SelectItem value="difference">Con diferencia explicada</SelectItem><SelectItem value="exception">Excepción aceptada</SelectItem></SelectContent></Select></div>
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
  )
}
