"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ClipboardText } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  COMMITTEE_PROGRAM_STATUS_LABELS,
  PROGRAM_ACTIVITY_DERIVED_LABELS,
  PROGRAM_RISK_TOPIC_LABELS,
  deriveProgramActivityStatus,
  monthLabel,
  type ProgramComplianceSummary,
} from "@/lib/prevention/cphs-program"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  activateProgramAction,
  addProgramActivityAction,
  cancelProgramActivityAction,
  completeProgramActivityAction,
  createProgramAction,
  linkActivityToMeetingAction,
} from "../../actions"

interface ActivityItem {
  id: string
  title: string
  description: string | null
  plannedMonth: number
  dueOn: string | null
  status: string
  riskTopic: string | null
  responsibleName: string | null
  commissionLabel: string | null
  completionNote: string | null
  reviewedInMeetingId: string | null
  version: number
}

interface SelectedProgram {
  id: string
  year: number
  status: string
  version: number
  summary: ProgramComplianceSummary
  asOf: string
  activities: ActivityItem[]
}

interface Props {
  committeeId: string
  committeeActive: boolean
  programs: { id: string; year: number; status: string; version: number }[]
  selected: SelectedProgram | null | undefined
  members: { id: string; name: string }[]
  meetings: { id: string; code: string; scheduledFor: string }[]
  canManage: boolean
}

const DERIVED_BADGE: Record<string, "success" | "danger" | "outline" | "default"> = {
  done: "success",
  overdue: "danger",
  cancelled: "outline",
  pending: "default",
}

type ActivityFilter = "all" | "done" | "overdue" | "due"

export function ProgramHeaderActions({ committeeId, committeeActive, selected, members }: {
  committeeId: string
  committeeActive: boolean
  selected: SelectedProgram | null | undefined
  members: { id: string; name: string }[]
}) {
  if (!committeeActive) return null
  return (
    <>
      <NewProgramDialog committeeId={committeeId} />
      {selected && selected.status !== "closed" && (
        <NewActivityDialog programId={selected.id} members={members} />
      )}
      {selected?.status === "draft" && selected.activities.length > 0 && (
        <ActivateProgramButton programId={selected.id} version={selected.version} />
      )}
    </>
  )
}

export function ProgramPanel({ committeeId, committeeActive, programs, selected, members, meetings, canManage }: Props) {
  const router = useRouter()
  const [activityFilter, setActivityFilter] = React.useState<ActivityFilter>("all")

  if (programs.length === 0 || !selected) {
    return (
      <EmptyState
        icon={<ClipboardText size={24} />}
        title="El comité aún no tiene programa de trabajo"
        description="El programa reúne las actividades del comité mes a mes, con responsable, plazo y evidencia. Es el reemplazo de las actividades N°12, N°13 y N°14 que salieron del PDTP."
        action={canManage && committeeActive ? <NewProgramDialog committeeId={committeeId} /> : undefined}
      />
    )
  }

  const summary = selected.summary
  const metrics = [
    { id: "total", filter: "all" as const, label: "Actividades", value: summary.total, detail: `Año ${selected.year}` },
    { id: "done", filter: "done" as const, label: "Realizadas", value: summary.done === 0 ? "Por iniciar" : summary.done, detail: summary.done === 0 ? "Registra la primera ejecución" : "Con evidencia registrada" },
    { id: "overdue", filter: "overdue" as const, label: "Atrasadas", value: summary.overdue === 0 ? "Al día" : summary.overdue, detail: summary.overdue === 0 ? "Sin actividades vencidas" : "Su plazo ya venció" },
    {
      id: "compliance",
      filter: "due" as const,
      label: "Cumplimiento",
      value: summary.compliancePct === null ? "Sin vencimientos" : `${summary.compliancePct}%`,
      detail: summary.compliancePct === null ? "Revisa lo planificado" : `Sobre ${summary.due} exigible(s)`,
    },
  ]
  const activityRows = selected.activities.map((activity) => ({
    activity,
    derived: deriveProgramActivityStatus(activity, selected.year, selected.asOf),
  }))
  const filteredActivities = activityRows.filter(({ derived }) => {
    if (activityFilter === "all") return true
    if (activityFilter === "due") return derived === "done" || derived === "overdue"
    return derived === activityFilter
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            aria-pressed={activityFilter === metric.filter}
            onClick={() => setActivityFilter(metric.filter)}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-surface-2)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          aria-label="Año del programa"
          value={selected.id}
          onValueChange={(value) => router.push(`/prevencion/cphs/${committeeId}/programa?programa=${value}`)}
          options={programs.map((program) => ({ value: program.id, label: `Programa ${program.year}` }))}
          className="w-48"
        />
        <Badge variant={selected.status === "active" ? "success" : selected.status === "closed" ? "outline" : "default"}>
          {COMMITTEE_PROGRAM_STATUS_LABELS[selected.status] ?? selected.status}
        </Badge>
      </div>

      {selected.activities.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={24} />}
          title="El programa no tiene actividades"
          description="Agrega las actividades que el comité se compromete a ejecutar cada mes. Sin al menos una, el programa no puede aprobarse."
          action={canManage && committeeActive ? <NewActivityDialog programId={selected.id} members={members} /> : undefined}
          compact
        />
      ) : filteredActivities.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={24} />}
          title="No hay actividades en este filtro"
          description="Prueba otra métrica o vuelve a mostrar el programa completo."
          action={<Button size="sm" variant="secondary" onClick={() => setActivityFilter("all")}>Ver todas</Button>}
          compact
        />
      ) : (
        <div id="program-activities" className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead>Actividad</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Riesgo</TableHead>
                <TableHead>Estado</TableHead>
                {canManage && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredActivities.map(({ activity, derived }) => {
                return (
                  <TableRow key={activity.id}>
                    <TableCell className="text-sm font-medium">{monthLabel(activity.plannedMonth)}</TableCell>
                    <TableCell>
                      <span className="text-sm">{activity.title}</span>
                      {activity.description && (
                        <span className="block max-w-md text-xs text-[var(--color-text-subtle)]">{activity.description}</span>
                      )}
                      {activity.dueOn && (
                        <span className="block text-xs text-[var(--color-text-subtle)]">Plazo {formatDate(activity.dueOn)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {activity.responsibleName ?? activity.commissionLabel ?? <span className="text-[var(--color-text-subtle)]">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {activity.riskTopic ? PROGRAM_RISK_TOPIC_LABELS[activity.riskTopic] ?? activity.riskTopic : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={DERIVED_BADGE[derived] ?? "default"}>
                        {PROGRAM_ACTIVITY_DERIVED_LABELS[derived] ?? derived}
                      </Badge>
                      {activity.completionNote && (
                        <span className="mt-1 block max-w-xs text-xs text-[var(--color-text-subtle)]">{activity.completionNote}</span>
                      )}
                      {activity.reviewedInMeetingId && (
                        <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">
                          Revisada en {meetings.find((meeting) => meeting.id === activity.reviewedInMeetingId)?.code ?? "sesión"}
                        </span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {activity.status === "planned" && (
                            <CompleteActivityDialog activity={activity} meetings={meetings} />
                          )}
                          {meetings.length > 0 && (
                            <LinkMeetingDialog activityId={activity.id} meetings={meetings} />
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ── Diálogos ─────────────────────────────────────────────────────────────── */

function NewProgramDialog({ committeeId }: { committeeId: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createProgramAction({
      committeeId,
      year: Number(form.get("year")),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Nuevo programa</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo programa de trabajo</DialogTitle>
            <DialogDescription>Un programa por año. Nace en preparación y se aprueba cuando tiene actividades.</DialogDescription>
          </DialogHeader>
          <Field label="Año">
            <Input name="year" type="number" min={2020} max={2100} required defaultValue={new Date().getFullYear()} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ActivateProgramButton({ programId, version }: { programId: string; version: number }) {
  const operation = useOperation()
  return (
    <Button
      size="sm"
      disabled={operation.pending}
      onClick={() => operation.run(() => activateProgramAction({ programId, expectedVersion: version }))}
    >
      Aprobar programa
    </Button>
  )
}

function NewActivityDialog({ programId, members }: { programId: string; members: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(String(new Date().getMonth() + 1))
  const [responsibleId, setResponsibleId] = React.useState("")
  const [riskTopic, setRiskTopic] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const dueOn = String(form.get("dueOn") ?? "").trim()
    const commission = String(form.get("commissionLabel") ?? "").trim()
    const description = String(form.get("description") ?? "").trim()
    operation.run(() => addProgramActivityAction({
      programId,
      title: form.get("title"),
      description: description || null,
      plannedMonth: Number(month),
      dueOn: dueOn || null,
      responsibleMemberId: responsibleId || null,
      commissionLabel: commission || null,
      riskTopic: riskTopic || null,
    }), () => { setOpen(false); setResponsibleId(""); setRiskTopic("") })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Agregar actividad</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar actividad al programa</DialogTitle>
            <DialogDescription>El mes planificado define el plazo si no indicas una fecha exacta.</DialogDescription>
          </DialogHeader>
          <Field label="Actividad" hint="Mínimo 5 caracteres.">
            <Input name="title" required minLength={5} maxLength={300} />
          </Field>
          <Field label="Detalle" hint="Opcional.">
            <Textarea name="description" maxLength={5000} rows={2} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Mes planificado">
              <OptionSelect
                name="plannedMonth"
                value={month}
                onValueChange={setMonth}
                options={Array.from({ length: 12 }, (_, index) => ({
                  value: String(index + 1),
                  label: monthLabel(index + 1),
                }))}
              />
            </Field>
            <Field label="Plazo exacto" hint="Opcional."><DatePicker name="dueOn" /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Responsable" hint="Integrante activo del comité.">
              <OptionSelect
                value={responsibleId}
                onValueChange={setResponsibleId}
                emptyLabel="Sin responsable"
                placeholder="Sin responsable"
                options={members.map((member) => ({ value: member.id, label: member.name }))}
              />
            </Field>
            <Field label="Comisión" hint="Si la ejecuta una comisión y no una persona.">
              <Input name="commissionLabel" maxLength={200} />
            </Field>
          </div>
          <Field label="Riesgo relacionado" hint="Opcional.">
            <OptionSelect
              value={riskTopic}
              onValueChange={setRiskTopic}
              emptyLabel="Sin relacionar"
              placeholder="Sin relacionar"
              options={Object.entries(PROGRAM_RISK_TOPIC_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CompleteActivityDialog({ activity, meetings }: {
  activity: ActivityItem
  meetings: { id: string; code: string; scheduledFor: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [meetingId, setMeetingId] = React.useState(activity.reviewedInMeetingId ?? "")
  const [mode, setMode] = React.useState<"complete" | "cancel">("complete")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const note = form.get("note")
    const evidence = String(form.get("evidenceReference") ?? "").trim()
    operation.run(() => mode === "complete"
      ? completeProgramActivityAction({
          activityId: activity.id,
          expectedVersion: activity.version,
          completionNote: note,
          evidenceReference: evidence || null,
          reviewedInMeetingId: meetingId || null,
        })
      : cancelProgramActivityAction({
          activityId: activity.id,
          expectedVersion: activity.version,
          reason: note,
        }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Cerrar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{activity.title}</DialogTitle>
            <DialogDescription>
              Marca la actividad como realizada con su evidencia, o cancélala dejando el motivo.
            </DialogDescription>
          </DialogHeader>
          <Field label="Resultado">
            <OptionSelect
              value={mode}
              onValueChange={(value) => setMode(value as "complete" | "cancel")}
              options={[
                { value: "complete", label: "Realizada" },
                { value: "cancel", label: "Cancelada" },
              ]}
            />
          </Field>
          <Field
            label={mode === "complete" ? "Qué se hizo" : "Motivo de la cancelación"}
            hint="Mínimo 10 caracteres."
          >
            <Textarea name="note" required minLength={10} maxLength={5000} rows={3} />
          </Field>
          {mode === "complete" && (
            <>
              <Field label="Evidencia" hint="Referencia al documento o registro que la respalda.">
                <Input name="evidenceReference" maxLength={500} />
              </Field>
              <Field label="Revisada en la sesión" hint="Opcional. Sólo sesiones con acta cerrada.">
                <OptionSelect
                  value={meetingId}
                  onValueChange={setMeetingId}
                  emptyLabel="Sin sesión asociada"
                  placeholder="Sin sesión asociada"
                  options={meetings.map((meeting) => ({
                    value: meeting.id,
                    label: `${meeting.code} · ${formatDateTime(meeting.scheduledFor)}`,
                  }))}
                />
              </Field>
            </>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LinkMeetingDialog({ activityId, meetings }: {
  activityId: string
  meetings: { id: string; code: string; scheduledFor: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [meetingId, setMeetingId] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(() => linkActivityToMeetingAction({ activityId, meetingId }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Vincular a sesión</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Vincular a una sesión</DialogTitle>
            <DialogDescription>Deja constancia de en qué sesión del comité se revisó esta actividad.</DialogDescription>
          </DialogHeader>
          <Field label="Sesión">
            <OptionSelect
              id="link-meeting"
              value={meetingId}
              onValueChange={setMeetingId}
              placeholder="Selecciona sesión"
              options={meetings.map((meeting) => ({
                value: meeting.id,
                label: `${meeting.code} · ${formatDateTime(meeting.scheduledFor)}`,
              }))}
            />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !meetingId}>Vincular</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
