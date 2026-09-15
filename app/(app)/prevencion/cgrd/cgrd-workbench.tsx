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
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/utils"
import {
  GRD_COMMITTEE_MIN_HEADCOUNT, GRD_MATRIX_STATUS_LABELS, GRD_STRUCTURE_LABELS,
} from "@/lib/prevention/cgrd"
import { CAPA_STATUS_LABELS } from "@/lib/prevention/capa"
import type {
  getGrdStructureStatus, listGrdAgreements, listGrdCommittees, listGrdMatrices, listGrdMeetings,
  listGrdMembers, listGrdThreats, listGrdWorkers,
} from "@/lib/services/prevention-cgrd"
import {
  addGrdMemberAction, addGrdThreatAction,
  constituteGrdCommitteeAction, createGrdMatrixDraftAction, designateGrdCoordinatorAction,
  dissolveGrdCommitteeAction, endGrdCoordinatorAction, publishGrdMatrixAction, recordGrdMeetingAction,
  removeGrdMemberAction, removeGrdThreatAction,
} from "./actions"

type Worksite = { id: string; name: string; code: string }
type Committee = Awaited<ReturnType<typeof listGrdCommittees>>[number]
type Member = Awaited<ReturnType<typeof listGrdMembers>>[number]
type Matrix = Awaited<ReturnType<typeof listGrdMatrices>>[number]
type Threat = Awaited<ReturnType<typeof listGrdThreats>>[number]
type Meeting = Awaited<ReturnType<typeof listGrdMeetings>>[number]
type Worker = Awaited<ReturnType<typeof listGrdWorkers>>[number]
type Agreement = Awaited<ReturnType<typeof listGrdAgreements>>[number]
type Structure = Awaited<ReturnType<typeof getGrdStructureStatus>>
/** Acuerdo en edición dentro del diálogo de acta, antes de existir en base. */
type DraftAgreement = { description: string; actionDescription: string; priority: "low" | "medium" | "high" | "critical"; targetDate: string }

const MATRIX_STATUS_VARIANT: Record<string, "outline" | "warning" | "info" | "success" | "danger"> = {
  draft: "outline", published: "success", superseded: "outline",
}

async function handle(promise: Promise<{ ok: boolean; message?: string }>, onDone: (message?: string) => void) {
  const result = await promise
  onDone(result.ok ? undefined : (result.message ?? "No se pudo completar la acción."))
}

export function CgrdWorkbench({
  worksites, selectedWorksiteId, committee, structure, members, matrices, latestMatrixThreats, meetings, agreements, workerCandidates,
  canManageCommittee, canEditMatrix, canPublishMatrix, canManageMeetings,
}: {
  worksites: Worksite[]
  selectedWorksiteId: string | null
  committee: Committee | null
  structure: Structure | null
  members: Member[]
  matrices: Matrix[]
  latestMatrixThreats: Threat[]
  meetings: Meeting[]
  agreements: Agreement[]
  workerCandidates: Worker[]
  canManageCommittee: boolean
  canEditMatrix: boolean
  canPublishMatrix: boolean
  canManageMeetings: boolean
}) {
  const router = useRouter()
  const [constituteOpen, setConstituteOpen] = React.useState(false)
  const [designateOpen, setDesignateOpen] = React.useState(false)
  const [addMemberOpen, setAddMemberOpen] = React.useState(false)
  const [newMatrixOpen, setNewMatrixOpen] = React.useState(false)
  const [addThreatOpen, setAddThreatOpen] = React.useState(false)
  const [publishingMatrix, setPublishingMatrix] = React.useState<Matrix | null>(null)
  const [recordMeetingOpen, setRecordMeetingOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function onDone(message?: string) {
    if (message) { setError(message); return }
    setError(null)
    router.refresh()
  }

  const latestMatrix = matrices.length > 0 ? [...matrices].sort((a, b) => b.matrixVersion - a.matrixVersion)[0]! : null
  const hasDraft = matrices.some((matrix) => matrix.status === "draft")

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Gestión de Riesgos de Desastres"
        description="Comité, matriz GRD y actas del CGRD (DS 44) — distinto del Comité Paritario."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "CGRD" }]} />}
      />

      <div className="mt-4">
        <Select value={selectedWorksiteId ?? ""} onValueChange={(value) => router.replace(`/prevencion/cgrd?faena=${value}`, { scroll: false })}>
          <SelectTrigger className="w-64" aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}

      {structure && (
        <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
          Dotación activa: <strong className="font-mono tabular-nums">{structure.headcount}</strong> ·
          {" "}corresponde <strong>{GRD_STRUCTURE_LABELS[structure.required]}</strong>
          {structure.required === "coordinator" ? ` (el comité es exigible desde ${GRD_COMMITTEE_MIN_HEADCOUNT})` : ""}
          {structure.existing === "coordinator" && !structure.satisfied
            ? " — hay un coordinador designado, que ya no basta para esta dotación."
            : ""}
        </p>
      )}

      {/* La matriz GRD es de la faena, no del comité: la N°80 aplica también
          a una faena con coordinador. Vive fuera del bloque del comité por eso. */}
      {selectedWorksiteId && (
        <section className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Matriz GRD</h2>
            {canEditMatrix && !hasDraft && <Button type="button" size="sm" variant="secondary" onClick={() => setNewMatrixOpen(true)}>Nueva versión</Button>}
          </div>

          {!latestMatrix ? (
            <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Sin versiones de la matriz GRD.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <MetaBadge meta={{ label: GRD_MATRIX_STATUS_LABELS[latestMatrix.status as keyof typeof GRD_MATRIX_STATUS_LABELS] ?? latestMatrix.status, variant: MATRIX_STATUS_VARIANT[latestMatrix.status] ?? "outline" }} dot />
                <span className="text-sm font-medium">{latestMatrix.title} · v{latestMatrix.matrixVersion}</span>
              </div>

              {latestMatrix.status === "draft" && (
                <div className="flex flex-wrap gap-2">
                  {canEditMatrix && (
                    <Button type="button" size="sm" onClick={() => setAddThreatOpen(true)}>Agregar amenaza</Button>
                  )}
                  {canPublishMatrix && (
                    <Button type="button" size="sm" variant="secondary" onClick={() => setPublishingMatrix(latestMatrix)}>Publicar</Button>
                  )}
                </div>
              )}

              {latestMatrixThreats.length === 0 ? (
                <p className="text-sm text-[var(--color-text-subtle)]">Sin amenazas registradas en esta versión.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                  {latestMatrixThreats.map((threat) => (
                    <li key={threat.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">{threat.name} <span className="text-xs text-[var(--color-text-subtle)]">· {threat.origin === "obligatoria" ? "Obligatoria" : "Detectada"}</span></p>
                        <p className="mt-1 text-xs text-[var(--color-text-subtle)] line-clamp-2">{threat.workPlan}</p>
                      </div>
                      {latestMatrix.status === "draft" && canEditMatrix && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => void handle(removeGrdThreatAction({ threatId: threat.id }), onDone)}>Quitar</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {!selectedWorksiteId ? (
        <EmptyState title="Sin faenas visibles" description="No tienes faenas asignadas para gestionar el CGRD." />
      ) : structure?.coordinator && !committee ? (
        <section className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Coordinador de Gestión del Riesgo de Desastres</h2>
              <p className="text-xs text-[var(--color-text-subtle)]">
                {workerCandidates.find((worker) => worker.id === structure.coordinator!.workerId)
                  ? `${workerCandidates.find((worker) => worker.id === structure.coordinator!.workerId)!.lastName}, ${workerCandidates.find((worker) => worker.id === structure.coordinator!.workerId)!.firstName}`
                  : structure.coordinator.workerId} · designado el {structure.coordinator.designatedOn}
              </p>
            </div>
            {canManageCommittee && (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setConstituteOpen(true)}>Constituir comité</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => {
                  const reason = window.prompt("Motivo del término de la designación (mínimo 10 caracteres):")
                  if (reason && reason.trim().length >= 10) {
                    void handle(endGrdCoordinatorAction({ coordinatorId: structure.coordinator!.id, expectedVersion: structure.coordinator!.version, reason }), onDone)
                  }
                }}>Terminar designación</Button>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
            Constituir el comité reemplaza esta designación: la norma pide un órgano, no dos.
          </p>
        </section>
      ) : !committee ? (
        <EmptyState
          title={structure?.required === "coordinator" ? "Sin coordinador designado" : "Sin comité vigente"}
          description={structure?.required === "coordinator"
            ? `Con ${structure.headcount} persona(s) corresponde designar un Coordinador de Gestión del Riesgo de Desastres. Constituir el comité también es válido: la norma fija un mínimo, y sobrecumplirlo no es incumplir.`
            : "Esta faena no tiene un Comité de Gestión de Riesgos de Desastres constituido."}
          action={canManageCommittee ? (
            <div className="flex gap-2">
              {structure?.required === "coordinator" && (
                <Button type="button" onClick={() => setDesignateOpen(true)}>Designar coordinador</Button>
              )}
              <Button type="button" variant={structure?.required === "coordinator" ? "secondary" : "primary"} onClick={() => setConstituteOpen(true)}>Constituir comité</Button>
            </div>
          ) : undefined}
        />
      ) : (
        <>
          <section className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">{committee.name}</h2>
                <p className="text-xs text-[var(--color-text-subtle)]">Constituido {committee.constitutedOn} · mandato hasta {committee.mandateEndsOn}</p>
              </div>
              {canManageCommittee && (
                <Button type="button" variant="destructive" size="sm" onClick={() => {
                  const reason = window.prompt("Motivo de la disolución (mínimo 10 caracteres):")
                  if (reason && reason.trim().length >= 10) {
                    void handle(dissolveGrdCommitteeAction({ committeeId: committee.id, expectedVersion: committee.version, reason }), onDone)
                  }
                }}>Disolver</Button>
              )}
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase text-[var(--color-text-subtle)]">Integrantes</h3>
                {canManageCommittee && <Button type="button" size="sm" variant="secondary" onClick={() => setAddMemberOpen(true)}>Agregar integrante</Button>}
              </div>
              {members.filter((member) => member.status === "active").length === 0 ? (
                <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Sin integrantes registrados.</p>
              ) : (
                <ul className="mt-2 divide-y divide-[var(--color-border)]">
                  {members.filter((member) => member.status === "active").map((member) => {
                    const worker = workerCandidates.find((candidate) => candidate.id === member.workerId)
                    return (
                      <li key={member.id} className="flex items-center justify-between py-2 text-sm">
                        <span>{worker ? `${worker.lastName}, ${worker.firstName}` : member.workerId} {member.role ? <span className="text-xs text-[var(--color-text-subtle)]">· {member.role}</span> : null}</span>
                        {canManageCommittee && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => {
                            const reason = window.prompt("Motivo (mínimo 10 caracteres):")
                            if (reason && reason.trim().length >= 10) void handle(removeGrdMemberAction({ memberId: member.id, reason }), onDone)
                          }}>Quitar</Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>


          <section className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Actas de reunión</h2>
              {canManageMeetings && <Button type="button" size="sm" variant="secondary" onClick={() => setRecordMeetingOpen(true)}>Registrar acta</Button>}
            </div>
            {meetings.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Sin sesiones registradas.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {meetings.map((meeting) => (
                  <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <MetaBadge meta={{ label: "Registrada", variant: "success" }} dot />
                      <span className="ml-2">{meeting.code} · {formatDateTime(meeting.heldOn)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Acuerdos</h2>
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Cada acuerdo del acta se persigue como acción correctiva en CAPA: el estado que se muestra es el de
              su CAPA, no una copia.
            </p>
            {agreements.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Sin acuerdos registrados.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {agreements.map((agreement) => (
                  <li key={agreement.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1">{agreement.description}</span>
                    <span className="flex items-center gap-2">
                      {agreement.capaStatus && (
                        <MetaBadge meta={{ label: CAPA_STATUS_LABELS[agreement.capaStatus as keyof typeof CAPA_STATUS_LABELS] ?? agreement.capaStatus, variant: agreement.capaStatus === "closed" || agreement.capaStatus === "verified" ? "success" : "warning" }} dot />
                      )}
                      <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                        {agreement.capaCode ?? "sin CAPA"}{agreement.capaTargetDate ? ` · ${agreement.capaTargetDate}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {selectedWorksiteId && (
        <>
          <ConstituteDialog open={constituteOpen} onOpenChange={setConstituteOpen} worksiteId={selectedWorksiteId} onDone={onDone} />
          <DesignateCoordinatorDialog open={designateOpen} onOpenChange={setDesignateOpen} worksiteId={selectedWorksiteId} workers={workerCandidates} onDone={onDone} />
          {/* De faena, no de comité: acompañan a la sección de la matriz. */}
          <NewMatrixDialog open={newMatrixOpen} onOpenChange={setNewMatrixOpen} worksiteId={selectedWorksiteId} onDone={onDone} />
          {latestMatrix && <AddThreatDialog open={addThreatOpen} onOpenChange={setAddThreatOpen} matrixId={latestMatrix.id} onDone={onDone} />}
          <PublishMatrixDialog matrix={publishingMatrix} onClose={() => setPublishingMatrix(null)} onDone={onDone} />
        </>
      )}
      {committee && (
        <>
          <AddMemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} committeeId={committee.id} workers={workerCandidates} onDone={onDone} />
          <RecordMeetingDialog open={recordMeetingOpen} onOpenChange={setRecordMeetingOpen} committeeId={committee.id} onDone={onDone} />
        </>
      )}
    </PageContainer>
  )
}

function ConstituteDialog({ open, onOpenChange, worksiteId, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; worksiteId: string; onDone: (message?: string) => void }) {
  const [name, setName] = React.useState("")
  const [constitutedOn, setConstitutedOn] = React.useState("")
  const [mandateEndsOn, setMandateEndsOn] = React.useState("")
  const [evidenceUrl, setEvidenceUrl] = React.useState("")
  const [pending, setPending] = React.useState(false)

  async function save() {
    setPending(true)
    try {
      const result = await constituteGrdCommitteeAction({ worksiteId, name, constitutedOn, mandateEndsOn, evidenceUrl })
      if (result.ok) { onOpenChange(false); setName(""); setConstitutedOn(""); setMandateEndsOn(""); setEvidenceUrl("") }
      onDone(result.ok ? undefined : result.message)
    } finally { setPending(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Constituir CGRD</DialogTitle><DialogDescription>Comité de Gestión de Riesgos de Desastres, distinto del Comité Paritario.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <Field label="Nombre" required><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={300} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Constituido el" required><Input type="date" value={constitutedOn} onChange={(event) => setConstitutedOn(event.target.value)} /></Field>
        <Field label="Mandato hasta" required><Input type="date" value={mandateEndsOn} onChange={(event) => setMandateEndsOn(event.target.value)} /></Field>
      </div>
      <Field label="Evidencia del acta de constitución" required helper="Pega el enlace al documento (Drive, SharePoint, etc.)."><Input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://..." /></Field>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || name.trim().length < 3 || !constitutedOn || !mandateEndsOn || !evidenceUrl.trim()}>{pending ? "Constituyendo..." : "Constituir"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function AddMemberDialog({ open, onOpenChange, committeeId, workers, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; committeeId: string; workers: Worker[]; onDone: (message?: string) => void }) {
  const [workerId, setWorkerId] = React.useState(workers[0]?.id ?? "")
  const [role, setRole] = React.useState("integrante")
  const [pending, setPending] = React.useState(false)

  async function save() {
    setPending(true)
    try {
      const result = await addGrdMemberAction({ committeeId, workerId, role })
      if (result.ok) onOpenChange(false)
      onDone(result.ok ? undefined : result.message)
    } finally { setPending(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Agregar integrante</DialogTitle></DialogHeader>
    <div className="space-y-4">
      <Field label="Persona" required><Select value={workerId} onValueChange={setWorkerId}><SelectTrigger><SelectValue placeholder="Selecciona una persona" /></SelectTrigger><SelectContent>{workers.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.lastName}, {worker.firstName}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Rol"><Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="presidente">Presidente</SelectItem><SelectItem value="secretario">Secretario</SelectItem><SelectItem value="integrante">Integrante</SelectItem></SelectContent></Select></Field>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || !workerId}>{pending ? "Agregando..." : "Agregar"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function NewMatrixDialog({ open, onOpenChange, worksiteId, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; worksiteId: string; onDone: (message?: string) => void }) {
  const [title, setTitle] = React.useState("")
  const [revisionReason, setRevisionReason] = React.useState("")
  const [pending, setPending] = React.useState(false)

  async function save() {
    setPending(true)
    try {
      const result = await createGrdMatrixDraftAction({ worksiteId, title, revisionReason })
      if (result.ok) { onOpenChange(false); setTitle(""); setRevisionReason("") }
      onDone(result.ok ? undefined : result.message)
    } finally { setPending(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Nueva versión de la matriz GRD</DialogTitle></DialogHeader>
    <div className="space-y-4">
      <Field label="Título" required><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} /></Field>
      <Field label="Motivo de la revisión" required><Textarea value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} rows={3} maxLength={2000} /></Field>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || title.trim().length < 5 || revisionReason.trim().length < 10}>{pending ? "Creando..." : "Crear borrador"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function AddThreatDialog({ open, onOpenChange, matrixId, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; matrixId: string; onDone: (message?: string) => void }) {
  const [name, setName] = React.useState("")
  const [origin, setOrigin] = React.useState<"obligatoria" | "detectada">("obligatoria")
  const [historicalAnalysis, setHistoricalAnalysis] = React.useState("")
  const [legalRequirement, setLegalRequirement] = React.useState("")
  const [workPlan, setWorkPlan] = React.useState("")
  const [pending, setPending] = React.useState(false)

  async function save() {
    setPending(true)
    try {
      const result = await addGrdThreatAction({ matrixId, name, origin, historicalAnalysis, legalRequirement, workPlan })
      if (result.ok) { onOpenChange(false); setName(""); setHistoricalAnalysis(""); setLegalRequirement(""); setWorkPlan("") }
      onDone(result.ok ? undefined : result.message)
    } finally { setPending(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Agregar amenaza</DialogTitle><DialogDescription>Análisis histórico, evaluación legal y plan de trabajo — los tres componentes que exige la N°80.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="Amenaza" required><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={300} /></Field>
        <Field label="Origen" required><Select value={origin} onValueChange={(value) => setOrigin(value as "obligatoria" | "detectada")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="obligatoria">Obligatoria</SelectItem><SelectItem value="detectada">Detectada</SelectItem></SelectContent></Select></Field>
      </div>
      <Field label="Análisis histórico" required><Textarea value={historicalAnalysis} onChange={(event) => setHistoricalAnalysis(event.target.value)} rows={2} maxLength={5000} /></Field>
      <Field label="Evaluación legal" required><Textarea value={legalRequirement} onChange={(event) => setLegalRequirement(event.target.value)} rows={2} maxLength={5000} /></Field>
      <Field label="Plan de trabajo" required><Textarea value={workPlan} onChange={(event) => setWorkPlan(event.target.value)} rows={2} maxLength={5000} /></Field>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || name.trim().length < 3 || historicalAnalysis.trim().length < 10 || legalRequirement.trim().length < 10 || workPlan.trim().length < 10}>{pending ? "Agregando..." : "Agregar"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function PublishMatrixDialog({ matrix, onClose, onDone }: { matrix: Matrix | null; onClose: () => void; onDone: (message?: string) => void }) {
  const [evidenceUrl, setEvidenceUrl] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [prevMatrix, setPrevMatrix] = React.useState(matrix)
  if (matrix !== prevMatrix) { setPrevMatrix(matrix); setEvidenceUrl("") }

  async function save() {
    if (!matrix) return
    setPending(true)
    try {
      const result = await publishGrdMatrixAction({ matrixId: matrix.id, expectedVersion: matrix.version, evidenceUrl })
      if (result.ok) onClose()
      onDone(result.ok ? undefined : result.message)
    } finally { setPending(false) }
  }

  return <Dialog open={matrix !== null} onOpenChange={(value) => { if (!value) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>Publicar matriz GRD</DialogTitle><DialogDescription>Cierra la N°80 del PDTP. Reemplaza cualquier versión publicada anteriormente en esta faena.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <Field label="Evidencia de la matriz publicada" required helper="Pega el enlace al documento (Drive, SharePoint, etc.)."><Input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://..." /></Field>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || !evidenceUrl.trim()}>{pending ? "Publicando..." : "Publicar"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

const EMPTY_AGREEMENT: DraftAgreement = { description: "", actionDescription: "", priority: "medium", targetDate: "" }

function RecordMeetingDialog({ open, onOpenChange, committeeId, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; committeeId: string; onDone: (message?: string) => void }) {
  const [heldOn, setHeldOn] = React.useState("")
  const [agenda, setAgenda] = React.useState("")
  const [minutes, setMinutes] = React.useState("")
  const [quorumReached, setQuorumReached] = React.useState(true)
  const [evidenceUrl, setEvidenceUrl] = React.useState("")
  const [drafts, setDrafts] = React.useState<DraftAgreement[]>([])
  const [pending, setPending] = React.useState(false)

  function reset() {
    setHeldOn(""); setAgenda(""); setMinutes(""); setQuorumReached(true); setEvidenceUrl(""); setDrafts([])
  }

  function updateDraft(index: number, patch: Partial<DraftAgreement>) {
    setDrafts((current) => current.map((draft, position) => position === index ? { ...draft, ...patch } : draft))
  }

  // Un acuerdo a medias no se envía: o está completo o no va. Se valida acá
  // para que el botón diga por qué está deshabilitado antes del round-trip.
  const draftsComplete = drafts.every((draft) =>
    draft.description.trim().length >= 5 && draft.actionDescription.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(draft.targetDate))

  async function save() {
    setPending(true)
    try {
      const result = await recordGrdMeetingAction({
        committeeId, heldOn: new Date(heldOn).toISOString(), agenda, minutes, quorumReached, evidenceUrl,
        agreements: drafts.map((draft) => ({
          description: draft.description.trim(),
          actionDescription: draft.actionDescription.trim(),
          priority: draft.priority,
          targetDate: draft.targetDate,
        })),
      })
      if (result.ok) { onOpenChange(false); reset() }
      onDone(result.ok ? undefined : result.message)
    } finally { setPending(false) }
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!value) onOpenChange(false) }}><DialogContent>
    <DialogHeader><DialogTitle>Registrar acta</DialogTitle><DialogDescription>Cierra la N°81 del PDTP. Se carga después de la sesión, con su evidencia. Cada acuerdo se abre como acción correctiva en CAPA.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fecha y hora de la sesión" required><Input type="datetime-local" value={heldOn} onChange={(event) => setHeldOn(event.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={quorumReached} onChange={(event) => setQuorumReached(event.target.checked)} /> Hubo quórum</label>
      </div>
      <Field label="Tabla / agenda" required><Textarea value={agenda} onChange={(event) => setAgenda(event.target.value)} rows={2} maxLength={5000} /></Field>
      <Field label="Acta" required helper="Mínimo 20 caracteres."><Textarea value={minutes} onChange={(event) => setMinutes(event.target.value)} rows={5} maxLength={20000} /></Field>
      <Field label="Evidencia del acta" required helper="Pega el enlace al documento (Drive, SharePoint, etc.)."><Input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://..." /></Field>

      <div className="rounded-lg border border-[var(--color-border)] p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase text-[var(--color-text-subtle)]">Acuerdos</h3>
          <Button type="button" size="sm" variant="secondary" onClick={() => setDrafts((current) => [...current, { ...EMPTY_AGREEMENT }])}>Agregar acuerdo</Button>
        </div>
        {drafts.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">Sin acuerdos. Un acta puede registrarse sin ellos.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {drafts.map((draft, index) => (
              <div key={index} className="space-y-2 rounded-md bg-[var(--color-surface-2)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--color-text-subtle)]">Acuerdo {index + 1}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDrafts((current) => current.filter((_, position) => position !== index))}>Quitar</Button>
                </div>
                <Field label="Acuerdo" required><Input value={draft.description} onChange={(event) => updateDraft(index, { description: event.target.value })} maxLength={3000} /></Field>
                <Field label="Acción comprometida" required><Input value={draft.actionDescription} onChange={(event) => updateDraft(index, { actionDescription: event.target.value })} maxLength={3000} /></Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Prioridad" required>
                    <Select value={draft.priority} onValueChange={(value) => updateDraft(index, { priority: value as DraftAgreement["priority"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baja</SelectItem>
                        <SelectItem value="medium">Media</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="critical">Crítica</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Plazo" required><Input type="date" value={draft.targetDate} onChange={(event) => updateDraft(index, { targetDate: event.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || !heldOn || agenda.trim().length < 10 || minutes.trim().length < 20 || !evidenceUrl.trim() || !draftsComplete}>{pending ? "Registrando..." : "Registrar acta"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function DesignateCoordinatorDialog({ open, onOpenChange, worksiteId, workers, onDone }: {
  open: boolean; onOpenChange: (open: boolean) => void; worksiteId: string; workers: Worker[]; onDone: (message?: string) => void
}) {
  const [workerId, setWorkerId] = React.useState("")
  const [designatedOn, setDesignatedOn] = React.useState("")
  const [evidenceUrl, setEvidenceUrl] = React.useState("")
  const [pending, setPending] = React.useState(false)

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) { setPrevOpen(open); if (open) { setWorkerId(""); setDesignatedOn(""); setEvidenceUrl("") } }

  async function save() {
    setPending(true)
    try {
      const result = await designateGrdCoordinatorAction({ worksiteId, workerId, designatedOn, evidenceUrl })
      if (result.ok) onOpenChange(false)
      onDone(result.ok ? undefined : result.message)
    } finally { setPending(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader>
      <DialogTitle>Designar coordinador</DialogTitle>
      <DialogDescription>
        Coordinador de Gestión del Riesgo de Desastres, la figura que corresponde hasta 25 personas. Es distinta
        del Delegado de Seguridad y Salud en el Trabajo, que es de otro cuerpo normativo.
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-4">
      <Field label="Persona" required>
        <Select value={workerId} onValueChange={setWorkerId}>
          <SelectTrigger><SelectValue placeholder="Selecciona a la persona" /></SelectTrigger>
          <SelectContent>{workers.map((worker) => <SelectItem key={worker.id} value={worker.id}>{worker.lastName}, {worker.firstName}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Designado el" required><Input type="date" value={designatedOn} onChange={(event) => setDesignatedOn(event.target.value)} /></Field>
      <Field label="Evidencia de la designación" required helper="Pega el enlace al documento (Drive, SharePoint, etc.)."><Input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://..." /></Field>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="button" onClick={save} disabled={pending || !workerId || !designatedOn || !evidenceUrl.trim()}>{pending ? "Designando..." : "Designar"}</Button></DialogFooter>
  </DialogContent></Dialog>
}
