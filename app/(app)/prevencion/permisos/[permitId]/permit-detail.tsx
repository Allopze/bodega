"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  ENERGY_SOURCE_LABELS,
  PERMIT_CREW_ROLE_LABELS,
  PERMIT_STATUS_LABELS,
  PERMIT_TRANSITIONS,
  RESIDUAL_RISK_LABELS,
  permitStatusBadgeVariant,
} from "@/lib/prevention/permits"
import { formatDateTime } from "@/lib/utils"
import {
  acknowledgePermitCrewAction,
  addPermitIsolationAction,
  addPermitMeasurementAction,
  applyPermitIsolationAction,
  extendWorkPermitAction,
  removePermitIsolationAction,
  saveJsaStepsAction,
  transitionWorkPermitAction,
  verifyPermitControlAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { linesToArray, toLocalInputValue } from "@/lib/utils"
import { nanoid } from "@/lib/id"

interface PermitInfo {
  id: string
  code: string
  status: string
  taskDescription: string
  location: string
  riskEntryId: string | null
  plannedStartAt: string
  plannedEndAt: string
  extendedUntilAt: string | null
  extensionReason: string | null
  rejectionReason: string | null
  suspensionReason: string | null
  closureSummary: string | null
  cancellationReason: string | null
  requestedByUserId: string
  version: number
}

interface ControlItem {
  id: string
  description: string
  isMandatory: boolean
  verified: boolean
  notApplicableReason: string | null
}

interface IsolationItem {
  id: string
  energySource: string
  equipmentTag: string
  isolationMethod: string
  lockTagId: string
  appliedAt: string | null
  verifiedZeroEnergy: boolean
  removedAt: string | null
}

interface MeasurementItem {
  id: string
  parameter: string
  value: string
  unit: string
  acceptableMin: string | null
  acceptableMax: string | null
  withinRange: boolean
  equipmentTag: string
  takenAt: string
}

interface JsaStepItem {
  stepOrder: number
  stepDescription: string
  hazards: string[]
  controls: string[]
  residualRisk: string
}

interface CrewItem {
  id: string
  workerName: string
  role: string
  acknowledgedAt: string | null
  crewUserId: string | null
  /** PER-002: enlace de acuse sin cuenta; null si la persona sí tiene cuenta. */
  ackLink?: string | null
  hasCompetencyGap: boolean
}

interface Readiness {
  allowed: boolean
  blockers: { kind: string; detail: string }[]
}

interface Props {
  permit: PermitInfo
  typeName: string
  typeCode: string
  requiresIsolation: boolean
  requiresMeasurement: boolean
  requiresJsa: boolean
  maxDurationHours: number
  worksiteName: string
  supervisorName: string
  requesterName: string
  controls: ControlItem[]
  isolations: IsolationItem[]
  measurements: MeasurementItem[]
  jsaSteps: JsaStepItem[]
  crew: CrewItem[]
  readiness: Readiness
  currentUserId: string
  canRequest: boolean
  canVerify: boolean
  canApprove: boolean
  canActivate: boolean
  canSuspend: boolean
  canClose: boolean
}

const TRANSITION_LABELS: Record<string, string> = {
  pending_approval: "Enviar a aprobación",
  approved: "Aprobar",
  rejected: "Rechazar",
  active: "Habilitar",
  suspended: "Suspender",
  closed: "Cerrar",
  cancelled: "Cancelar",
}

const TRANSITION_DESCRIPTIONS: Record<string, string> = {
  pending_approval: "Queda a la espera de revisión segregada de quien lo solicitó.",
  approved: "Habilita a que se registren aislamientos y mediciones en terreno.",
  rejected: "El permiso no continúa. Queda registrado con el motivo.",
  active: "Recalcula la habilitación completa en este momento: controles, aislamientos, mediciones, AST y cuadrilla.",
  suspended: "Detiene el trabajo en el acto. Se reactiva desde este mismo panel.",
  closed: "No se puede cerrar con aislamientos aplicados sin retirar.",
  cancelled: "El permiso queda cancelado con el motivo en el historial.",
}

function terminalNote(permit: PermitInfo) {
  if (permit.status === "rejected") return { label: "Motivo del rechazo", text: permit.rejectionReason }
  if (permit.status === "suspended") return { label: "Motivo de la suspensión", text: permit.suspensionReason }
  if (permit.status === "closed") return { label: "Resumen de cierre", text: permit.closureSummary }
  if (permit.status === "cancelled") return { label: "Motivo de la cancelación", text: permit.cancellationReason }
  return null
}

export function PermitDetail({
  permit, typeName, typeCode, requiresIsolation, requiresMeasurement, requiresJsa, maxDurationHours,
  worksiteName, supervisorName, requesterName, controls, isolations, measurements, jsaSteps, crew,
  readiness, currentUserId, canRequest, canVerify, canApprove, canActivate, canSuspend, canClose,
}: Props) {
  const editableByRequester = ["draft", "pending_approval"].includes(permit.status) && canRequest
  const terminal = ["closed", "rejected", "cancelled"].includes(permit.status)
  const note = terminalNote(permit)
  const openIsolations = isolations.filter((item) => item.appliedAt && !item.removedAt)

  const PERMISSION_BY_STATUS: Record<string, boolean> = {
    pending_approval: canRequest,
    approved: canApprove,
    rejected: canApprove,
    active: canActivate,
    suspended: canSuspend,
    closed: canClose,
    cancelled: canRequest,
  }

  const transitions = (PERMIT_TRANSITIONS[permit.status] ?? []).filter((toStatus) => {
    if (!PERMISSION_BY_STATUS[toStatus]) return false
    // Quien solicitó el permiso no puede aprobarlo: el servicio lo rechaza: no
    // se ofrece una acción condenada a fallar.
    if (toStatus === "approved" && permit.requestedByUserId === currentUserId) return false
    return true
  })

  const facts = [
    { label: "Estado", value: PERMIT_STATUS_LABELS[permit.status] ?? permit.status },
    { label: "Tipo", value: `${typeName} (${typeCode})` },
    { label: "Faena", value: worksiteName },
    { label: "Lugar", value: permit.location },
    { label: "Supervisor", value: supervisorName },
    { label: "Solicitado por", value: requesterName },
    { label: "Ventana planificada", value: `${formatDateTime(permit.plannedStartAt)} a ${formatDateTime(permit.plannedEndAt)}` },
    { label: "Extensión", value: permit.extendedUntilAt ? `hasta ${formatDateTime(permit.extendedUntilAt)}` : "Sin extender" },
    { label: "Duración máxima del tipo", value: `${maxDurationHours} h` },
    ...(permit.riskEntryId ? [{ label: "Peligro MIPER de origen", value: permit.riskEntryId }] : []),
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MetaBadge meta={{ label: PERMIT_STATUS_LABELS[permit.status] ?? permit.status, variant: permitStatusBadgeVariant(permit.status) }} />
          {note?.text && <span className="text-sm text-[var(--color-text-subtle)]">{note.label}: {note.text}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(permit.status === "approved" || permit.status === "active") && canApprove && (
            <ExtendDialog permit={permit} />
          )}
          {transitions.map((toStatus) => (
            <TransitionDialog
              key={toStatus}
              permit={permit}
              toStatus={toStatus}
              label={TRANSITION_LABELS[toStatus] ?? toStatus}
              description={TRANSITION_DESCRIPTIONS[toStatus] ?? ""}
              blockers={
                toStatus === "active" && !readiness.allowed ? readiness.blockers.map((item) => item.detail)
                  : toStatus === "closed" && openIsolations.length > 0 ? openIsolations.map((item) => `Aislamiento sin retirar en ${item.equipmentTag} (${item.lockTagId}).`)
                    : undefined
              }
            />
          ))}
        </div>
      </div>

      {!terminal && !readiness.allowed && permit.status !== "active" && (
        <div className="rounded-md border border-[var(--color-warning-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Aún no puede habilitarse:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {readiness.blockers.map((item) => <li key={item.detail}>{item.detail}</li>)}
          </ul>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">AST / JSA{requiresJsa && <span className="ml-1 text-xs font-normal text-[var(--color-text-subtle)]">(exigido por el tipo de permiso)</span>}</h2>
          {editableByRequester && <JsaDialog permitId={permit.id} steps={jsaSteps} />}
        </div>
        {jsaSteps.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
            Sin pasos registrados{requiresJsa && ": este tipo de permiso exige al menos uno para habilitarse"}.
          </p>
        ) : (
          <div className="space-y-2">
            {jsaSteps.map((step) => (
              <div key={step.stepOrder} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Paso {step.stepOrder} · {step.stepDescription}</span>
                  <MetaBadge meta={{ label: `Riesgo residual ${RESIDUAL_RISK_LABELS[step.residualRisk] ?? step.residualRisk}`, variant: step.residualRisk === "critical" || step.residualRisk === "high" ? "danger" : step.residualRisk === "medium" ? "warning" : "default" }} />
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <span className="text-xs font-medium text-[var(--color-text-subtle)]">Peligros</span>
                    <ul className="list-disc pl-4">{step.hazards.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-[var(--color-text-subtle)]">Controles</span>
                    <ul className="list-disc pl-4">{step.controls.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Controles</h2>
        {controls.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin controles declarados para este permiso.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Control</TableHead>
                  <TableHead>Estado</TableHead>
                  {canVerify && !terminal && <TableHead className="text-right">Verificar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {controls.map((control) => (
                  <TableRow key={control.id}>
                    <TableCell className="text-sm">
                      {control.description}
                      {control.isMandatory && <MetaBadge meta={{ label: "Obligatorio", variant: "outline" }} className="ml-2" />}
                    </TableCell>
                    <TableCell className="text-sm">
                      {control.verified
                        ? <MetaBadge meta={{ label: "Verificado", variant: "success" }} />
                        : control.notApplicableReason
                          ? <span className="text-[var(--color-text-subtle)]">No aplica: {control.notApplicableReason}</span>
                          : <MetaBadge meta={{ label: "Pendiente", variant: "warning" }} />}
                    </TableCell>
                    {canVerify && !terminal && (
                      <TableCell className="text-right"><ControlVerifyDialog control={control} /></TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Aislamiento de energías (LOTO){requiresIsolation && <span className="ml-1 text-xs font-normal text-[var(--color-text-subtle)]">(exigido por el tipo de permiso)</span>}</h2>
          {canVerify && !terminal && <AddIsolationDialog permitId={permit.id} />}
        </div>
        {isolations.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin aislamientos registrados.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo / candado</TableHead>
                  <TableHead>Fuente</TableHead>
                  <TableHead>Estado</TableHead>
                  {canVerify && !terminal && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isolations.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs">{item.lockTagId}</span>
                      <span className="block">{item.equipmentTag}</span>
                      <span className="block text-xs text-[var(--color-text-subtle)]">{item.isolationMethod}</span>
                    </TableCell>
                    <TableCell className="text-sm">{ENERGY_SOURCE_LABELS[item.energySource] ?? item.energySource}</TableCell>
                    <TableCell className="text-sm">
                      {item.removedAt
                        ? <MetaBadge meta={{ label: `Retirado ${formatDateTime(item.removedAt)}`, variant: "outline" }} />
                        : item.appliedAt
                          ? item.verifiedZeroEnergy
                            ? <MetaBadge meta={{ label: "Aplicado · energía cero verificada", variant: "success" }} />
                            : <MetaBadge meta={{ label: "Aplicado sin verificar energía cero", variant: "warning" }} />
                          : <MetaBadge meta={{ label: "Sin aplicar", variant: "warning" }} />}
                    </TableCell>
                    {canVerify && !terminal && (
                      <TableCell className="text-right">
                        {!item.appliedAt && <ApplyIsolationDialog isolation={item} />}
                        {item.appliedAt && !item.removedAt && (
                          permit.status === "active"
                            ? <span className="text-xs text-[var(--color-text-subtle)]">Suspende o cierra para retirar</span>
                            : <RemoveIsolationDialog isolation={item} />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Mediciones{requiresMeasurement && <span className="ml-1 text-xs font-normal text-[var(--color-text-subtle)]">(exigido por el tipo de permiso)</span>}</h2>
          {canVerify && !terminal && <AddMeasurementDialog permitId={permit.id} />}
        </div>
        {measurements.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin mediciones registradas.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parámetro</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Rango aceptable</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Tomada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {measurements.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">{item.parameter}</TableCell>
                    <TableCell className="text-sm">{item.equipmentTag}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{item.value} {item.unit}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {item.acceptableMin ?? "—"} – {item.acceptableMax ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      <MetaBadge meta={{ label: item.withinRange ? "En rango" : "Fuera de rango", variant: item.withinRange ? "success" : "danger" }} />
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDateTime(item.takenAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Cuadrilla ({crew.length})</h2>
        {crew.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin cuadrilla asignada.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Competencia</TableHead>
                  <TableHead>Acuse</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crew.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="text-sm">{member.workerName}</TableCell>
                    <TableCell className="text-sm">{PERMIT_CREW_ROLE_LABELS[member.role] ?? member.role}</TableCell>
                    <TableCell className="text-sm">
                      {member.hasCompetencyGap ? <MetaBadge meta={{ label: "Sin competencia vigente", variant: "danger" }} /> : <MetaBadge meta={{ label: "Habilitado", variant: "success" }} />}
                    </TableCell>
                    <TableCell className="text-sm">
                      {member.acknowledgedAt
                        ? formatDateTime(member.acknowledgedAt)
                        : member.crewUserId === currentUserId
                          ? <AckButton crewId={member.id} />
                          /* PER-002: la persona sin cuenta acusa por enlace
                             personal. Antes aquí sólo decía "Pendiente" y no
                             había forma de dejar de estarlo. */
                          : member.ackLink
                            ? (
                              <a
                                href={member.ackLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-(--color-primary) underline underline-offset-2"
                              >
                                Enlace de acuse (sin cuenta)
                              </a>
                            )
                            : "Pendiente"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

/* ── Transición de estado ─────────────────────────────────────────────────── */

function TransitionDialog({ permit, toStatus, label, description, blockers }: {
  permit: PermitInfo
  toStatus: string
  label: string
  description: string
  blockers?: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const hasBlockers = (blockers?.length ?? 0) > 0
  const destructive = toStatus === "rejected" || toStatus === "cancelled"

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => transitionWorkPermitAction({
      permitId: permit.id,
      toStatus,
      reason: form.get("reason"),
      expectedVersion: permit.version,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant={destructive ? "destructive" : "secondary"}>{label}</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{label} · {permit.code}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {hasBlockers && (
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede completar:</p>
              <ul className="list-disc space-y-1 pl-4">{blockers!.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          <Field label="Motivo" hint="Mínimo 10 caracteres.">
            <Textarea name="reason" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || hasBlockers} variant={destructive ? "destructive" : "primary"}>{label}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Extensión ─────────────────────────────────────────────────────────────── */

function ExtendDialog({ permit }: { permit: PermitInfo }) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => extendWorkPermitAction({
      permitId: permit.id,
      expectedVersion: permit.version,
      extendedUntilAt: new Date(String(form.get("extendedUntilAt"))).toISOString(),
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          const currentEnd = new Date(permit.extendedUntilAt ?? permit.plannedEndAt)
          setDefaultValue(toLocalInputValue(new Date(currentEnd.getTime() + 2 * 3_600_000)))
        }
        setOpen(value)
      }}
    >
      <DialogTrigger asChild><Button size="sm" variant="secondary">Extender</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Extender {permit.code}</DialogTitle>
            <DialogDescription>No puede superar la duración máxima del tipo de permiso.</DialogDescription>
          </DialogHeader>
          <Field label="Nuevo término">
            <Input name="extendedUntilAt" type="datetime-local" required defaultValue={defaultValue} />
          </Field>
          <Field label="Motivo" hint="Mínimo 10 caracteres.">
            <Textarea name="reason" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Extender</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── AST / JSA ────────────────────────────────────────────────────────────── */

function JsaDialog({ permitId, steps }: { permitId: string; steps: JsaStepItem[] }) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<{ id: string; stepDescription: string; hazards: string; controls: string; residualRisk: string }[]>([])
  const operation = useOperation()

  function openWith(existing: JsaStepItem[]) {
    setDraft(existing.length > 0
      ? existing.map((item) => ({ id: nanoid(), stepDescription: item.stepDescription, hazards: item.hazards.join("\n"), controls: item.controls.join("\n"), residualRisk: item.residualRisk }))
      : [{ id: nanoid(), stepDescription: "", hazards: "", controls: "", residualRisk: "medium" }])
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(() => saveJsaStepsAction({
      permitId,
      steps: draft.map((item, index) => ({
        stepOrder: index + 1,
        stepDescription: item.stepDescription,
        hazards: linesToArray(item.hazards),
        controls: linesToArray(item.controls),
        residualRisk: item.residualRisk,
      })),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) openWith(steps); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">{steps.length > 0 ? "Editar AST/JSA" : "Escribir AST/JSA"}</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AST / JSA</DialogTitle>
            <DialogDescription>
              Guardar reemplaza todos los pasos existentes por esta lista completa. Un peligro o control por línea.
            </DialogDescription>
          </DialogHeader>
          {draft.map((step, index) => (
            <div key={step.id} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Paso {index + 1}</span>
                {draft.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}>
                    Quitar paso
                  </Button>
                )}
              </div>
              <Field label="Descripción">
                <Textarea
                  value={step.stepDescription} required minLength={5} maxLength={2000}
                  onChange={(event) => setDraft((current) => current.map((s, i) => i === index ? { ...s, stepDescription: event.target.value } : s))}
                />
              </Field>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="Peligros" hint="Uno por línea.">
                  <Textarea
                    value={step.hazards} required
                    onChange={(event) => setDraft((current) => current.map((s, i) => i === index ? { ...s, hazards: event.target.value } : s))}
                  />
                </Field>
                <Field label="Controles" hint="Uno por línea.">
                  <Textarea
                    value={step.controls} required
                    onChange={(event) => setDraft((current) => current.map((s, i) => i === index ? { ...s, controls: event.target.value } : s))}
                  />
                </Field>
              </div>
              <Field label="Riesgo residual">
                <Select value={step.residualRisk} onValueChange={(v) => setDraft((current) => current.map((s, i) => i === index ? { ...s, residualRisk: v } : s))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RESIDUAL_RISK_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
              </Field>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setDraft((current) => [...current, { id: nanoid(), stepDescription: "", hazards: "", controls: "", residualRisk: "medium" }])}>
            Agregar paso
          </Button>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar AST/JSA</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Verificación de control ──────────────────────────────────────────────── */

function ControlVerifyDialog({ control }: { control: ControlItem }) {
  const [open, setOpen] = React.useState(false)
  const [verified, setVerified] = React.useState(true)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => verifyPermitControlAction({
      controlId: control.id,
      verified,
      notApplicableReason: verified ? null : form.get("notApplicableReason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setVerified(true); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Verificar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Verificar control</DialogTitle>
            <DialogDescription>{control.description}</DialogDescription>
          </DialogHeader>
          <Field label="Resultado">
            <Select value={verified ? "yes" : "no"} onValueChange={(v) => setVerified(v === "yes")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Verificado en terreno</SelectItem><SelectItem value="no">No aplica</SelectItem></SelectContent></Select>
          </Field>
          {!verified && (
            <Field label="Por qué no aplica" hint="Obligatorio para no verificar un control.">
              <Textarea name="notApplicableReason" required minLength={3} maxLength={1000} />
            </Field>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── LOTO ─────────────────────────────────────────────────────────────────── */

function AddIsolationDialog({ permitId }: { permitId: string }) {
  const [open, setOpen] = React.useState(false)
  const [energySource, setEnergySource] = React.useState("electrical")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => addPermitIsolationAction({
      permitId,
      energySource: form.get("energySource"),
      equipmentTag: form.get("equipmentTag"),
      isolationMethod: form.get("isolationMethod"),
      lockTagId: form.get("lockTagId"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Agregar aislamiento</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo aislamiento</DialogTitle>
            <DialogDescription>Se registra sin aplicar. Aplícalo desde la lista una vez instalado el candado.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Fuente de energía">
              <Select value={energySource} onValueChange={setEnergySource}><SelectTrigger><SelectValue placeholder="Selecciona fuente" /></SelectTrigger><SelectContent>{Object.entries(ENERGY_SOURCE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="energySource" value={energySource} />
            </Field>
            <Field label="ID de candado/tarjeta"><Input name="lockTagId" required maxLength={120} /></Field>
          </div>
          <Field label="Equipo"><Input name="equipmentTag" required maxLength={200} /></Field>
          <Field label="Método de aislamiento" hint="Mínimo 3 caracteres.">
            <Textarea name="isolationMethod" required minLength={3} maxLength={500} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Registrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ApplyIsolationDialog({ isolation }: { isolation: IsolationItem }) {
  const [open, setOpen] = React.useState(false)
  const [verifiedZeroEnergy, setVerifiedZeroEnergy] = React.useState(true)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(() => applyPermitIsolationAction({ isolationId: isolation.id, verifiedZeroEnergy }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Aplicar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Aplicar aislamiento {isolation.lockTagId}</DialogTitle>
            <DialogDescription>{isolation.equipmentTag} · {isolation.isolationMethod}</DialogDescription>
          </DialogHeader>
          <Checkbox label="Energía cero verificada en terreno" checked={verifiedZeroEnergy} onChange={(event) => setVerifiedZeroEnergy(event.target.checked)} />
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Aplicar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemoveIsolationDialog({ isolation }: { isolation: IsolationItem }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Retirar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => removePermitIsolationAction({ isolationId: isolation.id, reason: form.get("reason") }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Retirar aislamiento {isolation.lockTagId}</DialogTitle>
            <DialogDescription>Equivale a devolver energía a {isolation.equipmentTag}.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 5 caracteres.">
            <Textarea name="reason" required minLength={5} maxLength={1000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" variant="destructive" disabled={operation.pending}>Retirar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Mediciones ───────────────────────────────────────────────────────────── */

function AddMeasurementDialog({ permitId }: { permitId: string }) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const min = String(form.get("acceptableMin") ?? "").trim()
    const max = String(form.get("acceptableMax") ?? "").trim()
    const calibration = String(form.get("calibrationDate") ?? "").trim()
    operation.run(() => addPermitMeasurementAction({
      permitId,
      parameter: form.get("parameter"),
      value: Number(form.get("value")),
      unit: form.get("unit"),
      acceptableMin: min ? Number(min) : null,
      acceptableMax: max ? Number(max) : null,
      equipmentTag: form.get("equipmentTag"),
      calibrationDate: calibration || null,
      takenAt: new Date(String(form.get("takenAt"))).toISOString(),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultValue(toLocalInputValue(new Date())); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Registrar medición</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva medición</DialogTitle>
            <DialogDescription>Debe declararse al menos un límite aceptable, mínimo o máximo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Parámetro"><Input name="parameter" required maxLength={120} placeholder="O2" /></Field>
            <Field label="Equipo"><Input name="equipmentTag" required maxLength={200} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Valor"><Input name="value" type="number" step="any" required /></Field>
            <Field label="Unidad"><Input name="unit" required maxLength={40} placeholder="%" /></Field>
            <Field label="Fecha de calibración" hint="Opcional, salvo que el tipo de permiso exija calibración vigente."><DatePicker name="calibrationDate" /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Mínimo aceptable"><Input name="acceptableMin" type="number" step="any" /></Field>
            <Field label="Máximo aceptable"><Input name="acceptableMax" type="number" step="any" /></Field>
          </div>
          <Field label="Tomada el">
            <Input name="takenAt" type="datetime-local" required defaultValue={defaultValue} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Registrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Acuse de cuadrilla ───────────────────────────────────────────────────── */

function AckButton({ crewId }: { crewId: string }) {
  const operation = useOperation()
  return (
    <div className="space-y-1">
      <Button
        type="button" size="sm" disabled={operation.pending}
        onClick={() => operation.run(() => acknowledgePermitCrewAction({ crewId }))}
      >
        Acusar recibo
      </Button>
      {operation.message && <p role="status" className="text-xs">{operation.message}</p>}
    </div>
  )
}
