"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { assessDrillCompletion } from "@/lib/prevention/emergency"
import {
  EMERGENCY_DRILL_OUTCOME_LABELS,
  EMERGENCY_DRILL_STATUS_LABELS,
  EMERGENCY_PLAN_STATUS_LABELS,
  EMERGENCY_RESOURCE_STATUS_LABELS,
  EMERGENCY_SCENARIO_TYPE_LABELS,
  emergencyPlanStatusBadgeVariant,
} from "@/lib/prevention/emergency"
import { formatDateTime } from "@/lib/utils"
import {
  addEmergencyContactAction,
  addEmergencyResourceAction,
  addEmergencyRoleAction,
  addEmergencyScenarioAction,
  approveEmergencyPlanAction,
  completeEmergencyDrillAction,
  scheduleEmergencyDrillAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { toLocalInputValue } from "@/lib/utils"

const SCENARIO_TYPES = Object.keys(EMERGENCY_SCENARIO_TYPE_LABELS)

interface PlanInfo {
  id: string
  code: string
  title: string
  status: string
  description: string | null
  createdByUserId: string
  version: number
}

interface ScenarioInfo { id: string; type: string; title: string; description: string | null; responseProcedure: string }
interface RoleInfo { id: string; roleName: string; assigneeName: string; backupName: string | null }
interface ResourceInfo { id: string; name: string; kind: string; location: string; lastInspectedAt: string | null; nextInspectionAt: string | null; status: string }
interface ContactInfo { id: string; name: string; org: string; role: string | null; phone: string }
interface DrillInfo { id: string; scenarioType: string; scheduledFor: string; status: string; outcome: string | null; version: number }
interface WorkerOption { id: string; name: string; position: string | null }

interface Props {
  plan: PlanInfo
  worksiteName: string
  readiness: { ready: boolean; blockers: string[] }
  scenarios: ScenarioInfo[]
  roles: RoleInfo[]
  resources: ResourceInfo[]
  contacts: ContactInfo[]
  drills: DrillInfo[]
  eligibleWorkers: WorkerOption[]
  assignees: { id: string; name: string }[]
  currentUserId: string
  canManage: boolean
  canApprove: boolean
  canExecuteDrill: boolean
}

export function PlanDetail({
  plan, worksiteName, readiness, scenarios, roles, resources, contacts, drills,
  eligibleWorkers, assignees, currentUserId, canManage, canApprove, canExecuteDrill,
}: Props) {
  const isDraft = plan.status === "draft"
  const isApproved = plan.status === "approved"
  const canApproveThis = canApprove && isDraft && plan.createdByUserId !== currentUserId
  const approveOperation = useOperation()

  const facts = [
    { label: "Estado", value: EMERGENCY_PLAN_STATUS_LABELS[plan.status] ?? plan.status },
    { label: "Faena", value: worksiteName },
    { label: "Código", value: plan.code },
  ]

  function approve() {
    approveOperation.run(() => approveEmergencyPlanAction({ planId: plan.id, expectedVersion: plan.version }))
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      {plan.description && <p className="text-sm text-[var(--color-text-subtle)]">{plan.description}</p>}

      {isDraft && !readiness.ready && (
        <div className="rounded-md border border-[var(--color-warning-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">El plan no puede aprobarse todavía:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      )}

      {isDraft && (
        <div className="flex items-center gap-3">
          <Badge variant={emergencyPlanStatusBadgeVariant(plan.status)}>{EMERGENCY_PLAN_STATUS_LABELS[plan.status]}</Badge>
          {canApproveThis && (
            <Button size="sm" disabled={!readiness.ready || approveOperation.pending} onClick={approve}>Aprobar plan</Button>
          )}
          {approveOperation.message && <p role="status" className="text-sm">{approveOperation.message}</p>}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Escenarios ({scenarios.length})</h2>
          {canManage && plan.status !== "archived" && <AddScenarioDialog planId={plan.id} />}
        </div>
        {scenarios.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin escenarios declarados.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Procedimiento de respuesta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenarios.map((scenario) => (
                  <TableRow key={scenario.id}>
                    <TableCell className="text-sm">{EMERGENCY_SCENARIO_TYPE_LABELS[scenario.type] ?? scenario.type}</TableCell>
                    <TableCell className="text-sm font-medium">{scenario.title}</TableCell>
                    <TableCell className="max-w-md text-sm text-[var(--color-text-subtle)]">{scenario.responseProcedure}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Organigrama de emergencia ({roles.length})</h2>
          {canManage && plan.status !== "archived" && eligibleWorkers.length > 0 && <AddRoleDialog planId={plan.id} eligibleWorkers={eligibleWorkers} />}
        </div>
        {roles.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin roles designados.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rol</TableHead>
                  <TableHead>Titular</TableHead>
                  <TableHead>Reemplazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="text-sm font-medium">{role.roleName}</TableCell>
                    <TableCell className="text-sm">{role.assigneeName}</TableCell>
                    <TableCell className="text-sm text-[var(--color-text-subtle)]">{role.backupName ?? "Sin declarar"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recursos ({resources.length})</h2>
          {canManage && plan.status !== "archived" && <AddResourceDialog planId={plan.id} />}
        </div>
        {resources.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin recursos declarados.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Próxima inspección</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell className="text-sm font-medium">{resource.name}</TableCell>
                    <TableCell className="text-sm">{resource.kind}</TableCell>
                    <TableCell className="text-sm">{resource.location}</TableCell>
                    <TableCell className="text-sm tabular-nums">{resource.nextInspectionAt ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={resource.status === "operational" ? "success" : resource.status === "out_of_service" ? "danger" : "warning"}>
                        {EMERGENCY_RESOURCE_STATUS_LABELS[resource.status] ?? resource.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Contactos ({contacts.length})</h2>
          {canManage && plan.status !== "archived" && <AddContactDialog planId={plan.id} />}
        </div>
        {contacts.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin contactos registrados.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Organización</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Teléfono</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="text-sm font-medium">{contact.name}</TableCell>
                    <TableCell className="text-sm">{contact.org}</TableCell>
                    <TableCell className="text-sm">{contact.role ?? "—"}</TableCell>
                    <TableCell className="text-sm tabular-nums">{contact.phone}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Simulacros ({drills.length})</h2>
          {canExecuteDrill && isApproved && <ScheduleDrillDialog planId={plan.id} />}
        </div>
        {drills.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
            {isApproved ? "Sin simulacros programados." : "Sólo un plan aprobado puede programar simulacros."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Escenario</TableHead>
                  <TableHead>Programado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Resultado</TableHead>
                  {canExecuteDrill && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {drills.map((drill) => (
                  <TableRow key={drill.id}>
                    <TableCell className="text-sm">{EMERGENCY_SCENARIO_TYPE_LABELS[drill.scenarioType] ?? drill.scenarioType}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDateTime(drill.scheduledFor)}</TableCell>
                    <TableCell>
                      <Badge variant={drill.status === "completed" ? "success" : drill.status === "cancelled" ? "outline" : "default"}>
                        {EMERGENCY_DRILL_STATUS_LABELS[drill.status] ?? drill.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {drill.outcome
                        ? <Badge variant={drill.outcome === "satisfactory" ? "success" : "warning"}>{EMERGENCY_DRILL_OUTCOME_LABELS[drill.outcome] ?? drill.outcome}</Badge>
                        : <span className="text-sm text-[var(--color-text-subtle)]">—</span>}
                    </TableCell>
                    {canExecuteDrill && (
                      <TableCell className="text-right">
                        {drill.status === "scheduled" && (
                          <CompleteDrillDialog drill={drill} eligibleWorkers={eligibleWorkers} assignees={assignees} />
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
    </div>
  )
}

/* ── Alta de escenario ────────────────────────────────────────────────────── */

function AddScenarioDialog({ planId }: { planId: string }) {
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const description = String(form.get("description") ?? "").trim()
    operation.run(() => addEmergencyScenarioAction({
      planId,
      type: form.get("type"),
      title: form.get("title"),
      description: description || null,
      responseProcedure: form.get("responseProcedure"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Agregar escenario</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar escenario</DialogTitle>
            <DialogDescription>Cada escenario declara su propio procedimiento de respuesta.</DialogDescription>
          </DialogHeader>
          <Field label="Tipo">
            <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue placeholder="Selecciona un tipo" /></SelectTrigger><SelectContent>{SCENARIO_TYPES.map((t) => <SelectItem key={t} value={t}>{EMERGENCY_SCENARIO_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select><input type="hidden" name="type" value={type} />
          </Field>
          <Field label="Título"><Input name="title" required minLength={3} maxLength={200} /></Field>
          <Field label="Descripción" hint="Opcional."><Textarea name="description" maxLength={3000} /></Field>
          <Field label="Procedimiento de respuesta" hint="Mínimo 10 caracteres.">
            <Textarea name="responseProcedure" required minLength={10} maxLength={10_000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de rol de organigrama ───────────────────────────────────────────── */

function AddRoleDialog({ planId, eligibleWorkers }: { planId: string; eligibleWorkers: WorkerOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [assigneeWorkerId, setAssigneeWorkerId] = React.useState(eligibleWorkers[0]?.id ?? "")
  const [backupWorkerId, setBackupWorkerId] = React.useState("_none")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const backupWorkerId = String(form.get("backupWorkerId") ?? "").trim()
    operation.run(() => addEmergencyRoleAction({
      planId,
      roleName: form.get("roleName"),
      assigneeWorkerId: form.get("assigneeWorkerId"),
      backupWorkerId: backupWorkerId || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Agregar rol</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar rol del organigrama</DialogTitle>
            <DialogDescription>Titular y reemplazo deben pertenecer a la faena del plan.</DialogDescription>
          </DialogHeader>
          <Field label="Rol" hint="Ej: Jefe de emergencia, Encargado de evacuación.">
            <Input name="roleName" required minLength={2} maxLength={120} />
          </Field>
          <Field label="Titular">
            <Select value={assigneeWorkerId} onValueChange={setAssigneeWorkerId}><SelectTrigger><SelectValue placeholder="Selecciona titular" /></SelectTrigger><SelectContent>{eligibleWorkers.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.name}{worker.position ? ` · ${worker.position}` : ""}</SelectItem>)}</SelectContent></Select><input type="hidden" name="assigneeWorkerId" value={assigneeWorkerId} />
          </Field>
          <Field label="Reemplazo" hint="Opcional.">
            <Select value={backupWorkerId} onValueChange={setBackupWorkerId}><SelectTrigger><SelectValue placeholder="Sin declarar" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin declarar</SelectItem>{eligibleWorkers.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.name}{worker.position ? ` · ${worker.position}` : ""}</SelectItem>)}</SelectContent></Select><input type="hidden" name="backupWorkerId" value={backupWorkerId === "_none" ? "" : backupWorkerId} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de recurso ──────────────────────────────────────────────────────── */

function AddResourceDialog({ planId }: { planId: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const lastInspectedAt = String(form.get("lastInspectedAt") ?? "").trim()
    const nextInspectionAt = String(form.get("nextInspectionAt") ?? "").trim()
    operation.run(() => addEmergencyResourceAction({
      planId,
      name: form.get("name"),
      kind: form.get("kind"),
      location: form.get("location"),
      lastInspectedAt: lastInspectedAt || null,
      nextInspectionAt: nextInspectionAt || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Agregar recurso</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar recurso</DialogTitle>
            <DialogDescription>Equipos, extintores, kits de derrame u otro recurso de respuesta.</DialogDescription>
          </DialogHeader>
          <Field label="Nombre"><Input name="name" required minLength={2} maxLength={200} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo" hint="Ej: Extintor, kit de derrame."><Input name="kind" required minLength={2} maxLength={120} /></Field>
            <Field label="Ubicación"><Input name="location" required minLength={2} maxLength={300} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Última inspección" hint="Opcional."><DatePicker name="lastInspectedAt" /></Field>
            <Field label="Próxima inspección" hint="Opcional."><DatePicker name="nextInspectionAt" /></Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de contacto ─────────────────────────────────────────────────────── */

function AddContactDialog({ planId }: { planId: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const role = String(form.get("role") ?? "").trim()
    operation.run(() => addEmergencyContactAction({
      planId,
      name: form.get("name"),
      org: form.get("org"),
      role: role || null,
      phone: form.get("phone"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Agregar contacto</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar contacto</DialogTitle>
            <DialogDescription>Internos, mandante, mutualidad o autoridades.</DialogDescription>
          </DialogHeader>
          <Field label="Nombre"><Input name="name" required minLength={2} maxLength={200} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Organización"><Input name="org" required minLength={2} maxLength={200} /></Field>
            <Field label="Rol" hint="Opcional."><Input name="role" maxLength={120} /></Field>
          </div>
          <Field label="Teléfono"><Input name="phone" required minLength={3} maxLength={60} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Programación de simulacro ────────────────────────────────────────────── */

function ScheduleDrillDialog({ planId }: { planId: string }) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const [scenarioType, setScenarioType] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => scheduleEmergencyDrillAction({
      planId,
      scenarioType: form.get("scenarioType"),
      scheduledFor: new Date(String(form.get("scheduledFor"))).toISOString(),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultValue(toLocalInputValue(new Date())); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm">Programar simulacro</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Programar simulacro</DialogTitle>
            <DialogDescription>Sólo un plan aprobado puede programar simulacros.</DialogDescription>
          </DialogHeader>
          <Field label="Escenario">
            <Select value={scenarioType} onValueChange={setScenarioType}><SelectTrigger><SelectValue placeholder="Selecciona un tipo" /></SelectTrigger><SelectContent>{SCENARIO_TYPES.map((t) => <SelectItem key={t} value={t}>{EMERGENCY_SCENARIO_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select><input type="hidden" name="scenarioType" value={scenarioType} />
          </Field>
          <Field label="Fecha y hora"><Input name="scheduledFor" type="datetime-local" required defaultValue={defaultValue} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Programar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cierre de simulacro ──────────────────────────────────────────────────── */

function CompleteDrillDialog({ drill, eligibleWorkers, assignees }: {
  drill: DrillInfo
  eligibleWorkers: WorkerOption[]
  assignees: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [executedAt, setExecutedAt] = React.useState("")
  const [present, setPresent] = React.useState<Set<string>>(new Set())
  const [outcome, setOutcome] = React.useState<"" | "satisfactory" | "needs_improvement">("")
  const [responsibleUserId, setResponsibleUserId] = React.useState("_none")
  const operation = useOperation()

  const readiness = React.useMemo(() => assessDrillCompletion({
    participants: eligibleWorkers.map((worker) => ({ present: present.has(worker.id) })),
    evacuationSeconds: null,
    outcome: outcome || null,
  }), [eligibleWorkers, present, outcome])

  function togglePresent(workerId: string, checked: boolean) {
    setPresent((current) => {
      const next = new Set(current)
      if (checked) next.add(workerId); else next.delete(workerId)
      return next
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const durationMinutes = String(form.get("durationMinutes") ?? "").trim()
    const evacuationSeconds = String(form.get("evacuationSeconds") ?? "").trim()
    const observations = String(form.get("observations") ?? "").trim()
    const responsibleUserId = String(form.get("responsibleUserId") ?? "").trim()
    const targetDate = String(form.get("targetDate") ?? "").trim()
    operation.run(() => completeEmergencyDrillAction({
      drillId: drill.id,
      expectedVersion: drill.version,
      executedAt: new Date(executedAt).toISOString(),
      durationMinutes: durationMinutes ? Number(durationMinutes) : null,
      evacuationSeconds: evacuationSeconds ? Number(evacuationSeconds) : null,
      observations: observations || null,
      outcome: outcome || null,
      participants: eligibleWorkers.map((worker) => ({ workerId: worker.id, present: present.has(worker.id) })),
      responsibleUserId: responsibleUserId || null,
      targetDate: targetDate || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setExecutedAt(toLocalInputValue(new Date())); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Completar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Completar simulacro</DialogTitle>
            <DialogDescription>Un resultado &ldquo;requiere mejora&rdquo; deriva una acción CAPA con responsable y plazo.</DialogDescription>
          </DialogHeader>

          {readiness.blockers.length > 0 && (
            <p className="text-sm text-[var(--color-warning-ink)]">{readiness.blockers.join(" ")}</p>
          )}

          <Field label="Realizado el"><Input type="datetime-local" required value={executedAt} onChange={(event) => setExecutedAt(event.target.value)} /></Field>

          <div className="space-y-2">
            <span className="text-sm font-medium">Participantes</span>
            <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border)]">
              {eligibleWorkers.length === 0 ? (
                <p className="p-3 text-sm text-[var(--color-text-subtle)]">Sin dotación disponible en esta faena.</p>
              ) : eligibleWorkers.map((worker) => (
                <label key={worker.id} className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-b-0">
                  <input type="checkbox" checked={present.has(worker.id)} onChange={(event) => togglePresent(worker.id, event.target.checked)} />
                  <span>{worker.name}{worker.position ? ` · ${worker.position}` : ""}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Duración (min)" hint="Opcional."><Input name="durationMinutes" type="number" min={1} /></Field>
            <Field label="Tiempo de evacuación (s)" hint="Opcional."><Input name="evacuationSeconds" type="number" min={1} /></Field>
          </div>

          <Field label="Resultado">
            <Select value={outcome || "_none"} onValueChange={(v) => setOutcome(v === "_none" ? "" : v as "satisfactory" | "needs_improvement")}><SelectTrigger><SelectValue placeholder="Selecciona un resultado" /></SelectTrigger><SelectContent><SelectItem value="_none" className="hidden">Selecciona un resultado</SelectItem><SelectItem value="satisfactory">Satisfactorio</SelectItem><SelectItem value="needs_improvement">Requiere mejora</SelectItem></SelectContent></Select>
          </Field>

          <Field label="Observaciones" hint="Opcional."><Textarea name="observations" maxLength={5000} /></Field>

          {outcome === "needs_improvement" && (
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              <p className="text-sm font-medium">Acción correctiva derivada a CAPA</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Responsable" hint="Opcional.">
                  <Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin asignar</SelectItem>{assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="responsibleUserId" value={responsibleUserId === "_none" ? "" : responsibleUserId} />
                </Field>
                <Field label="Plazo" required><DatePicker name="targetDate" /></Field>
              </div>
            </div>
          )}

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !readiness.ready}>Completar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
