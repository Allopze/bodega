"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { EmptyState } from "@/components/ui/empty-state"
import { useOperation } from "@/lib/hooks/use-operation"
import { formatCLP, formatDate, formatDateTime } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/masters"
import type { getMaintenanceRecordDetail } from "@/lib/services/maintenance"
import { addMaintenanceLaborAction, addMaintenancePartAction, addMaintenanceTaskAction, decideMaintenanceCostApprovalAction, setMaintenanceTaskStatusAction, uploadMaintenanceDocumentAction } from "../actions"

type RecordDetail = Awaited<ReturnType<typeof getMaintenanceRecordDetail>>
const STATUS: Record<string, { label: string; variant: "outline" | "warning" | "success" | "danger" }> = {
  scheduled: { label: "Programada", variant: "outline" },
  in_progress: { label: "En curso", variant: "warning" },
  completed: { label: "Completada", variant: "success" },
  cancelled: { label: "Cancelada", variant: "danger" },
}

export function MaintenanceOrderWorkbench({ record, canEdit, canViewCosts, canApproveCosts }: { record: RecordDetail; canEdit: boolean; canViewCosts: boolean; canApproveCosts: boolean }) {
  const status = STATUS[record.status] ?? { label: record.status, variant: "outline" as const }
  const editable = canEdit && ["scheduled", "in_progress"].includes(record.status)
  return <PageContainer width="workbench">
    <PageHeader title={record.code ?? "Orden de trabajo"} description={`${record.vehicle.code ? `${record.vehicle.code} · ` : ""}${record.vehicle.plate} · ${record.worksite.name}`} breadcrumb={<Breadcrumbs items={[{ label: "Mantenciones", href: "/mantenciones" }, { label: record.code ?? "Detalle" }]} />} actions={<Button asChild variant="secondary"><Link href={`/flota/${record.vehicleId}`}>Ver activo</Link></Button>} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>Alcance de la orden</CardTitle><p className="mt-1 text-sm text-[var(--color-text-muted)]">{record.maintenanceType} · {formatDate(record.maintenanceDate)}</p></div><Badge variant={status.variant}>{status.label}</Badge></CardHeader><CardContent><dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Prioridad" value={record.priority} /><Info label="Responsable" value={record.assignee?.name ?? "Sin asignar"} /><Info label="SLA" value={record.slaDueAt ? formatDateTime(record.slaDueAt) : "Sin SLA"} />
          <Info label="Impacto operacional" value={record.operationalImpact === "out_of_service" ? "Fuera de servicio" : record.operationalImpact === "maintenance" ? "En mantención" : "Sin cambio"} /><Info label="Garantía" value={record.underWarranty ? "Sí" : "No"} /><Info label="Proveedor" value={record.supplier?.name ?? "Sin proveedor"} />
          {record.rootCause && <div className="sm:col-span-2 lg:col-span-3"><Info label="Causa raíz" value={record.rootCause} /></div>}
        </dl></CardContent></Card>
        <TasksCard maintenanceId={record.id} tasks={record.tasks} editable={editable} />
        <PartsCard maintenanceId={record.id} parts={record.parts} editable={editable} canViewCosts={canViewCosts} />
        <LaborCard maintenanceId={record.id} labor={record.labor} editable={editable} canViewCosts={canViewCosts} />
        <DocumentsCard maintenanceId={record.id} documents={record.documents} editable={editable} />
      </div>
      <aside className="space-y-4">
        <Card><CardHeader><CardTitle>Lecturas y detención</CardTitle></CardHeader><CardContent><dl className="space-y-3 text-sm"><Info label="Kilometraje" value={record.odometerReading == null ? "—" : `${record.odometerReading.toLocaleString("es-CL")} km`} /><Info label="Horómetro" value={record.hourMeterReading == null ? "—" : `${record.hourMeterReading.toLocaleString("es-CL")} h`} /><Info label="Inicio detención" value={record.downtimeStartedAt ? formatDateTime(record.downtimeStartedAt) : "—"} /><Info label="Fin detención" value={record.downtimeEndedAt ? formatDateTime(record.downtimeEndedAt) : "—"} /></dl></CardContent></Card>
        {canViewCosts && <CostCard record={record} canEdit={canEdit} canApprove={canApproveCosts} />}
        {record.inspectionFindingId && <Card><CardHeader><CardTitle>Origen</CardTitle></CardHeader><CardContent><p className="text-sm text-[var(--color-text-muted)]">Esta OT nació de un hallazgo de inspección. Al completarla, la plataforma acredita evidencia CAPA automáticamente.</p></CardContent></Card>}
      </aside>
    </div>
  </PageContainer>
}

function CostCard({ record, canEdit, canApprove }: { record: RecordDetail; canEdit: boolean; canApprove: boolean }) {
  const operation = useOperation()
  const approvalLabel: Record<string, string> = { not_required: "No solicitada", pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada" }
  return <Card><CardHeader><CardTitle>Costos</CardTitle></CardHeader><CardContent className="space-y-4"><dl className="space-y-3 text-sm"><Info label="Neto" value={formatCLP(record.netAmount ?? 0)} /><Info label="IVA" value={formatCLP(record.taxAmount ?? 0)} /><Info label="Total OT" value={formatCLP(record.totalAmount ?? 0)} /><Info label="Repuestos" value={formatCLP(record.parts.reduce((sum, part) => sum + part.quantity * (part.unitCost ?? 0), 0))} /><Info label="Mano de obra" value={formatCLP(record.labor.reduce((sum, entry) => sum + entry.hours * (entry.hourlyRate ?? 0), 0))} /><Info label="Aprobación" value={approvalLabel[record.costApprovalStatus] ?? record.costApprovalStatus} /></dl>{operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}<div className="flex flex-wrap gap-2">{canEdit && record.costApprovalStatus !== "pending" && record.costApprovalStatus !== "approved" && <Button type="button" size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => decideMaintenanceCostApprovalAction({ maintenanceId: record.id, decision: "request" }))}>Solicitar aprobación</Button>}{canApprove && record.costApprovalStatus === "pending" && <><Button type="button" size="sm" disabled={operation.pending} onClick={() => operation.run(() => decideMaintenanceCostApprovalAction({ maintenanceId: record.id, decision: "approve" }))}>Aprobar</Button><Button type="button" size="sm" variant="destructive" disabled={operation.pending} onClick={() => operation.run(() => decideMaintenanceCostApprovalAction({ maintenanceId: record.id, decision: "reject" }))}>Rechazar</Button></>}</div></CardContent></Card>
}

const DOCUMENT_TYPES = [
  { value: "quote", label: "Cotización" },
  { value: "diagnosis", label: "Diagnóstico" },
  { value: "work_order", label: "Orden / acta de taller" },
  { value: "invoice", label: "Factura" },
  { value: "evidence", label: "Evidencia fotográfica" },
  { value: "other", label: "Otro antecedente" },
]

function DocumentsCard({ maintenanceId, documents, editable }: { maintenanceId: string; documents: RecordDetail["documents"]; editable: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadMaintenanceDocumentAction, { ok: false, message: "" })
  const [documentType, setDocumentType] = useState("diagnosis")
  return <Card><CardHeader><CardTitle>Documentos y evidencias</CardTitle></CardHeader><CardContent className="space-y-4">
    {documents.length === 0 ? <EmptyState title="Sin documentos vigentes" description="Adjunta cotización, diagnóstico, factura o acta. Subir otro archivo del mismo tipo conserva la versión anterior como histórica." /> : <ul className="divide-y divide-[var(--color-border)]">{documents.map((document) => <li key={document.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><a className="font-medium text-[var(--color-accent-ink)] underline-offset-4 hover:underline" href={`/api/mantenciones/documentos/${document.id}`} target="_blank" rel="noreferrer">{document.fileName}</a><p className="text-xs text-[var(--color-text-muted)]">{DOCUMENT_TYPES.find((item) => item.value === document.documentType)?.label ?? document.documentType} · {document.status === "current" ? "Vigente" : "Reemplazado"}</p></div><Badge variant={document.status === "current" ? "success" : "outline"}>{document.status === "current" ? "Vigente" : "Histórico"}</Badge></li>)}</ul>}
    {editable && <form action={action} className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end"><input type="hidden" name="maintenanceId" value={maintenanceId} /><Field label="Tipo documental" htmlFor="maintenance-document-type"><OptionSelect id="maintenance-document-type" name="documentType" value={documentType} onValueChange={setDocumentType} options={DOCUMENT_TYPES} /></Field><Field label="Archivo" htmlFor="maintenance-document-file" hint="PDF o imagen, máximo 20 MB"><Input id="maintenance-document-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></Field><Button type="submit" disabled={pending}>{pending ? "Subiendo…" : "Adjuntar"}</Button></form>}
    {state.message && <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-[var(--color-success)]" : "text-sm text-[var(--color-danger)]"}>{state.message}</p>}
  </CardContent></Card>
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">{label}</dt><dd className="mt-0.5 font-medium text-[var(--color-text)]">{value}</dd></div> }

function TasksCard({ maintenanceId, tasks, editable }: { maintenanceId: string; tasks: RecordDetail["tasks"]; editable: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMaintenanceTaskAction, { ok: false, message: "" })
  const operation = useOperation()
  return <Card><CardHeader><CardTitle>Tareas</CardTitle></CardHeader><CardContent className="space-y-4">
    {tasks.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">La orden todavía no tiene tareas desglosadas.</p> : <ul className="space-y-2">{tasks.map((task) => <li key={task.id} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2"><span className={task.status === "completed" ? "text-sm line-through text-[var(--color-text-muted)]" : "text-sm"}>{task.description}</span>{editable && <Button size="sm" variant="ghost" disabled={operation.pending} onClick={() => operation.run(() => setMaintenanceTaskStatusAction({ taskId: task.id, maintenanceId, completed: task.status !== "completed" }))}>{task.status === "completed" ? "Reabrir" : "Completar"}</Button>}</li>)}</ul>}
    {operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}
    {editable && <form action={action} className="flex flex-col gap-2 sm:flex-row"><input type="hidden" name="maintenanceId" value={maintenanceId} /><Field label="Nueva tarea" htmlFor="new-maintenance-task" className="flex-1" error={state.fieldErrors?.description?.[0]}><Input id="new-maintenance-task" name="description" minLength={3} required /></Field><Button type="submit" className="self-end" disabled={pending}>Agregar</Button></form>}
    {state.message && !state.ok && <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>}
  </CardContent></Card>
}

function PartsCard({ maintenanceId, parts, editable, canViewCosts }: { maintenanceId: string; parts: RecordDetail["parts"]; editable: boolean; canViewCosts: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMaintenancePartAction, { ok: false, message: "" })
  return <Card><CardHeader><CardTitle>Repuestos e insumos</CardTitle></CardHeader><CardContent className="space-y-4">
    {parts.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No hay repuestos imputados a esta orden.</p> : <ul className="divide-y divide-[var(--color-border)]">{parts.map((part) => <li key={part.id} className="flex justify-between gap-3 py-2 text-sm"><span>{part.description}{part.partNumber ? ` · ${part.partNumber}` : ""}</span><span className="font-mono">{part.quantity.toLocaleString("es-CL")} {part.unit}{canViewCosts ? ` · ${formatCLP((part.unitCost ?? 0) * part.quantity)}` : ""}</span></li>)}</ul>}
    {editable && <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input type="hidden" name="maintenanceId" value={maintenanceId} /><Field label="Descripción" htmlFor="part-description" className="sm:col-span-2" error={state.fieldErrors?.description?.[0]}><Input id="part-description" name="description" required /></Field><Field label="Código" htmlFor="part-number"><Input id="part-number" name="partNumber" /></Field><Field label="Cantidad" htmlFor="part-quantity" required><Input id="part-quantity" name="quantity" type="number" min="0.001" step="0.001" required /></Field><Field label="Unidad" htmlFor="part-unit"><Input id="part-unit" name="unit" defaultValue="un" /></Field>{canViewCosts && <Field label="Costo unitario" htmlFor="part-cost"><Input id="part-cost" name="unitCost" type="number" min="0" step="1" defaultValue="0" /></Field>}<div className="flex items-end"><Button type="submit" disabled={pending}>Agregar repuesto</Button></div></form>}
    {state.message && !state.ok && <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>}
  </CardContent></Card>
}

function LaborCard({ maintenanceId, labor, editable, canViewCosts }: { maintenanceId: string; labor: RecordDetail["labor"]; editable: boolean; canViewCosts: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMaintenanceLaborAction, { ok: false, message: "" })
  return <Card><CardHeader><CardTitle>Mano de obra</CardTitle></CardHeader><CardContent className="space-y-4">{labor.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No hay horas imputadas.</p> : <ul className="divide-y divide-[var(--color-border)]">{labor.map((entry) => <li key={entry.id} className="flex justify-between gap-3 py-2 text-sm"><span>{entry.description}</span><span className="font-mono">{entry.hours.toLocaleString("es-CL")} h{canViewCosts ? ` · ${formatCLP(entry.hours * (entry.hourlyRate ?? 0))}` : ""}</span></li>)}</ul>}{editable && <form action={action} className="grid gap-3 sm:grid-cols-3"><input type="hidden" name="maintenanceId" value={maintenanceId} /><Field label="Trabajo realizado" htmlFor="labor-description" error={state.fieldErrors?.description?.[0]}><Input id="labor-description" name="description" required /></Field><Field label="Horas" htmlFor="labor-hours"><Input id="labor-hours" name="hours" type="number" min="0.01" step="0.01" required /></Field>{canViewCosts && <Field label="Tarifa por hora" htmlFor="labor-rate"><Input id="labor-rate" name="hourlyRate" type="number" min="0" step="1" defaultValue="0" /></Field>}<div className="sm:col-span-3"><Button type="submit" disabled={pending}>Agregar mano de obra</Button></div></form>}{state.message && !state.ok && <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>}</CardContent></Card>
}
