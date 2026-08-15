"use client"

import * as React from "react"
import Link from "next/link"
import { Buildings, UserCircle } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  PREVENTIVE_ORGANIZATION_LABELS,
  type PreventiveOrganization,
} from "@/lib/prevention/cphs-organization"
import { COMMITTEE_PROGRAM_STATUS_LABELS } from "@/lib/prevention/cphs-program"
import { formatDate } from "@/lib/utils"
import { designateDelegateAction, endDelegateAction, recordDtRegistrationAction } from "../actions"

interface Profile {
  worksiteId: string
  worksiteName: string
  headcount: number
  declaredHeadcount: { year: number; month: number; workerCount: number } | null
  prevencionista: string | null
  committee: {
    id: string; name: string; mandateEndsOn: string; mandateExpired: boolean
    dtRegisteredOn: string | null; dtRegistrationReference: string | null
  } | null
  delegate: { id: string; workerName: string; designatedOn: string; termEndsOn: string | null; version: number } | null
  program: { id: string; committeeId: string; year: number; status: string } | null
  compliance: { required: PreventiveOrganization; compliant: boolean; detail: string }
}

interface WorkerOption {
  id: string
  name: string
  position: string | null
}

export function WorksiteProfile({ profile, eligibleWorkers, canManage }: {
  profile: Profile
  eligibleWorkers: WorkerOption[]
  canManage: boolean
}) {
  const facts = [
    { label: "Dotación activa", value: String(profile.headcount), hint: "Trabajadores propios en el padrón" },
    {
      label: "Dotación declarada",
      value: profile.declaredHeadcount ? String(profile.declaredHeadcount.workerCount) : "Sin declarar",
      hint: profile.declaredHeadcount
        ? `Indicadores ${String(profile.declaredHeadcount.month).padStart(2, "0")}/${profile.declaredHeadcount.year}`
        : "No hay período cargado en indicadores",
    },
    { label: "Órgano exigible", value: PREVENTIVE_ORGANIZATION_LABELS[profile.compliance.required], hint: "Según dotación" },
    { label: "Prevencionista", value: profile.prevencionista ?? "Sin asignar", hint: "El más frecuente en la dotación" },
  ]

  /* Los dos conteos vienen de fuentes distintas y discrepar es señal, no error:
   * uno es el padrón vivo y el otro lo carga RRHH por mes. */
  const headcountMismatch = profile.declaredHeadcount !== null
    && profile.declaredHeadcount.workerCount !== profile.headcount

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{fact.hint}</span>
          </div>
        ))}
      </div>

      <div className={`rounded-md border p-4 text-sm ${profile.compliance.compliant
        ? "border-[var(--color-border)]"
        : "border-[var(--color-danger-line)] bg-[var(--color-surface-2)]"}`}>
        <div className="flex items-center gap-2">
          <Badge variant={profile.compliance.compliant ? "success" : "danger"}>
            {profile.compliance.compliant ? "Al día" : "Brecha"}
          </Badge>
          <span>{profile.compliance.detail}</span>
        </div>
      </div>

      {headcountMismatch && (
        <p className="rounded-md border border-[var(--color-warning-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          La dotación del padrón ({profile.headcount}) no coincide con la declarada en indicadores
          ({profile.declaredHeadcount?.workerCount}). La obligación se calcula sobre el padrón; conviene
          revisar cuál de las dos está desactualizada.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Comité Paritario</h2>
        {profile.committee ? (
          <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/prevencion/cphs/${profile.committee.id}`} className="text-sm font-medium hover:underline">
                {profile.committee.name}
              </Link>
              <Badge variant={profile.committee.mandateExpired ? "warning" : "success"}>
                {profile.committee.mandateExpired ? "Mandato vencido" : "Vigente"}
              </Badge>
            </div>
            <p className="text-sm text-[var(--color-text-subtle)]">Mandato hasta {formatDate(profile.committee.mandateEndsOn)}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <div className="text-sm">
                <span className="text-eyebrow block">Registro ante la Dirección del Trabajo</span>
                {profile.committee.dtRegisteredOn ? (
                  <span>{formatDate(profile.committee.dtRegisteredOn)} · {profile.committee.dtRegistrationReference}</span>
                ) : (
                  <span className="text-[var(--color-text-subtle)]">Sin registrar</span>
                )}
              </div>
              {canManage && <DtRegistrationDialog committeeId={profile.committee.id} registered={Boolean(profile.committee.dtRegisteredOn)} />}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <div className="text-sm">
                <span className="text-eyebrow block">Programa de trabajo</span>
                {profile.program ? (
                  <span>
                    {profile.program.year} · {COMMITTEE_PROGRAM_STATUS_LABELS[profile.program.status] ?? profile.program.status}
                  </span>
                ) : (
                  <span className="text-[var(--color-text-subtle)]">Sin programa registrado</span>
                )}
              </div>
              {profile.program ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/prevencion/cphs/${profile.program.committeeId}/programa?programa=${profile.program.id}`}>
                    Ver programa
                  </Link>
                </Button>
              ) : canManage ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/prevencion/cphs/${profile.committee.id}/programa`}>Crear programa</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Buildings size={24} />}
            title="La faena no tiene comité paritario"
            description="Constituye el comité desde el módulo CPHS cuando la dotación haga exigible este órgano preventivo."
            action={<Button asChild size="sm" variant="secondary"><Link href="/prevencion/cphs">Ir a CPHS</Link></Button>}
            compact
          />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Delegado de Seguridad y Salud</h2>
        </div>
        {profile.delegate ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] p-4">
            <div className="text-sm">
              <span className="font-medium">{profile.delegate.workerName}</span>
              <span className="block text-xs text-[var(--color-text-subtle)]">
                Designado el {formatDate(profile.delegate.designatedOn)}
                {profile.delegate.termEndsOn ? ` · hasta ${formatDate(profile.delegate.termEndsOn)}` : ""}
              </span>
            </div>
            {canManage && <EndDelegateDialog delegate={profile.delegate} />}
          </div>
        ) : (
          <EmptyState
            icon={<UserCircle size={24} />}
            title="La faena no tiene delegado vigente"
            description={eligibleWorkers.length > 0 ? "Designa a una persona de la dotación activa para cubrir la organización preventiva exigible." : "No hay personas elegibles en esta faena. Revisa primero la dotación asignada."}
            action={canManage && eligibleWorkers.length > 0 ? <DesignateDelegateDialog worksiteId={profile.worksiteId} eligibleWorkers={eligibleWorkers} /> : undefined}
            compact
          />
        )}
      </section>
    </div>
  )
}

/* ── Designación de delegado ──────────────────────────────────────────────── */

function DesignateDelegateDialog({ worksiteId, eligibleWorkers }: { worksiteId: string; eligibleWorkers: WorkerOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [workerId, setWorkerId] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const termEndsOn = String(form.get("termEndsOn") ?? "").trim()
    operation.run(() => designateDelegateAction({
      worksiteId,
      workerId: form.get("workerId"),
      designatedOn: form.get("designatedOn"),
      termEndsOn: termEndsOn || null,
    }), () => { setOpen(false); setWorkerId("") })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Designar delegado</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Designar delegado</DialogTitle>
            <DialogDescription>Debe pertenecer a la dotación activa de la faena.</DialogDescription>
          </DialogHeader>
          <Field label="Persona">
            <OptionSelect
              name="workerId"
              value={workerId}
              onValueChange={setWorkerId}
              placeholder="Selecciona persona"
              options={eligibleWorkers.map((worker) => ({
                value: worker.id,
                label: worker.position ? `${worker.name} · ${worker.position}` : worker.name,
              }))}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Designado el"><DatePicker name="designatedOn" /></Field>
            <Field label="Término del período" hint="Opcional."><DatePicker name="termEndsOn" /></Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending || !workerId}>Designar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EndDelegateDialog({ delegate }: { delegate: { id: string; workerName: string; version: number } }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => endDelegateAction({
      delegateId: delegate.id,
      expectedVersion: delegate.version,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Terminar período</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Terminar período de {delegate.workerName}</DialogTitle>
            <DialogDescription>Queda registrado con su motivo; no se borra el historial.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres.">
            <Textarea name="reason" required minLength={10} maxLength={1000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Terminar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Registro ante la Dirección del Trabajo ───────────────────────────────── */

function DtRegistrationDialog({ committeeId, registered }: { committeeId: string; registered: boolean }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => recordDtRegistrationAction({
      committeeId,
      dtRegisteredOn: form.get("dtRegisteredOn"),
      dtRegistrationReference: form.get("dtRegistrationReference"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">{registered ? "Actualizar registro" : "Registrar ante la DT"}</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registro ante la Dirección del Trabajo</DialogTitle>
            <DialogDescription>
              El acta y el comprobante como archivos se adjuntan desde Documentación SST, vinculados al comité.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Fecha de registro"><DatePicker name="dtRegisteredOn" /></Field>
            <Field label="Folio o referencia" hint="Mínimo 3 caracteres.">
              <Input name="dtRegistrationReference" required minLength={3} maxLength={200} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
