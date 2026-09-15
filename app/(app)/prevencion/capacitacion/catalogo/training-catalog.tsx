"use client"

import * as React from "react"
import { Certificate } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  COMPETENCY_SCOPE_LABELS,
  TRAINING_KIND_LABELS,
  TRAINING_MODALITY_LABELS,
  TRAINING_VERSION_STATUS_LABELS,
} from "@/lib/prevention/training"
import {
  DS44_ART16_MAX_VALIDITY_MONTHS,
  DS44_ART16_MIN_DURATION_MINUTES,
} from "@/lib/validation/prevention-module/training"
import {
  createCompetencyRequirementAction,
  createTrainingCourseAction,
  createTrainingCourseVersionAction,
  transitionTrainingCourseVersionAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { nanoid } from "@/lib/id"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

interface CourseItem {
  id: string
  code: string
  name: string
  kind: string
  minimumDurationMinutes: number
  validityMonths: number | null
  requiresAssessment: boolean
  passingScore: number
  legalBasis: string | null
  publishedVersionLabel: string | null
}

interface VersionItem {
  id: string
  courseName: string
  versionLabel: string
  status: string
  durationMinutes: number
  modality: string
  version: number
  observationComment: string | null
}

interface RequirementItem {
  id: string
  courseName: string
  scopeType: string
  scopeValue: string | null
  worksiteName: string | null
  enforcement: string
  isActive: boolean
}

function versionStatusVariant(status: string): "default" | "info" | "warning" | "success" | "outline" {
  if (status === "published") return "success"
  if (status === "approved") return "info"
  if (status === "observed") return "warning"
  if (status === "superseded") return "outline"
  return "default"
}

export function TrainingCatalog({ courses, versions, requirements, worksites, canManage, canApprove, catalogActivities = [] }: {
  courses: CourseItem[]
  versions: VersionItem[]
  requirements: RequirementItem[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  canApprove: boolean
  catalogActivities?: PdtpActivityPickerOption[]
}) {
  const [tab, setTab] = React.useState<"courses" | "versions" | "requirements">("courses")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1">
          {([["courses", `Cursos (${courses.length})`], ["versions", `Contenidos (${versions.length})`], ["requirements", `Requisitos (${requirements.length})`]] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
              className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
              {label}
            </button>
          ))}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <CourseDialog catalogActivities={catalogActivities} />
            {courses.length > 0 && <VersionDialog courses={courses} />}
            {courses.length > 0 && <RequirementDialog courses={courses} worksites={worksites} />}
          </div>
        )}
      </div>

      {tab === "courses" && (courses.length === 0 ? (
        <EmptyState
          icon={<Certificate size={20} />}
          title="Aún no hay cursos en el catálogo"
          description="Un curso declara su duración mínima y su vigencia. Si es legal obligatorio, debe cumplir el piso del DS 44 art. 16: 8 horas y vigencia de a lo más 2 años."
          action={canManage ? <CourseDialog catalogActivities={catalogActivities} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / curso</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Duración mínima</TableHead>
                <TableHead className="text-right">Vigencia</TableHead>
                <TableHead>Evaluación</TableHead>
                <TableHead>Versión vigente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.name}</span>
                    {item.legalBasis && <span className="block text-xs text-[var(--color-text-subtle)]">{item.legalBasis}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{TRAINING_KIND_LABELS[item.kind] ?? item.kind}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.minimumDurationMinutes} min</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.validityMonths === null ? "Sin vencimiento" : `${item.validityMonths} meses`}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.requiresAssessment ? `Exigida · ${item.passingScore}%` : "No exigida"}
                  </TableCell>
                  <TableCell>
                    {item.publishedVersionLabel
                      ? <MetaBadge meta={{ label: item.publishedVersionLabel, variant: "success" }} />
                      : <span className="text-xs text-[var(--color-text-subtle)]">Sin versión publicada</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {tab === "versions" && (versions.length === 0 ? (
        <EmptyState
          icon={<Certificate size={20} />}
          title="Ningún curso tiene contenido versionado"
          description="El temario se versiona aparte del curso. Sólo puede dictarse una versión publicada, y quien la escribe no puede aprobarla."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Curso</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Duración</TableHead>
                <TableHead>Modalidad</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.courseName}</TableCell>
                  <TableCell className="font-mono text-xs">{item.versionLabel}</TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: TRAINING_VERSION_STATUS_LABELS[item.status] ?? item.status, variant: versionStatusVariant(item.status) }} />
                    {item.observationComment && (
                      <span className="mt-1 block max-w-xs text-xs text-[var(--color-text-subtle)]">{item.observationComment}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.durationMinutes} min</TableCell>
                  <TableCell className="text-sm">{TRAINING_MODALITY_LABELS[item.modality] ?? item.modality}</TableCell>
                  <TableCell className="text-right">
                    <VersionTransition version={item} canManage={canManage} canApprove={canApprove} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {tab === "requirements" && (requirements.length === 0 ? (
        <EmptyState
          icon={<Certificate size={20} />}
          title="Aún no hay requisitos de competencia"
          description="Un requisito declara qué curso exige qué población. Sin requisitos declarados no se detecta ninguna brecha, porque el sistema no puede inferir qué tarea es crítica."
          action={canManage && courses.length > 0 ? <RequirementDialog courses={courses} worksites={worksites} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Curso exigido</TableHead>
                <TableHead>Alcance</TableHead>
                <TableHead>Exigibilidad</TableHead>
                <TableHead>Activo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.courseName}</TableCell>
                  <TableCell className="text-sm">
                    {COMPETENCY_SCOPE_LABELS[item.scopeType] ?? item.scopeType}
                    {(item.scopeValue || item.worksiteName) && (
                      <span className="block text-xs text-[var(--color-text-subtle)]">{item.scopeValue ?? item.worksiteName}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <MetaBadge meta={item.enforcement === "blocking" ? { label: "Bloqueante", variant: "danger" } : { label: "Advertencia", variant: "warning" }} />
                  </TableCell>
                  <TableCell className="text-sm">{item.isActive ? "Sí" : "No"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}

/* ── Alta de curso ────────────────────────────────────────────────────────── */

function CourseDialog({ catalogActivities }: { catalogActivities: PdtpActivityPickerOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState("legal_mandatory")
  const [requiresAssessment, setRequiresAssessment] = React.useState(true)
  const operation = useOperation()
  const isLegal = kind === "legal_mandatory"
  const isOdi = kind === "odi"
  const [catalogActivityIds, setCatalogActivityIds] = React.useState<string[]>([])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const validity = String(form.get("validityMonths") ?? "").trim()
    operation.run(() => createTrainingCourseAction({
      code: form.get("code"),
      name: form.get("name"),
      kind,
      description: String(form.get("description") ?? "") || null,
      minimumDurationMinutes: Number(form.get("minimumDurationMinutes")),
      validityMonths: validity ? Number(validity) : null,
      requiresAssessment,
      passingScore: Number(form.get("passingScore")),
      legalBasis: String(form.get("legalBasis") ?? "") || null,
      riskEntryId: String(form.get("riskEntryId") ?? "") || null,
      pdtpActivityNumbers: [],
      catalogActivityIds,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo curso</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo curso</DialogTitle>
            <DialogDescription>
              La duración y la vigencia son parámetros del curso, no del sistema. Un curso legal obligatorio
              debe cumplir el piso del DS 44 art. 16.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Código"><Input name="code" required minLength={2} maxLength={60} placeholder="LEG-8H" /></Field>
            <Field label="Tipo">
              <Select value={kind} onValueChange={setKind}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TRAINING_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
          </div>
          <Field label="Nombre"><Input name="name" required minLength={3} maxLength={300} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Duración mínima (minutos)"
              hint={isLegal ? `Mínimo legal: ${DS44_ART16_MIN_DURATION_MINUTES} min (8 horas).` : undefined}
            >
              <Input name="minimumDurationMinutes" type="number" min={isLegal ? DS44_ART16_MIN_DURATION_MINUTES : 1}
                defaultValue={isLegal ? DS44_ART16_MIN_DURATION_MINUTES : 60} required />
            </Field>
            <Field
              label="Vigencia (meses)"
              hint={isLegal ? `Obligatoria y de a lo más ${DS44_ART16_MAX_VALIDITY_MONTHS} meses.` : "Vacío = no vence."}
            >
              <Input name="validityMonths" type="number" min={1} max={isLegal ? DS44_ART16_MAX_VALIDITY_MONTHS : 600}
                defaultValue={isLegal ? DS44_ART16_MAX_VALIDITY_MONTHS : ""} required={isLegal} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Evaluación">
              <Select value={requiresAssessment ? "yes" : "no"} onValueChange={(v) => setRequiresAssessment(v === "yes")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Exigida</SelectItem><SelectItem value="no">No exigida</SelectItem></SelectContent></Select>
            </Field>
            <Field label="Nota de aprobación (%)">
              <Input name="passingScore" type="number" min={0} max={100} defaultValue={70} required />
            </Field>
          </div>
          {isLegal && (
            <Field label="Fundamento normativo" hint="Obligatorio para un curso legal obligatorio.">
              <Textarea name="legalBasis" required minLength={5} defaultValue="DS 44/2024 art. 16" />
            </Field>
          )}
          {isOdi && (
            <Field label="Peligro MIPER de origen" hint="Una ODI debe derivar de un peligro identificado en la matriz.">
              <Input name="riskEntryId" required placeholder="ID del peligro en la MIPER" />
            </Field>
          )}
          <Field label="Descripción"><Textarea name="description" maxLength={3000} /></Field>
          <PdtpActivityPicker multiple label="Actividades PDTP que acredita" options={catalogActivities} value={catalogActivityIds} onChange={setCatalogActivityIds} />
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear curso</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de versión de contenido ─────────────────────────────────────────── */

function VersionDialog({ courses }: { courses: CourseItem[] }) {
  const [open, setOpen] = React.useState(false)
  const [modules, setModules] = React.useState([{ id: nanoid(), title: "", minutes: 60 }])
  const [courseId, setCourseId] = React.useState(courses[0]?.id ?? "")
  const [modality, setModality] = React.useState("presencial")
  const [assessmentType, setAssessmentType] = React.useState("theoretical")
  const operation = useOperation()
  const declaredMinutes = modules.reduce((total, item) => total + (Number(item.minutes) || 0), 0)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createTrainingCourseVersionAction({
      courseId: form.get("courseId"),
      versionLabel: form.get("versionLabel"),
      contentOutline: modules.map((item) => ({ title: item.title, minutes: Number(item.minutes) })),
      durationMinutes: Number(form.get("durationMinutes")),
      modality: form.get("modality"),
      assessmentType: form.get("assessmentType"),
      passingScore: Number(form.get("passingScore")),
    }), () => { setOpen(false); setModules([{ id: nanoid(), title: "", minutes: 60 }]) })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Nuevo contenido</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva versión de contenido</DialogTitle>
            <DialogDescription>
              Nace en borrador. Quien la escribe no puede aprobarla, y sólo puede dictarse una vez publicada.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Curso">
              <Select value={courseId} onValueChange={setCourseId}><SelectTrigger><SelectValue placeholder="Selecciona curso" /></SelectTrigger><SelectContent>{courses.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="courseId" value={courseId} />
            </Field>
            <Field label="Etiqueta de versión"><Input name="versionLabel" required maxLength={80} defaultValue="v1" /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Duración total (min)"><Input name="durationMinutes" type="number" min={1} defaultValue={480} required /></Field>
            <Field label="Modalidad">
              <Select value={modality} onValueChange={setModality}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TRAINING_MODALITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="modality" value={modality} />
            </Field>
            <Field label="Evaluación">
              <Select value={assessmentType} onValueChange={setAssessmentType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin evaluación</SelectItem><SelectItem value="theoretical">Teórica</SelectItem><SelectItem value="practical">Práctica</SelectItem><SelectItem value="both">Teórica y práctica</SelectItem></SelectContent></Select><input type="hidden" name="assessmentType" value={assessmentType} />
            </Field>
          </div>
          <Field label="Nota de aprobación (%)"><Input name="passingScore" type="number" min={0} max={100} defaultValue={70} required /></Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Temario</span>
              <span className="text-xs text-[var(--color-text-subtle)]">{declaredMinutes} min declarados</span>
            </div>
            {modules.map((item, index) => (
              <div key={item.id} className="flex gap-2">
                <Input
                  value={item.title}
                  onChange={(event) => setModules((current) => current.map((m, i) => i === index ? { ...m, title: event.target.value } : m))}
                  placeholder="Módulo" required minLength={3} className="flex-1"
                />
                <Input
                  type="number" min={1} value={item.minutes}
                  onChange={(event) => setModules((current) => current.map((m, i) => i === index ? { ...m, minutes: Number(event.target.value) } : m))}
                  className="w-24" required
                />
                {modules.length > 1 && (
                  <Button type="button" variant="ghost" size="sm"
                    onClick={() => setModules((current) => current.filter((_, i) => i !== index))}>
                    Quitar
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setModules((current) => [...current, { id: nanoid(), title: "", minutes: 60 }])}>
              Agregar módulo
            </Button>
          </div>

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear versión</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Transiciones de versión ──────────────────────────────────────────────── */

const NEXT_STATES: Record<string, { to: string; label: string; needsApproval: boolean }[]> = {
  draft: [{ to: "in_review", label: "Enviar a revisión", needsApproval: false }],
  in_review: [
    { to: "approved", label: "Aprobar", needsApproval: true },
    { to: "observed", label: "Observar", needsApproval: false },
  ],
  observed: [{ to: "in_review", label: "Reenviar a revisión", needsApproval: false }],
  approved: [{ to: "published", label: "Publicar", needsApproval: true }],
}

function VersionTransition({ version, canManage, canApprove }: { version: VersionItem; canManage: boolean; canApprove: boolean }) {
  const [open, setOpen] = React.useState<string | null>(null)
  const operation = useOperation()
  const options = (NEXT_STATES[version.status] ?? []).filter((option) => option.needsApproval ? canApprove : canManage)
  if (options.length === 0) return <span className="text-xs text-[var(--color-text-subtle)]">—</span>

  return (
    <div className="flex justify-end gap-1">
      {options.map((option) => (
        <Dialog key={option.to} open={open === option.to} onOpenChange={(value) => setOpen(value ? option.to : null)}>
          <DialogTrigger asChild><Button size="sm" variant="secondary">{option.label}</Button></DialogTrigger>
          <DialogContent>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                operation.run(() => transitionTrainingCourseVersionAction({
                  versionId: version.id,
                  toStatus: option.to,
                  reason: form.get("reason"),
                  expectedVersion: version.version,
                }), () => setOpen(null))
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>{option.label} · {version.courseName} {version.versionLabel}</DialogTitle>
                <DialogDescription>
                  {option.to === "observed"
                    ? "La observación vuelve el contenido al autor: describe qué debe corregirse."
                    : option.to === "published"
                      ? "Publicar reemplaza la versión vigente anterior del mismo curso."
                      : "Queda registrado en el historial con tu identidad y la fecha."}
                </DialogDescription>
              </DialogHeader>
              <Field label="Motivo" hint="Mínimo 10 caracteres.">
                <Textarea name="reason" required minLength={10} maxLength={3000} />
              </Field>
              {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
              <DialogFooter><Button type="submit" disabled={operation.pending}>{option.label}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ))}
    </div>
  )
}

/* ── Alta de requisito de competencia ─────────────────────────────────────── */

function RequirementDialog({ courses, worksites }: { courses: CourseItem[]; worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [scopeType, setScopeType] = React.useState("position")
  const [courseId, setCourseId] = React.useState(courses[0]?.id ?? "")
  const [enforcement, setEnforcement] = React.useState("warning")
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createCompetencyRequirementAction({
      courseId: form.get("courseId"),
      scopeType,
      scopeValue: String(form.get("scopeValue") ?? "") || null,
      worksiteId: String(form.get("worksiteId") ?? "") || null,
      enforcement: form.get("enforcement"),
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Nuevo requisito</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo requisito de competencia</DialogTitle>
            <DialogDescription>
              Un requisito bloqueante impide asignar a la persona a la tarea que lo exige. El sistema no puede
              inferir qué tarea es crítica: esa decisión es de Prevención.
            </DialogDescription>
          </DialogHeader>
          <Field label="Curso exigido">
            <Select value={courseId} onValueChange={setCourseId}><SelectTrigger><SelectValue placeholder="Selecciona curso" /></SelectTrigger><SelectContent>{courses.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="courseId" value={courseId} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Alcance">
              <Select value={scopeType} onValueChange={setScopeType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="position">Cargo</SelectItem><SelectItem value="worksite">Faena</SelectItem><SelectItem value="global">Toda la organización</SelectItem><SelectItem value="task">Tarea (se resuelve en el permiso de trabajo)</SelectItem></SelectContent></Select>
            </Field>
            <Field label="Exigibilidad">
              <Select value={enforcement} onValueChange={setEnforcement}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="warning">Advertencia</SelectItem><SelectItem value="blocking">Bloqueante</SelectItem></SelectContent></Select><input type="hidden" name="enforcement" value={enforcement} />
            </Field>
          </div>
          {scopeType === "position" && (
            <Field label="Cargo" hint="Debe coincidir con el cargo registrado en la dotación.">
              <Input name="scopeValue" required maxLength={300} placeholder="Operador maquinaria pesada" />
            </Field>
          )}
          {scopeType === "task" && (
            <Field label="Clave de tarea" hint="Es la clave que declara el tipo de permiso de trabajo (competencyTaskKey).">
              <Input name="scopeValue" required maxLength={300} placeholder="espacio-confinado" />
            </Field>
          )}
          {scopeType === "worksite" && (
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
          )}
          <Field label="Fundamento" hint="Por qué se exige. Mínimo 10 caracteres.">
            <Textarea name="reason" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear requisito</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
