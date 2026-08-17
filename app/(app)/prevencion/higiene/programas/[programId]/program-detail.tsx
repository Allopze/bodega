"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PROGRAM_STATUS_LABELS, SURVEILLANCE_STATUS_LABELS } from "@/lib/prevention/hygiene"
import { enrollGroupInSurveillanceAction, recordSurveillanceOutcomeAction } from "../../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { todayInChile } from "@/lib/utils"

interface ProgramInfo {
  id: string
  code: string
  name: string
  protocol: string
  periodicityMonths: number
  legalBasis: string
  status: string
}

interface EnrollmentInfo {
  id: string
  workerName: string
  groupName: string | null
  enrolledOn: string
  dueOn: string
  status: string
  attendedOn: string | null
  absenceReason: string | null
}

interface GroupOption {
  id: string
  name: string
  memberCount: number
}

function statusBadgeVariant(status: string): "default" | "warning" | "success" | "danger" | "outline" {
  if (status === "attended") return "success"
  if (status === "absent") return "danger"
  if (status === "summoned") return "warning"
  if (status === "exempt") return "outline"
  return "default"
}

export function ProgramDetail({ program, enrollments, eligibleGroups, canManage }: {
  program: ProgramInfo
  enrollments: EnrollmentInfo[]
  eligibleGroups: GroupOption[]
  canManage: boolean
}) {
  const overdue = enrollments.filter((item) => ["pending", "summoned"].includes(item.status) && item.dueOn < todayInChile()).length

  const facts = [
    { label: "Protocolo", value: program.protocol },
    { label: "Periodicidad", value: `${program.periodicityMonths} meses` },
    { label: "Estado", value: PROGRAM_STATUS_LABELS[program.status] ?? program.status },
    { label: "Matriculados", value: String(enrollments.length) },
    { label: "Vencidos", value: String(overdue) },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-5">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm">{program.legalBasis}</p>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Matrículas ({enrollments.length})</h2>
          {canManage && program.status === "active" && eligibleGroups.length > 0 && (
            <EnrollGroupDialog programId={program.id} eligibleGroups={eligibleGroups} />
          )}
        </div>
        {enrollments.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
            Sin matrículas. Matricular un grupo deriva su nómina completa desde el GES.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>GES de origen</TableHead>
                  <TableHead>Matriculado</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  {canManage && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">{item.workerName}</TableCell>
                    <TableCell className="text-sm">{item.groupName ?? "—"}</TableCell>
                    <TableCell className="text-sm tabular-nums">{item.enrolledOn}</TableCell>
                    <TableCell className="text-sm tabular-nums">{item.dueOn}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(item.status)}>{SURVEILLANCE_STATUS_LABELS[item.status] ?? item.status}</Badge>
                      {item.status === "absent" && item.absenceReason && (
                        <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">{item.absenceReason}</span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {(item.status === "pending" || item.status === "summoned") && <OutcomeDialog enrollment={item} />}
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

/* ── Matricular grupo ─────────────────────────────────────────────────────── */

function EnrollGroupDialog({ programId, eligibleGroups }: { programId: string; eligibleGroups: GroupOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const [groupId, setGroupId] = React.useState(eligibleGroups[0]?.id ?? "")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const startingOn = String(form.get("startingOn") ?? "").trim()
    operation.run(() => enrollGroupInSurveillanceAction({
      programId,
      groupId: form.get("groupId"),
      startingOn: startingOn || undefined,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultValue(todayInChile()); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm">Matricular grupo</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Matricular grupo de exposición</DialogTitle>
            <DialogDescription>Matricula a todas las personas activas del grupo. La próxima fecha se calcula desde la periodicidad del programa.</DialogDescription>
          </DialogHeader>
          <Field label="Grupo de exposición">
            <Select value={groupId} onValueChange={setGroupId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{eligibleGroups.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} ({item.memberCount} personas)</SelectItem>)}</SelectContent></Select><input type="hidden" name="groupId" value={groupId} />
          </Field>
          <Field label="Desde" hint="Opcional. Por defecto, hoy."><DatePicker name="startingOn" defaultValue={defaultValue} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Matricular</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Registro de resultado ────────────────────────────────────────────────── */

type SurveillanceOutcomeStatus = "summoned" | "attended" | "absent" | "exempt"

const OUTCOME_OPTIONS: { value: SurveillanceOutcomeStatus; label: string }[] = [
  { value: "summoned", label: "Citado" },
  { value: "attended", label: "Asistió" },
  { value: "absent", label: "Ausente" },
  { value: "exempt", label: "Exento" },
]

function OutcomeDialog({ enrollment }: { enrollment: EnrollmentInfo }) {
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<SurveillanceOutcomeStatus>("summoned")
  const operation = useOperation()
  const defaultAttendedOn = React.useMemo(() => todayInChile(), [])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const attendedOn = String(form.get("attendedOn") ?? "").trim()
    const healthRecordId = String(form.get("healthRecordId") ?? "").trim()
    const absenceReason = String(form.get("absenceReason") ?? "").trim()
    operation.run(() => recordSurveillanceOutcomeAction({
      enrollmentId: enrollment.id,
      status,
      attendedOn: status === "attended" ? attendedOn || null : null,
      healthRecordId: healthRecordId || null,
      absenceReason: status === "absent" ? absenceReason || null : null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Registrar resultado</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registrar resultado</DialogTitle>
            <DialogDescription>{enrollment.workerName} · vence {enrollment.dueOn}</DialogDescription>
          </DialogHeader>
          <Field label="Resultado">
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{OUTCOME_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}</SelectContent></Select>
          </Field>
          {status === "attended" && (
            <>
              <Field label="Fecha del control" required><DatePicker name="attendedOn" defaultValue={defaultAttendedOn} /></Field>
              <Field label="ID del registro de salud" hint="Opcional. El resultado clínico vive en el dominio cifrado, no aquí.">
                <Input name="healthRecordId" />
              </Field>
            </>
          )}
          {status === "absent" && (
            <Field label="Motivo" hint="Mínimo 5 caracteres.">
              <Textarea name="absenceReason" required minLength={5} maxLength={1000} />
            </Field>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
