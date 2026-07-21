"use client"

import { useCallback, useState, useTransition, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Pagination } from "@/components/ui/pagination"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { PaginationState } from "@/lib/pagination"
import type { getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import type { listRiskImportBatchesPage } from "@/lib/services/prevention-risk-import"
import {
  activateRiskImportBatchAction,
  addRiskEntryAction,
  approveRiskImportBatchAction,
  createRiskMatrixDraftAction,
  ensureIspRiskMethodologyAction,
  resolveRiskImportRowAction,
  resolveRiskReviewTriggerAction,
  stageRiskImportAction,
  transitionRiskMatrixAction,
} from "./actions"

type Dashboard = Awaited<ReturnType<typeof getRiskDashboard>>
type Imports = Awaited<ReturnType<typeof listRiskImportBatchesPage>>["rows"]
type Result = { ok: boolean; message?: string }

const STATUS_LABEL: Record<string, string> = { draft: "Borrador", in_review: "En revisión", reviewed: "Revisada", approved: "Aprobada", published: "Vigente", superseded: "Reemplazada", staged: "En revisión", activated: "Activado" }

function variant(status: string): "success" | "warning" | "danger" | "default" | "outline" {
  if (["published", "approved", "activated", "completed"].includes(status)) return "success"
  if (["in_review", "reviewed", "pending", "overdue", "staged"].includes(status)) return "warning"
  if (["ineffective", "rejected"].includes(status)) return "danger"
  return "default"
}

function useOperation() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState("")
  function run(operation: () => Promise<Result>, onSuccess?: () => void) {
    setMessage("")
    startTransition(async () => {
      const result = await operation()
      setMessage(result.ok ? "Guardado correctamente." : result.message ?? "No se pudo completar la acción.")
      if (result.ok) onSuccess?.()
    })
  }
  return { pending, message, run }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="font-medium">{label}</span>{children}</label>
}

export function MiperHeaderActions({ worksites, methodologies, canEdit }: {
  worksites: Dashboard["worksites"]
  methodologies: Dashboard["methodologies"]
  canEdit: boolean
}) {
  const operation = useOperation()
  if (!canEdit) return null
  return (
    <div className="flex gap-2">
      {methodologies.length === 0 && <Button variant="secondary" disabled={operation.pending} onClick={() => operation.run(ensureIspRiskMethodologyAction)}>Registrar metodología ISP</Button>}
      <MatrixDialog worksites={worksites} methodologies={methodologies} />
      <ImportDialog worksites={worksites} />
    </div>
  )
}

function MatrixDialog({ worksites, methodologies }: { worksites: Dashboard["worksites"]; methodologies: Dashboard["methodologies"] }) {
  const [open, setOpen] = useState(false)
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [methodologyId, setMethodologyId] = useState(methodologies[0]?.id ?? "")
  const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    operation.run(() => createRiskMatrixDraftAction({
      worksiteId: values.get("worksiteId"), title: values.get("title"), methodologyId: values.get("methodologyId"),
      revisionReason: values.get("revisionReason"), participationSummary: values.get("participationSummary"), consultationEvidenceReference: values.get("consultationEvidenceReference"),
    }), () => setOpen(false))
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button disabled={!worksites.length || !methodologies.length}>Nueva versión</Button></DialogTrigger><DialogContent className="max-w-2xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Nueva versión MIPER</DialogTitle><DialogDescription>La versión parte como borrador y requiere revisión, aprobación y publicación segregadas.</DialogDescription></DialogHeader>
      <div className="grid gap-3 md:grid-cols-2"><Field label="Faena"><Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} /></Field><Field label="Metodología"><Select value={methodologyId} onValueChange={setMethodologyId}><SelectTrigger><SelectValue placeholder="Selecciona metodología" /></SelectTrigger><SelectContent>{methodologies.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="methodologyId" value={methodologyId} /></Field></div>
      <Field label="Título"><Input name="title" required minLength={5} /></Field><Field label="Motivo de revisión"><Textarea name="revisionReason" required minLength={10} /></Field><Field label="Participación y consulta"><Textarea name="participationSummary" required minLength={10} /></Field><Field label="Evidencia de consulta"><Input name="consultationEvidenceReference" required /></Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Crear borrador</Button></DialogFooter></form></DialogContent></Dialog>
  )
}

function ImportDialog({ worksites }: { worksites: Dashboard["worksites"] }) {
  const [open, setOpen] = useState(false)
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => stageRiskImportAction(form), () => setOpen(false))
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="secondary" disabled={!worksites.length}>Importar XLSX</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Importar MIPER</DialogTitle><DialogDescription>El original y su hash se conservan. Las filas observadas no se activan hasta resolverlas.</DialogDescription></DialogHeader><Field label="Faena"><Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} /></Field><Field label="Archivo XLSX"><Input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Cargar lote</Button></DialogFooter></form></DialogContent></Dialog>
}

export function MiperWorkbench({ dashboard, imports, importsTotal, importsPagination, currentUserId, canEdit, canReview, canApprove, canPublish }: {
  dashboard: Dashboard
  imports: Imports
  importsTotal: number
  importsPagination: PaginationState
  currentUserId: string
  canEdit: boolean
  canReview: boolean
  canApprove: boolean
  canPublish: boolean
}) {
  const published = dashboard.matrices.filter((item) => item.status === "published")
  const router = useRouter()
  const searchParams = useSearchParams()
  const navigateImportsPage = useCallback((page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (page > 1) params.set("page", String(page))
    else params.delete("page")
    const qs = params.toString()
    router.push(qs ? `?${qs}` : "")
  }, [router, searchParams])
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y lg:grid-cols-4">
        <a href="#versiones" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Procesos cubiertos</span><strong className="block text-xl">{dashboard.coverage.coveredProcesses}/{dashboard.coverage.activeProcesses}</strong></a>
        <a href="#versiones" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Puestos cubiertos</span><strong className="block text-xl">{dashboard.coverage.coveredPositions}/{dashboard.coverage.activePositions}</strong></a>
        <a href="#bloqueos" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Riesgos críticos abiertos</span><strong className="block text-xl">{dashboard.criticalBlockers.length}</strong></a>
        <a href="#revisiones" className="px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Revisiones pendientes</span><strong className="block text-xl">{dashboard.triggers.length}</strong></a>
      </div>
      {published.length === 0 && <div role="status" className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-4 text-sm"><strong>No existe una MIPER vigente en las faenas visibles.</strong><p className="mt-1">Crea o importa una versión, incorpora peligros y completa el workflow segregado.</p></div>}
      <Tabs defaultValue="versions"><TabsList><TabsTrigger value="versions">Versiones</TabsTrigger><TabsTrigger value="reviews">Revisiones ({dashboard.triggers.length})</TabsTrigger><TabsTrigger value="imports">Importaciones ({importsTotal})</TabsTrigger></TabsList>
        <TabsContent value="versions" id="versiones" className="space-y-3">
          {dashboard.matrices.length === 0 ? <EmptyState title="Sin versiones MIPER" description="Crea la primera versión usando una metodología validada." /> : dashboard.matrices.map((matrix) => {
            const entries = dashboard.entries.filter((item) => item.entry.matrixId === matrix.id)
            return <section key={matrix.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{matrix.title} · v{matrix.matrixVersion}</h2><Badge variant={variant(matrix.status)}>{STATUS_LABEL[matrix.status] ?? matrix.status}</Badge></div><p className="mt-1 text-sm text-[var(--color-text-subtle)]">{entries.length} peligro(s) · {matrix.revisionReason}</p>{matrix.publishedHashSha256 && <p className="mt-1 font-mono text-xs">SHA-256 {matrix.publishedHashSha256.slice(0, 16)}…</p>}</div><div className="flex flex-wrap gap-2">{matrix.status === "draft" && canEdit && <AddRiskDialog matrixId={matrix.id} />}{matrix.status === "published" && <Button variant="secondary" asChild><Link href={`/api/prevencion/miper/${matrix.id}/export`}>Exportar XLSX</Link></Button>}<MatrixTransition matrix={matrix} currentUserId={currentUserId} canEdit={canEdit} canReview={canReview} canApprove={canApprove} canPublish={canPublish} /></div></div>
              {entries.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-2">{entries.slice(0, 8).map(({ entry, process, task, position }) => <div key={entry.id} className="rounded border p-3 text-sm"><div className="flex justify-between gap-2"><strong>{entry.hazardCode} · {entry.hazard}</strong>{entry.isCritical && <Badge variant="danger">Crítico</Badge>}</div><p className="mt-1 text-[var(--color-text-subtle)]">{process.name} → {task.name} → {position.name}</p><p className="mt-1">Residual: {entry.residualLevel}</p></div>)}</div>}
            </section>
          })}
        </TabsContent>
        <TabsContent value="reviews" id="revisiones" className="space-y-3">{dashboard.triggers.length === 0 ? <EmptyState title="Sin revisiones pendientes" description="La revisión anual y los cambios/incidentes crearán tareas aquí." /> : dashboard.triggers.map((trigger) => <div key={trigger.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><div className="flex gap-2"><strong>{trigger.description}</strong><Badge variant={trigger.dueAt < new Date().toISOString().slice(0, 10) ? "danger" : "warning"}>{trigger.dueAt}</Badge></div><p className="text-xs text-[var(--color-text-subtle)]">Origen {trigger.sourceType} · {trigger.sourceId}</p></div>{canReview && <ResolveTriggerDialog triggerId={trigger.id} matrices={published.filter((item) => item.worksiteId === trigger.worksiteId)} />}</div>)}</TabsContent>
        <TabsContent value="imports" className="space-y-3">
          {imports.length === 0 ? <EmptyState title="Sin importaciones" description="Carga un XLSX para conservar el original y revisar su normalización." /> : imports.map((batch) => <ImportBatch key={batch.id} batch={batch} methodologies={dashboard.methodologies} canEdit={canEdit} canApprove={canApprove} currentUserId={currentUserId} />)}
          {importsPagination.totalPages > 1 && (
            <div className="flex justify-center pt-2">
              <Pagination page={importsPagination.page} total={importsPagination.totalItems} perPage={importsPagination.limit} onPage={navigateImportsPage} />
            </div>
          )}
        </TabsContent>
      </Tabs>
      {dashboard.criticalBlockers.length > 0 && <section id="bloqueos" className="rounded-lg border border-[var(--color-danger-line)] p-4"><h2 className="font-semibold">Bloqueos críticos</h2><p className="text-sm text-[var(--color-text-subtle)]">Un riesgo crítico permanece aquí si no tiene control crítico implementado/verificado o cobertura PDTP.</p><ul className="mt-3 space-y-2">{dashboard.criticalBlockers.map(({ entry, process, task }) => <li key={entry.id} className="text-sm"><strong>{entry.hazard}</strong> · {process.name} / {task.name}</li>)}</ul></section>}
    </div>
  )
}

function AddRiskDialog({ matrixId }: { matrixId: string }) {
  const [open, setOpen] = useState(false)
  const [hierarchy, setHierarchy] = useState("elimination")
  const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const v = new FormData(event.currentTarget); const critical = v.get("critical") === "on"; const control = String(v.get("control") ?? "").trim()
    operation.run(() => addRiskEntryAction({ matrixId, process: { code: v.get("processCode"), name: v.get("process") }, task: { code: v.get("taskCode"), name: v.get("task"), isRoutine: true }, position: { code: v.get("positionCode"), name: v.get("position") }, hazardCode: v.get("hazardCode"), hazard: v.get("hazard"), riskFactor: v.get("factor"), expectedEventOrDamage: v.get("damage"), exposedPeopleDescription: v.get("exposed"), exposedPeopleCount: Number(v.get("count") || 0), genderConsiderations: v.get("gender"), sensitiveWorkerConsiderations: v.get("sensitivity"), inherentDimensions: { assessment: v.get("inherent") }, inherentLevel: v.get("inherent"), residualDimensions: { assessment: v.get("residual") }, residualLevel: v.get("residual"), isCritical: critical, responsibleSnapshot: v.get("responsible"), evidenceReference: v.get("evidence") || null, controls: control ? [{ description: control, hierarchy: v.get("hierarchy"), isExisting: true, isCritical: critical, performanceStandard: critical ? v.get("standard") : null, verificationFrequency: critical ? v.get("frequency") : null, responsibleSnapshot: v.get("responsible"), status: "proposed" }] : [] }), () => setOpen(false))
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm">Agregar peligro</Button></DialogTrigger><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Agregar peligro y control</DialogTitle><DialogDescription>La jerarquía y evaluación quedan congeladas en esta versión.</DialogDescription></DialogHeader><div className="grid gap-3 md:grid-cols-3"><Field label="Proceso"><Input name="process" required /></Field><Field label="Código proceso"><Input name="processCode" required /></Field><span /><Field label="Tarea"><Input name="task" required /></Field><Field label="Código tarea"><Input name="taskCode" required /></Field><span /><Field label="Puesto"><Input name="position" required /></Field><Field label="Código puesto"><Input name="positionCode" required /></Field><span /></div><div className="grid gap-3 md:grid-cols-2"><Field label="Código peligro"><Input name="hazardCode" required /></Field><Field label="Peligro"><Input name="hazard" required /></Field><Field label="Factor"><Input name="factor" required /></Field><Field label="Evento o daño"><Input name="damage" required /></Field><Field label="Personas expuestas"><Input name="exposed" required /></Field><Field label="Cantidad"><Input name="count" type="number" min="0" defaultValue="0" /></Field><Field label="Evaluación inherente"><Input name="inherent" required /></Field><Field label="Riesgo residual"><Input name="residual" required /></Field></div><Field label="Enfoque de género"><Textarea name="gender" required minLength={3} /></Field><Field label="Personas especialmente sensibles"><Textarea name="sensitivity" required minLength={3} /></Field><div className="grid gap-3 md:grid-cols-2"><Field label="Responsable"><Input name="responsible" required /></Field><Field label="Evidencia"><Input name="evidence" /></Field></div><label className="flex items-center gap-2 text-sm"><input name="critical" type="checkbox" /> Riesgo/control crítico</label><Field label="Control existente o planificado"><Textarea name="control" /></Field><div className="grid gap-3 md:grid-cols-3"><Field label="Jerarquía"><Select value={hierarchy} onValueChange={setHierarchy}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="elimination">Eliminación</SelectItem><SelectItem value="substitution">Sustitución</SelectItem><SelectItem value="engineering">Ingeniería</SelectItem><SelectItem value="administrative">Administrativo</SelectItem><SelectItem value="ppe">EPP</SelectItem></SelectContent></Select><input type="hidden" name="hierarchy" value={hierarchy} /></Field><Field label="Estándar crítico"><Input name="standard" /></Field><Field label="Frecuencia"><Input name="frequency" /></Field></div>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Guardar peligro</Button></DialogFooter></form></DialogContent></Dialog>
}

function MatrixTransition({ matrix, currentUserId, canEdit, canReview, canApprove, canPublish }: { matrix: Dashboard["matrices"][number]; currentUserId: string; canEdit: boolean; canReview: boolean; canApprove: boolean; canPublish: boolean }) {
  const next = matrix.status === "draft" && canEdit ? ["in_review", "Enviar a revisión"] : matrix.status === "in_review" && canReview && matrix.createdByUserId !== currentUserId ? ["reviewed", "Revisar"] : matrix.status === "reviewed" && canApprove && matrix.createdByUserId !== currentUserId && matrix.reviewedByUserId !== currentUserId ? ["approved", "Aprobar"] : matrix.status === "approved" && canPublish ? ["published", "Publicar"] : null
  const [open, setOpen] = useState(false); const operation = useOperation()
  if (!next) return null
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => transitionRiskMatrixAction({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: next![0], reason: v.get("reason"), effectiveFrom: next![0] === "published" ? v.get("effectiveFrom") : undefined }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">{next[1]}</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>{next[1]} MIPER v{matrix.matrixVersion}</DialogTitle><DialogDescription>La decisión quedará en el historial con actor y fecha.</DialogDescription></DialogHeader><Field label="Fundamento"><Textarea name="reason" required minLength={10} /></Field>{next[0] === "published" && <Field label="Vigente desde"><DatePicker name="effectiveFrom" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>}{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>{next[1]}</Button></DialogFooter></form></DialogContent></Dialog>
}

function ResolveTriggerDialog({ triggerId, matrices }: { triggerId: string; matrices: Dashboard["matrices"] }) {
  const [open, setOpen] = useState(false); const [matrixId, setMatrixId] = useState(matrices[0]?.id ?? ""); const operation = useOperation()
  if (!matrices.length) return <Badge variant="warning">Requiere nueva publicación</Badge>
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => resolveRiskReviewTriggerAction({ triggerId, matrixId: v.get("matrixId"), resolution: v.get("resolution") }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">Completar revisión</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Completar disparador</DialogTitle><DialogDescription>Sólo una publicación posterior al disparador puede cerrarlo.</DialogDescription></DialogHeader><Field label="Versión publicada"><Select value={matrixId} onValueChange={setMatrixId}><SelectTrigger><SelectValue placeholder="Selecciona versión" /></SelectTrigger><SelectContent>{matrices.map((item) => <SelectItem key={item.id} value={item.id}>v{item.matrixVersion} · {item.title}</SelectItem>)}</SelectContent></Select><input type="hidden" name="matrixId" value={matrixId} /></Field><Field label="Resultado"><Textarea name="resolution" required minLength={10} /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Completar</Button></DialogFooter></form></DialogContent></Dialog>
}

function ImportBatch({ batch, methodologies, canEdit, canApprove, currentUserId }: { batch: Imports[number]; methodologies: Dashboard["methodologies"]; canEdit: boolean; canApprove: boolean; currentUserId: string }) {
  const operation = useOperation()
  return <section className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex gap-2"><strong>{batch.sourceFileName}</strong><Badge variant={variant(batch.status)}>{STATUS_LABEL[batch.status] ?? batch.status}</Badge></div><p className="mt-1 text-xs text-[var(--color-text-subtle)]">SHA-256 {batch.sourceChecksumSha256} · {batch.totalRows} filas · {batch.reviewRows} observadas</p></div><div className="flex gap-2"><Button asChild size="sm" variant="secondary"><Link href={`/api/prevencion/miper/importaciones/${batch.id}/original`}>Original</Link></Button>{batch.status === "staged" && canApprove && batch.createdByUserId !== currentUserId && <Button size="sm" disabled={operation.pending || batch.rows.some((row) => row.status === "needs_review")} onClick={() => operation.run(() => approveRiskImportBatchAction(batch.id))}>Aprobar lote</Button>}{batch.status === "approved" && canEdit && methodologies.length > 0 && <ActivateImportDialog batchId={batch.id} methodologies={methodologies} />}</div></div>{operation.message && <p role="status" className="mt-2 text-sm">{operation.message}</p>}<div className="mt-3 space-y-2">{batch.rows.filter((row) => row.status === "needs_review").map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-warning-line)] p-3 text-sm"><span>Fila {row.rowNumber}: {(row.issues as string[]).join("; ")}</span>{canEdit && <ResolveImportRowDialog row={row} />}</div>)}</div></section>
}

function ActivateImportDialog({ batchId, methodologies }: { batchId: string; methodologies: Dashboard["methodologies"] }) {
  const [open, setOpen] = useState(false); const [methodologyId, setMethodologyId] = useState(methodologies[0]?.id ?? ""); const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => activateRiskImportBatchAction({ batchId, title: v.get("title"), methodologyId: v.get("methodologyId"), revisionReason: v.get("reason"), participationSummary: v.get("participation"), consultationEvidenceReference: v.get("evidence") }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm">Crear borrador</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Activar lote aprobado</DialogTitle><DialogDescription>Crea una MIPER borrador; aún debe completar su workflow.</DialogDescription></DialogHeader><Field label="Título"><Input name="title" required defaultValue="MIPER importada" /></Field><Field label="Metodología"><Select value={methodologyId} onValueChange={setMethodologyId}><SelectTrigger><SelectValue placeholder="Selecciona metodología" /></SelectTrigger><SelectContent>{methodologies.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="methodologyId" value={methodologyId} /></Field><Field label="Motivo"><Textarea name="reason" required minLength={10} /></Field><Field label="Participación"><Textarea name="participation" required minLength={10} /></Field><Field label="Evidencia de consulta"><Input name="evidence" required /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Activar</Button></DialogFooter></form></DialogContent></Dialog>
}

function ResolveImportRowDialog({ row }: { row: Imports[number]["rows"][number] }) {
  const [open, setOpen] = useState(false); const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); let normalized: unknown; try { normalized = JSON.parse(String(v.get("normalized"))) } catch { return }; operation.run(() => resolveRiskImportRowAction({ rowId: row.id, normalized, resolution: v.get("resolution"), reject: v.get("reject") === "on" }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">Resolver</Button></DialogTrigger><DialogContent className="max-w-2xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Resolver fila {row.rowNumber}</DialogTitle><DialogDescription>El original permanece intacto; sólo se modifica la normalización y queda la decisión.</DialogDescription></DialogHeader><Field label="Normalización JSON"><Textarea name="normalized" className="min-h-64 font-mono text-xs" defaultValue={JSON.stringify(row.normalized, null, 2)} /></Field><Field label="Decisión"><Textarea name="resolution" required minLength={10} /></Field><label className="flex gap-2 text-sm"><input name="reject" type="checkbox" /> Rechazar fila</label>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Guardar decisión</Button></DialogFooter></form></DialogContent></Dialog>
}
