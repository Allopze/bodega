"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MONTH_LABELS } from "@/lib/services/pdtp/constants"
import { formatDateTime } from "@/lib/utils"
import type {
  listAlcoholTestDispatches, listAlcoholTests, listAlcotestEquipment, listAlcotestWorkers,
} from "@/lib/services/prevention-alcotest"
import { recordAlcoholTestAction, recordAlcoholTestDispatchAction } from "./actions"

type Worksite = { id: string; name: string; code: string }
type AlcoholTest = Awaited<ReturnType<typeof listAlcoholTests>>[number]
type AlcoholTestDispatch = Awaited<ReturnType<typeof listAlcoholTestDispatches>>[number]
type Worker = Awaited<ReturnType<typeof listAlcotestWorkers>>[number]
type Equipment = Awaited<ReturnType<typeof listAlcotestEquipment>>[number]

/** Valor centinela del selector de persona para el caso "no es de la dotación". */
const THIRD_PARTY = "__third_party__"
const NO_EQUIPMENT = "__none__"

const SHIFT_LABEL: Record<string, string> = { dia: "Día", noche: "Noche" }

/** Valor para <input type="datetime-local">, en hora local del navegador. */
function localDatetimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function previousPeriod(): { year: number; month: number } {
  const now = new Date()
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const month = now.getMonth() === 0 ? 12 : now.getMonth()
  return { year, month }
}

export function AlcotestWorkbench({
  worksites, initialTests, initialDispatches, workers, equipment, canRegister, canDispatch,
}: {
  worksites: Worksite[]
  initialTests: AlcoholTest[]
  initialDispatches: AlcoholTestDispatch[]
  workers: Worker[]
  equipment: Equipment[]
  canRegister: boolean
  canDispatch: boolean
}) {
  const router = useRouter()
  const [registerOpen, setRegisterOpen] = React.useState(false)
  const [dispatchOpen, setDispatchOpen] = React.useState(false)
  const worksiteName = React.useMemo(() => new Map(worksites.map((w) => [w.id, w.name])), [worksites])

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Alcotest"
        description="Controles de alcotest (DO-48) y el envío mensual de sus registros al organismo administrador."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Programa de trabajo", href: "/prevencion/pdtp" }, { label: "Alcotest" }]} />}
        actions={
          <div className="flex gap-2">
            {canDispatch && <Button type="button" variant="secondary" onClick={() => setDispatchOpen(true)}>Enviar registros del mes</Button>}
            {canRegister && <Button type="button" onClick={() => setRegisterOpen(true)} disabled={worksites.length === 0}>Registrar control</Button>}
          </div>
        }
      />

      <section className="mt-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Controles recientes</h2>
        {initialTests.length === 0 ? (
          <EmptyState compact title="Sin controles registrados" description="Los controles de alcotest que se registren aparecerán aquí." />
        ) : (
          <div className="mt-2 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {initialTests.slice(0, 30).map((test) => {
              const worker = workers.find((candidate) => candidate.id === test.testedWorkerId)
              const subject = worker
                ? `${worker.lastName}, ${worker.firstName}`
                : test.testedPersonName ?? "Sin identificar"
              const device = equipment.find((item) => item.id === test.equipmentId)
              return (
                <article key={test.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{subject}
                      {!worker && test.testedPersonName ? <span className="ml-1 text-xs text-[var(--color-text-subtle)]">(tercero)</span> : null}
                    </p>
                    <p className="text-xs text-[var(--color-text-subtle)]">
                      {worksiteName.get(test.worksiteId) ?? test.worksiteId} · {formatDateTime(test.performedAt)} · turno {SHIFT_LABEL[test.shift] ?? test.shift}
                    </p>
                  </div>
                  <MetaBadge meta={{ label: `${test.result === "positivo" ? "Positivo" : "Negativo"}`, variant: test.result === "positivo" ? "danger" : "success" }} dot />
                  <span className="text-xs text-[var(--color-text-subtle)]">
                    {test.procedureCode}{device ? ` · ${device.code}` : " · sin equipo"}
                  </span>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Envíos de registros</h2>
        {initialDispatches.length === 0 ? (
          <EmptyState compact title="Sin envíos registrados" description="El envío mensual de registros que se registre aparecerá aquí." />
        ) : (
          <div className="mt-2 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {initialDispatches.map((dispatch) => (
              <article key={dispatch.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_8rem] sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">{worksiteName.get(dispatch.worksiteId) ?? dispatch.worksiteId}</p>
                  <p className="text-xs text-[var(--color-text-subtle)]">{MONTH_LABELS[dispatch.month - 1]} {dispatch.year} · a {dispatch.recipient}</p>
                </div>
                <span className="text-xs text-[var(--color-text-subtle)]">{formatDateTime(dispatch.sentAt)}</span>
                <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{dispatch.testCount} control(es)</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <RegisterTestDialog open={registerOpen} onOpenChange={setRegisterOpen} worksites={worksites} workers={workers} equipment={equipment} onSaved={() => router.refresh()} />
      <DispatchDialog open={dispatchOpen} onOpenChange={setDispatchOpen} worksites={worksites} onSaved={() => router.refresh()} />
    </PageContainer>
  )
}

function RegisterTestDialog({ open, onOpenChange, worksites, workers, equipment, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void
  worksites: Worksite[]; workers: Worker[]; equipment: Equipment[]; onSaved: () => void
}) {
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [shift, setShift] = React.useState("dia")
  const [performedAt, setPerformedAt] = React.useState("")
  const [result, setResult] = React.useState<"negativo" | "positivo">("negativo")
  const [subject, setSubject] = React.useState("")
  const [personName, setPersonName] = React.useState("")
  const [equipmentId, setEquipmentId] = React.useState(NO_EQUIPMENT)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Persona y equipo pertenecen a la faena: cambiar de faena invalida lo elegido.
  const worksiteWorkers = workers.filter((worker) => worker.worksiteId === worksiteId)
  const worksiteEquipment = equipment.filter((item) => item.worksiteId === worksiteId)

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setError(null)
      setResult("negativo")
      setSubject("")
      setPersonName("")
      setEquipmentId(NO_EQUIPMENT)
      // Hora local del navegador, no UTC: `datetime-local` la interpreta como
      // hora de pared de quien la ve, y toISOString() la habría adelantado.
      setPerformedAt(localDatetimeInputValue(new Date()))
    }
  }

  function changeWorksite(value: string) {
    setWorksiteId(value)
    setSubject("")
    setEquipmentId(NO_EQUIPMENT)
  }

  const isThirdParty = subject === THIRD_PARTY
  const subjectReady = isThirdParty ? personName.trim().length >= 3 : subject.length > 0

  async function save() {
    setPending(true); setError(null)
    let res
    try {
      res = await recordAlcoholTestAction({
        worksiteId, shift, performedAt: new Date(performedAt).toISOString(), result,
        testedWorkerId: isThirdParty ? null : subject,
        testedPersonName: isThirdParty ? personName.trim() : null,
        equipmentId: equipmentId === NO_EQUIPMENT ? null : equipmentId,
      })
    } finally {
      setPending(false)
    }
    if (!res.ok) { setError(res.message ?? "No se pudo registrar el control."); return }
    onOpenChange(false); onSaved()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Registrar control de alcotest</DialogTitle><DialogDescription>Cierra la N°30 (PRF) o la N°31 (Supervisor/Jefe de terreno) según tu rol.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <Field label="Faena" required><Select value={worksiteId} onValueChange={changeWorksite}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Persona evaluada" required helper="Un control que no dice a quién se le tomó no sirve como evidencia.">
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger><SelectValue placeholder="Selecciona a la persona" /></SelectTrigger>
          <SelectContent>
            {worksiteWorkers.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.lastName}, {worker.firstName}{worker.position ? ` · ${worker.position}` : ""}</SelectItem>)}
            <SelectItem value={THIRD_PARTY}>Otra persona (no es de la dotación)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {isThirdParty && (
        <Field label="Nombre del tercero" required helper="Chofer de proveedor, contratista o visita.">
          <Input value={personName} onChange={(event) => setPersonName(event.target.value)} maxLength={200} />
        </Field>
      )}
      <Field label="Alcotómetro" helper={worksiteEquipment.length === 0 ? "Esta faena no tiene alcotómetros dados de alta en equipos de servicio." : "Su calibración se controla en el registro de equipos de servicio."}>
        <Select value={equipmentId} onValueChange={setEquipmentId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_EQUIPMENT}>Sin registrar</SelectItem>
            {worksiteEquipment.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {item.name}{item.model ? ` (${item.model})` : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Turno" required><Select value={shift} onValueChange={setShift}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dia">Día</SelectItem><SelectItem value="noche">Noche</SelectItem></SelectContent></Select></Field>
        <Field label="Resultado" required><Select value={result} onValueChange={(value) => setResult(value as "negativo" | "positivo")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="negativo">Negativo</SelectItem><SelectItem value="positivo">Positivo</SelectItem></SelectContent></Select></Field>
      </div>
      <Field label="Fecha y hora" required><Input type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} /></Field>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || !worksiteId || !performedAt || !subjectReady}>{pending ? "Registrando..." : "Registrar"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function DispatchDialog({ open, onOpenChange, worksites, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; worksites: Worksite[]; onSaved: () => void
}) {
  const period = previousPeriod()
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [year, setYear] = React.useState(period.year)
  const [month, setMonth] = React.useState(period.month)
  const [recipient, setRecipient] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) { setError(null); setRecipient(""); setYear(period.year); setMonth(period.month) }
  }

  async function save() {
    setPending(true); setError(null)
    let res
    try {
      res = await recordAlcoholTestDispatchAction({ worksiteId, year, month, recipient })
    } finally {
      setPending(false)
    }
    if (!res.ok) { setError(res.message ?? "No se pudo registrar el envío."); return }
    onOpenChange(false); onSaved()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Enviar registros del mes</DialogTitle><DialogDescription>Cierra la N°32: el envío según DO-48 de los controles del período elegido. Un envío por faena y mes.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <Field label="Faena" required><Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mes" required><Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MONTH_LABELS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Año" required><Input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} /></Field>
      </div>
      <Field label="Destinatario" required helper="Organismo administrador o mutual que recibe el envío."><Input value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={200} /></Field>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || !worksiteId || recipient.trim().length < 3}>{pending ? "Registrando..." : "Registrar envío"}</Button></DialogFooter>
  </DialogContent></Dialog>
}
