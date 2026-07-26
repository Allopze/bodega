"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AGENT_TYPE_LABELS,
  MEASUREMENT_OUTCOME_LABELS,
  assessMeasurement,
  measurementOutcomeBadgeVariant,
} from "@/lib/prevention/hygiene"
import { addExposureGroupMemberAction, recordExposureMeasurementAction } from "../../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"

interface GroupInfo {
  id: string
  code: string
  name: string
  processDescription: string
  surveillanceRequired: boolean
  surveillanceReason: string | null
  isActive: boolean
}

interface AgentInfo {
  id: string
  name: string
  agentType: string
  unit: string
  permissibleLimit: string | null
  actionLevelFactor: string
  limitBasis: string
}

interface MemberInfo {
  id: string
  workerName: string
  workerPosition: string | null
  joinedOn: string
  leftOn: string | null
}

interface MeasurementInfo {
  id: string
  measuredOn: string
  value: string
  unit: string
  permissibleLimitSnapshot: string | null
  actionLevelSnapshot: string | null
  outcome: string
  method: string
  laboratoryName: string | null
  equipmentTag: string
}

interface WorkerOption {
  id: string
  name: string
  position: string | null
}

export function GroupDetail({ group, worksiteName, agent, members, measurements, eligibleWorkers, canManage, canMeasure }: {
  group: GroupInfo
  worksiteName: string
  agent: AgentInfo
  members: MemberInfo[]
  measurements: MeasurementInfo[]
  eligibleWorkers: WorkerOption[]
  canManage: boolean
  canMeasure: boolean
}) {
  const activeMembers = members.filter((item) => !item.leftOn)

  const facts = [
    { label: "Faena", value: worksiteName },
    { label: "Agente", value: `${agent.name} (${AGENT_TYPE_LABELS[agent.agentType] ?? agent.agentType})` },
    { label: "Límite permisible", value: agent.permissibleLimit ? `${agent.permissibleLimit} ${agent.unit}` : "No comparable: sin límite declarado" },
    { label: "Nivel de acción", value: agent.permissibleLimit ? `${(Number(agent.permissibleLimit) * Number(agent.actionLevelFactor)).toFixed(4)} ${agent.unit}` : "—" },
    { label: "Fundamento", value: agent.limitBasis },
    { label: "Expuestos activos", value: String(activeMembers.length) },
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

      <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm">
        <p><strong>Proceso:</strong> {group.processDescription}</p>
        <p className="mt-2">
          <strong>Vigilancia:</strong>{" "}
          {group.surveillanceRequired ? <Badge variant="danger">Requerida</Badge> : <Badge variant="success">No requerida</Badge>}
        </p>
        {group.surveillanceReason && <p className="mt-1 text-[var(--color-text-subtle)]">{group.surveillanceReason}</p>}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Integrantes ({activeMembers.length} activos)</h2>
          {canManage && group.isActive && eligibleWorkers.length > 0 && (
            <AddMemberDialog groupId={group.id} eligibleWorkers={eligibleWorkers} existingNames={activeMembers.map((m) => m.workerName)} />
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
                  <TableHead>Incorporado</TableHead>
                  <TableHead>Retirado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="text-sm">
                      {member.workerName}
                      {member.workerPosition && <span className="block text-xs text-[var(--color-text-subtle)]">{member.workerPosition}</span>}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{member.joinedOn}</TableCell>
                    <TableCell className="text-sm tabular-nums">{member.leftOn ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Mediciones ({measurements.length})</h2>
          {canMeasure && <AddMeasurementDialog groupId={group.id} agent={agent} />}
        </div>
        {measurements.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin mediciones registradas.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Límite / nivel de acción vigente</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Equipo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {measurements.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm tabular-nums">{item.measuredOn}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{item.value} {item.unit}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {item.permissibleLimitSnapshot ? `${item.permissibleLimitSnapshot} / ${item.actionLevelSnapshot} ${item.unit}` : "Sin límite a la fecha"}
                    </TableCell>
                    <TableCell><Badge variant={measurementOutcomeBadgeVariant(item.outcome)}>{MEASUREMENT_OUTCOME_LABELS[item.outcome] ?? item.outcome}</Badge></TableCell>
                    <TableCell className="text-sm">{item.method}{item.laboratoryName && ` · ${item.laboratoryName}`}</TableCell>
                    <TableCell className="text-sm">{item.equipmentTag}</TableCell>
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

function AddMemberDialog({ groupId, eligibleWorkers, existingNames }: {
  groupId: string
  eligibleWorkers: WorkerOption[]
  existingNames: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const [workerId, setWorkerId] = React.useState("")
  const operation = useOperation()
  const existing = new Set(existingNames)
  const available = eligibleWorkers.filter((worker) => !existing.has(worker.name))

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => addExposureGroupMemberAction({
      groupId,
      workerId: form.get("workerId"),
      joinedOn: form.get("joinedOn"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultValue(new Date().toISOString().slice(0, 10)); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm">Agregar integrante</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar integrante al GES</DialogTitle>
            <DialogDescription>La matrícula de vigilancia se deriva de esta pertenencia: nadie expuesto queda fuera por omisión.</DialogDescription>
          </DialogHeader>
          {available.length === 0 ? (
            <p className="text-sm text-[var(--color-text-subtle)]">Toda la dotación elegible ya integra el grupo.</p>
          ) : (
            <>
              <Field label="Persona">
                <Select value={workerId} onValueChange={setWorkerId}><SelectTrigger><SelectValue placeholder="Selecciona persona" /></SelectTrigger><SelectContent>{available.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.name}{worker.position ? ` · ${worker.position}` : ""}</SelectItem>)}</SelectContent></Select><input type="hidden" name="workerId" value={workerId} />
              </Field>
              <Field label="Incorporado el" required><DatePicker name="joinedOn" defaultValue={defaultValue} /></Field>
            </>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || available.length === 0}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Registro de medición ─────────────────────────────────────────────────── */

function AddMeasurementDialog({ groupId, agent }: { groupId: string; agent: AgentInfo }) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const [value, setValue] = React.useState("")
  const operation = useOperation()

  const preview = value.trim() && !Number.isNaN(Number(value))
    ? assessMeasurement(Number(value), {
      permissibleLimit: agent.permissibleLimit === null ? null : Number(agent.permissibleLimit),
      actionLevelFactor: Number(agent.actionLevelFactor),
    })
    : null

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const calibrationDate = String(form.get("calibrationDate") ?? "").trim()
    const laboratoryName = String(form.get("laboratoryName") ?? "").trim()
    const sampleDuration = String(form.get("sampleDurationMinutes") ?? "").trim()
    const reportReference = String(form.get("reportReference") ?? "").trim()
    operation.run(() => recordExposureMeasurementAction({
      groupId,
      measuredOn: form.get("measuredOn"),
      value: Number(value),
      method: form.get("method"),
      laboratoryName: laboratoryName || null,
      equipmentTag: form.get("equipmentTag"),
      calibrationDate: calibrationDate || null,
      sampleDurationMinutes: sampleDuration ? Number(sampleDuration) : null,
      reportReference: reportReference || null,
    }), () => { setOpen(false); setValue("") })
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultValue(new Date().toISOString().slice(0, 10)); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Registrar medición</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva medición</DialogTitle>
            <DialogDescription>El límite y el nivel de acción vigentes quedan congelados en esta fila.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Fecha" required><DatePicker name="measuredOn" defaultValue={defaultValue} /></Field>
            <Field label={`Valor (${agent.unit})`}>
              <Input name="value" type="number" step="any" min={0} required value={value} onChange={(event) => setValue(event.target.value)} />
            </Field>
          </div>
          {preview && (
            <p className="text-sm">
              Resultado previsto: <Badge variant={measurementOutcomeBadgeVariant(preview.outcome)}>{MEASUREMENT_OUTCOME_LABELS[preview.outcome] ?? preview.outcome}</Badge>
              {preview.triggersSurveillance && <span className="ml-2 text-xs text-[var(--color-warning-ink)]">Obliga a vigilancia</span>}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Método"><Input name="method" required minLength={3} maxLength={300} /></Field>
            <Field label="Equipo"><Input name="equipmentTag" required maxLength={200} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Laboratorio" hint="Opcional."><Input name="laboratoryName" maxLength={200} /></Field>
            <Field label="Fecha de calibración" hint="Opcional."><DatePicker name="calibrationDate" /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Duración de muestra (min)" hint="Opcional."><Input name="sampleDurationMinutes" type="number" min={1} /></Field>
            <Field label="Referencia de informe" hint="Opcional."><Input name="reportReference" maxLength={2000} /></Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Registrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
