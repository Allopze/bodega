"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Certificate } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { formatDate } from "@/lib/utils"
import {
  CERTIFICATION_LEVEL_LABELS,
  DOSSIER_STATUS_LABELS,
  EVALUATION_STATUS_LABELS,
  GAP_CLOSURE_DAYS,
  type EvaluatedRequirement,
} from "@/lib/prevention/cphs-certification"
import {
  createCertificationDossierAction,
  recordAuditResultAction,
  recordManualEvaluationAction,
  reopenCertificationDossierAction,
  submitCertificationDossierAction,
  updateDossierAdministrativeDataAction,
} from "../../actions"

interface Dossier {
  id: string
  level: string
  periodYear: number
  status: string
  version: number
  adherenceConfirmed: boolean
  sagecopRegistered: boolean
  sagecopReference: string | null
  contributionsStatus: string | null
  auditedFrom: string | null
  auditedTo: string | null
  auditedOn: string | null
  auditResult: string | null
  gapsDeadlineOn: string | null
  validUntilOn: string | null
  frozen: boolean
  requirements: EvaluatedRequirement[]
  summary: { total: number; applicable: number; met: number; gaps: number; readyToSubmit: boolean }
  gaps: { code: string; title: string; capaActionId: string | null }[]
}

interface Props {
  committeeId: string
  dossiers: { id: string; level: string; periodYear: number; status: string }[]
  selected: Dossier | null | undefined
  canCertify: boolean
}

const STATUS_BADGE: Record<string, "success" | "danger" | "outline" | "default"> = {
  met: "success",
  not_met: "danger",
  not_applicable: "outline",
}

type RequirementFilter = "all" | "met" | "not_met"

export function CertificationHeaderActions({ committeeId, selected }: {
  committeeId: string
  selected: Dossier | null | undefined
}) {
  return (
    <>
      <NewDossierDialog committeeId={committeeId} />
      {selected?.status === "draft" && <AdministrativeDialog dossier={selected} />}
      {selected?.status === "draft" && <SubmitDossierDialog dossier={selected} />}
      {selected?.status === "submitted" && <AuditResultDialog dossier={selected} />}
      {selected?.status === "rejected" && <ReopenDossierDialog dossier={selected} />}
    </>
  )
}

export function CertificationPanel({ committeeId, dossiers, selected, canCertify }: Props) {
  const router = useRouter()
  const [requirementFilter, setRequirementFilter] = React.useState<RequirementFilter>("all")

  if (dossiers.length === 0 || !selected) {
    return (
      <EmptyState
        icon={<Certificate size={24} />}
        title="El comité no tiene expediente de certificación"
        description="El expediente reúne la evidencia que Mutual de Seguridad exige para certificar el comité. La mayor parte se evalúa sola con los datos que ya tiene la plataforma; sólo la comunicación de riesgo grave e inminente se declara a mano."
        action={canCertify ? <NewDossierDialog committeeId={committeeId} /> : undefined}
      />
    )
  }

  const metrics = [
    { id: "met", filter: "met" as const, label: "Requisitos cumplidos", value: `${selected.summary.met}/${selected.summary.applicable}`, detail: `Nivel ${CERTIFICATION_LEVEL_LABELS[selected.level as "bronce"] ?? selected.level}` },
    { id: "gaps", filter: "not_met" as const, label: "Brechas abiertas", value: selected.summary.gaps === 0 ? "Sin brechas" : selected.summary.gaps, detail: selected.summary.gaps === 0 ? "Expediente listo" : selected.gaps.some((gap) => gap.capaActionId) ? "Con acción CAPA abierta" : "Requiere plan de cierre" },
    { id: "deadline", filter: "not_met" as const, label: "Plazo de brechas", value: selected.gapsDeadlineOn ? formatDate(selected.gapsDeadlineOn) : "Se define al presentar", detail: `${GAP_CLOSURE_DAYS} días desde la presentación` },
    { id: "valid", filter: "all" as const, label: "Vigencia", value: selected.validUntilOn ? formatDate(selected.validUntilOn) : "Pendiente de auditoría", detail: "Anual desde la auditoría" },
  ]
  const filteredRequirements = selected.requirements.filter((requirement) => (
    requirementFilter === "all" || requirement.status === requirementFilter
  ))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            aria-pressed={requirementFilter === metric.filter}
            onClick={() => setRequirementFilter(metric.filter)}
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
          aria-label="Expediente"
          value={selected.id}
          onValueChange={(value) => router.push(`/prevencion/cphs/${committeeId}/certificacion?expediente=${value}`)}
          options={dossiers.map((dossier) => ({
            value: dossier.id,
            label: `${CERTIFICATION_LEVEL_LABELS[dossier.level as "bronce"] ?? dossier.level} ${dossier.periodYear}`,
          }))}
          className="w-56"
        />
        <Badge variant={selected.status === "certified" ? "success" : selected.status === "rejected" ? "danger" : selected.status === "submitted" ? "warning" : "default"}>
          {DOSSIER_STATUS_LABELS[selected.status] ?? selected.status}
        </Badge>
      </div>

      {selected.frozen && (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
          Este expediente está congelado: lo que se muestra es la evaluación tal como se presentó
          {selected.gapsDeadlineOn ? `, con plazo de cierre de brechas al ${formatDate(selected.gapsDeadlineOn)}` : ""}.
          Los cambios posteriores en el comité no lo alteran.
        </p>
      )}

      <section id="certification-process" className="space-y-3">
        <h2 className="text-sm font-semibold">Datos administrativos del proceso</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
          {[
            { label: "Adherencia a Mutual", value: selected.adherenceConfirmed ? "Confirmada" : "Sin confirmar" },
            { label: "Registro SAGECOP", value: selected.sagecopRegistered ? (selected.sagecopReference ?? "Activo") : "Sin registrar" },
            { label: "Período auditado", value: selected.auditedFrom && selected.auditedTo ? `${formatDate(selected.auditedFrom)} → ${formatDate(selected.auditedTo)}` : "Sin definir" },
            { label: "Cotizaciones Ley 16.744", value: selected.contributionsStatus ?? "Sin declarar" },
          ].map((fact) => (
            <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
              <span className="text-eyebrow">{fact.label}</span>
              <span className="mt-1 block text-sm font-medium">{fact.value}</span>
            </div>
          ))}
        </div>
        {selected.auditResult && (
          <p className="rounded-md border border-[var(--color-border)] p-4 text-sm">
            <span className="text-eyebrow block">Resultado de la auditoría{selected.auditedOn ? ` · ${formatDate(selected.auditedOn)}` : ""}</span>
            {selected.auditResult}
          </p>
        )}
      </section>

      <section id="certification-requirements" className="space-y-3">
        <h2 className="text-sm font-semibold">Requisitos ({filteredRequirements.length} de {selected.summary.total})</h2>
        {filteredRequirements.length === 0 ? (
          <EmptyState
            icon={<Certificate size={24} />}
            title="No hay requisitos en este filtro"
            description="Vuelve al expediente completo para revisar los demás requisitos."
            action={<Button size="sm" variant="secondary" onClick={() => setRequirementFilter("all")}>Ver todos</Button>}
            compact
          />
        ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requisito</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Estado</TableHead>
                {canCertify && !selected.frozen && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequirements.map((requirement) => {
                const gap = selected.gaps.find((item) => item.code === requirement.code)
                return (
                  <TableRow key={requirement.code}>
                    <TableCell>
                      <span className="text-sm font-medium">{requirement.title}</span>
                      <span className="block max-w-lg text-xs text-[var(--color-text-subtle)]">{requirement.description}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {requirement.source === "auto" ? "Automático" : "Declarado"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[requirement.status] ?? "default"}>
                        {EVALUATION_STATUS_LABELS[requirement.status] ?? requirement.status}
                      </Badge>
                      <span className="mt-1 block max-w-md text-xs text-[var(--color-text-subtle)]">{requirement.detail}</span>
                      {requirement.evidenceReference && (
                        <span className="mt-1 block max-w-md text-xs text-[var(--color-text-subtle)]">
                          Evidencia: {requirement.evidenceReference}
                        </span>
                      )}
                      {gap?.capaActionId && (
                        <Link href={`/prevencion/capa/${gap.capaActionId}`} className="mt-1 block text-xs underline">
                          Ver acción correctiva
                        </Link>
                      )}
                    </TableCell>
                    {canCertify && !selected.frozen && (
                      <TableCell className="text-right">
                        {requirement.source === "manual" && (
                          <ManualEvaluationDialog
                            dossierId={selected.id}
                            expectedVersion={selected.version}
                            requirement={requirement}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        )}
      </section>
    </div>
  )
}

/* ── Diálogos ─────────────────────────────────────────────────────────────── */

function NewDossierDialog({ committeeId }: { committeeId: string }) {
  const [open, setOpen] = React.useState(false)
  const [level, setLevel] = React.useState("bronce")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createCertificationDossierAction({
      committeeId,
      level,
      periodYear: Number(form.get("periodYear")),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Nuevo expediente</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo expediente de certificación</DialogTitle>
            <DialogDescription>
              Bronce verifica el cumplimiento base del comité. Plata y Oro se habilitan cuando el comité
              opere de forma estable.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nivel">
              <OptionSelect
                value={level}
                onValueChange={setLevel}
                options={Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Período">
              <Input name="periodYear" type="number" min={2020} max={2100} required defaultValue={new Date().getFullYear()} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AdministrativeDialog({ dossier }: { dossier: Dossier }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const reference = String(form.get("sagecopReference") ?? "").trim()
    const contributions = String(form.get("contributionsStatus") ?? "").trim()
    const from = String(form.get("auditedFrom") ?? "").trim()
    const to = String(form.get("auditedTo") ?? "").trim()
    operation.run(() => updateDossierAdministrativeDataAction({
      dossierId: dossier.id,
      expectedVersion: dossier.version,
      adherenceConfirmed: form.get("adherenceConfirmed") === "on",
      sagecopRegistered: form.get("sagecopRegistered") === "on",
      sagecopReference: reference || null,
      contributionsStatus: contributions || null,
      auditedFrom: from || null,
      auditedTo: to || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Datos administrativos</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Datos administrativos del proceso</DialogTitle>
            <DialogDescription>Condiciones que Mutual exige además del funcionamiento del comité.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Checkbox name="adherenceConfirmed" label="Chome adherida a Mutual de Seguridad CChC" defaultChecked={dossier.adherenceConfirmed} />
            <Checkbox name="sagecopRegistered" label="Comité con registro activo en SAGECOP" defaultChecked={dossier.sagecopRegistered} />
          </div>
          <Field label="Referencia SAGECOP" hint="Opcional.">
            <Input name="sagecopReference" maxLength={200} defaultValue={dossier.sagecopReference ?? ""} />
          </Field>
          <Field label="Estado de cotizaciones Ley 16.744" hint="Opcional.">
            <Input name="contributionsStatus" maxLength={200} defaultValue={dossier.contributionsStatus ?? ""} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Período auditado desde"><DatePicker name="auditedFrom" defaultValue={dossier.auditedFrom ?? undefined} /></Field>
            <Field label="Hasta"><DatePicker name="auditedTo" defaultValue={dossier.auditedTo ?? undefined} /></Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ManualEvaluationDialog({
  dossierId,
  expectedVersion,
  requirement,
}: {
  dossierId: string
  expectedVersion: number
  requirement: EvaluatedRequirement
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const evidence = String(form.get("evidenceReference") ?? "").trim()
    operation.run(() => recordManualEvaluationAction({
      dossierId,
      expectedVersion,
      requirementCode: requirement.code,
      status: form.get("status"),
      detail: form.get("detail"),
      evidenceReference: evidence,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Declarar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{requirement.title}</DialogTitle>
            <DialogDescription>{requirement.description}</DialogDescription>
          </DialogHeader>
          <Field label="Estado">
            <OptionSelect
              key={`${requirement.code}:${requirement.status}`}
              name="status"
              defaultValue={requirement.status}
              options={Object.entries(EVALUATION_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Fundamento" hint="Mínimo 10 caracteres. Queda en el expediente.">
            <Textarea name="detail" required minLength={10} maxLength={2000} rows={3} defaultValue={requirement.detail} />
          </Field>
          <Field label="Evidencia" hint="Referencia al documento que lo respalda.">
            <Input name="evidenceReference" required minLength={3} maxLength={500} defaultValue={requirement.evidenceReference ?? ""} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SubmitDossierDialog({ dossier }: { dossier: Dossier }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Presentar expediente</Button></DialogTrigger>
      <DialogContent>
        <div className="space-y-4">
          <DialogHeader>
            <DialogTitle>Presentar el expediente a auditoría</DialogTitle>
            <DialogDescription>
              La evaluación queda congelada tal como está hoy y cada brecha abre una acción correctiva
              con plazo de {GAP_CLOSURE_DAYS} días. Presentar con brechas conocidas es válido: lo que
              no es válido es presentarlas sin plan de cierre.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-[var(--color-border)] p-3 text-sm">
            {selectedSummary(dossier)}
          </p>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter>
            <Button
              disabled={operation.pending}
              onClick={() => operation.run(
                () => submitCertificationDossierAction({ dossierId: dossier.id, expectedVersion: dossier.version }),
                () => setOpen(false),
              )}
            >
              Presentar
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function selectedSummary(dossier: Dossier) {
  if (dossier.summary.gaps === 0) return "El expediente cumple todos los requisitos aplicables."
  const titles = dossier.gaps.map((gap) => gap.title).join("; ")
  return `Se presentará con ${dossier.summary.gaps} brecha(s): ${titles}.`
}

function ReopenDossierDialog({ dossier }: { dossier: Dossier }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => reopenCertificationDossierAction({
      dossierId: dossier.id,
      expectedVersion: dossier.version,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Reabrir expediente</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reabrir el expediente rechazado</DialogTitle>
            <DialogDescription>
              Vuelve a preparación para corregir y re-presentar. Los requisitos automáticos se evalúan
              otra vez en vivo, las declaraciones manuales se conservan y las acciones correctivas ya
              abiertas por cada brecha no se duplican.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres. Queda en el historial del expediente.">
            <Textarea name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Reabrir</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AuditResultDialog({ dossier }: { dossier: Dossier }) {
  const [open, setOpen] = React.useState(false)
  const [outcome, setOutcome] = React.useState("certified")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => recordAuditResultAction({
      dossierId: dossier.id,
      expectedVersion: dossier.version,
      outcome,
      auditedOn: form.get("auditedOn"),
      auditResult: form.get("auditResult"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Registrar resultado</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Resultado de la auditoría de Mutual</DialogTitle>
            <DialogDescription>Si certifica, la vigencia queda por un año desde la fecha de auditoría.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Resultado">
              <OptionSelect
                value={outcome}
                onValueChange={setOutcome}
                options={[
                  { value: "certified", label: "Certificado" },
                  { value: "rejected", label: "Rechazado" },
                ]}
              />
            </Field>
            <Field label="Fecha de auditoría"><DatePicker name="auditedOn" /></Field>
          </div>
          <Field label="Detalle del resultado" hint="Mínimo 10 caracteres.">
            <Textarea name="auditResult" required minLength={10} maxLength={2000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
