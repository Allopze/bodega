"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { FileInput } from "@/components/ui/file-input"
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
  emergencyScenarioTypeLabel,
  emergencyPlanStatusBadgeVariant,
} from "@/lib/prevention/emergency"
import { formatDateTime } from "@/lib/utils"
import {
  addEmergencyContactAction,
  linkResourcesToPlanAction,
  addEmergencyRoleAction,
  addEmergencyScenarioAction,
  approveEmergencyPlanAction,
  archiveEmergencyPlanAction,
  cancelEmergencyDrillAction,
  completeEmergencyDrillAction,
  scheduleEmergencyDrillAction,
  setEmergencyPlanPdtpActivitiesAction,
  updateEmergencyResourceAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { toLocalInputValue } from "@/lib/utils"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

const SCENARIO_TYPES = Object.keys(EMERGENCY_SCENARIO_TYPE_LABELS)

interface PlanInfo {
  id: string
  code: string
  title: string
  status: string
  description: string | null
  createdByUserId: string
  version: number
  /** Actividades del PDTP que acredita cada simulacro de este plan. */
  pdtpActivityNumbers: number[]
}

interface ScenarioInfo { id: string; type: string; title: string; description: string | null; responseProcedure: string }
interface RoleInfo { id: string; roleName: string; assigneeName: string; backupName: string | null }
interface ResourceInfo { id: string; name: string; kind: string; location: string; serialNumber: string | null; lastInspectedAt: string | null; nextInspectionAt: string | null; expiresAt: string | null; status: string }
interface ContactInfo { id: string; name: string; org: string; role: string | null; phone: string }
interface DrillInfo { id: string; scenarioType: string; scheduledFor: string; status: string; outcome: string | null; version: number; activeEvidenceCount: number }
interface WorkerOption { id: string; name: string; position: string | null }

interface Props {
  plan: PlanInfo
  worksiteName: string
  readiness: { ready: boolean; blockers: string[] }
  scenarios: ScenarioInfo[]
  roles: RoleInfo[]
  resources: ResourceInfo[]
  /** Inventario de la faena que este plan aún no declara (Admin → Inventario de faena). */
  linkableResources: { id: string; name: string; kind: string; location: string }[]
  contacts: ContactInfo[]
  drills: DrillInfo[]
  eligibleWorkers: WorkerOption[]
  assignees: { id: string; name: string }[]
  currentUserId: string
  canManage: boolean
  canApprove: boolean
  canExecuteDrill: boolean
  catalogActivities: PdtpActivityPickerOption[]
  catalogActivityIds: string[]
}

export function PlanDetail({
  plan, worksiteName, readiness, scenarios, roles, resources, linkableResources, contacts, drills,
  eligibleWorkers, assignees, currentUserId, canManage, canApprove, canExecuteDrill,
  catalogActivities, catalogActivityIds,
}: Props) {
  const isDraft = plan.status === "draft"
  const isApproved = plan.status === "approved"
  const canApproveThis = canApprove && isDraft && plan.createdByUserId !== currentUserId
  const approveOperation = useOperation()

  const facts = [
    { label: "Estado", value: EMERGENCY_PLAN_STATUS_LABELS[plan.status] ?? plan.status },
    { label: "Faena", value: worksiteName },
    { label: "Código", value: plan.code },
    // Sin actividades declaradas, completar un simulacro no acredita nada en el
    // programa anual: el conector es un no-op (EMERGENCIAS-05).
    {
      label: "Acreditación PDTP",
      value: catalogActivityIds.length > 0 ? `${catalogActivityIds.length} actividad(es) de catálogo` : plan.pdtpActivityNumbers.length > 0 ? `N° ${plan.pdtpActivityNumbers.join(", ")} (histórico)` : "No acredita",
    },
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

      {isApproved && (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text-subtle)]">
          El plan está aprobado: su contenido quedó congelado. Para cambiarlo, archívalo y emite el plan siguiente de la faena.
          El inventario de equipos sí se mantiene, porque pertenece a la faena y no al documento.
        </p>
      )}

      {plan.status !== "archived" && (
        <div className="flex flex-wrap items-center gap-3">
          <MetaBadge meta={{ label: `${EMERGENCY_PLAN_STATUS_LABELS[plan.status]}`, variant: emergencyPlanStatusBadgeVariant(plan.status) }} />
          {canApproveThis && (
            <Button size="sm" disabled={!readiness.ready || approveOperation.pending} onClick={approve}>Aprobar plan</Button>
          )}
          {/* Disponible con el plan aprobado, no sólo en borrador: los simulacros
              sólo existen sobre un plan aprobado, y el cableado al programa
              anual no es contenido del documento congelado. */}
          {canManage && <PdtpActivitiesDialog planId={plan.id} code={plan.code} version={plan.version} current={catalogActivityIds} options={catalogActivities} />}
          {canApprove && <ArchivePlanDialog planId={plan.id} code={plan.code} version={plan.version} />}
          {approveOperation.message && <p role="status" className="text-sm">{approveOperation.message}</p>}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Escenarios ({scenarios.length})</h2>
          {canManage && isDraft && <AddScenarioDialog planId={plan.id} />}
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
                    <TableCell className="text-sm">{emergencyScenarioTypeLabel(scenario.type)}</TableCell>
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
          {canManage && isDraft && eligibleWorkers.length > 0 && <AddRoleDialog planId={plan.id} eligibleWorkers={eligibleWorkers} />}
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
          {canManage && isDraft && <LinkResourcesDialog planId={plan.id} options={linkableResources} />}
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
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  {canManage && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell className="text-sm font-medium">{resource.name}</TableCell>
                    <TableCell className="text-sm">{resource.kind}</TableCell>
                    <TableCell className="text-sm">{resource.location}</TableCell>
                    <TableCell className="text-sm tabular-nums">{resource.nextInspectionAt ?? "—"}</TableCell>
                    <TableCell className="text-sm tabular-nums">{resource.expiresAt ?? "—"}</TableCell>
                    <TableCell>
                      <MetaBadge meta={{ label: `${EMERGENCY_RESOURCE_STATUS_LABELS[resource.status] ?? resource.status}`, variant: resource.status === "operational" ? "success" : resource.status === "out_of_service" ? "danger" : "warning" }} />
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <EditResourceDialog resource={resource} />
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
          <h2 className="text-sm font-semibold">Contactos ({contacts.length})</h2>
          {canManage && isDraft && <AddContactDialog planId={plan.id} />}
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
                    <TableCell className="text-sm">{emergencyScenarioTypeLabel(drill.scenarioType)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDateTime(drill.scheduledFor)}</TableCell>
                    <TableCell>
                      <MetaBadge meta={{ label: `${EMERGENCY_DRILL_STATUS_LABELS[drill.status] ?? drill.status}`, variant: drill.status === "completed" ? "success" : drill.status === "cancelled" ? "outline" : "default" }} />
                    </TableCell>
                    <TableCell>
                      {drill.outcome
                        ? <MetaBadge meta={{ label: `${EMERGENCY_DRILL_OUTCOME_LABELS[drill.outcome] ?? drill.outcome}`, variant: drill.outcome === "satisfactory" ? "success" : "warning" }} />
                        : <span className="text-sm text-[var(--color-text-subtle)]">—</span>}
                    </TableCell>
                    {canExecuteDrill && (
                      <TableCell className="text-right">
                        {drill.status === "scheduled" && (
                          <div className="flex justify-end gap-2">
                            <CompleteDrillDialog drill={drill} assignees={assignees} />
                            <CancelDrillDialog drill={drill} />
                          </div>
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
            <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue placeholder="Selecciona un tipo" /></SelectTrigger><SelectContent>{SCENARIO_TYPES.map((t) => <SelectItem key={t} value={t}>{emergencyScenarioTypeLabel(t)}</SelectItem>)}</SelectContent></Select><input type="hidden" name="type" value={type} />
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

/**
 * Declara en el plan recursos que YA existen en el inventario de la faena.
 *
 * Antes esto era un alta: el plan creaba el extintor. Eso ataba la realidad
 * física al estado de un documento —con el plan aprobado no se podía registrar
 * un equipo nuevo— y ponía el padrón dentro de Prevención, que sólo lo consume.
 * El inventario se carga en Admin → Inventario de faena; acá se elige.
 */
function LinkResourcesDialog({ planId, options }: {
  planId: string
  options: { id: string; name: string; kind: string; location: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const operation = useOperation()

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSelected([]) }}>
      <DialogTrigger asChild><Button size="sm">Declarar recursos</Button></DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(
              () => linkResourcesToPlanAction({ planId, resourceIds: selected }),
              () => { setOpen(false); setSelected([]) },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Declarar recursos del inventario</DialogTitle>
            <DialogDescription>
              Los equipos instalados en la faena se cargan en Administración → Inventario de faena. Acá se declara
              cuáles cubre este plan de emergencias.
            </DialogDescription>
          </DialogHeader>
          {options.length === 0 ? (
            <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
              No queda ningún recurso de esta faena sin declarar. Si falta un equipo, cárgalo primero en
              Administración → Inventario de faena.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
              {options.map((option) => (
                <label key={option.id} className="flex items-start gap-2 rounded p-1.5 text-sm hover:bg-[var(--color-surface-2)]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(option.id)}
                    onChange={() => toggle(option.id)}
                  />
                  <span>
                    <span className="block font-medium">{option.name}</span>
                    <span className="text-xs text-[var(--color-text-subtle)]">{option.kind} · {option.location}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending || selected.length === 0}>
              Declarar {selected.length > 0 ? `(${selected.length})` : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
/* ── Mantención y baja de un recurso ──────────────────────────────────────────
 * El equipo pertenece a la faena, no al documento: se mantiene aunque el plan
 * esté aprobado o archivado. Actualizar las fechas es lo que apaga el aviso de
 * vencimiento en la bandeja de Prevención; darlo de baja lo saca del control de
 * inspecciones y lo deja contado como fuera de servicio.
 */

const RESOURCE_STATUSES = Object.keys(EMERGENCY_RESOURCE_STATUS_LABELS)

function EditResourceDialog({ resource }: { resource: ResourceInfo }) {
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState(resource.status)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const optional = (key: string) => String(form.get(key) ?? "").trim() || null
    operation.run(() => updateEmergencyResourceAction({
      resourceId: resource.id,
      name: form.get("name"),
      kind: form.get("kind"),
      location: form.get("location"),
      serialNumber: optional("serialNumber"),
      lastInspectedAt: optional("lastInspectedAt"),
      nextInspectionAt: optional("nextInspectionAt"),
      expiresAt: optional("expiresAt"),
      status,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Editar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar {resource.name}</DialogTitle>
            <DialogDescription>
              Registra la recarga, la inspección o la baja del equipo. Actualizar las fechas retira el aviso de vencimiento.
            </DialogDescription>
          </DialogHeader>
          <Field label="Nombre"><Input name="name" required minLength={2} maxLength={200} defaultValue={resource.name} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo"><Input name="kind" required minLength={2} maxLength={120} defaultValue={resource.kind} /></Field>
            <Field label="Ubicación"><Input name="location" required minLength={2} maxLength={300} defaultValue={resource.location} /></Field>
          </div>
          <Field label="Número de serie" hint="Opcional."><Input name="serialNumber" maxLength={120} defaultValue={resource.serialNumber ?? ""} /></Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Última inspección" hint="Opcional."><DatePicker name="lastInspectedAt" defaultValue={resource.lastInspectedAt ?? ""} /></Field>
            <Field label="Próxima inspección" hint="Opcional."><DatePicker name="nextInspectionAt" defaultValue={resource.nextInspectionAt ?? ""} /></Field>
            <Field label="Vencimiento" hint="Carga o caducidad."><DatePicker name="expiresAt" defaultValue={resource.expiresAt ?? ""} /></Field>
          </div>
          <Field label="Estado" hint="Fuera de servicio da de baja el equipo.">
            <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RESOURCE_STATUSES.map((value) => <SelectItem key={value} value={value}>{EMERGENCY_RESOURCE_STATUS_LABELS[value]}</SelectItem>)}</SelectContent></Select>
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Acreditación PDTP de los simulacros ──────────────────────────────────────
 * `pdtpActivityNumbers` del plan no tenía escritor: `completeEmergencyDrill` lo
 * leía, encontraba vacío y salía sin acreditar, así que ningún simulacro cerró
 * jamás la N°84 del programa anual. Mismo cableado y mismo formulario que el
 * catálogo de inspecciones (EMERGENCIAS-05).
 */

function PdtpActivitiesDialog({ planId, code, version, current, options }: {
  planId: string
  code: string
  version: number
  current: string[]
  options: PdtpActivityPickerOption[]
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const [selected, setSelected] = React.useState(current)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(
      () => setEmergencyPlanPdtpActivitiesAction({ planId, expectedVersion: version, pdtpActivityNumbers: [], catalogActivityIds: selected }),
      () => setOpen(false),
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setSelected(current) }}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Acreditación PDTP</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Acreditación PDTP · {code}</DialogTitle>
            <DialogDescription>
              Actividades corporativas que acredita cada simulacro completado de este plan.
            </DialogDescription>
          </DialogHeader>
          <PdtpActivityPicker multiple label="Actividades que acredita" options={options} value={selected} onChange={setSelected} />
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Archivo del plan ─────────────────────────────────────────────────────────
 * Sólo un plan no archivado por faena: archivar el vigente es lo que habilita
 * emitir el siguiente, y también la vía para cambiar un plan ya aprobado.
 */

function ArchivePlanDialog({ planId, code, version }: { planId: string; code: string; version: number }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => archiveEmergencyPlanAction({
      planId,
      expectedVersion: version,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Archivar plan</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Archivar {code}</DialogTitle>
            <DialogDescription>
              El plan deja de estar vigente y la faena queda libre para emitir el siguiente. El inventario de equipos se conserva.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" htmlFor="archive-plan-reason" hint="Mínimo 10 caracteres.">
            <Textarea id="archive-plan-reason" name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Archivar</Button></DialogFooter>
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
            <Select value={scenarioType} onValueChange={setScenarioType}><SelectTrigger><SelectValue placeholder="Selecciona un tipo" /></SelectTrigger><SelectContent>{SCENARIO_TYPES.map((t) => <SelectItem key={t} value={t}>{emergencyScenarioTypeLabel(t)}</SelectItem>)}</SelectContent></Select><input type="hidden" name="scenarioType" value={scenarioType} />
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

function CompleteDrillDialog({ drill, assignees }: {
  drill: DrillInfo
  assignees: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [executedAt, setExecutedAt] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [outcome, setOutcome] = React.useState<"" | "satisfactory" | "needs_improvement">("")
  const [responsibleUserId, setResponsibleUserId] = React.useState("_none")
  const operation = useOperation()

  /* El gate era el checklist de dotación; pasó a ser el acta. La cuenta local
   * incluye los archivos elegidos, que se suben antes de cerrar. */
  const readiness = React.useMemo(() => assessDrillCompletion({
    activeEvidenceCount: drill.activeEvidenceCount + files.length,
    evacuationSeconds: null,
    outcome: outcome || null,
  }), [drill.activeEvidenceCount, files, outcome])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const durationMinutes = String(form.get("durationMinutes") ?? "").trim()
    const evacuationSeconds = String(form.get("evacuationSeconds") ?? "").trim()
    const observations = String(form.get("observations") ?? "").trim()
    const responsibleUserId = String(form.get("responsibleUserId") ?? "").trim()
    const targetDate = String(form.get("targetDate") ?? "").trim()
    operation.run(async () => {
      /* La evidencia se sube antes de cerrar: el servicio exige al menos una
       * activa, y subirla después dejaría el simulacro cerrado sin acta. */
      for (const file of files) {
        const upload = new FormData()
        upload.set("drillId", drill.id)
        upload.set("file", file)
        const response = await fetch("/api/prevencion/emergencias/simulacros/evidencia", { method: "POST", body: upload })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string }
          return { ok: false as const, message: payload.error ?? "No se pudo subir una evidencia." }
        }
      }
      return completeEmergencyDrillAction({
        drillId: drill.id,
        expectedVersion: drill.version,
        executedAt: new Date(executedAt).toISOString(),
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        evacuationSeconds: evacuationSeconds ? Number(evacuationSeconds) : null,
        observations: observations || null,
        outcome: outcome || null,
        responsibleUserId: responsibleUserId || null,
        targetDate: targetDate || null,
      })
    }, () => setOpen(false))
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

          {/* Acotado entre la fecha programada y ahora, que es lo mismo que
              valida el servicio: no ofrecer una fecha que va a rechazar. */}
          <Field label="Realizado el" hint="Entre la fecha programada y ahora.">
            <Input
              type="datetime-local" required value={executedAt}
              min={toLocalInputValue(new Date(drill.scheduledFor))}
              max={toLocalInputValue(new Date())}
              onChange={(event) => setExecutedAt(event.target.value)}
            />
          </Field>

          <Field
            label="Evidencia"
            required={drill.activeEvidenceCount === 0}
            hint="Acta, registro fotográfico o informe del simulacro. Máximo 25 MB por archivo."
          >
            <FileInput
              multiple
              accept=".pdf,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png"
              onFilesChange={setFiles}
              disabled={operation.pending}
            />
          </Field>
          {drill.activeEvidenceCount > 0 && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Este simulacro ya tiene {drill.activeEvidenceCount} evidencia(s) adjunta(s).
            </p>
          )}

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

/* ── Cancelación de simulacro ─────────────────────────────────────────────────
 * Reprogramar es cancelar con motivo y volver a programar: mover la fecha en su
 * lugar borraría que el simulacro anterior no se realizó.
 */

function CancelDrillDialog({ drill }: { drill: DrillInfo }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => cancelEmergencyDrillAction({
      drillId: drill.id,
      expectedVersion: drill.version,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Cancelar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Cancelar simulacro</DialogTitle>
            <DialogDescription>
              El simulacro queda cancelado con su motivo, no se borra. Para reprogramarlo, cancélalo y programa uno nuevo.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" htmlFor="cancel-drill-reason" hint="Mínimo 10 caracteres.">
            <Textarea id="cancel-drill-reason" name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Cancelar simulacro</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
