"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  assessQuorum,
  COMMITTEE_MEETING_STATUS_LABELS,
  COMMITTEE_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  MEMBER_ROLE_LABELS,
  MEMBER_STATUS_LABELS,
  REPRESENTATION_LABELS,
  SEAT_LABELS,
} from "@/lib/prevention/cphs"
import { formatDateTime } from "@/lib/utils"
import {
  addCommitteeMemberAction,
  closeCommitteeMeetingAction,
  scheduleCommitteeMeetingAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { toLocalInputValue } from "@/lib/utils"

interface CommitteeInfo {
  id: string
  name: string
  status: string
  constitutedOn: string
  mandateEndsOn: string
  meetingDayOfMonth: number | null
  version: number
}

interface ParityInfo {
  valid: boolean
  issues: { kind: string; detail: string }[]
}

interface CadenceInfo {
  monthsWithoutMeeting: number
  overdue: boolean
}

interface MemberInfo {
  id: string
  workerName: string
  representation: string
  seat: string
  role: string | null
  status: string
  hasFuero: boolean
  electedOn: string | null
  termEndsOn: string | null
}

interface MeetingInfo {
  id: string
  code: string
  meetingType: string
  scheduledFor: string
  agenda: string
  status: string
  quorumReached: boolean
  convened: number
  attended: number
  agreements: number
  version: number
}

interface WorkerOption {
  id: string
  name: string
  position: string | null
}

interface Props {
  committee: CommitteeInfo
  worksiteName: string
  parity: ParityInfo
  mandateExpired: boolean
  cadence: CadenceInfo
  members: MemberInfo[]
  meetings: MeetingInfo[]
  eligibleWorkers: WorkerOption[]
  assignees: { id: string; name: string }[]
  canManage: boolean
}

export function CommitteeDetail({
  committee, worksiteName, parity, mandateExpired, cadence, members, meetings, eligibleWorkers, assignees, canManage,
}: Props) {
  const active = committee.status === "active" && !mandateExpired
  const activeMembers = members.filter((item) => item.status === "active")

  const facts = [
    { label: "Estado", value: COMMITTEE_STATUS_LABELS[mandateExpired ? "expired" : committee.status] ?? committee.status },
    { label: "Faena", value: worksiteName },
    { label: "Constituido", value: committee.constitutedOn },
    { label: "Mandato hasta", value: committee.mandateEndsOn },
    { label: "Día de sesión", value: committee.meetingDayOfMonth ? `Día ${committee.meetingDayOfMonth} de cada mes` : "Sin declarar" },
    { label: "Cadencia", value: cadence.overdue ? "Sin sesionar (2+ meses)" : "Al día" },
  ]

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

      {!parity.valid && (
        <div className="rounded-md border border-[var(--color-warning-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">El comité no cumple los requisitos de validez:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {parity.issues.map((issue, index) => <li key={index}>{issue.detail}</li>)}
          </ul>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Integrantes ({activeMembers.length} activos)</h2>
          {canManage && active && eligibleWorkers.length > 0 && (
            <AddMemberDialog committeeId={committee.id} eligibleWorkers={eligibleWorkers} existingMemberNames={activeMembers.map((m) => m.workerName)} />
          )}
        </div>
        {members.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin integrantes incorporados.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Representación</TableHead>
                  <TableHead>Asiento</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Fuero</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="text-sm">{member.workerName}</TableCell>
                    <TableCell className="text-sm">{REPRESENTATION_LABELS[member.representation] ?? member.representation}</TableCell>
                    <TableCell className="text-sm">{SEAT_LABELS[member.seat] ?? member.seat}</TableCell>
                    <TableCell className="text-sm">{member.role ? MEMBER_ROLE_LABELS[member.role] ?? member.role : "—"}</TableCell>
                    <TableCell className="text-sm">{member.hasFuero ? "Sí" : "No"}</TableCell>
                    <TableCell className="text-sm">
                      <Badge variant={member.status === "active" ? "success" : "outline"}>{MEMBER_STATUS_LABELS[member.status] ?? member.status}</Badge>
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
          <h2 className="text-sm font-semibold">Sesiones ({meetings.length})</h2>
          {canManage && active && <ScheduleMeetingDialog committeeId={committee.id} />}
        </div>
        {meetings.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin sesiones convocadas.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Convocada</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Asistencia</TableHead>
                  <TableHead className="text-right">Acuerdos</TableHead>
                  {canManage && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.map((meeting) => (
                  <TableRow key={meeting.id}>
                    <TableCell>
                      <span className="font-mono text-xs">{meeting.code}</span>
                      <span className="block max-w-xs text-xs text-[var(--color-text-subtle)]">{meeting.agenda}</span>
                    </TableCell>
                    <TableCell className="text-sm">{MEETING_TYPE_LABELS[meeting.meetingType] ?? meeting.meetingType}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDateTime(meeting.scheduledFor)}</TableCell>
                    <TableCell>
                      <Badge variant={meeting.status === "closed" ? "success" : meeting.status === "cancelled" ? "outline" : "default"}>
                        {COMMITTEE_MEETING_STATUS_LABELS[meeting.status] ?? meeting.status}
                      </Badge>
                      {meeting.status === "closed" && !meeting.quorumReached && (
                        <span className="block text-xs text-[var(--color-text-subtle)]">Sin quórum</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{meeting.attended} / {meeting.convened}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{meeting.agreements}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {(meeting.status === "scheduled" || meeting.status === "held") && (
                          <CloseMeetingDialog meeting={meeting} members={activeMembers} assignees={assignees} />
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

/* ── Alta de integrante ───────────────────────────────────────────────────── */

function AddMemberDialog({ committeeId, eligibleWorkers, existingMemberNames }: {
  committeeId: string
  eligibleWorkers: WorkerOption[]
  existingMemberNames: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const [workerId, setWorkerId] = React.useState(eligibleWorkers[0]?.id ?? "")
  const [representation, setRepresentation] = React.useState("company")
  const [seat, setSeat] = React.useState("titular")
  const [role, setRole] = React.useState("")
  const operation = useOperation()
  const existing = new Set(existingMemberNames)
  const available = eligibleWorkers.filter((worker) => !existing.has(worker.name))

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const role = String(form.get("role") ?? "").trim()
    const electedOn = String(form.get("electedOn") ?? "").trim()
    const termEndsOn = String(form.get("termEndsOn") ?? "").trim()
    operation.run(() => addCommitteeMemberAction({
      committeeId,
      workerId: form.get("workerId"),
      representation: form.get("representation"),
      seat: form.get("seat"),
      role: role || null,
      electedOn: electedOn || null,
      termEndsOn: termEndsOn || null,
      hasFuero: form.get("hasFuero") === "on",
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Agregar integrante</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar integrante</DialogTitle>
            <DialogDescription>Debe pertenecer al mismo centro de trabajo del comité.</DialogDescription>
          </DialogHeader>
          {available.length === 0 ? (
            <p className="text-sm text-[var(--color-text-subtle)]">Toda la dotación elegible ya integra el comité.</p>
          ) : (
            <>
              <Field label="Persona">
                <Select value={workerId} onValueChange={setWorkerId}><SelectTrigger><SelectValue placeholder="Selecciona persona" /></SelectTrigger><SelectContent>{available.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.name}{worker.position ? ` · ${worker.position}` : ""}</SelectItem>)}</SelectContent></Select><input type="hidden" name="workerId" value={workerId} />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Representación">
                  <Select value={representation} onValueChange={setRepresentation}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="company">Empresa</SelectItem><SelectItem value="workers">Personas trabajadoras</SelectItem></SelectContent></Select><input type="hidden" name="representation" value={representation} />
                </Field>
                <Field label="Asiento">
                  <Select value={seat} onValueChange={setSeat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="titular">Titular</SelectItem><SelectItem value="suplente">Suplente</SelectItem></SelectContent></Select><input type="hidden" name="seat" value={seat} />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Cargo" hint="Opcional.">
                  <Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue placeholder="Integrante" /></SelectTrigger><SelectContent><SelectItem value="_none">Integrante</SelectItem><SelectItem value="presidente">Presidente</SelectItem><SelectItem value="secretario">Secretario</SelectItem></SelectContent></Select><input type="hidden" name="role" value={role === "_none" ? "" : role} />
                </Field>
                <label className="mt-6 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="hasFuero" /> Tiene fuero sindical
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Electo el" hint="Opcional."><Input name="electedOn" type="date" /></Field>
                <Field label="Término del período" hint="Opcional."><Input name="termEndsOn" type="date" /></Field>
              </div>
            </>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || available.length === 0}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Convocatoria de sesión ───────────────────────────────────────────────── */

function ScheduleMeetingDialog({ committeeId }: { committeeId: string }) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const [meetingType, setMeetingType] = React.useState("ordinary")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => scheduleCommitteeMeetingAction({
      committeeId,
      meetingType: form.get("meetingType"),
      scheduledFor: new Date(String(form.get("scheduledFor"))).toISOString(),
      agenda: form.get("agenda"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultValue(toLocalInputValue(new Date())); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm">Convocar sesión</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Convocar sesión</DialogTitle>
            <DialogDescription>Convoca a todos los integrantes activos. La asistencia se marca al cerrar el acta.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo">
              <Select value={meetingType} onValueChange={setMeetingType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ordinary">Ordinaria</SelectItem><SelectItem value="extraordinary">Extraordinaria</SelectItem></SelectContent></Select><input type="hidden" name="meetingType" value={meetingType} />
            </Field>
            <Field label="Fecha y hora"><Input name="scheduledFor" type="datetime-local" required defaultValue={defaultValue} /></Field>
          </div>
          <Field label="Tabla / agenda" hint="Mínimo 10 caracteres."><Textarea name="agenda" required minLength={10} maxLength={5000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Convocar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cierre de acta ───────────────────────────────────────────────────────── */

interface AgreementDraft {
  description: string
  actionDescription: string
  responsibleUserId: string
  priority: "low" | "medium" | "high" | "critical"
  targetDate: string
}

function CloseMeetingDialog({ meeting, members, assignees }: {
  meeting: MeetingInfo
  members: MemberInfo[]
  assignees: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [heldAt, setHeldAt] = React.useState("")
  const [attended, setAttended] = React.useState<Set<string>>(new Set())
  const [excuses, setExcuses] = React.useState<Record<string, string>>({})
  const [agreements, setAgreements] = React.useState<AgreementDraft[]>([])
  const operation = useOperation()

  // Aquí no hay `id` de integrante disponible por fuera de `members`, así que la
  // vista previa de quórum usa exactamente los mismos datos que verá el
  // servicio: mismo criterio, sin duplicar la regla en el cliente.
  const quorum = React.useMemo(() => assessQuorum({
    members: members.map((item) => ({ id: item.id, representation: item.representation, seat: item.seat, role: item.role, status: item.status })),
    attendedMemberIds: [...attended],
  }), [members, attended])

  function toggleAttended(memberId: string, checked: boolean) {
    setAttended((current) => {
      const next = new Set(current)
      if (checked) next.add(memberId); else next.delete(memberId)
      return next
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => closeCommitteeMeetingAction({
      meetingId: meeting.id,
      expectedVersion: meeting.version,
      heldAt: new Date(heldAt).toISOString(),
      minutes: form.get("minutes"),
      attendedMemberIds: [...attended],
      excuses: Object.entries(excuses).filter(([, reason]) => reason.trim()).map(([memberId, reason]) => ({ memberId, reason })),
      agreements: agreements.filter((item) => item.description.trim()).map((item) => ({
        description: item.description,
        actionDescription: item.actionDescription,
        responsibleUserId: item.responsibleUserId || null,
        priority: item.priority,
        targetDate: item.targetDate,
      })),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setHeldAt(toLocalInputValue(new Date())); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Cerrar acta</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cerrar acta {meeting.code}</DialogTitle>
            <DialogDescription>
              Sin quórum el cierre se rechaza: un suplente presente cubre a un titular ausente de su misma representación.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm">
            Quórum: <strong>{quorum.effective} de {quorum.required} requeridos</strong>
            {" "}{quorum.reached ? <Badge variant="success">Alcanzado</Badge> : <Badge variant="warning">No alcanzado</Badge>}
          </p>

          <Field label="Realizada el"><Input type="datetime-local" required value={heldAt} onChange={(event) => setHeldAt(event.target.value)} /></Field>

          <div className="space-y-2">
            <span className="text-sm font-medium">Asistencia</span>
            <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border)]">
              {members.map((member) => (
                <div key={member.id} className="border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-b-0">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={attended.has(member.id)} onChange={(event) => toggleAttended(member.id, event.target.checked)} />
                    <span className="flex-1">
                      {member.workerName}
                      <span className="ml-2 text-xs text-[var(--color-text-subtle)]">
                        {REPRESENTATION_LABELS[member.representation] ?? member.representation} · {SEAT_LABELS[member.seat] ?? member.seat}
                      </span>
                    </span>
                  </label>
                  {!attended.has(member.id) && (
                    <Input
                      className="mt-1"
                      placeholder="Motivo de inasistencia (opcional)"
                      value={excuses[member.id] ?? ""}
                      onChange={(event) => setExcuses((current) => ({ ...current, [member.id]: event.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <Field label="Acta" hint="Mínimo 20 caracteres.">
            <Textarea name="minutes" required minLength={20} maxLength={20_000} />
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Acuerdos</span>
              <Button
                type="button" variant="secondary" size="sm"
                onClick={() => setAgreements((current) => [...current, { description: "", actionDescription: "", responsibleUserId: "", priority: "medium", targetDate: "" }])}
              >
                Agregar acuerdo
              </Button>
            </div>
            {agreements.map((item, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Acuerdo {index + 1}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAgreements((current) => current.filter((_, i) => i !== index))}>Quitar</Button>
                </div>
                <Field label="Descripción" hint="Mínimo 5 caracteres.">
                  <Textarea value={item.description} required minLength={5} maxLength={3000}
                    onChange={(event) => setAgreements((current) => current.map((a, i) => i === index ? { ...a, description: event.target.value } : a))} />
                </Field>
                <Field label="Acción" hint="Mínimo 3 caracteres.">
                  <Textarea value={item.actionDescription} required minLength={3} maxLength={3000}
                    onChange={(event) => setAgreements((current) => current.map((a, i) => i === index ? { ...a, actionDescription: event.target.value } : a))} />
                </Field>
                <div className="grid gap-2 md:grid-cols-3">
                  <Field label="Responsable" hint="Opcional.">
                    <Select value={item.responsibleUserId} onValueChange={(v) => setAgreements((current) => current.map((a, i) => i === index ? { ...a, responsibleUserId: v === "_none" ? "" : v } : a))}><SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin asignar</SelectItem>{assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
                  </Field>
                  <Field label="Prioridad">
                    <Select value={item.priority} onValueChange={(v) => setAgreements((current) => current.map((a, i) => i === index ? { ...a, priority: v as AgreementDraft["priority"] } : a))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baja</SelectItem><SelectItem value="medium">Media</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem></SelectContent></Select>
                  </Field>
                  <Field label="Plazo">
                    <Input type="date" required value={item.targetDate}
                      onChange={(event) => setAgreements((current) => current.map((a, i) => i === index ? { ...a, targetDate: event.target.value } : a))} />
                  </Field>
                </div>
              </div>
            ))}
          </div>

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !quorum.reached}>Cerrar acta</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
