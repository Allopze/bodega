"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import {
  addPpaEvidenceAction,
  authorizePpaRestartAction,
  cancelPpaAction,
  closePpaAction,
  declarePpaCorrectionAction,
  verifyPpaCorrectionAction,
} from "../actions"

type WorkflowStatus =
  | "detenido"
  | "en_correccion"
  | "pendiente_verificacion"
  | "autorizado"
  | "rechazado"
  | "cancelado"
  | "cerrado"
  | "aprobado_auto"

interface Props {
  ppaId: string
  ppaVersion: number
  status: WorkflowStatus
  verified: boolean
  capa: {
    id: string
    version: number
    status: string
    evidenceCount: number
  } | null
  canCorrect: boolean
  canVerify: boolean
  canAuthorize: boolean
  canCancel: boolean
  canClose: boolean
}

function useWorkflowMutation() {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
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
  return { pending, run }
}

export function PpaWorkflowPanel({
  ppaId,
  ppaVersion,
  status,
  verified,
  capa,
  canCorrect,
  canVerify,
  canAuthorize,
  canCancel,
  canClose,
}: Props) {
  const { pending, run } = useWorkflowMutation()
  const [evidenceKind, setEvidenceKind] = React.useState<"document" | "photo" | "url">("photo")
  const [evidenceReference, setEvidenceReference] = React.useState("")
  const [evidenceDescription, setEvidenceDescription] = React.useState("")
  const [verificationComment, setVerificationComment] = React.useState("")
  const [effectivenessAssessment, setEffectivenessAssessment] = React.useState("")
  const [restartComment, setRestartComment] = React.useState("")
  const [closeComment, setCloseComment] = React.useState("")
  const [cancelReason, setCancelReason] = React.useState("")

  const isTerminal = status === "cancelado" || status === "cerrado" || status === "aprobado_auto"
  const canAddEvidence = canCorrect && capa && !["verified", "closed", "cancelled"].includes(capa.status)
  const hasStateAction =
    (status === "en_correccion" && canCorrect && capa) ||
    (status === "pendiente_verificacion" && !verified && canVerify && capa) ||
    (status === "pendiente_verificacion" && verified && canAuthorize) ||
    (status === "autorizado" && canClose)

  if (!canAddEvidence && !hasStateAction && (!canCancel || isTerminal)) return null

  function addEvidence() {
    if (!capa || evidenceReference.trim().length < 3) {
      toast.error("Indica una referencia verificable para la evidencia.")
      return
    }
    run(() => addPpaEvidenceAction({
      ppaId,
      actionId: capa.id,
      expectedCapaVersion: capa.version,
      kind: evidenceKind,
      reference: evidenceReference,
      description: evidenceDescription || undefined,
    }))
  }

  function declareImplemented() {
    if (!capa) return
    run(() => declarePpaCorrectionAction({
      ppaId,
      expectedPpaVersion: ppaVersion,
      expectedCapaVersion: capa.version,
    }))
  }

  function verify(accepted: boolean) {
    if (!capa || verificationComment.trim().length < 5) {
      toast.error("Documenta la verificación con al menos 5 caracteres.")
      return
    }
    if (accepted && effectivenessAssessment.trim().length < 5) {
      toast.error("Documenta cómo se comprobó la eficacia del control.")
      return
    }
    run(() => verifyPpaCorrectionAction({
      ppaId,
      expectedPpaVersion: ppaVersion,
      expectedCapaVersion: capa.version,
      accepted,
      comment: verificationComment,
      effectivenessStatus: accepted ? "effective" : undefined,
      effectivenessAssessment: accepted ? effectivenessAssessment : undefined,
    }))
  }

  function authorizeRestart() {
    run(() => authorizePpaRestartAction({
      ppaId,
      expectedPpaVersion: ppaVersion,
      comment: restartComment || undefined,
    }))
  }

  function closeCase() {
    if (closeComment.trim().length < 5) {
      toast.error("Registra una observación de cierre de al menos 5 caracteres.")
      return
    }
    run(() => closePpaAction({ ppaId, expectedPpaVersion: ppaVersion, comment: closeComment }))
  }

  function cancelCase() {
    if (cancelReason.trim().length < 5) {
      toast.error("La cancelación requiere un motivo de al menos 5 caracteres.")
      return
    }
    run(() => cancelPpaAction({
      ppaId,
      expectedPpaVersion: ppaVersion,
      expectedCapaVersion: capa?.version,
      reason: cancelReason,
    }))
  }

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <h2 className="text-sm font-semibold">Siguiente control</h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        El reinicio requiere evidencia, verificación independiente y autorización expresa.
      </p>

      {canAddEvidence && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
          <p className="text-sm font-medium">Evidencia de implementación</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[150px_1fr]">
            <Field label="Tipo" htmlFor="ppa-evidence-kind">
              <Select value={evidenceKind} onValueChange={(value) => setEvidenceKind(value as typeof evidenceKind)}>
                <SelectTrigger id="ppa-evidence-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="photo">Fotografía</SelectItem>
                  <SelectItem value="document">Documento</SelectItem>
                  <SelectItem value="url">Enlace verificable</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Referencia" htmlFor="ppa-evidence-reference" helper="URL, folio o ubicación controlada del archivo.">
              <Input
                id="ppa-evidence-reference"
                value={evidenceReference}
                onChange={(event) => setEvidenceReference(event.target.value)}
                placeholder="Ej.: https://… o FOT-2026-0042"
                maxLength={4000}
              />
            </Field>
          </div>
          <Field label="Descripción (opcional)" htmlFor="ppa-evidence-description">
            <Textarea
              id="ppa-evidence-description"
              rows={2}
              value={evidenceDescription}
              onChange={(event) => setEvidenceDescription(event.target.value)}
              maxLength={1000}
            />
          </Field>
          <Button variant="secondary" size="sm" onClick={addEvidence} loading={pending}>
            Vincular evidencia
          </Button>
        </div>
      )}

      {status === "en_correccion" && canCorrect && capa && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <p className="text-sm">
            Evidencias verificables: <strong>{capa.evidenceCount}</strong>
          </p>
          <Button
            className="mt-3 w-full"
            onClick={declareImplemented}
            loading={pending}
            disabled={capa.evidenceCount === 0}
          >
            Declarar controles implementados
          </Button>
          {capa.evidenceCount === 0 && (
            <p className="mt-2 text-xs text-[var(--color-warning)]">Adjunta al menos una evidencia documental, fotográfica o URL.</p>
          )}
        </div>
      )}

      {status === "pendiente_verificacion" && !verified && canVerify && capa && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
          <Field label="Resultado de la inspección" htmlFor="ppa-verification-comment">
            <Textarea
              id="ppa-verification-comment"
              rows={3}
              value={verificationComment}
              onChange={(event) => setVerificationComment(event.target.value)}
              maxLength={2000}
            />
          </Field>
          <Field label="Comprobación de eficacia" htmlFor="ppa-effectiveness">
            <Textarea
              id="ppa-effectiveness"
              rows={3}
              value={effectivenessAssessment}
              onChange={(event) => setEffectivenessAssessment(event.target.value)}
              maxLength={3000}
            />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => verify(false)} loading={pending}>Devolver a corrección</Button>
            <Button onClick={() => verify(true)} loading={pending}>Verificar controles</Button>
          </div>
        </div>
      )}

      {status === "pendiente_verificacion" && verified && canAuthorize && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
          <Field label="Observación de autorización (opcional)" htmlFor="ppa-restart-comment">
            <Textarea
              id="ppa-restart-comment"
              rows={2}
              value={restartComment}
              onChange={(event) => setRestartComment(event.target.value)}
              maxLength={1000}
            />
          </Field>
          <Button className="w-full" onClick={authorizeRestart} loading={pending}>
            Autorizar reinicio de la tarea
          </Button>
        </div>
      )}

      {status === "autorizado" && canClose && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
          <Field label="Observación de cierre" htmlFor="ppa-close-comment">
            <Textarea
              id="ppa-close-comment"
              rows={2}
              value={closeComment}
              onChange={(event) => setCloseComment(event.target.value)}
              maxLength={2000}
            />
          </Field>
          <Button variant="secondary" className="w-full" onClick={closeCase} loading={pending}>
            Cerrar administrativamente
          </Button>
        </div>
      )}

      {canCancel && !isTerminal && (
        <details className="mt-4 border-t border-[var(--color-border)] pt-4">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-danger)]">Cancelar esta tarea</summary>
          <div className="mt-3 space-y-3">
            <Field label="Motivo obligatorio" htmlFor="ppa-cancel-reason">
              <Textarea
                id="ppa-cancel-reason"
                rows={2}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                maxLength={2000}
              />
            </Field>
            <Button variant="destructive" size="sm" onClick={cancelCase} loading={pending}>Confirmar cancelación</Button>
          </div>
        </details>
      )}
    </section>
  )
}
