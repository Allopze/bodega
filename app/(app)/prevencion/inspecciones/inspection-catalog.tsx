"use client"

import * as React from "react"
import { ClipboardText } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { INSPECTION_FREQUENCY_LABELS, INSPECTION_KIND_LABELS } from "@/lib/prevention/inspections"
import {
  approveInspectionTemplateAction,
  retireInspectionTemplateAction,
  createInspectionProgramAction,
  importInspectionTemplateAction,
  runProgramNowAction,
  setInspectionTemplatePdtpActivitiesAction,
  updateInspectionProgramAction,
} from "./actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { todayInChile } from "@/lib/utils"

interface Coverage {
  totalItems: number
  withDanoPotencial: number
  withRequired: number
  criticalityInert: boolean
}

interface TemplateItem {
  id: string
  code: string
  versionLabel: string
  name: string
  kind: string
  status: string
  authorUserId: string
  version: number
  coverage: Coverage
  /** Actividades del PDTP (campo `n`) que acredita al completarse un run. */
  pdtpActivityNumbers: number[] | null
  /** Definición de `lib/sst/definitions` de la que salió el snapshot. */
  sourceDefinitionCode: string | null
  /** El catálogo en código difiere del snapshot congelado (A-03). */
  definitionDrifted: boolean
  /** La definición de origen ya no existe en el catálogo en código. */
  definitionMissing: boolean
}

interface ProgramItem {
  id: string
  templateId: string
  worksiteId: string
  templateName: string
  worksiteName: string
  frequency: string
  intervalDays: number
  nextDueOn: string
  assignedToUserId: string | null
  assigneeName: string | null
  riskEntryId: string | null
  subjectType: string | null
  isActive: boolean
  version: number
}

interface ImportableDefinition {
  code: string
  title: string
  version: string
  sections: number
  items: number
  coverage: Coverage
  /** Actividades del PDTP que acreditará al ejecutarse (cableado del programa). */
  pdtpActivities: { n: number; name: string }[]
}

function templateStatusVariant(status: string): "default" | "success" | "outline" {
  if (status === "approved") return "success"
  if (status === "superseded") return "outline"
  return "default"
}

function coverageLabel(coverage: Coverage) {
  return `${coverage.withDanoPotencial}/${coverage.totalItems} con gravedad`
}

/**
 * Catálogo de instrumentos. Antes convivía con la programación en una sola
 * pantalla de pestañas: son dos actos distintos —qué se pregunta y cuándo se
 * pregunta— con permisos y públicos distintos, y la pestaña obligaba a pasar
 * por uno para llegar al otro.
 */
export function InspectionTemplatesPanel({ templates, importable, canManage, canApprove }: {
  templates: TemplateItem[]
  importable: ImportableDefinition[]
  canManage: boolean
  canApprove: boolean
}) {
  // A-02: antes se filtraba del picker toda definición ya incorporada, lo que
  // dejaba inalcanzable el versionado — y con él todo el mecanismo de
  // `superseded` que `approveInspectionTemplate` ya implementa. Reimportar es
  // el camino normal para publicar una versión nueva; lo único que el servicio
  // rechaza es repetir la misma `versionLabel`.
  const versionsByDefinition = React.useMemo(() => {
    const map = new Map<string, { approved?: TemplateItem; latest?: TemplateItem }>()
    for (const template of templates) {
      if (!template.sourceDefinitionCode) continue
      const entry = map.get(template.sourceDefinitionCode) ?? {}
      if (template.status === "approved") entry.approved = template
      if (!entry.latest) entry.latest = template
      map.set(template.sourceDefinitionCode, entry)
    }
    return map
  }, [templates])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-eyebrow">{templates.length} instrumento(s)</span>
        {canManage && importable.length > 0 && (
          <ImportTemplateDialog importable={importable} versionsByDefinition={versionsByDefinition} />
        )}
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title="No hay instrumentos instalados"
          description="El catálogo se instala solo al desplegar. Si esta pantalla está vacía, falta correr el sembrado de plantillas."
          action={canManage && importable.length > 0 ? <ImportTemplateDialog importable={importable} versionsByDefinition={versionsByDefinition} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Gravedad declarada</TableHead>
                <TableHead>Acredita PDTP</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.name}</span>
                  </TableCell>
                  <TableCell className="text-sm">{INSPECTION_KIND_LABELS[item.kind] ?? item.kind}</TableCell>
                  <TableCell className="font-mono text-xs">{item.versionLabel}</TableCell>
                  <TableCell>
                    <Badge variant={templateStatusVariant(item.status)}>{item.status === "approved" ? "Aprobada" : item.status === "superseded" ? "Reemplazada" : "Borrador"}</Badge>
                    {/* A-03: el snapshot está congelado a propósito, así que la
                        deriva no es un error — es la señal de que toca publicar
                        una versión nueva. Sólo interesa mientras la plantilla
                        esté vigente; una ya reemplazada deriva por definición. */}
                    {item.status !== "superseded" && item.definitionDrifted && (
                      <span className="mt-1 block text-xs text-[var(--color-warning-ink)]" title="El contenido en código difiere del snapshot aprobado. No implica que el checklist haya cambiado de fondo.">
                        Catálogo actualizado
                      </span>
                    )}
                    {item.definitionMissing && (
                      <span className="mt-1 block text-xs text-[var(--color-warning-ink)]" title="La definición de origen ya no existe en lib/sst/definitions.">
                        Definición retirada
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {coverageLabel(item.coverage)}
                    {item.coverage.criticalityInert && <span className="ml-1 text-xs text-[var(--color-warning-ink)]">sin gravedad: toda falla saldrá de criticidad media</span>}
                  </TableCell>
                  {/* Sin actividades declaradas, completar un run no acredita
                      nada en el programa anual: el conector es un no-op. */}
                  <TableCell className="text-sm">
                    {item.pdtpActivityNumbers && item.pdtpActivityNumbers.length > 0 ? (
                      <span className="font-mono text-xs">N° {item.pdtpActivityNumbers.join(", ")}</span>
                    ) : (
                      <span className="text-xs text-[var(--color-warning-ink)]">No acredita</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {item.status !== "superseded" && canManage && (
                        <PdtpActivitiesDialog
                          templateId={item.id}
                          name={item.name}
                          expectedVersion={item.version}
                          current={item.pdtpActivityNumbers ?? []}
                        />
                      )}
                      {item.status === "draft" && canApprove && (
                        <ApproveDialog templateId={item.id} name={item.name} expectedVersion={item.version} />
                      )}
                      {item.status !== "superseded" && canApprove && (
                        <RetireDialog templateId={item.id} name={item.name} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/**
 * Programación: qué instrumento se ejecuta, en qué faena y con qué frecuencia.
 * El cron diario materializa desde acá, y "Ejecutar ahora" usa el mismo camino.
 */
export function InspectionProgramsPanel({ programs, approvedTemplates, worksites, assignees, riskEntriesByWorksite, canManage }: {
  programs: ProgramItem[]
  approvedTemplates: { id: string; name: string; versionLabel: string }[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  /** Peligros de la MIPER por faena, para el picker de la programación (A-09). */
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  canManage: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-eyebrow">{programs.length} programación(es)</span>
        {canManage && approvedTemplates.length > 0 && worksites.length > 0 && (
          <ProgramDialog templates={approvedTemplates} worksites={worksites} assignees={assignees} riskEntriesByWorksite={riskEntriesByWorksite} />
        )}
      </div>

      {programs.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title="Aún no hay programación"
          description="Una programación declara qué plantilla se ejecuta, en qué faena y con qué frecuencia."
          action={canManage && approvedTemplates.length > 0 && worksites.length > 0 ? <ProgramDialog templates={approvedTemplates} worksites={worksites} assignees={assignees} riskEntriesByWorksite={riskEntriesByWorksite} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plantilla</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Frecuencia</TableHead>
                <TableHead>Próxima</TableHead>
                <TableHead>Asignada a</TableHead>
                <TableHead>Activa</TableHead>
                {canManage && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {programs.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.templateName}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell className="text-sm">
                    {INSPECTION_FREQUENCY_LABELS[item.frequency] ?? item.frequency}
                    <span className="block text-xs text-[var(--color-text-subtle)]">cada {item.intervalDays} día(s)</span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {item.nextDueOn}
                    {item.isActive && item.nextDueOn < todayInChile() && (
                      <span className="block text-xs text-[var(--color-warning-ink)]">Vencida</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.assigneeName ?? "Sin asignar"}</TableCell>
                  <TableCell className="text-sm">{item.isActive ? "Sí" : "No"}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* A-11: la programación se creaba y quedaba congelada
                            — ni editar, ni reasignar, ni desactivar. */}
                        <EditProgramDialog program={item} assignees={assignees} />
                        <ToggleProgramButton program={item} />
                        {/* B-04: mismo camino que el cron diario. */}
                        {item.isActive && <RunProgramNowButton program={item} />}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ── Incorporar plantilla ─────────────────────────────────────────────────── */

/** Centinela de "sin actividad": `Select` reserva el string vacío. */
const NO_ACTIVITY = "__none__"

function ImportTemplateDialog({ importable, versionsByDefinition }: {
  importable: ImportableDefinition[]
  versionsByDefinition: Map<string, { approved?: TemplateItem; latest?: TemplateItem }>
}) {
  const [open, setOpen] = React.useState(false)
  const [code, setCode] = React.useState(importable[0]?.code ?? "")
  const [kind, setKind] = React.useState("inspection")
  /** Actividad elegida cuando la definición sirve a más de una. */
  const [activity, setActivity] = React.useState(NO_ACTIVITY)
  const operation = useOperation()
  const definition = importable.find((item) => item.code === code)
  const existing = versionsByDefinition.get(code)
  const ambiguous = (definition?.pdtpActivities.length ?? 0) > 1

  // Cambiar de definición invalida la actividad elegida para la anterior.
  React.useEffect(() => { setActivity(NO_ACTIVITY) }, [code])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const versionLabel = String(form.get("versionLabel") ?? "").trim()
    operation.run(() => importInspectionTemplateAction({
      definitionCode: code,
      kind: form.get("kind"),
      versionLabel: versionLabel || undefined,
      // Sólo se manda cuando hay que desempatar. Omitirlo deja que el servicio
      // aplique el cableado por defecto, que es el caso de las nueve
      // definiciones con una sola actividad.
      ...(ambiguous && activity !== NO_ACTIVITY ? { pdtpActivityNumbers: [Number(activity)] } : {}),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Publicar nueva versión</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Publicar nueva versión</DialogTitle>
            <DialogDescription>
              Queda vigente al incorporarla: puede programarse y ejecutarse de inmediato. El contenido viene del catálogo SST versionado en el código, no se redacta aquí.
            </DialogDescription>
          </DialogHeader>
          <Field label="Definición del catálogo SST">
            <Select value={code} onValueChange={setCode}><SelectTrigger aria-label="Definición del catálogo SST"><SelectValue /></SelectTrigger><SelectContent>{importable.map((item) => <SelectItem key={item.code} value={item.code}>{item.title}</SelectItem>)}</SelectContent></Select>
          </Field>
          {definition && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              {definition.sections} secciones · {definition.items} ítems · {coverageLabel(definition.coverage)}
              {definition.coverage.criticalityInert && " · sin gravedad por ítem, ningún hallazgo alcanzará criticidad alta."}
            </p>
          )}
          {/* Qué acredita en el programa anual. Una sola actividad se cablea
              sola; dos exigen elegir, porque la misma definición de EPP la
              ejecutan el JT (n=64) y el PRF (n=65) por separado. */}
          {definition && (definition.pdtpActivities.length === 1 && definition.pdtpActivities[0] ? (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Acredita la actividad PDTP <span className="font-mono">N° {definition.pdtpActivities[0].n}</span> — {definition.pdtpActivities[0].name}.
            </p>
          ) : definition.pdtpActivities.length > 1 ? (
            // La misma definición de EPP la ejecutan el JT (n=64) y el PRF
            // (n=65) por separado: cablear las dos haría que un run de uno
            // cerrara la ocurrencia del otro, así que se elige una.
            <Field
              label="Actividad del PDTP que acredita"
              hint="Esta definición sirve a más de una; elige la del responsable que la va a ejecutar."
            >
              <Select value={activity} onValueChange={setActivity}>
                <SelectTrigger aria-label="Actividad del PDTP que acredita"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACTIVITY}>No acredita</SelectItem>
                  {definition.pdtpActivities.map((item) => (
                    <SelectItem key={item.n} value={String(item.n)}>N° {item.n} — {item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-xs text-[var(--color-text-subtle)]">
              No acredita ninguna actividad del programa anual.
            </p>
          ))}
          {existing?.approved && (
            <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
              Ya hay una versión vigente de esta definición: <span className="font-mono">{existing.approved.versionLabel}</span>.
              Incorporar otra la reemplaza en el acto, y las programaciones que apunten a la anterior dejarán de generar inspecciones.
              Usa una etiqueta de versión distinta.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo">
              <Select value={kind} onValueChange={setKind}><SelectTrigger aria-label="Tipo de instrumento"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="kind" value={kind} />
            </Field>
            <Field
              label="Etiqueta de versión"
              hint={existing?.latest
                ? `Ya existe ${existing.latest.versionLabel}; usa otra etiqueta.`
                : `Vacío = ${definition?.version ?? "versión de la definición"}.`}
            >
              <Input name="versionLabel" maxLength={80} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Incorporar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Acreditación PDTP ─────────────────────────────────────────────────────── */

/**
 * Declara qué actividades del programa anual acredita la plantilla. Sin esto
 * el conector `onInspectionCompleted` no hace nada y la inspección jamás llega
 * al PDTP — que fue el estado de todas las plantillas hasta 2026-08-04.
 */
function PdtpActivitiesDialog({ templateId, name, expectedVersion, current }: {
  templateId: string
  name: string
  expectedVersion: number
  current: number[]
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Acreditación PDTP</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const raw = String(new FormData(event.currentTarget).get("numbers") ?? "")
            const pdtpActivityNumbers = raw
              .split(/[\s,]+/)
              .map((token) => Number(token.trim()))
              .filter((value) => Number.isInteger(value) && value > 0)
            operation.run(
              () => setInspectionTemplatePdtpActivitiesAction({ templateId, expectedVersion, pdtpActivityNumbers }),
              () => setOpen(false),
            )
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Acreditación PDTP · {name}</DialogTitle>
            <DialogDescription>
              Números de actividad del programa anual que se acreditan al completar una inspección con esta
              plantilla. Vacío = no acredita nada.
            </DialogDescription>
          </DialogHeader>
          <Field label="Números de actividad" hint="Separados por coma o espacio. Ej.: 24, 27">
            <Input name="numbers" defaultValue={current.join(", ")} maxLength={120} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Aprobar plantilla ─────────────────────────────────────────────────────── */

function ApproveDialog({ templateId, name, expectedVersion }: { templateId: string; name: string; expectedVersion: number }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Aprobar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => approveInspectionTemplateAction({ templateId, expectedVersion, reason: form.get("reason") }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Aprobar {name}</DialogTitle>
            <DialogDescription>Congela el contenido y reemplaza la versión aprobada anterior del mismo código.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres."><Textarea name="reason" required minLength={10} maxLength={2000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Aprobar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Retirar plantilla ─────────────────────────────────────────────────────── */

/**
 * Saca un instrumento de circulación.
 *
 * Borra la fila si nunca se usó; si tiene ejecuciones o programaciones, la
 * marca reemplazada. Esa asimetría la resuelve el servidor, no esta pantalla:
 * la plantilla guarda el cuestionario congelado con el que se firmaron sus
 * inspecciones, y borrarla las dejaría sin las preguntas que respondieron.
 */
function RetireDialog({ templateId, name }: { templateId: string; name: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Retirar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => retireInspectionTemplateAction({ templateId, reason: form.get("reason") }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Retirar {name}</DialogTitle>
            <DialogDescription>
              Deja de poder programarse y ejecutarse. Si nunca se usó, se elimina; si tiene
              inspecciones hechas, se conserva como reemplazada — sus respuestas son evidencia.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres."><Textarea name="reason" required minLength={10} maxLength={2000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Retirar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Gestión de una programación existente ────────────────────────────────
 * A-10/A-11: el diálogo de alta no ofrecía `intervalDays` (pese a que el Zod y
 * el CHECK lo soportan) y, una vez creada, la programación no se podía editar,
 * reasignar ni desactivar.
 */

function EditProgramDialog({ program, assignees }: {
  program: ProgramItem
  assignees: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [frequency, setFrequency] = React.useState(program.frequency)
  const [assignedToUserId, setAssignedToUserId] = React.useState(program.assignedToUserId ?? "_none")
  const [nextDueOn, setNextDueOn] = React.useState(program.nextDueOn)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const intervalDays = Number(form.get("intervalDays"))
    const subjectType = String(form.get("subjectType") ?? "").trim()
    operation.run(() => updateInspectionProgramAction({
      programId: program.id,
      expectedVersion: program.version,
      frequency,
      intervalDays: Number.isFinite(intervalDays) && intervalDays > 0 ? intervalDays : undefined,
      nextDueOn,
      assignedToUserId: assignedToUserId === "_none" ? null : assignedToUserId,
      subjectType: subjectType || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Editar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar programación</DialogTitle>
            <DialogDescription>{program.templateName} · {program.worksiteName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Frecuencia">
              <Select value={frequency} onValueChange={setFrequency}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Intervalo (días)" hint="Vacío = el propio de la frecuencia.">
              <Input name="intervalDays" type="number" min={1} max={3650} defaultValue={program.intervalDays} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Próxima ejecución">
              <DatePicker value={nextDueOn} onChange={setNextDueOn} />
            </Field>
            <Field label="Asignada a" hint="Opcional.">
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin asignar</SelectItem>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
            </Field>
          </div>
          <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor.">
            <Input name="subjectType" maxLength={120} defaultValue={program.subjectType ?? ""} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Desactivar es el borrado: los runs ya creados conservan su origen. */
function ToggleProgramButton({ program }: { program: ProgramItem }) {
  const operation = useOperation()
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={operation.pending}
      onClick={() => operation.run(() => updateInspectionProgramAction({
        programId: program.id,
        expectedVersion: program.version,
        isActive: !program.isActive,
      }))}
    >
      {program.isActive ? "Desactivar" : "Activar"}
    </Button>
  )
}

/** Materializa la ejecución del período por el mismo camino que el cron. */
function RunProgramNowButton({ program }: { program: ProgramItem }) {
  const operation = useOperation()
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={operation.pending}
      onClick={() => operation.run(() => runProgramNowAction({ programId: program.id }))}
      title={operation.message || undefined}
    >
      Ejecutar ahora
    </Button>
  )
}

/* ── Alta de programación ─────────────────────────────────────────────────── */

function ProgramDialog({ templates, worksites, assignees, riskEntriesByWorksite }: {
  templates: { id: string; name: string; versionLabel: string }[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
}) {
  const [open, setOpen] = React.useState(false)
  const [defaultStart, setDefaultStart] = React.useState("")
  const [templateId, setTemplateId] = React.useState(templates[0]?.id ?? "")
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [frequency, setFrequency] = React.useState("monthly")
  const [assignedToUserId, setAssignedToUserId] = React.useState("_none")
  const [riskEntryId, setRiskEntryId] = React.useState("_none")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const assignee = String(form.get("assignedToUserId") ?? "").trim()
    const subjectType = String(form.get("subjectType") ?? "").trim()
    const riskEntry = String(form.get("riskEntryId") ?? "").trim()
    const intervalDays = Number(form.get("intervalDays"))
    operation.run(() => createInspectionProgramAction({
      templateId: form.get("templateId"),
      worksiteId: form.get("worksiteId"),
      frequency: form.get("frequency"),
      // A-10: el Zod y el CHECK siempre lo soportaron; el formulario no lo ofrecía.
      intervalDays: Number.isFinite(intervalDays) && intervalDays > 0 ? intervalDays : undefined,
      startsOn: form.get("startsOn"),
      assignedToUserId: assignee || null,
      subjectType: subjectType || null,
      riskEntryId: riskEntry || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultStart(todayInChile()); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm">Nuevo programa</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva programación</DialogTitle>
            <DialogDescription>Sólo puede programarse una plantilla aprobada.</DialogDescription>
          </DialogHeader>
          <Field label="Plantilla">
            <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger aria-label="Plantilla"><SelectValue /></SelectTrigger><SelectContent>{templates.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="templateId" value={templateId} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setRiskEntryId("_none") }}><SelectTrigger aria-label="Faena del programa"><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
            <Field label="Frecuencia">
              <Select value={frequency} onValueChange={setFrequency}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="frequency" value={frequency} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Primera fecha" required>
              <DatePicker name="startsOn" defaultValue={defaultStart} />
            </Field>
            <Field label="Intervalo (días)" hint="Vacío = el propio de la frecuencia.">
              <Input name="intervalDays" type="number" min={1} max={3650} />
            </Field>
            <Field label="Asignada a" hint="Opcional.">
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin asignar</SelectItem>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="assignedToUserId" value={assignedToUserId === "_none" ? "" : assignedToUserId} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor."><Input name="subjectType" maxLength={120} /></Field>
            {/* A-09: antes era un `<Input>` donde el usuario debía escribir el
                UUID del peligro a mano, sin validar existencia ni faena. */}
            <Field label="Peligro MIPER de origen" hint="Opcional. Los de la faena seleccionada.">
              <Select value={riskEntryId} onValueChange={setRiskEntryId}>
                <SelectTrigger aria-label="Peligro MIPER de origen"><SelectValue placeholder="Sin vincular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin vincular</SelectItem>
                  {(riskEntriesByWorksite[worksiteId] ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>{entry.hazardCode} · {entry.hazard}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="riskEntryId" value={riskEntryId === "_none" ? "" : riskEntryId} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Programar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
