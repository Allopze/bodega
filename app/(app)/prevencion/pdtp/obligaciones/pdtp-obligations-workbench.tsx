"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { listPdtpDemandActivities, listPdtpObligations } from "@/lib/services/prevention-pdtp"
import { cancelPdtpObligationAction, createPdtpObligationAction, reportPdtpObligationAction } from "./actions"

type DemandActivity = Awaited<ReturnType<typeof listPdtpDemandActivities>>[number]
type ObligationRow = Awaited<ReturnType<typeof listPdtpObligations>>[number]
type Worksite = { id: string; name: string }

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  overdue: "Vencida",
  reported: "Reportada",
  completed: "Completada",
  cancelled: "Cancelada",
}

function statusVariant(status: string): "warning" | "danger" | "info" | "success" | "outline" {
  if (status === "overdue") return "danger"
  if (status === "pending") return "warning"
  if (status === "reported") return "info"
  if (status === "completed") return "success"
  return "outline"
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" })

function dateTime(value: string | null) {
  if (!value) return "Sin plazo"
  return DATE_TIME_FORMAT.format(new Date(value))
}

function clientRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function PdtpObligationsWorkbench({
  worksites, activities, initialObligations, canExecute, canCancel,
}: {
  worksites: Worksite[]
  activities: DemandActivity[]
  initialObligations: ObligationRow[]
  canExecute: boolean
  /** Cancelar es gestión, no trabajo de terreno: permiso propio. */
  canCancel: boolean
}) {
  const router = useRouter()
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("open")
  const [worksiteId, setWorksiteId] = React.useState("all")
  const [createOpen, setCreateOpen] = React.useState(false)
  const [reporting, setReporting] = React.useState<ObligationRow | null>(null)
  const [cancelling, setCancelling] = React.useState<ObligationRow | null>(null)
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")

  const counts = React.useMemo(() => ({
    pending: initialObligations.filter((row) => row.effectiveStatus === "pending").length,
    overdue: initialObligations.filter((row) => row.effectiveStatus === "overdue").length,
    reported: initialObligations.filter((row) => row.effectiveStatus === "reported").length,
  }), [initialObligations])
  const rows = initialObligations.filter((row) => {
    if (status !== "open" && row.effectiveStatus !== status) return false
    if (worksiteId !== "all" && row.obligation.worksiteId !== worksiteId) return false
    if (!query) return true
    return [row.activityName, row.worksiteName, row.obligation.sourceType, row.obligation.sourceId]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase("es-CL").includes(query))
  })

  function openCreate() {
    setCreateOpen(true)
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Actividades a demanda y por evento"
        description="Gestiona casos reales, plazos y evidencias sin inventar cuotas para actividades que no son calendarizadas."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Programa de trabajo", href: "/prevencion/pdtp" }, { label: "A demanda y por evento" }]} />}
        actions={canExecute ? <Button type="button" onClick={openCreate} disabled={activities.length === 0 || worksites.length === 0}>Registrar necesidad o evento</Button> : undefined}
      />

      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] sm:grid-cols-4">
        {[
          { key: "pending", label: "Pendientes", value: counts.pending, detail: "Dentro de plazo" },
          { key: "overdue", label: "Vencidas", value: counts.overdue, detail: "Requieren atención" },
          { key: "reported", label: "Por aprobar", value: counts.reported, detail: "Trabajo ya informado" },
        ].map((metric) => (
          <button key={metric.key} type="button" onClick={() => setStatus((current) => current === metric.key ? "open" : metric.key)} aria-pressed={status === metric.key} className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]">
            <span className="text-eyebrow">{metric.label}</span>
            <strong className="mt-1 block font-mono text-xl tabular-nums">{metric.value}</strong>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Estado"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Trabajo abierto</SelectItem>
            <SelectItem value="pending">Pendientes</SelectItem>
            <SelectItem value="overdue">Vencidas</SelectItem>
            <SelectItem value="reported">Por aprobar</SelectItem>
          </SelectContent>
        </Select>
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger className="w-56" aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las faenas visibles</SelectItem>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {activities.length === 0 ? (
        <EmptyState title="No hay actividades operables por evento" description="Activa un programa y confirma en el constructor cuáles actividades ocurren a demanda o por un evento, con plazo y evidencia definidos." />
      ) : initialObligations.length === 0 ? (
        <EmptyState
          title="Sin casos"
          description="Aún no ha ocurrido una necesidad o evento. Esto no equivale a 0 % ni a 100 % de cumplimiento."
          action={canExecute ? <Button type="button" onClick={openCreate}>Registrar el primer caso</Button> : undefined}
        />
      ) : rows.length === 0 ? (
        <EmptyState compact title="No hay resultados con estos filtros" description="Cambia el estado, la faena o el texto del filtro superior." action={<Button type="button" variant="secondary" onClick={() => { setStatus("open"); setWorksiteId("all") }}>Limpiar filtros</Button>} />
      ) : (
        <div className="mt-4 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {rows.map((row) => (
            <article key={row.obligation.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_15rem_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(row.effectiveStatus)} dot>{STATUS_LABEL[row.effectiveStatus] ?? row.effectiveStatus}</Badge>
                  <span className="font-mono text-xs text-[var(--color-text-subtle)]">Actividad {row.activityNumber}</span>
                  <span className="text-xs text-[var(--color-text-subtle)]">{row.worksiteName}</span>
                </div>
                <h2 className="mt-2 text-sm font-semibold text-[var(--color-text)]">{row.activityName}</h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {row.obligation.sourceType && row.obligation.sourceId ? `Origen: ${row.obligation.sourceType} · ${row.obligation.sourceId}` : "Necesidad registrada manualmente"}
                </p>
              </div>
              <div>
                <p className="text-eyebrow">Plazo</p>
                <p className={row.effectiveStatus === "overdue" ? "mt-1 text-sm font-semibold text-[var(--color-danger)]" : "mt-1 text-sm text-[var(--color-text)]"}>{dateTime(row.obligation.dueAt)}</p>
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Cantidad esperada: {row.obligation.plannedQuantity}</p>
              </div>
              {(canExecute || canCancel) && (
                <div className="flex flex-wrap justify-end gap-2">
                  {canExecute && (row.effectiveStatus === "pending" || row.effectiveStatus === "overdue") && <Button type="button" size="sm" onClick={() => setReporting(row)}>Reportar trabajo</Button>}
                  {canCancel && (row.effectiveStatus === "pending" || row.effectiveStatus === "overdue") && <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(row)}>Cancelar</Button>}
                  {canExecute && row.effectiveStatus === "reported" && <Button type="button" size="sm" variant="secondary" onClick={() => router.push("/prevencion/pdtp/aprobaciones")}>Ir a aprobación</Button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}


      <CreateObligationDialog open={createOpen} onOpenChange={setCreateOpen} activities={activities} worksites={worksites} onSaved={() => router.refresh()} />
      <ReportObligationDialog row={reporting} onClose={() => setReporting(null)} onSaved={() => router.refresh()} />
      <CancelObligationDialog row={cancelling} onClose={() => setCancelling(null)} onSaved={() => router.refresh()} />
    </PageContainer>
  )
}



function CreateObligationDialog({ open, onOpenChange, activities, worksites, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; activities: DemandActivity[]; worksites: Worksite[]; onSaved: () => void }) {
  const [activityId, setActivityId] = React.useState(activities[0]?.id ?? "")
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [sourceType, setSourceType] = React.useState("")
  const [sourceId, setSourceId] = React.useState("")
  const [quantity, setQuantity] = React.useState(1)
  const [reason, setReason] = React.useState("")
  const [requestId, setRequestId] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const activity = activities.find((item) => item.id === activityId)

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) { setRequestId(clientRequestId()); setError(null) }
  }

  async function save() {
    setPending(true); setError(null)
    const result = await createPdtpObligationAction({
      activityId, worksiteId, origin: "manual", clientRequestId: requestId,
      sourceType: sourceType || null, sourceId: sourceId || null,
      plannedQuantity: quantity, manualReason: reason, sourceMetadata: {},
    })
    setPending(false)
    if (!result.ok) { setError(result.message ?? "No se pudo registrar el caso."); return }
    onOpenChange(false); setReason(""); setSourceType(""); setSourceId(""); onSaved()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Registrar una necesidad o evento</DialogTitle><DialogDescription>Esto abre una obligación real con plazo. No agrega una cuota ficticia al calendario.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <Field label="Actividad" required><Select value={activityId} onValueChange={setActivityId}><SelectTrigger><SelectValue placeholder="Selecciona una actividad" /></SelectTrigger><SelectContent>{activities.map((item) => <SelectItem key={item.id} value={item.id}>{item.programYear} · N°{item.n} · {item.activity}</SelectItem>)}</SelectContent></Select></Field>
      {activity && <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">{activity.mode === "triggered" ? `Por evento: ${activity.triggerDescription}` : "A demanda"} · plazo {activity.dueDays} día(s) · evidencia: {activity.evidenceRequirement}</p>}
      <Field label="Faena" required><Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
      {activity?.mode === "triggered" && <div className="grid gap-3 sm:grid-cols-2"><Field label="Tipo de fuente" required><Input value={sourceType} onChange={(event) => setSourceType(event.target.value)} placeholder="Ej.: incidente" /></Field><Field label="Identificador de fuente" required><Input value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="Código o ID del caso" /></Field></div>}
      <Field label="Cantidad esperada" required><Input className="max-w-32" type="number" min="0.01" step="0.25" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></Field>
      <Field label="Motivo del registro manual" required helper="Explica por qué el caso se abre manualmente y qué hecho lo originó."><Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} minLength={10} maxLength={3000} /></Field>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || !activityId || !worksiteId || reason.trim().length < 10 || (activity?.mode === "triggered" && (!sourceType.trim() || !sourceId.trim()))}>{pending ? "Registrando..." : "Abrir obligación"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function ReportObligationDialog({ row, onClose, onSaved }: { row: ObligationRow | null; onClose: () => void; onSaved: () => void }) {
  const [quantity, setQuantity] = React.useState(1)
  const [evidence, setEvidence] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [prevRow, setPrevRow] = React.useState(row)
  if (row !== prevRow) {
    setPrevRow(row)
    if (row) { setQuantity(row.obligation.plannedQuantity); setEvidence(""); setError(null) }
  }
  async function save() {
    if (!row) return
    setPending(true); setError(null)
    const result = await reportPdtpObligationAction({ obligationId: row.obligation.id, executedQuantity: quantity, evidenceText: evidence, evidencePhotos: [] })
    setPending(false)
    if (!result.ok) { setError(result.message ?? "No se pudo reportar el trabajo."); return }
    onClose(); onSaved()
  }
  return <Dialog open={row !== null} onOpenChange={(value) => { if (!value) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>Reportar trabajo realizado</DialogTitle><DialogDescription>La obligación quedará reportada y pasará a aprobación; aún no contará como cumplimiento formal.</DialogDescription></DialogHeader>
    <div className="space-y-4"><p className="text-sm font-medium">{row?.activityName}</p><Field label="Cantidad realizada" required><Input className="max-w-32" type="number" min="0.01" step="0.25" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></Field><Field label="Evidencia" required helper="Describe el expediente, registro o respaldo verificable."><Textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={4} maxLength={5000} /></Field>{error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}</div>
    <DialogFooter><Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || evidence.trim().length === 0}>{pending ? "Reportando..." : "Enviar a aprobación"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function CancelObligationDialog({ row, onClose, onSaved }: { row: ObligationRow | null; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [prevRow, setPrevRow] = React.useState(row)
  if (row !== prevRow) {
    setPrevRow(row)
    if (row) { setReason(""); setError(null) }
  }
  async function save() {
    if (!row) return
    setPending(true); setError(null)
    const result = await cancelPdtpObligationAction({ obligationId: row.obligation.id, reason })
    setPending(false)
    if (!result.ok) { setError(result.message ?? "No se pudo cancelar la obligación."); return }
    onClose(); onSaved()
  }
  return <Dialog open={row !== null} onOpenChange={(value) => { if (!value) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>Cancelar obligación</DialogTitle><DialogDescription>La cancelación no contará como caso cumplido y conservará el motivo en la trazabilidad.</DialogDescription></DialogHeader>
    <div><Field label="Motivo" required><Textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={3000} rows={3} /></Field>{error && <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}</div>
    <DialogFooter><Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Volver</Button><Button type="button" variant="destructive" onClick={save} disabled={pending || reason.trim().length < 10}>{pending ? "Cancelando..." : "Confirmar cancelación"}</Button></DialogFooter>
  </DialogContent></Dialog>
}
