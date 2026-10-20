"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FREQUENCY_INTERVAL_DAYS, INSPECTION_FREQUENCY_LABELS, nextDueAfter } from "@/lib/prevention/inspections"
import {
  NO_SUBJECT,
  subjectIdsFromRef,
  subjectRefFromIds,
  templateRequiresContainer,
  type InspectionSubjectOption,
} from "@/lib/prevention/inspection-list-query"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDate, todayInChile } from "@/lib/utils"
import { AssigneeSelectOptions, findWorksiteSuggestedAssignee, type InspectionAssigneeOption } from "../../assignee-picker"
import { createInspectionProgramAction, runProgramNowAction, updateInspectionProgramAction } from "../../actions"
import { InspectionTemplateSelect } from "../../template-select"
import type { ProgramItem } from "../../_components/catalog-types"
import { FormDialogFooter, InlineError, OperationError, ReasonField, useFormDialog } from "../../_components/form-dialog"
import { SubjectSelectField, selectableSubjects } from "../../_components/subject-select-field"

/**
 * Cómo se nombra una programación fuera de su fila: el instrumento, la faena y, si lo
 * tiene, el sujeto. Hay un botón «Editar», «Detener» y «Crear y abrir inspección» por
 * fila, y sin esto un lector de pantalla los oye todos iguales (R-03).
 */
export function programAccessibleName(program: Pick<ProgramItem, "templateName" | "worksiteName" | "subjectLabel">) {
  return `${program.templateName} en ${program.worksiteName}${program.subjectLabel ? ` (${program.subjectLabel})` : ""}`
}

/* ── Gestión de una programación existente ────────────────────────────────
 * A-10/A-11: el diálogo de alta no ofrecía `intervalDays` (pese a que el Zod y
 * el CHECK lo soportan) y, una vez creada, la programación no se podía editar,
 * reasignar ni desactivar.
 */

export function EditProgramDialog({ program, assignees, subjects, riskEntries }: {
  program: ProgramItem
  assignees: InspectionAssigneeOption[]
  subjects: InspectionSubjectOption[]
  riskEntries: { id: string; hazardCode: string; hazard: string }[]
}) {
  const [frequency, setFrequency] = React.useState(program.frequency)
  const [intervalDays, setIntervalDays] = React.useState(program.intervalDays)
  const [assignedToUserId, setAssignedToUserId] = React.useState(program.assignedToUserId ?? "_none")
  const [nextDueOn, setNextDueOn] = React.useState(program.nextDueOn)
  const [subjectRef, setSubjectRef] = React.useState(subjectRefFromIds(program))
  // INS-16: el servicio siempre aceptó cambiar el peligro y el formulario no lo ofrecía.
  const [riskEntryId, setRiskEntryId] = React.useState(program.riskEntryId ?? "_none")
  const { open, changeOpen, operation } = useFormDialog(() => {
    setFrequency(program.frequency)
    setIntervalDays(program.intervalDays)
    setAssignedToUserId(program.assignedToUserId ?? "_none")
    setNextDueOn(program.nextDueOn)
    setSubjectRef(subjectRefFromIds(program))
    setRiskEntryId(program.riskEntryId ?? "_none")
  })

  const requiresContainer = templateRequiresContainer(program.templateDefinitionCode)
  const subjectOptions = selectableSubjects(subjects, requiresContainer)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const subjectType = String(form.get("subjectType") ?? "").trim()
    // Quitarle el contenedor a un programa de contenedores lo dejaría
    // generando inspecciones sin sujeto; el servicio también lo rechaza.
    if (requiresContainer && !subjectRef.startsWith("container:")) {
      operation.setMessage("Selecciona un contenedor del catálogo de la faena.", "error")
      return
    }
    operation.run(() => updateInspectionProgramAction({
      programId: program.id,
      expectedVersion: program.version,
      frequency,
      intervalDays,
      nextDueOn,
      assignedToUserId: assignedToUserId === "_none" ? null : assignedToUserId,
      subjectType: subjectType || null,
      riskEntryId: riskEntryId === "_none" ? null : riskEntryId,
      ...subjectIdsFromRef(subjectRef),
    }), () => {
      toast.success("Programación actualizada.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Editar programación de ${programAccessibleName(program)}`}>Editar</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar programación</DialogTitle>
            <DialogDescription>{program.templateName} · {program.worksiteName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Frecuencia" error={operation.fieldError("frequency")}>
              <Select value={frequency} onValueChange={(value) => { setFrequency(value); setIntervalDays(FREQUENCY_INTERVAL_DAYS[value] ?? 30) }}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Intervalo efectivo (días)" hint="Este número gobierna el calendario. Al cambiar la frecuencia se propone su intervalo estándar." error={operation.fieldError("intervalDays")}>
              <Input name="intervalDays" type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} required />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Próxima ejecución" error={operation.fieldError("nextDueOn")}>
              <DatePicker value={nextDueOn} onChange={setNextDueOn} />
            </Field>
            <Field label="Asignada a" hint="Opcional." error={operation.fieldError("assignedToUserId")}>
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><AssigneeSelectOptions assignees={assignees} worksiteId={program.worksiteId} noneLabel="Sin asignar" /></SelectContent></Select>
            </Field>
          </div>
          {(subjectOptions.length > 0 || requiresContainer) && (
            <SubjectSelectField
              worksiteId={program.worksiteId}
              subjects={subjects}
              requiresContainer={requiresContainer}
              value={subjectRef}
              onValueChange={setSubjectRef}
              noneLabel="Sin sujeto del inventario"
              hint={requiresContainer
                ? "Obligatorio: cada inspección generada apuntará a este contenedor del catálogo."
                : "Opcional. Cada inspección generada apuntará a este recurso o equipo; un recurso del inventario actualiza su última inspección al completarse."}
            />
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor." error={operation.fieldError("subjectType")}>
              <Input name="subjectType" maxLength={120} defaultValue={program.subjectType ?? ""} />
            </Field>
            <Field label="Peligro MIPER de origen" hint="Opcional. Los de esta faena." error={operation.fieldError("riskEntryId")}>
              <Select value={riskEntryId} onValueChange={setRiskEntryId}>
                <SelectTrigger aria-label="Peligro MIPER de origen"><SelectValue placeholder="Sin vincular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin vincular</SelectItem>
                  {riskEntries.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>{entry.hazardCode} · {entry.hazard}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Guardar" pending={operation.pending} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Desactivar es el borrado: los runs ya creados conservan su origen. */
export function ToggleProgramButton({ program }: { program: ProgramItem }) {
  const { open, changeOpen, operation } = useFormDialog()
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {/* I-20: "Detener" es destructivo (frena la generación futura); "Reactivar" no. */}
        <Button
          type="button"
          size="sm"
          variant={program.isActive ? "ghost-danger" : "ghost"}
          aria-label={`${program.isActive ? "Detener" : "Reactivar"} programación de ${programAccessibleName(program)}`}
        >
          {program.isActive ? "Detener" : "Reactivar"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim()
          operation.run(() => updateInspectionProgramAction({
            programId: program.id,
            expectedVersion: program.version,
            isActive: !program.isActive,
            reason,
          }), () => {
            toast.success(program.isActive ? "Programación detenida." : "Programación reactivada.")
            changeOpen(false)
          })
        }}>
          <DialogHeader>
            <DialogTitle>{program.isActive ? "¿Detener esta programación?" : "¿Reactivar esta programación?"}</DialogTitle>
            <DialogDescription>{program.isActive
              ? "No se crearán futuras inspecciones automáticas. Las ya creadas se conservan y pueden seguir ejecutándose."
              : "Volverán a generarse inspecciones desde la próxima fecha configurada."}</DialogDescription>
          </DialogHeader>
          <ReasonField error={operation.fieldError("reason")} />
          <OperationError operation={operation} />
          <FormDialogFooter
            submitLabel={program.isActive ? "Detener programación" : "Reactivar programación"}
            variant={program.isActive ? "destructive" : "primary"}
            pending={operation.pending}
            onCancel={() => changeOpen(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Materializa la ejecución del período por el mismo camino que el cron. */
export function RunProgramNowButton({ program }: { program: ProgramItem }) {
  const operation = useOperation()
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const today = todayInChile()
  // I-01: cada ejecución avanza `nextDueOn` un intervalo completo
  // (materializeProgramRuns), sin exigir que el programa esté vencido cuando
  // se llama con `programId` explícito. Regularizar una vencida es el camino
  // correcto y no debe pedir confirmación; crearla fuera de ciclo sí consume
  // un ciclo del programa anual y merece decirlo antes, no después.
  const outOfCycle = program.frequency !== "on_demand" && program.nextDueOn > today
  const nextAfter = nextDueAfter(program.nextDueOn, program.intervalDays, today)

  function create() {
    setConfirming(false)
    operation.run(() => runProgramNowAction({ programId: program.id }), (result) => {
      const runId = result.data?.runId
      if (typeof runId === "string") router.push(`/prevencion/inspecciones/${runId}`)
    })
  }

  return (
    // `max-w-full`: en la columna de acción de la tabla (10 rem) un error largo
    // debe partirse dentro de ella, no empujar la tabla fuera del pozo.
    <div className="max-w-full space-y-1 text-right">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={operation.pending}
        // Mientras crea, el texto visible cambia a «Creando…»: el nombre accesible no lo contradice.
        aria-label={operation.pending ? undefined : `Crear y abrir inspección de ${programAccessibleName(program)}`}
        onClick={() => (outOfCycle ? setConfirming(true) : create())}
      >
        {operation.pending ? "Creando…" : "Crear y abrir inspección"}
      </Button>
      <InlineError operation={operation} className="max-w-full" />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        variant="warning"
        title="Esta programación aún no vence"
        description={`La próxima inspección de "${program.templateName}" está programada para el ${formatDate(program.nextDueOn)}. Crearla ahora consume ese ciclo: la próxima pasará al ${formatDate(nextAfter)}. ¿Crear de todos modos?`}
        confirmLabel="Crear igual y mover la fecha"
        cancelLabel="No crear"
        onConfirm={create}
        loading={operation.pending}
      />
    </div>
  )
}

/* ── Alta de programación ─────────────────────────────────────────────────── */

export function ProgramDialog({ templates, worksites, assignees, riskEntriesByWorksite, subjectsByWorksite = {} }: {
  templates: { id: string; name: string; versionLabel: string; kind?: string | null; sourceDefinitionCode?: string | null }[]
  worksites: { id: string; name: string }[]
  assignees: InspectionAssigneeOption[]
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  /** Inventario por faena: declarar QUÉ se inspecciona, no sólo con qué instrumento (INS-04). */
  subjectsByWorksite?: Record<string, InspectionSubjectOption[]>
}) {
  const [startsOn, setStartsOn] = React.useState("")
  const [templateId, setTemplateId] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [frequency, setFrequency] = React.useState("monthly")
  const [intervalDays, setIntervalDays] = React.useState(FREQUENCY_INTERVAL_DAYS.monthly)
  const [assignedToUserId, setAssignedToUserId] = React.useState("_none")
  const [riskEntryId, setRiskEntryId] = React.useState("_none")
  const [subjectRef, setSubjectRef] = React.useState(NO_SUBJECT)
  const { open, changeOpen, operation } = useFormDialog(() => {
    setTemplateId("")
    setWorksiteId("")
    setStartsOn(todayInChile())
    setFrequency("monthly")
    setIntervalDays(FREQUENCY_INTERVAL_DAYS.monthly)
    setAssignedToUserId("_none")
    setRiskEntryId("_none")
    setSubjectRef(NO_SUBJECT)
  })

  /* La programación de contenedores exige sujeto por el mismo motivo que la
   * ejecución: un programa sin contenedor produce runs sin sujeto. */
  const requiresContainer = templateRequiresContainer(
    templates.find((item) => item.id === templateId)?.sourceDefinitionCode)
  const worksiteSubjects = subjectsByWorksite[worksiteId] ?? []
  const subjectOptions = selectableSubjects(worksiteSubjects, requiresContainer)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const assignee = String(form.get("assignedToUserId") ?? "").trim()
    const subjectType = String(form.get("subjectType") ?? "").trim()
    const riskEntry = String(form.get("riskEntryId") ?? "").trim()
    if (!templateId || !worksiteId || !startsOn) {
      operation.setMessage("Selecciona la plantilla, la faena y la primera fecha.", "error")
      return
    }
    if (requiresContainer && !subjectRef.startsWith("container:")) {
      operation.setMessage("Selecciona un contenedor del catálogo de la faena.", "error")
      return
    }
    operation.run(() => createInspectionProgramAction({
      templateId: form.get("templateId"),
      worksiteId: form.get("worksiteId"),
      frequency: form.get("frequency"),
      // A-10: el Zod y el CHECK siempre lo soportaron; el formulario no lo ofrecía.
      intervalDays,
      startsOn: form.get("startsOn"),
      assignedToUserId: assignee || null,
      subjectType: subjectType || null,
      riskEntryId: riskEntry || null,
      ...subjectIdsFromRef(subjectRef),
    }), () => {
      toast.success("Programación creada.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo programa</Button></DialogTrigger>
      <DialogContent className="overflow-hidden p-0">
        <form onSubmit={submit} className="flex max-h-[min(90dvh,54rem)] flex-col">
          <DialogHeader className="mb-0 shrink-0 border-b border-[var(--color-border)] px-6 pb-4 pt-6">
            <DialogTitle>Nueva programación</DialogTitle>
            <DialogDescription>Elige explícitamente el instrumento y la faena. Sólo las plantillas aprobadas pueden programarse.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <Field label="Plantilla" error={operation.fieldError("templateId")}>
            <InspectionTemplateSelect templates={templates} value={templateId} onValueChange={setTemplateId} /><input type="hidden" name="templateId" value={templateId} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Faena" error={operation.fieldError("worksiteId")}>
              <Select value={worksiteId} onValueChange={(value) => {
                setWorksiteId(value)
                setRiskEntryId("_none")
                setSubjectRef(NO_SUBJECT)
                setAssignedToUserId(findWorksiteSuggestedAssignee(assignees, value))
              }}><SelectTrigger aria-label="Faena del programa"><SelectValue placeholder="Selecciona la faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
            <Field label="Frecuencia" error={operation.fieldError("frequency")}>
              <Select value={frequency} onValueChange={(value) => { setFrequency(value); setIntervalDays(FREQUENCY_INTERVAL_DAYS[value] ?? 30) }}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="frequency" value={frequency} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Primera fecha" required error={operation.fieldError("startsOn")}>
              <DatePicker name="startsOn" value={startsOn} onChange={setStartsOn} />
            </Field>
            <Field label="Intervalo efectivo (días)" hint="Este número gobierna el calendario. Al cambiar la frecuencia se propone su intervalo estándar." error={operation.fieldError("intervalDays")}>
              <Input name="intervalDays" type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} required />
            </Field>
            <Field label="Asignada a" hint="Opcional. El prevencionista de la faena se sugiere automáticamente al elegirla." error={operation.fieldError("assignedToUserId")}>
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><AssigneeSelectOptions assignees={assignees} worksiteId={worksiteId} noneLabel="Sin asignar" /></SelectContent></Select><input type="hidden" name="assignedToUserId" value={assignedToUserId === "_none" ? "" : assignedToUserId} />
            </Field>
          </div>
          {/* Con plantilla de contenedores el campo se muestra siempre, incluso
              sin opciones: desaparecer dejaba pasar el alta sin sujeto. */}
          {(subjectOptions.length > 0 || requiresContainer) && (
            <SubjectSelectField
              worksiteId={worksiteId}
              subjects={worksiteSubjects}
              requiresContainer={requiresContainer}
              value={subjectRef}
              onValueChange={setSubjectRef}
              noneLabel="Sin sujeto del inventario"
              hint={requiresContainer
                ? "Obligatorio: cada inspección generada apuntará a este contenedor del catálogo."
                : "Opcional. Cada inspección generada apuntará a este recurso o equipo, y el prevencionista sabrá qué va a inspeccionar."}
            />
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor." error={operation.fieldError("subjectType")}><Input name="subjectType" maxLength={120} /></Field>
            {/* A-09: antes era un `<Input>` donde el usuario debía escribir el
                UUID del peligro a mano, sin validar existencia ni faena. */}
            <Field label="Peligro MIPER de origen" hint="Opcional. Los de la faena seleccionada." error={operation.fieldError("riskEntryId")}>
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
          <OperationError operation={operation} />
          </div>
          <FormDialogFooter
            className="mt-0 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4"
            submitLabel={operation.pending ? "Programando…" : "Programar"}
            pending={operation.pending}
            disabled={!templateId || !worksiteId || !startsOn}
            onCancel={() => changeOpen(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}
