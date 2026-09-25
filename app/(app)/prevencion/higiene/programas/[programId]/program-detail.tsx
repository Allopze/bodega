"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
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
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"

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
  workerId: string
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
  // Personas, no filas: cada control asistido abre el ciclo siguiente, así que
  // una persona controlada aparece dos veces en la tabla (el ciclo cerrado y el
  // que viene).
  const enrolledPeople = new Set(enrollments.map((item) => item.workerId)).size

  const facts = [
    { label: "Protocolo", value: program.protocol },
    { label: "Periodicidad", value: `${program.periodicityMonths} meses` },
    { label: "Estado", value: PROGRAM_STATUS_LABELS[program.status] ?? program.status },
    { label: "Matriculados", value: String(enrolledPeople) },
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
          <h2 className="text-sm font-semibold">Ciclos de control ({enrollments.length})</h2>
          {canManage && program.status === "active" && eligibleGroups.length > 0 && (
            <EnrollGroupDialog programId={program.id} eligibleGroups={eligibleGroups} />
          )}
        </div>
        {enrollments.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
            Sin matrículas. Matricular un grupo deriva su nómina completa desde el GES; después, cada control asistido abre solo el ciclo siguiente.
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
                      <MetaBadge meta={{ label: SURVEILLANCE_STATUS_LABELS[item.status] ?? item.status, variant: statusBadgeVariant(item.status) }} />
                      {(item.status === "absent" || item.status === "exempt") && item.absenceReason && (
                        <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">{item.absenceReason}</span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {(item.status === "pending" || item.status === "summoned") && <OutcomeDialog enrollment={item} periodicityMonths={program.periodicityMonths} />}
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
    <Dialog open={open} onOpenChange={(value) => { if (value) { setDefaultValue(todayInChile()); setGroupId(eligibleGroups[0]?.id ?? "") } setOpen(value) }}>
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

function OutcomeDialog({ enrollment, periodicityMonths }: { enrollment: EnrollmentInfo; periodicityMonths: number }) {
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
      absenceReason: status === "absent" || status === "exempt" ? absenceReason || null : null,
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
          {status === "attended" && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Al guardar se abre el ciclo siguiente de esta persona, con vencimiento a {periodicityMonths} meses de la fecha del control, mientras siga en el grupo de exposición.
            </p>
          )}
          {status === "absent" && (
            <Field label="Motivo" hint="Mínimo 5 caracteres.">
              <Textarea name="absenceReason" required minLength={5} maxLength={1000} />
            </Field>
          )}
          {status === "exempt" && (
            <>
              <Field
                label="Motivo de la exención"
                required
                hint={`Obligatorio: la persona sale del padrón de expuestos del programa anual hasta el ciclo siguiente. Mínimo ${REASON_MIN_LENGTH} caracteres. No escribas el diagnóstico: este motivo se muestra en la tabla y se copia al registro de auditoría — el dato clínico va sólo en el registro de salud cifrado.`}
              >
                <Textarea name="absenceReason" required minLength={REASON_MIN_LENGTH} maxLength={REASON_MAX_LENGTH} />
              </Field>
              <p className="text-xs text-[var(--color-text-subtle)]">
                Al guardar se abre también el ciclo siguiente de esta persona, a {periodicityMonths} meses del vencimiento actual: la exención acota sólo este ciclo, no la deja fuera del padrón para siempre.
              </p>
            </>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
