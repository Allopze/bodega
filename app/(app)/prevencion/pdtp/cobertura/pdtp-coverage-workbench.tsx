"use client"

import { useState, useTransition, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { getPdtpCoverage } from "@/lib/services/prevention-risk-legal"
import { linkPdtpActivitySourceAction, resolvePdtpUpdateObligationAction } from "./actions"

type Coverage = Awaited<ReturnType<typeof getPdtpCoverage>>
type Source = { id: string; worksiteId: string; label: string }
type Result = { ok: boolean; message?: string }

function useOperation() {
  const [pending, startTransition] = useTransition(); const [message, setMessage] = useState("")
  function run(operation: () => Promise<Result>, success?: () => void) { setMessage(""); startTransition(async () => { const result = await operation(); setMessage(result.ok ? "Guardado correctamente." : result.message ?? "No se pudo completar la acción."); if (result.ok) success?.() }) }
  return { pending, message, run }
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1 text-sm"><span className="font-medium">{label}</span>{children}</label> }

const SOURCE_LABELS: Record<string, string> = { risk_control: "Control MIPER", legal_requirement: "Requisito legal", incident_capa: "Incidente/CAPA", audit: "Auditoría", internal_objective: "Objetivo interno", contractual_obligation: "Obligación contractual" }

function sourceHref(sourceType: string, sourceId: string) {
  if (sourceType === "risk_control") return `/prevencion/miper/controles/${sourceId}`
  if (sourceType === "legal_requirement") return `/prevencion/requisitos-legales/${sourceId}`
  if (sourceType === "incident_capa") return `/prevencion/capa/${sourceId}`
  return null
}

export function PdtpCoverageWorkbench({ coverage, riskControls, legalRequirements, worksites, canManage }: {
  coverage: Coverage
  riskControls: Source[]
  legalRequirements: Source[]
  worksites: Array<{ id: string; name: string }>
  canManage: boolean
}) {
  return <div className="space-y-4"><div className="grid grid-cols-2 overflow-hidden border-y lg:grid-cols-4"><a href="#actividades" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Actividades con fuente</span><strong className="block text-xl">{coverage.coverage.sourcedActivities}/{coverage.coverage.totalActivities}</strong></a><a href="#brechas" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Sin origen</span><strong className="block text-xl">{coverage.coverage.unsourcedActivities}</strong></a><a href="#relojes" className="border-r px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Actualizaciones pendientes</span><strong className="block text-xl">{coverage.coverage.pendingUpdates}</strong></a><a href="#actividades" className="px-4 py-3 hover:bg-[var(--color-surface-2)]"><span className="text-eyebrow">Programa</span><strong className="block text-xl">{coverage.program.year} · v{coverage.program.version}</strong></a></div>
    {coverage.coverage.unsourcedActivities > 0 && <div id="brechas" role="status" className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-4 text-sm"><strong>El PDTP todavía contiene actividades sin fuente demostrable.</strong><p className="mt-1">No se imputan automáticamente a MIPER ni al registro legal; deben conciliarse una a una o justificarse como objetivo interno.</p></div>}
    <section id="relojes" className="space-y-2"><h2 className="font-semibold">Relojes de actualización</h2>{coverage.obligations.length === 0 ? <p className="text-sm text-[var(--color-text-subtle)]">No hay actualizaciones MIPER/legal pendientes de incorporar.</p> : coverage.obligations.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="flex gap-2"><strong>{item.sourceVersionSnapshot}</strong><Badge variant={item.status === "overdue" ? "danger" : "warning"}>{item.status === "overdue" ? "Vencido" : `Vence ${item.dueAt}`}</Badge></div><p className="text-xs text-[var(--color-text-subtle)]">{item.sourceType === "risk_matrix" ? "Actualización MIPER: plazo reglamentario de 30 días para modificar el programa." : "Requisito aplicable pendiente de cobertura programática."}</p></div>{canManage && <ResolveObligationDialog obligationId={item.id} programId={coverage.program.id} />}</div>)}</section>
    <section id="actividades" className="space-y-2"><h2 className="font-semibold">Actividades y fuentes</h2>{coverage.activities.length === 0 ? <EmptyState title="Programa sin actividades" description="Agrega actividades antes de evaluar su cobertura." /> : coverage.activities.map((activity) => <div key={activity.id} className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-3"><div><strong>N°{activity.n} · {activity.activity}</strong><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{activity.objective}</p></div>{canManage && <LinkSourceDialog activityId={activity.id} worksites={worksites} riskControls={riskControls} legalRequirements={legalRequirements} />}</div><div className="mt-3 flex flex-wrap gap-2">{activity.sources.length === 0 ? <Badge variant="warning">Sin fuente</Badge> : activity.sources.map((source) => { const href = sourceHref(source.sourceType, source.sourceId); const label = `${SOURCE_LABELS[source.sourceType] ?? source.sourceType} · ${source.sourceVersionSnapshot}`; return href ? <Button key={source.id} asChild size="sm" variant="secondary"><Link href={href}>{label}</Link></Button> : <Badge key={source.id} variant="default">{label}</Badge> })}</div></div>)}</section>
  </div>
}

function LinkSourceDialog({ activityId, worksites, riskControls, legalRequirements }: { activityId: string; worksites: Array<{ id: string; name: string }>; riskControls: Source[]; legalRequirements: Source[] }) {
  const [open, setOpen] = useState(false); const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? ""); const [sourceType, setSourceType] = useState("risk_control"); const [sourceId, setSourceId] = useState(""); const operation = useOperation()
  const options = sourceType === "risk_control" ? riskControls.filter((item) => item.worksiteId === worksiteId) : sourceType === "legal_requirement" ? legalRequirements.filter((item) => item.worksiteId === worksiteId) : []
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => linkPdtpActivitySourceAction({ activityId, worksiteId, sourceType, sourceId: v.get("sourceId") || `${sourceType}:${activityId}`, justification: v.get("justification") }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm">Vincular fuente</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Vincular origen de la medida</DialogTitle><DialogDescription>El vínculo no cierra el requisito ni reduce el riesgo; sólo demuestra cobertura programática.</DialogDescription></DialogHeader><Field label="Faena"><Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} /></Field><Field label="Tipo"><Select value={sourceType} onValueChange={setSourceType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="risk_control">Control MIPER</SelectItem><SelectItem value="legal_requirement">Requisito legal</SelectItem><SelectItem value="incident_capa">Incidente / CAPA</SelectItem><SelectItem value="audit">Auditoría</SelectItem><SelectItem value="contractual_obligation">Obligación contractual</SelectItem><SelectItem value="internal_objective">Objetivo interno</SelectItem></SelectContent></Select><input type="hidden" name="sourceType" value={sourceType} /></Field>{options.length > 0 ? <Field label="Fuente"><Select value={sourceId} onValueChange={setSourceId}><SelectTrigger><SelectValue placeholder="Selecciona fuente" /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="sourceId" value={sourceId} /></Field> : <Field label="Identificador de fuente"><Input name="sourceId" required={!["audit", "contractual_obligation", "internal_objective"].includes(sourceType)} placeholder="ID CAPA, auditoría, contrato u objetivo" /></Field>}<Field label="Justificación"><Textarea name="justification" required minLength={10} /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Crear vínculo</Button></DialogFooter></form></DialogContent></Dialog>
}

function ResolveObligationDialog({ obligationId, programId }: { obligationId: string; programId: string }) {
  const [open, setOpen] = useState(false); const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const v = new FormData(event.currentTarget); operation.run(() => resolvePdtpUpdateObligationAction({ obligationId, programId, resolution: v.get("resolution") }), () => setOpen(false)) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="secondary">Declarar incorporada</Button></DialogTrigger><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Cerrar reloj de actualización</DialogTitle><DialogDescription>El servidor comprobará que el programa tenga al menos una actividad vinculada a esta fuente.</DialogDescription></DialogHeader><Field label="Resultado"><Textarea name="resolution" required minLength={10} /></Field>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending}>Confirmar incorporación</Button></DialogFooter></form></DialogContent></Dialog>
}

