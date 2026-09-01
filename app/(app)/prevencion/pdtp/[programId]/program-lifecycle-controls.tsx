"use client"

import * as React from "react"
import { Tooltip } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { ActionState } from "@/lib/validation/prevention"
import { pdtpProgramStatusLabel } from "@/lib/prevention/pdtp"
import {
  activatePdtpProgramAction,
  archivePdtpProgramAction,
  decidePdtpApprovalStepAction,
  reopenRejectedPdtpProgramAction,
  submitPdtpProgramForReviewAction,
} from "../actions"

type ProgramLifecycle = {
  id: string
  status: string
  elaboratedByName: string
  contentVersion: number
  contentDigest: string | null
  reviewStartedAt: string | null
  approvedByJdprAt: string | null
  approvedByLegalAt: string | null
  rejectionReason: string | null
}

type LifecyclePermissions = {
  canSubmitReview: boolean
  canApprove: boolean
  canSignLegal: boolean
  canActivate: boolean
  canManageLifecycle: boolean
}

type ApprovalStepProgress = {
  id: string
  code: string
  label: string
  isRequired: boolean
  canDecide: boolean
  decision: { decision: string; decidedAt: string } | null
}

// El texto viene del vocabulario compartido; aquí sólo vive el color.
const STATUS_VARIANT: Record<string, "default" | "warning" | "danger" | "success" | "outline"> = {
  draft: "default",
  in_review: "warning",
  rejected: "danger",
  active: "success",
  closed: "outline",
  archived: "outline",
}

function nextStep(program: ProgramLifecycle, pendingStep: ApprovalStepProgress | undefined, submitBlockers: string[]): string {
  if (program.status === "draft") {
    return submitBlockers.length > 0
      ? "Resuelve los puntos pendientes para poder enviar esta versión a revisión."
      : "Completa el contenido y envía una versión a revisión."
  }
  if (program.status === "rejected") return "Corrige las observaciones y reabre una nueva versión de contenido."
  if (program.status === "active") return "La versión aprobada está vigente y su contenido base permanece bloqueado."
  if (program.status === "closed") return "El expediente está cerrado y no admite nuevas ejecuciones."
  if (program.status === "archived") return "Esta versión se conserva solo como expediente histórico."
  if (pendingStep) return `Contenido congelado; falta completar: ${pendingStep.label}.`
  return "Todas las decisiones están completas; falta aceptar y activar la versión. La vigencia comenzará en ese momento."
}

export function ProgramLifecycleControls({
  program,
  permissions,
  approvalSteps,
  submitBlockers = [],
  children,
}: {
  program: ProgramLifecycle
  permissions: LifecyclePermissions
  approvalSteps?: ApprovalStepProgress[]
  /** Motivos por los que el contenido todavía no se puede enviar a revisión.
   *  El servidor los vuelve a comprobar; aquí se anticipan para que el operador
   *  no descubra el bloqueo recién al pulsar el botón. */
  submitBlockers?: string[]
  /** Sección adicional (p. ej. metadata del documento importado) que se
   *  pliega dentro de la misma tarjeta en vez de vivir en un bloque aparte. */
  children?: React.ReactNode
}) {
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const statusVariant = STATUS_VARIANT[program.status] ?? "outline"
  const steps: ApprovalStepProgress[] = approvalSteps ?? [
    {
      id: `${program.id}-approval-jdpr`, code: "jdpr", label: "Revisión JDPR", isRequired: true,
      canDecide: permissions.canApprove,
      decision: program.approvedByJdprAt ? { decision: "approved", decidedAt: program.approvedByJdprAt } : null,
    },
    {
      id: `${program.id}-approval-legal`, code: "legal", label: "Decisión Legal", isRequired: true,
      canDecide: permissions.canSignLegal,
      decision: program.approvedByLegalAt ? { decision: "approved", decidedAt: program.approvedByLegalAt } : null,
    },
  ]
  const pendingStep = steps.find((step) => step.isRequired && step.decision?.decision !== "approved")

  function run(action: () => Promise<ActionState>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) setError(result.message ?? "No se pudo completar la acción.")
    })
  }

  const canDecideCurrentStep = program.status === "in_review" && !!pendingStep?.canDecide
  const canArchive = ["in_review", "rejected", "closed"].includes(program.status) && permissions.canManageLifecycle

  return (
    <section aria-labelledby="program-lifecycle-title" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="program-lifecycle-title" className="text-sm font-semibold text-[var(--color-text)]">Estado del programa</h2>
            <Badge variant={statusVariant} dot>{pdtpProgramStatusLabel(program.status)}</Badge>
            <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">contenido v{program.contentVersion}</span>
            {program.contentDigest && (
              <code title={program.contentDigest} className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                SHA-256 {program.contentDigest.slice(0, 12)}
              </code>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{nextStep(program, pendingStep, submitBlockers)}</p>
          {program.status === "draft" && submitBlockers.length > 0 && (
            <div className="mt-2 max-w-3xl rounded-md border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
              <p className="font-semibold">Pendiente antes de enviar a revisión:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {submitBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </div>
          )}
          {program.status === "rejected" && program.rejectionReason && (
            <p className="mt-2 max-w-3xl rounded-md border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger-ink)]">
              <span className="font-semibold">Observación:</span> {program.rejectionReason}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {program.status === "draft" && permissions.canSubmitReview && (
            <ConfirmAction
              title="Enviar esta versión a revisión"
              description="Se calculará una huella del programa y el contenido quedará bloqueado hasta que sea rechazado y reabierto como una nueva versión."
              confirmLabel="Enviar a revisión"
              pending={pending}
              disabled={submitBlockers.length > 0}
              disabledReason="Resuelve primero los puntos pendientes listados arriba."
              onConfirm={() => run(() => submitPdtpProgramForReviewAction(program.id))}
            />
          )}
          {canDecideCurrentStep && pendingStep && (
            <Button size="sm" loading={pending} onClick={() => run(() => decidePdtpApprovalStepAction({
              programId: program.id,
              stepId: pendingStep.id,
              decision: "approved",
            }))}>
              Aprobar: {pendingStep.label}
            </Button>
          )}
          {program.status === "in_review" && !pendingStep && permissions.canActivate && (
            <Button size="sm" loading={pending} onClick={() => run(() => activatePdtpProgramAction(program.id))}>
              Aceptar y activar versión
            </Button>
          )}
          {canDecideCurrentStep && pendingStep && (
            <ReasonAction
              title="Rechazar esta versión"
              description="La observación quedará en la bitácora. Para corregir el contenido habrá que reabrir una nueva versión."
              confirmLabel="Rechazar versión"
              destructive
              pending={pending}
              onConfirm={(reason) => run(() => decidePdtpApprovalStepAction({
                programId: program.id,
                stepId: pendingStep.id,
                decision: "rejected",
                reason,
              }))}
            />
          )}
          {program.status === "rejected" && permissions.canManageLifecycle && (
            <ReasonAction
              title="Reabrir como nueva versión"
              description="Se invalidarán las decisiones anteriores, aumentará la versión de contenido y el programa volverá a ser editable."
              confirmLabel="Reabrir versión"
              pending={pending}
              onConfirm={(reason) => run(() => reopenRejectedPdtpProgramAction(program.id, reason))}
            />
          )}
          {canArchive && (
            <ReasonAction
              title="Archivar esta versión"
              description="El contenido y su historial se conservarán, pero la versión dejará de participar del flujo operativo."
              confirmLabel="Archivar versión"
              variant="secondary"
              pending={pending}
              onConfirm={(reason) => run(() => archivePdtpProgramAction(program.id, reason))}
            />
          )}
        </div>
      </div>

      <div className="grid gap-px border-t border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-4">
        <LifecycleStep label="Elaboración" value={program.elaboratedByName} done />
        <LifecycleStep label="Versión congelada" value={program.reviewStartedAt ? "Registrada" : "Pendiente"} done={!!program.reviewStartedAt} />
        {steps.map((step) => (
          <LifecycleStep
            key={step.id}
            label={step.label}
            value={step.decision?.decision === "approved" ? "Aprobada" : step.isRequired ? "Pendiente" : "Opcional · pendiente"}
            done={step.decision?.decision === "approved"}
          />
        ))}
      </div>

      {error && <p role="alert" className="border-t border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-4 py-2 text-sm text-[var(--color-danger-ink)]">{error}</p>}

      {children}
    </section>
  )
}

/**
 * Glosario de abreviaturas de rol/paso comunes en SG-SST. Es texto
 * explicativo para tooltips, no una regla de negocio: cualquier plantilla
 * puede nombrar sus pasos de aprobación como quiera, esto solo expande las
 * siglas conocidas cuando aparecen literalmente en la etiqueta.
 */
const ROLE_ABBREVIATION_GLOSSARY: Record<string, string> = {
  JDPR: "Jefatura de Prevención de Riesgos",
  PRF: "Prevencionista de Riesgos en Faena",
  CPHS: "Comité Paritario de Higiene y Seguridad",
  RRHH: "Recursos Humanos",
}

function expandRoleAbbreviations(label: string): string | undefined {
  const found = Object.keys(ROLE_ABBREVIATION_GLOSSARY).filter((abbr) => new RegExp(`\\b${abbr}\\b`).test(label))
  if (found.length === 0) return undefined
  return found.map((abbr) => `${abbr}: ${ROLE_ABBREVIATION_GLOSSARY[abbr]}`).join(" · ")
}

function LifecycleStep({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-2.5">
      {/* La sigla expandida ("PDTP" → su nombre completo) vivía sólo en el
          `title`: MICRO-001 pedía expandir siglas, y hacerlo por hover deja
          fuera al teclado y al teléfono. `Tooltip` responde a foco; `tabIndex`
          hace alcanzable un rótulo que si no, no lo sería. */}
      <Tooltip content={expandRoleAbbreviations(label)} side="top">
        <p tabIndex={0} className="w-fit rounded-(--radius-sm) text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">{label}</p>
      </Tooltip>
      <p className={done ? "mt-0.5 text-xs font-medium text-[var(--color-success-ink)]" : "mt-0.5 text-xs text-[var(--color-text-muted)]"}>{value}</p>
    </div>
  )
}

function ConfirmAction({
  title,
  description,
  confirmLabel,
  pending,
  disabled = false,
  disabledReason,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  disabled?: boolean
  disabledReason?: string
  onConfirm: () => void
}) {
  if (disabled) {
    // Un botón deshabilitado sin explicación es un callejón sin salida; el
    // motivo viaja por `title` y por el texto accesible del propio bloque.
    return <Button size="sm" disabled title={disabledReason}>{confirmLabel}</Button>
  }
  return (
    <Dialog>
      <DialogTrigger asChild><Button size="sm">{confirmLabel}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancelar</Button></DialogClose>
          <Button type="button" loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReasonAction({
  title,
  description,
  confirmLabel,
  pending,
  destructive = false,
  variant = "secondary",
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  destructive?: boolean
  variant?: "secondary" | "ghost"
  onConfirm: (reason: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const valid = reason.trim().length >= 10

  function confirm() {
    if (!valid) return
    onConfirm(reason.trim())
    setOpen(false)
    setReason("")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant={destructive ? "destructive" : variant}>{confirmLabel}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor={`reason-${confirmLabel}`}>
          Motivo
        </label>
        <Textarea
          id={`reason-${confirmLabel}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          minLength={10}
          maxLength={3000}
          placeholder="Describe la razón y el criterio utilizado…"
          className="mt-1"
        />
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Mínimo 10 caracteres. Quedará registrado en la bitácora.</p>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancelar</Button></DialogClose>
          <Button type="button" variant={destructive ? "destructive" : "primary"} disabled={!valid} loading={pending} onClick={confirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
