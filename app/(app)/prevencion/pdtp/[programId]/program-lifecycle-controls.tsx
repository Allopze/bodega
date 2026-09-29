"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Tooltip } from "@/components/ui/tooltip"
import { MetaBadge } from "@/components/states/state-badge"
import { Callout } from "@/components/ui/callout"
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
import { useOperation } from "@/lib/hooks/use-operation"
import { pdtpProgramStatusLabel, pdtpProgramStatusVariant } from "@/lib/prevention/pdtp"
import {
  activatePdtpProgramAction,
  archivePdtpProgramAction,
  closePdtpProgramYearAction,
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
  /** PREV-C03.6: año del programa y cierre formal del año (todas sus versiones). */
  year?: number
  yearClosedAt?: string | null
}

/** Lo que el servidor calculó sobre el cierre anual (`getPdtpYearCloseReadiness`).
 *  Sólo se entrega cuando el año del programa ya terminó y la versión está activa. */
type YearCloseState = {
  year: number
  canClose: boolean
  blockers: string[]
  /** Faenas dadas de baja que todavía deben meses: se enlazan a su vista para
   * cerrarlos, porque no aparecen entre las faenas operativas. */
  deactivatedWorksites?: Array<{ name: string; href: string }>
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

function nextStep(program: ProgramLifecycle, pendingStep: ApprovalStepProgress | undefined, submitBlockers: string[]): string {
  if (program.status === "draft") {
    return submitBlockers.length > 0
      ? "Resuelve los puntos pendientes para poder enviar esta versión a revisión."
      : "Completa el contenido y envía una versión a revisión."
  }
  if (program.status === "rejected") return "Corrige las observaciones y reabre una nueva versión de contenido."
  if (program.status === "active") return "La versión aprobada está vigente y su contenido base permanece bloqueado."
  if (program.status === "closed" && program.yearClosedAt) {
    return `El año${program.year ? ` ${program.year}` : ""} está cerrado formalmente: no admite hechos nuevos ni tardíos.`
  }
  if (program.status === "closed") return "Reemplazada por una versión posterior: conserva la evidencia de su período y no admite nuevas ejecuciones."
  if (program.status === "archived") return "Esta versión se conserva solo como expediente histórico."
  if (pendingStep) return `Contenido congelado; falta completar: ${pendingStep.label}.`
  return "Todas las decisiones están completas; falta aceptar y activar la versión. La vigencia comenzará en ese momento."
}

export function ProgramLifecycleControls({
  program,
  permissions,
  approvalSteps,
  submitBlockers = [],
  submitWarnings = [],
  yearClose,
  children,
}: {
  program: ProgramLifecycle
  permissions: LifecyclePermissions
  approvalSteps?: ApprovalStepProgress[]
  /** PREV-C03.6: estado del cierre anual, si el año del programa ya terminó. */
  yearClose?: YearCloseState | null
  /** Motivos por los que el contenido todavía no se puede enviar a revisión.
   *  El servidor los vuelve a comprobar; aquí se anticipan para que el operador
   *  no descubra el bloqueo recién al pulsar el botón. */
  submitBlockers?: string[]
  /** M-14: avisos que no bloquean el envío (p. ej. actividades periódicas sin planificar). */
  submitWarnings?: string[]
  /** Sección adicional (p. ej. metadata del documento importado) que se
   *  pliega dentro de la misma tarjeta en vez de vivir en un bloque aparte. */
  children?: React.ReactNode
}) {
  const router = useRouter()
  const { pending, run } = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const statusVariant = pdtpProgramStatusVariant(program.status)
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

  const canDecideCurrentStep = program.status === "in_review" && !!pendingStep?.canDecide
  // Un año cerrado formalmente es evidencia: no se archiva (el servidor también lo impide).
  const canArchive = ["in_review", "rejected", "closed"].includes(program.status) && permissions.canManageLifecycle && !program.yearClosedAt
  const showYearClose = program.status === "active" && !!yearClose && permissions.canManageLifecycle

  return (
    <section aria-labelledby="program-lifecycle-title" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="program-lifecycle-title" className="text-sm font-semibold text-[var(--color-text)]">Estado del programa</h2>
            <MetaBadge meta={{ label: pdtpProgramStatusLabel(program.status), variant: statusVariant }} dot />
            <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">contenido v{program.contentVersion}</span>
            {program.contentDigest && (
              <code title={program.contentDigest} className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                SHA-256 {program.contentDigest.slice(0, 12)}
              </code>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{nextStep(program, pendingStep, submitBlockers)}</p>
          {program.status === "draft" && submitBlockers.length > 0 && (
            <Callout tone="warning" className="mt-2 max-w-3xl" title="Pendiente antes de enviar a revisión:">
              <ul className="list-disc space-y-0.5 pl-5">
                {submitBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </Callout>
          )}
          {program.status === "draft" && submitWarnings.length > 0 && (
            <Callout tone="info" className="mt-2 max-w-3xl" title="Revisa antes de enviar a revisión:">
              <ul className="list-disc space-y-0.5 pl-5">
                {submitWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </Callout>
          )}
          {showYearClose && yearClose && !yearClose.canClose && yearClose.blockers.length > 0 && (
            <Callout tone="warning" className="mt-2 max-w-3xl" title={`Pendiente antes de cerrar el año ${yearClose.year}:`}>
              <ul className="list-disc space-y-0.5 pl-5">
                {yearClose.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
              {(yearClose.deactivatedWorksites?.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {yearClose.deactivatedWorksites!.map((worksite) => (
                    <li key={worksite.href}>
                      <Link href={worksite.href} className="font-medium underline">
                        Cerrar los meses de {worksite.name} (dada de baja)
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Callout>
          )}
          {program.status === "rejected" && program.rejectionReason && (
            <Callout tone="danger" className="mt-2 max-w-3xl">
              <span className="font-semibold">Observación:</span> {program.rejectionReason}
            </Callout>
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
          {showYearClose && yearClose && (
            <ReasonAction
              title={`Cerrar el año ${yearClose.year}`}
              description={`Todas las versiones de ${yearClose.year} quedarán cerradas. Los hechos que lleguen después para ese año se rechazarán y quedarán visibles en el libro de cumplimiento, sus meses ya no se podrán reabrir y el año no se podrá archivar. No hay forma de deshacerlo desde la plataforma.`}
              confirmLabel={`Cerrar el año ${yearClose.year}`}
              destructive
              disabled={!yearClose.canClose}
              disabledReason="Resuelve primero los puntos pendientes listados arriba."
              pending={pending}
              onConfirm={(reason) => run(() => closePdtpProgramYearAction(program.id, reason))}
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

      {/* PREV-I14: las etapas son una secuencia, así que se anuncian como lista
          ordenada. `flex-wrap` + `basis` reparte tantas por fila como quepan
          (una sola a 390 px) sin columnas fijas que un valor largo desborde;
          `gap-px` sobre el fondo de borde dibuja los separadores. */}
      <ol aria-label="Etapas del programa" className="flex flex-wrap gap-px border-t border-[var(--color-border)] bg-[var(--color-border)]">
        <LifecycleStep label="Elaboración" value={program.elaboratedByName} done />
        {/* PREV-I14: un programa activo o cerrado tiene su versión congelada por
            definición, aunque venga de antes de que se registrara el envío. */}
        <LifecycleStep
          label="Versión congelada"
          value={program.reviewStartedAt || program.status === "active" || program.status === "closed" ? "Registrada" : "Pendiente"}
          done={!!program.reviewStartedAt || program.status === "active" || program.status === "closed"}
        />
        {steps.map((step) => (
          <LifecycleStep
            key={step.id}
            label={step.label}
            value={step.decision?.decision === "approved" ? "Aprobada" : step.isRequired ? "Pendiente" : "Opcional · pendiente"}
            done={step.decision?.decision === "approved"}
          />
        ))}
      </ol>

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
    <li className="min-w-0 flex-[1_1_12rem] bg-[var(--color-surface)] px-4 py-2.5">
      {/* La sigla expandida ("PDTP" → su nombre completo) vivía sólo en el
          `title`: MICRO-001 pedía expandir siglas, y hacerlo por hover deja
          fuera al teclado y al teléfono. `Tooltip` responde a foco; `tabIndex`
          hace alcanzable un rótulo que si no, no lo sería. */}
      <Tooltip content={expandRoleAbbreviations(label)} side="top">
        <p tabIndex={0} className="w-fit max-w-full break-words rounded-(--radius-sm) text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">{label}</p>
      </Tooltip>
      <p className={done ? "mt-0.5 text-xs font-medium break-words text-[var(--color-success-ink)]" : "mt-0.5 text-xs break-words text-[var(--color-text-muted)]"}>{value}</p>
    </li>
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
  disabled = false,
  disabledReason,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  destructive?: boolean
  variant?: "secondary" | "ghost"
  disabled?: boolean
  disabledReason?: string
  onConfirm: (reason: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const valid = reason.trim().length >= 10

  if (disabled) {
    return <Button size="sm" variant={destructive ? "destructive" : variant} disabled title={disabledReason}>{confirmLabel}</Button>
  }

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
