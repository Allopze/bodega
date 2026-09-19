"use client"

import { useCallback, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { OptionSelect } from "@/components/ui/option-select"
import { Pagination } from "@/components/ui/pagination"
import { RISK_LEVELS, RISK_LEVEL_LABEL, riskLevelLabel } from "@/lib/prevention/risk-levels"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/utils"
import { useOperation } from "@/lib/hooks/use-operation"
import { Field } from "@/components/ui/field"
import type { PaginationState } from "@/lib/pagination"
import type { getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import type { listRiskImportBatchesPage } from "@/lib/services/prevention-risk-import"
import {
  activateRiskImportBatchAction,
  addRiskEntryAction,
  approveRiskImportBatchAction,
  createRiskMatrixDraftAction,
  ensureIspRiskMethodologyAction,
  reopenRiskImportBatchAction,
  resolveRiskImportRowAction,
  resolveRiskReviewTriggerAction,
  stageRiskImportAction,
  transitionRiskMatrixAction,
} from "./actions"

type Dashboard = Awaited<ReturnType<typeof getRiskDashboard>>
type Imports = Awaited<ReturnType<typeof listRiskImportBatchesPage>>["rows"]
const MIPER_TABS = new Set(["versions", "reviews", "imports"])

function resolveMiperTab(value: string | null) {
  return value && MIPER_TABS.has(value) ? value : "versions"
}

type RiskMatrixPermissions = {
  canEdit: boolean
  canReview: boolean
  canApprove: boolean
  canPublish: boolean
}

const STATUS_LABEL: Record<string, string> = { draft: "Borrador", in_review: "En revisión", reviewed: "Revisada", approved: "Aprobada", published: "Vigente", superseded: "Reemplazada", staged: "En revisión", activated: "Activado" }

function variant(status: string): "success" | "warning" | "danger" | "default" | "outline" {
  if (["published", "approved", "activated", "completed"].includes(status)) return "success"
  if (["in_review", "reviewed", "pending", "overdue", "staged"].includes(status)) return "warning"
  if (["ineffective", "rejected"].includes(status)) return "danger"
  return "default"
}

export function MiperHeaderActions({ worksites, methodologies, matrices, committeeMeetings, canEdit }: {
  worksites: Dashboard["worksites"]
  methodologies: Dashboard["methodologies"]
  matrices: Dashboard["matrices"]
  committeeMeetings: Dashboard["committeeMeetings"]
  canEdit: boolean
}) {
  const operation = useOperation()
  if (!canEdit) return null
  return (
    <div className="flex gap-2">
      {methodologies.length === 0 && <Button variant="secondary" disabled={operation.pending} onClick={() => operation.run(ensureIspRiskMethodologyAction)}>Registrar metodología ISP</Button>}
      <MatrixDialog worksites={worksites} methodologies={methodologies} matrices={matrices} committeeMeetings={committeeMeetings} />
      <ImportDialog worksites={worksites} />
    </div>
  )
}

function MatrixDialog({ worksites, methodologies, matrices, committeeMeetings }: { worksites: Dashboard["worksites"]; methodologies: Dashboard["methodologies"]; matrices: Dashboard["matrices"]; committeeMeetings: Dashboard["committeeMeetings"] }) {
  const [open, setOpen] = useState(false)
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [methodologyId, setMethodologyId] = useState(methodologies[0]?.id ?? "")
  /* MIPER-06: el servicio sabe crear una revisión copiando la versión vigente
   * (`sourceMatrixId` → copia peligros y controles y deja `supersedesMatrixId`),
   * pero este diálogo nunca enviaba el parámetro, así que ese camino era
   * inalcanzable y toda "nueva versión" nacía vacía. La vigente de la faena
   * elegida es el valor por defecto: revisar es lo normal, partir de cero es la
   * excepción. */
  const [sourceMatrixId, setSourceMatrixId] = useState("")
  /* MIPER-07: la sesión del comité es lo que vuelve verificable la participación
   * del CPHS que `participationSummary` sólo describe en prosa, y es lo único
   * que alimenta el crédito Oro `iper_committee_participation`. Es opcional: no
   * toda revisión MIPER pasa por el comité. */
  const [committeeMeetingId, setCommitteeMeetingId] = useState("")
  /* El nombre de la metodología es una frase larga (la guía completa) y el
   * trigger la trunca a media palabra: dentro se muestra el código, que es
   * corto y único junto a la versión; el nombre completo queda en la lista. */
  const methodology = methodologies.find((item) => item.id === methodologyId)
  const published = matrices.filter((item) => item.status === "published" && item.worksiteId === worksiteId)
  const meetings = committeeMeetings.filter((item) => item.worksiteId === worksiteId)
  const operation = useOperation()
  function chooseWorksite(value: string) {
    setWorksiteId(value)
    setSourceMatrixId(matrices.find((item) => item.status === "published" && item.worksiteId === value)?.id ?? "")
    // La sesión pertenece al comité de una faena: al cambiarla, la elegida deja
    // de ser elegible y el servidor la rechazaría.
    setCommitteeMeetingId("")
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const source = String(values.get("sourceMatrixId") ?? "")
    operation.run(() => createRiskMatrixDraftAction({
      worksiteId: values.get("worksiteId"), title: values.get("title"), methodologyId: values.get("methodologyId"),
      revisionReason: values.get("revisionReason"), participationSummary: values.get("participationSummary"), consultationEvidenceReference: values.get("consultationEvidenceReference"),
      committeeMeetingId: values.get("committeeMeetingId") || null,
      ...(source ? { sourceMatrixId: source } : {}),
    }), () => setOpen(false))
  }
  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) chooseWorksite(worksiteId) }}><DialogTrigger asChild><Button disabled={!worksites.length || !methodologies.length}>Nueva versión</Button></DialogTrigger><DialogContent className="max-w-2xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Nueva versión MIPER</DialogTitle><DialogDescription>La versión parte como borrador y requiere revisión, aprobación y publicación segregadas.</DialogDescription></DialogHeader>
      <div className="grid gap-3 md:grid-cols-2"><Field label="Faena" required><Select value={worksiteId} onValueChange={chooseWorksite}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} /></Field><Field label="Metodología" required><Select value={methodologyId} onValueChange={setMethodologyId}><SelectTrigger><SelectValue placeholder="Selecciona metodología">{methodology ? `${methodology.code} · ${methodology.versionLabel}` : null}</SelectValue></SelectTrigger><SelectContent>{methodologies.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="methodologyId" value={methodologyId} /></Field></div>
      <Field label="Punto de partida"><OptionSelect id="miper-source-matrix" value={sourceMatrixId} onValueChange={setSourceMatrixId} emptyLabel="Matriz nueva, sin peligros" placeholder="Matriz nueva, sin peligros" disabled={published.length === 0} options={published.map((item) => ({ value: item.id, label: `Revisar la vigente · v${item.matrixVersion} · ${item.title}` }))} /><input type="hidden" name="sourceMatrixId" value={sourceMatrixId} /></Field>
      <Field label="Título" required><Input name="title" required minLength={5} /></Field><Field label="Motivo de revisión" required><Textarea name="revisionReason" required minLength={10} /></Field><Field label="Participación y consulta" required><Textarea name="participationSummary" required minLength={10} /></Field><Field label="Evidencia de consulta" required><Input name="consultationEvidenceReference" required /></Field>
      <Field label="Sesión del comité paritario"><OptionSelect id="miper-committee-meeting" value={committeeMeetingId} onValueChange={setCommitteeMeetingId} emptyLabel="Sin sesión del comité" placeholder="Sin sesión del comité" disabled={meetings.length === 0} options={meetings.map((item) => ({ value: item.id, label: `${item.code} · ${formatDate(item.scheduledFor)}` }))} /><input type="hidden" name="committeeMeetingId" value={committeeMeetingId} /></Field>
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
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="secondary" disabled={!worksites.length}>Importar Excel</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Importar MIPER</DialogTitle><DialogDescription>El original y su hash se conservan. Las filas observadas no se activan hasta resolverlas.</DialogDescription></DialogHeader><Field label="Faena"><Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} /></Field><Field label="Archivo Excel"><Input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Cargar lote</Button></DialogFooter></form></DialogContent></Dialog>
}

export function MiperWorkbench({ dashboard, imports, importsTotal, importsPagination, currentUserId, permissions, today }: {
  dashboard: Dashboard
  imports: Imports
  importsTotal: number
  importsPagination: PaginationState
  currentUserId: string
  permissions: RiskMatrixPermissions
  today: string
}) {
  const { canEdit, canReview, canApprove } = permissions
  const published = dashboard.matrices.filter((item) => item.status === "published")
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => resolveMiperTab(searchParams.get("tab")))
  const navigateTab = useCallback((value: string) => {
    setActiveTab(value)
    const params = new URLSearchParams(searchParams.toString())
    if (value === "versions") params.delete("tab")
    else params.set("tab", value)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "", { scroll: false })
  }, [router, searchParams])
  const navigateImportsPage = useCallback((page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (page > 1) params.set("page", String(page))
    else params.delete("page")
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "", { scroll: false })
  }, [router, searchParams])
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y lg:grid-cols-4">
        <a href="#versiones" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Procesos cubiertos</span><strong className="block text-xl">{dashboard.coverage.coveredProcesses}/{dashboard.coverage.activeProcesses}</strong></a>
        <a href="#versiones" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Puestos cubiertos</span><strong className="block text-xl">{dashboard.coverage.coveredPositions}/{dashboard.coverage.activePositions}</strong></a>
        <a href="#bloqueos" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Riesgos críticos abiertos</span><strong className="block text-xl">{dashboard.criticalBlockers.length}</strong></a>
        <a href="#revisiones" className="px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Revisiones pendientes</span><strong className="block text-xl">{dashboard.triggers.length}</strong></a>
      </div>
      {published.length === 0 && <Callout tone="warning" title="No existe una MIPER vigente en las faenas visibles." className="p-4">Crea o importa una versión, incorpora peligros y completa el workflow segregado.</Callout>}
      <Tabs value={activeTab} onValueChange={navigateTab}><TabsList><TabsTrigger value="versions">Versiones</TabsTrigger><TabsTrigger value="reviews">Revisiones ({dashboard.triggers.length})</TabsTrigger><TabsTrigger value="imports">Importaciones ({importsTotal})</TabsTrigger></TabsList>
        <TabsContent value="versions" className="space-y-3"><div id="versiones">
          {dashboard.matrices.length === 0 ? <EmptyState title="Sin versiones MIPER" description="Crea la primera versión usando una metodología validada." /> : dashboard.matrices.map((matrix) => {
            const entries = dashboard.entries.filter((item) => item.entry.matrixId === matrix.id)
            return <section key={matrix.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{matrix.title} · v{matrix.matrixVersion}</h2><MetaBadge meta={{ label: STATUS_LABEL[matrix.status] ?? matrix.status, variant: variant(matrix.status) }} /></div><p className="mt-1 text-sm text-[var(--color-text-subtle)]">{entries.length} peligro(s) · {matrix.revisionReason}</p>{matrix.publishedHashSha256 && <p className="mt-1 font-mono text-xs">SHA-256 {matrix.publishedHashSha256.slice(0, 16)}…</p>}</div><div className="flex flex-wrap gap-2">{matrix.status === "draft" && canEdit && <AddRiskDialog matrixId={matrix.id} />}{matrix.status === "published" && <Button variant="secondary" asChild><a href={`/api/prevencion/miper/${matrix.id}/export`} download>Exportar Excel</a></Button>}<MatrixTransition matrix={matrix} currentUserId={currentUserId} permissions={permissions} today={today} /></div></div>
              {entries.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-2">{entries.slice(0, 8).map(({ entry, process, task, position }) => <div key={entry.id} className="rounded border p-3 text-sm"><div className="flex justify-between gap-2"><strong>{entry.hazardCode} · {entry.hazard}</strong>{entry.isCritical && <MetaBadge meta={{ label: "Crítico", variant: "danger" }} />}</div><p className="mt-1 text-[var(--color-text-subtle)]">{process.name} → {task.name} → {position.name}</p><p className="mt-1">Residual: {riskLevelLabel(entry.residualLevel)}</p></div>)}</div>}
            </section>
          })}
        </div></TabsContent>
        <TabsContent value="reviews" className="space-y-3"><div id="revisiones">{dashboard.triggers.length === 0 ? <EmptyState title="Sin revisiones pendientes" description="La revisión anual y los cambios/incidentes crearán tareas aquí." /> : dashboard.triggers.map((trigger) => <div key={trigger.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><div className="flex gap-2"><strong>{trigger.description}</strong><MetaBadge meta={{ label: formatDate(trigger.dueAt), variant: trigger.dueAt < today ? "danger" : "warning" }} /></div><p className="text-xs text-[var(--color-text-subtle)]">Origen {trigger.sourceType} · {trigger.sourceId}</p></div>{canReview && <ResolveTriggerDialog triggerId={trigger.id} matrices={published.filter((item) => item.worksiteId === trigger.worksiteId)} />}</div>)}</div></TabsContent>
        <TabsContent value="imports" className="space-y-3">
          {imports.length === 0 ? <EmptyState title="Sin importaciones" description="Carga un Excel para conservar el original y revisar su normalización." /> : imports.map((batch) => <ImportBatch key={batch.id} batch={batch} methodologies={dashboard.methodologies} committeeMeetings={dashboard.committeeMeetings} canEdit={canEdit} canApprove={canApprove} currentUserId={currentUserId} />)}
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
  // MIPER-01: el nivel era un campo de texto libre, así que cada quien escribía
  // "Alto", "alto" o "high" y la UI sólo sabía pintar el enum inglés. La lista
  // canónica es la de lib/prevention/risk-levels, la misma que valida el
  // servidor y la que restringe la base.
  const [inherentLevel, setInherentLevel] = useState<string>(RISK_LEVELS[2])
  const [residualLevel, setResidualLevel] = useState<string>(RISK_LEVELS[1])
  const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const v = new FormData(event.currentTarget); const critical = v.get("critical") === "on"; const control = String(v.get("control") ?? "").trim()
    operation.run(() => addRiskEntryAction({ matrixId, process: { code: v.get("processCode"), name: v.get("process") }, task: { code: v.get("taskCode"), name: v.get("task"), isRoutine: true }, position: { code: v.get("positionCode"), name: v.get("position") }, hazardCode: v.get("hazardCode"), hazard: v.get("hazard"), riskFactor: v.get("factor"), expectedEventOrDamage: v.get("damage"), exposedPeopleDescription: v.get("exposed"), exposedPeopleCount: Number(v.get("count") || 0), genderConsiderations: v.get("gender"), sensitiveWorkerConsiderations: v.get("sensitivity"), inherentDimensions: { assessment: v.get("inherent") }, inherentLevel: v.get("inherent"), residualDimensions: { assessment: v.get("residual") }, residualLevel: v.get("residual"), isCritical: critical, responsibleSnapshot: v.get("responsible"), evidenceReference: v.get("evidence") || null, controls: control ? [{ description: control, hierarchy: v.get("hierarchy"), isExisting: true, isCritical: critical, performanceStandard: critical ? v.get("standard") : null, verificationFrequency: critical ? v.get("frequency") : null, responsibleSnapshot: v.get("responsible"), status: "proposed" }] : [] }), () => setOpen(false))
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm">Agregar peligro</Button></DialogTrigger><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Agregar peligro y control</DialogTitle><DialogDescription>La jerarquía y evaluación quedan congeladas en esta versión.</DialogDescription></DialogHeader><div className="grid gap-3 md:grid-cols-3"><Field label="Proceso"><Input name="process" required /></Field><Field label="Código proceso"><Input name="processCode" required /></Field><span /><Field label="Tarea"><Input name="task" required /></Field><Field label="Código tarea"><Input name="taskCode" required /></Field><span /><Field label="Puesto"><Input name="position" required /></Field><Field label="Código puesto"><Input name="positionCode" required /></Field><span /></div><div className="grid gap-3 md:grid-cols-2"><Field label="Código peligro"><Input name="hazardCode" required /></Field><Field label="Peligro"><Input name="hazard" required /></Field><Field label="Factor"><Input name="factor" required /></Field><Field label="Evento o daño"><Input name="damage" required /></Field><Field label="Personas expuestas"><Input name="exposed" required /></Field><Field label="Cantidad"><Input name="count" type="number" min="0" defaultValue="0" /></Field><Field label="Riesgo inherente"><OptionSelect id="miper-inherent" value={inherentLevel} onValueChange={setInherentLevel} options={RISK_LEVELS.map((level) => ({ value: level, label: RISK_LEVEL_LABEL[level] }))} /><input type="hidden" name="inherent" value={inherentLevel} /></Field><Field label="Riesgo residual"><OptionSelect id="miper-residual" value={residualLevel} onValueChange={setResidualLevel} options={RISK_LEVELS.map((level) => ({ value: level, label: RISK_LEVEL_LABEL[level] }))} /><input type="hidden" name="residual" value={residualLevel} /></Field></div><Field label="Enfoque de género"><Textarea name="gender" required minLength={3} /></Field><Field label="Personas especialmente sensibles"><Textarea name="sensitivity" required minLength={3} /></Field><div className="grid gap-3 md:grid-cols-2"><Field label="Responsable"><Input name="responsible" required /></Field><Field label="Evidencia"><Input name="evidence" /></Field></div><Checkbox name="critical" label="Riesgo/control crítico" /><Field label="Control existente o planificado"><Textarea name="control" /></Field><div className="grid gap-3 md:grid-cols-3"><Field label="Jerarquía"><Select value={hierarchy} onValueChange={setHierarchy}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="elimination">Eliminación</SelectItem><SelectItem value="substitution">Sustitución</SelectItem><SelectItem value="engineering">Ingeniería</SelectItem><SelectItem value="administrative">Administrativo</SelectItem><SelectItem value="ppe">EPP</SelectItem></SelectContent></Select><input type="hidden" name="hierarchy" value={hierarchy} /></Field><Field label="Estándar crítico"><Input name="standard" /></Field><Field label="Frecuencia"><Input name="frequency" /></Field></div>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Guardar peligro</Button></DialogFooter></form></DialogContent></Dialog>
}

function MatrixTransition({ matrix, currentUserId, permissions, today }: { matrix: Dashboard["matrices"][number]; currentUserId: string; permissions: RiskMatrixPermissions; today: string }) {
  const { canEdit, canReview, canApprove, canPublish } = permissions
  const next = matrix.status === "draft" && canEdit ? ["in_review", "Enviar a revisión"] : matrix.status === "in_review" && canReview && matrix.createdByUserId !== currentUserId ? ["reviewed", "Revisar"] : matrix.status === "reviewed" && canApprove && matrix.createdByUserId !== currentUserId && matrix.reviewedByUserId !== currentUserId ? ["approved", "Aprobar"] : matrix.status === "approved" && canPublish ? ["published", "Publicar"] : null
  // MIPER-10: el revisor puede devolver a borrador. Sin esto una versión con un
  // error quedaba trabada en revisión — nadie podía avanzarla ni editarla.
  const canReturn = matrix.status === "in_review" && canReview
  return <>
    {next && <MatrixTransitionDialog matrix={matrix} toStatus={next[0]!} label={next[1]!} today={today} />}
    {canReturn && <MatrixTransitionDialog matrix={matrix} toStatus="draft" label="Devolver a borrador" today={today} />}
  </>
}

function MatrixTransitionDialog({ matrix, toStatus, label, today }: { matrix: Dashboard["matrices"][number]; toStatus: string; label: string; today: string }) {
  const [open, setOpen] = useState(false); const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => transitionRiskMatrixAction({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus, reason: v.get("reason"), effectiveFrom: toStatus === "published" ? v.get("effectiveFrom") : undefined }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">{label}</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>{label} MIPER v{matrix.matrixVersion}</DialogTitle><DialogDescription>{toStatus === "draft" ? "La versión vuelve a borrador para corregirse; el motivo queda en el historial." : "La decisión quedará en el historial con actor y fecha."}</DialogDescription></DialogHeader><Field label={toStatus === "draft" ? "Motivo de la devolución" : "Fundamento"}><Textarea name="reason" required minLength={10} /></Field>{toStatus === "published" && <Field label="Vigente desde"><DatePicker name="effectiveFrom" defaultValue={today} /></Field>}{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>{label}</Button></DialogFooter></form></DialogContent></Dialog>
}

function ResolveTriggerDialog({ triggerId, matrices }: { triggerId: string; matrices: Dashboard["matrices"] }) {
  const [open, setOpen] = useState(false); const [matrixId, setMatrixId] = useState(matrices[0]?.id ?? ""); const operation = useOperation()
  if (!matrices.length) return <MetaBadge meta={{ label: "Requiere nueva publicación", variant: "warning" }} />
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => resolveRiskReviewTriggerAction({ triggerId, matrixId: v.get("matrixId"), resolution: v.get("resolution") }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">Completar revisión</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Completar disparador</DialogTitle><DialogDescription>Sólo una publicación posterior al disparador puede cerrarlo.</DialogDescription></DialogHeader><Field label="Versión publicada"><Select value={matrixId} onValueChange={setMatrixId}><SelectTrigger><SelectValue placeholder="Selecciona versión" /></SelectTrigger><SelectContent>{matrices.map((item) => <SelectItem key={item.id} value={item.id}>v{item.matrixVersion} · {item.title}</SelectItem>)}</SelectContent></Select><input type="hidden" name="matrixId" value={matrixId} /></Field><Field label="Resultado"><Textarea name="resolution" required minLength={10} /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Completar</Button></DialogFooter></form></DialogContent></Dialog>
}

function ImportBatch({ batch, methodologies, committeeMeetings, canEdit, canApprove, currentUserId }: { batch: Imports[number]; methodologies: Dashboard["methodologies"]; committeeMeetings: Dashboard["committeeMeetings"]; canEdit: boolean; canApprove: boolean; currentUserId: string }) {
  const operation = useOperation()
  return <section className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex gap-2"><strong>{batch.sourceFileName}</strong><MetaBadge meta={{ label: STATUS_LABEL[batch.status] ?? batch.status, variant: variant(batch.status) }} /></div><p className="mt-1 text-xs text-[var(--color-text-subtle)]">SHA-256 {batch.sourceChecksumSha256} · {batch.totalRows} filas · {batch.reviewRows} observadas</p></div><div className="flex gap-2"><Button asChild size="sm" variant="secondary"><a href={`/api/prevencion/miper/importaciones/${batch.id}/original`} download>Original</a></Button>{batch.status === "staged" && canApprove && batch.createdByUserId !== currentUserId && <Button size="sm" disabled={operation.pending || batch.rows.some((row) => row.status === "needs_review")} onClick={() => operation.run(() => approveRiskImportBatchAction(batch.id))}>Aprobar lote</Button>}{batch.status === "approved" && canEdit && methodologies.length > 0 && <ActivateImportDialog batchId={batch.id} methodologies={methodologies} meetings={committeeMeetings.filter((item) => item.worksiteId === batch.worksiteId)} />}{batch.status === "approved" && canEdit && <ReopenImportDialog batchId={batch.id} />}</div></div>{operation.message && <p role="status" className="mt-2 text-sm">{operation.message}</p>}<div className="mt-3 space-y-2">{batch.rows.filter((row) => row.status === "needs_review").map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-warning-line)] p-3 text-sm"><span>Fila {row.rowNumber}: {(row.issues as string[]).join("; ")}</span>{canEdit && <ResolveImportRowDialog row={row} />}</div>)}</div></section>
}

/* La MIPER importada declara su sesión de comité igual que la creada a mano: sin
 * esto, una matriz nacida de un Excel no podía alimentar el crédito Oro
 * `iper_committee_participation` y ese camino quedaba a medias. Las sesiones ya
 * llegan acotadas a la faena del lote. */
function ActivateImportDialog({ batchId, methodologies, meetings }: { batchId: string; methodologies: Dashboard["methodologies"]; meetings: Dashboard["committeeMeetings"] }) {
  const [open, setOpen] = useState(false); const [methodologyId, setMethodologyId] = useState(methodologies[0]?.id ?? ""); const [committeeMeetingId, setCommitteeMeetingId] = useState(""); const operation = useOperation()
  const methodology = methodologies.find((item) => item.id === methodologyId)
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => activateRiskImportBatchAction({ batchId, title: v.get("title"), methodologyId: v.get("methodologyId"), revisionReason: v.get("reason"), participationSummary: v.get("participation"), consultationEvidenceReference: v.get("evidence"), committeeMeetingId: v.get("committeeMeetingId") || null }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm">Crear borrador</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Activar lote aprobado</DialogTitle><DialogDescription>Crea una MIPER borrador; aún debe completar su workflow.</DialogDescription></DialogHeader><Field label="Título"><Input name="title" required defaultValue="MIPER importada" /></Field><Field label="Metodología"><Select value={methodologyId} onValueChange={setMethodologyId}><SelectTrigger><SelectValue placeholder="Selecciona metodología">{methodology ? `${methodology.code} · ${methodology.versionLabel}` : null}</SelectValue></SelectTrigger><SelectContent>{methodologies.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="methodologyId" value={methodologyId} /></Field><Field label="Motivo"><Textarea name="reason" required minLength={10} /></Field><Field label="Participación"><Textarea name="participation" required minLength={10} /></Field><Field label="Evidencia de consulta"><Input name="evidence" required /></Field><Field label="Sesión del comité paritario"><OptionSelect id="miper-import-committee-meeting" value={committeeMeetingId} onValueChange={setCommitteeMeetingId} emptyLabel="Sin sesión del comité" placeholder="Sin sesión del comité" disabled={meetings.length === 0} options={meetings.map((item) => ({ value: item.id, label: `${item.code} · ${formatDate(item.scheduledFor)}` }))} /><input type="hidden" name="committeeMeetingId" value={committeeMeetingId} /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Activar</Button></DialogFooter></form></DialogContent></Dialog>
}

/* MIPER-04: la salida del lote aprobado que no activa. Vuelve a `staged`, que
 * es el único estado donde `resolveRiskImportRow` deja corregir o rechazar
 * filas — y exige una aprobación nueva antes de volver a intentarlo. */
function ReopenImportDialog({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false); const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => reopenRiskImportBatchAction({ batchId, reason: v.get("reason") }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">Reabrir lote</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Reabrir lote aprobado</DialogTitle><DialogDescription>Vuelve a revisión para corregir o rechazar filas. Pierde la aprobación y necesitará una nueva.</DialogDescription></DialogHeader><Field label="Motivo"><Textarea name="reason" required minLength={10} /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Reabrir</Button></DialogFooter></form></DialogContent></Dialog>
}

function ResolveImportRowDialog({ row }: { row: Imports[number]["rows"][number] }) {
  const [open, setOpen] = useState(false); const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); let normalized: unknown; try { normalized = JSON.parse(String(v.get("normalized"))) } catch { return }; operation.run(() => resolveRiskImportRowAction({ rowId: row.id, normalized, resolution: v.get("resolution"), reject: v.get("reject") === "on" }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">Resolver</Button></DialogTrigger><DialogContent className="max-w-2xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Resolver fila {row.rowNumber}</DialogTitle><DialogDescription>El original permanece intacto; sólo se modifica la normalización y queda la decisión.</DialogDescription></DialogHeader><Field label="Normalización JSON"><Textarea name="normalized" className="min-h-64 font-mono text-xs" defaultValue={JSON.stringify(row.normalized, null, 2)} /></Field><Field label="Decisión"><Textarea name="resolution" required minLength={10} /></Field><Checkbox name="reject" label="Rechazar fila" />{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Guardar decisión</Button></DialogFooter></form></DialogContent></Dialog>
}
