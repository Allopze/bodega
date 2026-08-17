"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import type { CapaStatus } from "@/lib/services/prevention-capa"
import {
  addCapaEvidenceAction,
  addCapaFollowupAction,
  reconcileCapaActionAction,
  transitionCapaActionAction,
  updateCapaActionAction,
} from "../actions"

interface Props {
  action: {
    id: string
    version: number
    status: CapaStatus
    priority: string
    targetDate: string
    responsibleUserId: string | null
    reconciliationStatus: string
    sourceType: string
    sourceId: string
  }
  users: { id: string; name: string }[]
  permissions: {
    manage: boolean
    complete: boolean
    verify: boolean
    close: boolean
    reconcile: boolean
    overrideSegregation: boolean
  }
}

export function CapaControls({ action, users, permissions }: Props) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [evidenceKind, setEvidenceKind] = React.useState<"document" | "photo" | "url">("photo")
  const [evidenceReference, setEvidenceReference] = React.useState("")
  const [evidenceDescription, setEvidenceDescription] = React.useState("")
  const [followupNote, setFollowupNote] = React.useState("")
  const [progress, setProgress] = React.useState("")
  const [transitionReason, setTransitionReason] = React.useState("")
  const [effectivenessAssessment, setEffectivenessAssessment] = React.useState("")
  const [segregationReason, setSegregationReason] = React.useState("")
  const [responsibleUserId, setResponsibleUserId] = React.useState(action.responsibleUserId ?? "unassigned")
  const [targetDate, setTargetDate] = React.useState(action.targetDate)
  const [priority, setPriority] = React.useState(action.priority)
  const [reconciliationStatus, setReconciliationStatus] = React.useState(action.reconciliationStatus)
  const [reconciliationReason, setReconciliationReason] = React.useState("")

  function run(operation: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await operation()
      if (result.ok) {
        toast.success(result.message ?? "Cambio registrado")
        router.refresh()
      } else {
        toast.error(result.message ?? "No se pudo registrar el cambio")
      }
    })
  }

  function transition(toStatus: CapaStatus, extra?: {
    effectivenessStatus?: "effective" | "ineffective" | "not_required"
    effectivenessAssessment?: string
    segregationExceptionReason?: string
  }) {
    run(() => transitionCapaActionAction({
      actionId: action.id,
      expectedVersion: action.version,
      toStatus,
      reason: transitionReason || undefined,
      ...extra,
    }))
  }

  function addEvidence() {
    if (evidenceReference.trim().length < 3) return toast.error("Indica una referencia verificable.")
    run(() => addCapaEvidenceAction({
      actionId: action.id,
      expectedVersion: action.version,
      kind: evidenceKind,
      reference: evidenceReference,
      description: evidenceDescription || undefined,
    }))
  }

  function addFollowup() {
    if (followupNote.trim().length < 3) return toast.error("Describe el seguimiento.")
    const parsedProgress = progress === "" ? undefined : Number(progress)
    if (parsedProgress !== undefined && (!Number.isInteger(parsedProgress) || parsedProgress < 0 || parsedProgress > 100)) {
      return toast.error("El avance debe ser un número entero entre 0 y 100.")
    }
    run(() => addCapaFollowupAction({
      actionId: action.id,
      expectedVersion: action.version,
      note: followupNote,
      progress: parsedProgress,
    }))
  }

  function verify() {
    if (transitionReason.trim().length < 5 || effectivenessAssessment.trim().length < 5) {
      return toast.error("Documenta la inspección y la evaluación de eficacia.")
    }
    run(() => transitionCapaActionAction({
      actionId: action.id,
      expectedVersion: action.version,
      toStatus: "verified",
      reason: transitionReason,
      effectivenessStatus: "effective",
      effectivenessAssessment,
      segregationExceptionReason: segregationReason || undefined,
    }))
  }

  function saveAssignment() {
    run(() => updateCapaActionAction({
      actionId: action.id,
      expectedVersion: action.version,
      responsibleUserId: responsibleUserId === "unassigned" ? null : responsibleUserId,
      priority: priority as "low" | "medium" | "high" | "critical",
      targetDate,
    }))
  }

  function reconcile() {
    if (reconciliationReason.trim().length < 5) return toast.error("Documenta la decisión de conciliación.")
    run(() => reconcileCapaActionAction({
      actionId: action.id,
      expectedVersion: action.version,
      responsibleUserId: responsibleUserId === "unassigned" ? null : responsibleUserId,
      status: reconciliationStatus as "reconciled" | "needs_assignment" | "needs_evidence" | "needs_review",
      reason: reconciliationReason,
    }))
  }

  const terminal = action.status === "closed" || action.status === "cancelled"
  // El avance de una acción nacida de un PPA lo conduce el PPA (declarar →
  // verificar → autorizar → cerrar). El servidor rechaza transiciones y
  // ediciones sobre este origen; ocultamos los controles para no ofrecer un
  // botón que sólo puede fallar. Evidencia, seguimiento y conciliación siguen.
  const ppaDriven = action.sourceType === "ppa"

  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <div>
        <h2 className="text-sm font-semibold">Controles CAPA</h2>
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Cada cambio vuelve a validar permiso, faena, estado y versión en el servidor.</p>
      </div>

      {ppaDriven && (
        <p className="rounded-md border border-[var(--color-border)] p-3 text-xs text-[var(--color-text-subtle)]">
          El avance y la asignación de esta acción se gestionan desde su PPA de origen:{" "}
          <Link href={`/prevencion/ppa/${action.sourceId}`} className="text-[var(--color-primary-ink)] hover:underline">
            ver el PPA
          </Link>.
        </p>
      )}

      {!terminal && !ppaDriven && (
        <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
          <Field label="Motivo / resultado de la transición" htmlFor="capa-transition-reason">
            <Textarea id="capa-transition-reason" rows={2} value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} maxLength={2000} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {permissions.complete && (action.status === "pending" || action.status === "reopened") && (
              <Button size="sm" onClick={() => transition("in_progress")} loading={pending}>Iniciar implementación</Button>
            )}
            {permissions.complete && action.status === "in_progress" && (
              <Button size="sm" onClick={() => transition("pending_verification")} loading={pending}>Enviar a verificación</Button>
            )}
            {permissions.verify && action.status === "pending_verification" && (
              <Button size="sm" variant="secondary" onClick={() => transition("reopened", { effectivenessStatus: "ineffective" })} loading={pending}>Devolver a implementación</Button>
            )}
            {permissions.close && action.status === "verified" && (
              <Button size="sm" onClick={() => transition("closed")} loading={pending}>Cerrar CAPA</Button>
            )}
            {permissions.verify && (action.status === "verified" || action.status === "closed") && (
              <Button size="sm" variant="secondary" onClick={() => transition("reopened", { effectivenessStatus: "ineffective" })} loading={pending}>Reabrir</Button>
            )}
            {permissions.manage && ["pending", "in_progress", "pending_verification", "reopened"].includes(action.status) && (
              <Button size="sm" variant="destructive" onClick={() => transition("cancelled")} loading={pending}>Cancelar CAPA</Button>
            )}
          </div>
        </div>
      )}

      {permissions.verify && !ppaDriven && action.status === "pending_verification" && (
        <details className="border-t border-[var(--color-border)] pt-3" open>
          <summary className="cursor-pointer text-sm font-medium">Evaluación de eficacia</summary>
          <div className="mt-3 space-y-3">
            <Field label="Cómo se comprobó la eficacia" htmlFor="capa-effectiveness">
              <Textarea id="capa-effectiveness" rows={3} value={effectivenessAssessment} onChange={(event) => setEffectivenessAssessment(event.target.value)} maxLength={3000} />
            </Field>
            {permissions.overrideSegregation && (action.priority === "high" || action.priority === "critical") && (
              <Field label="Excepción de segregación (sólo si corresponde)" htmlFor="capa-segregation">
                <Textarea id="capa-segregation" rows={2} value={segregationReason} onChange={(event) => setSegregationReason(event.target.value)} maxLength={2000} />
              </Field>
            )}
            <Button size="sm" onClick={verify} loading={pending}>Verificar eficacia</Button>
          </div>
        </details>
      )}

      {permissions.complete && !terminal && (
        <details className="border-t border-[var(--color-border)] pt-3">
          <summary className="cursor-pointer text-sm font-medium">Agregar evidencia</summary>
          <div className="mt-3 space-y-3">
            <Select value={evidenceKind} onValueChange={(value) => setEvidenceKind(value as typeof evidenceKind)}>
              <SelectTrigger aria-label="Tipo de evidencia"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="photo">Fotografía</SelectItem>
                <SelectItem value="document">Documento</SelectItem>
                <SelectItem value="url">URL verificable</SelectItem>
              </SelectContent>
            </Select>
            <Field label="Referencia" htmlFor="capa-evidence-reference">
              <Input id="capa-evidence-reference" value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={4000} />
            </Field>
            <Field label="Descripción (opcional)" htmlFor="capa-evidence-description">
              <Textarea id="capa-evidence-description" rows={2} value={evidenceDescription} onChange={(event) => setEvidenceDescription(event.target.value)} maxLength={1000} />
            </Field>
            <Button size="sm" variant="secondary" onClick={addEvidence} loading={pending}>Registrar evidencia</Button>
          </div>
        </details>
      )}

      {permissions.manage && !terminal && (
        <details className="border-t border-[var(--color-border)] pt-3">
          <summary className="cursor-pointer text-sm font-medium">Seguimiento</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Nota" htmlFor="capa-followup-note">
              <Textarea id="capa-followup-note" rows={2} value={followupNote} onChange={(event) => setFollowupNote(event.target.value)} maxLength={3000} />
            </Field>
            <Field label="Avance %" htmlFor="capa-progress">
              <Input id="capa-progress" inputMode="numeric" value={progress} onChange={(event) => setProgress(event.target.value)} />
            </Field>
            <Button size="sm" variant="secondary" onClick={addFollowup} loading={pending}>Registrar seguimiento</Button>
          </div>
        </details>
      )}

      {permissions.manage && !terminal && !ppaDriven && (
        <details className="border-t border-[var(--color-border)] pt-3">
          <summary className="cursor-pointer text-sm font-medium">Asignación y plazo</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Responsable" htmlFor="capa-responsible">
              <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
                <SelectTrigger id="capa-responsible"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Sin asignar</SelectItem>
                  {users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha objetivo" htmlFor="capa-target-date"><DatePicker id="capa-target-date" value={targetDate} onChange={setTargetDate} /></Field>
            <Field label="Prioridad" htmlFor="capa-priority">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="capa-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baja</SelectItem><SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button size="sm" variant="secondary" onClick={saveAssignment} loading={pending}>Guardar cambios</Button>
          </div>
        </details>
      )}

      {permissions.reconcile && (
        <details className="border-t border-[var(--color-border)] pt-3" open={action.reconciliationStatus !== "reconciled"}>
          <summary className="cursor-pointer text-sm font-medium">Conciliación histórica</summary>
          <div className="mt-3 space-y-3">
            <Select value={reconciliationStatus} onValueChange={setReconciliationStatus}>
              <SelectTrigger aria-label="Estado de conciliación"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reconciled">Conciliada</SelectItem>
                <SelectItem value="needs_assignment">Requiere asignación</SelectItem>
                <SelectItem value="needs_evidence">Requiere evidencia</SelectItem>
                <SelectItem value="needs_review">Requiere revisión</SelectItem>
              </SelectContent>
            </Select>
            <Field label="Fundamento" htmlFor="capa-reconciliation-reason">
              <Textarea id="capa-reconciliation-reason" rows={2} value={reconciliationReason} onChange={(event) => setReconciliationReason(event.target.value)} maxLength={2000} />
            </Field>
            <Button size="sm" onClick={reconcile} loading={pending}>Registrar conciliación</Button>
          </div>
        </details>
      )}
    </section>
  )
}
