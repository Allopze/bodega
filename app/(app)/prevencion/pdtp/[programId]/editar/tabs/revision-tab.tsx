"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { publishPdtpTemplateAction } from "../../../actions"

import type { pdtpPrograms } from "@/db/schema"
import type { PdtpChecklistTemplate } from "@/lib/services/prevention-pdtp"

import type { PdtpActivityRow } from "./types"

export function ReviewTab({
  program,
  activities,
  checklists,
  responsibleCatalog,
  visibleWorksites,
  memberWorksiteIds,
  activityWorksiteExclusions,
}: {
  program: typeof pdtpPrograms.$inferSelect
  activities: PdtpActivityRow[]
  checklists: PdtpChecklistTemplate[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds: string[]
  activityWorksiteExclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const objectiveCount = new Set(activities.map((activity) => activity.objectiveOrder)).size
  const missingSchedule = activities.filter((activity) => (activity.scheduleMode ?? "scheduled") === "scheduled" && !activity.recurrenceRule && activity.sourceSheetRow === 0).length
  const missingTrigger = activities.filter((activity) => activity.scheduleMode === "triggered" && !activity.triggerDescription).length
  const unresolvedScheduleClassification = activities.filter((activity) => activity.scheduleClassificationStatus === "needs_review").length
  const missingEvidence = activities.filter((activity) => !activity.evidenceRequirement && !checklists.some((checklist) => checklist.activityId === activity.id)).length
  const checks = [
    { label: "Datos básicos", ok: !!program.title.trim(), detail: program.title },
    { label: "Objetivos", ok: objectiveCount > 0, detail: objectiveCount > 0 ? `${objectiveCount} definido(s)` : "Agrega al menos un objetivo" },
    { label: "Actividades", ok: activities.length > 0, detail: activities.length > 0 ? `${activities.length} definida(s)` : "Agrega al menos una actividad" },
    { label: "Clasificación temporal", ok: unresolvedScheduleClassification === 0, detail: unresolvedScheduleClassification === 0 ? "Todas tienen una modalidad confirmada" : `${unresolvedScheduleClassification} requieren decidir cuándo se realizan` },
    { label: "Programación", ok: missingSchedule === 0 && missingTrigger === 0, detail: missingSchedule + missingTrigger === 0 ? "Todas explican cuándo se realizan" : `${missingSchedule + missingTrigger} requieren completar su regla` },
    { label: "Evidencia", ok: missingEvidence === 0, detail: missingEvidence === 0 ? "Requisitos definidos" : `${missingEvidence} sin requisito explícito o checklist` },
  ]
  const ready = checks.every((check) => check.ok)

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text)]">Revisión antes de enviar</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Comprueba el resultado preventivo; no necesitas revisar una grilla del Excel.</p>
        </div>
        <Badge variant={ready ? "success" : "warning"} dot>{ready ? "Listo para revisar" : "Faltan datos"}</Badge>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {checks.map((check) => (
          <li key={check.label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="font-medium text-[var(--color-text)]">{check.label}</span>
            <span className={check.ok ? "text-[var(--color-success)]" : "text-[var(--color-signal)]"}>{check.ok ? "Completo" : check.detail}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
        La aprobación ocurre fuera del editor y congela una versión exacta del contenido.
      </div>
      <AudiencePreviewPanel
        activities={activities}
        responsibleCatalog={responsibleCatalog}
        visibleWorksites={visibleWorksites}
        memberWorksiteIds={memberWorksiteIds}
        exclusions={activityWorksiteExclusions}
      />
      <TemplatePublishPanel program={program} ready={ready} />
    </section>
  )
}

/**
 * Previsualiza qué actividades ve cada responsable/audiencia sin crear
 * copias ni consultas nuevas: filtra en el cliente sobre `responsibleSlugs`
 * y `audienceRoles`, que ya son datos generales por actividad (no una tabla
 * especial por hoja). La dimensión de faena reutiliza `pdtpProgramWorksites`
 * (membresía) y `pdtpActivityWorksiteExclusions` (excepción puntual), ya
 * cargadas por la página del editor — sin faena seleccionada, o sin ninguna
 * de las dos props recibida (compatibilidad), el filtro por faena no se
 * muestra y el resultado es idéntico al de antes.
 */
export function AudiencePreviewPanel({
  activities,
  responsibleCatalog,
  visibleWorksites = [],
  memberWorksiteIds = [],
  exclusions = [],
}: {
  activities: PdtpActivityRow[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  visibleWorksites?: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds?: string[]
  exclusions?: Array<{ activityId: string; worksiteId: string }>
}) {
  const ALL = "__all__"
  const [responsableSlug, setResponsableSlug] = React.useState(ALL)
  const [audienceRole, setAudienceRole] = React.useState(ALL)
  const [worksiteId, setWorksiteId] = React.useState(ALL)

  const labelBySlug = new Map(responsibleCatalog.map((r) => [r.slug, r.displayName]))
  const audienceRoles = [...new Set(activities.flatMap((activity) => (Array.isArray(activity.audienceRoles) ? activity.audienceRoles as string[] : [])))].sort()

  const worksiteSelected = worksiteId !== ALL
  const worksiteCanOperate = !worksiteSelected || memberWorksiteIds.length === 0 || memberWorksiteIds.includes(worksiteId)
  const excludedActivityIds = new Set(worksiteSelected ? exclusions.filter((e) => e.worksiteId === worksiteId).map((e) => e.activityId) : [])

  const filtered = !worksiteCanOperate ? [] : activities.filter((activity) => {
    if (worksiteSelected && excludedActivityIds.has(activity.id)) return false
    const responsibleSlugs = Array.isArray(activity.responsibleSlugs) ? activity.responsibleSlugs as string[] : []
    if (responsableSlug !== ALL && !responsibleSlugs.includes(responsableSlug)) return false
    if (audienceRole !== ALL) {
      const roles = Array.isArray(activity.audienceRoles) ? activity.audienceRoles as string[] : []
      if (!roles.includes(audienceRole)) return false
    }
    return true
  })

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      <h4 className="text-sm font-semibold text-[var(--color-text)]">Previsualizar por responsable, audiencia o faena</h4>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Muestra exactamente qué actividades vería esa combinación, sin crear una copia del programa.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Select value={responsableSlug} onValueChange={setResponsableSlug}>
          <SelectTrigger className="w-56" aria-label="Responsable"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los responsables</SelectItem>
            {responsibleCatalog.map((r) => <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={audienceRole} onValueChange={setAudienceRole}>
          <SelectTrigger className="w-56" aria-label="Audiencia"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las audiencias</SelectItem>
            {audienceRoles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
          </SelectContent>
        </Select>
        {visibleWorksites.length > 0 && (
          <Select value={worksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger className="w-56" aria-label="Faena"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las faenas</SelectItem>
              {visibleWorksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {audienceRoles.length === 0 && responsableSlug === ALL && (
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">Ninguna actividad tiene audiencia asignada todavía; el filtro por responsable sigue disponible.</p>
      )}
      {worksiteSelected && !worksiteCanOperate ? (
        <p className="mt-3 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">
          Esta faena no está habilitada para este programa: la membresía declarada no la incluye.
        </p>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-text)]">
          {filtered.length} de {activities.length} actividad(es) visibles para esta combinación.
        </p>
      )}
      {filtered.length > 0 && (filtered.length !== activities.length) && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-[var(--color-text-muted)]">
          {filtered.map((activity) => (
            <li key={activity.id}>
              N°{activity.n} · {activity.responsibleDisplay || labelBySlug.get((Array.isArray(activity.responsibleSlugs) ? activity.responsibleSlugs as string[] : [])[0] ?? "") || "Sin responsable"}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TemplatePublishPanel({
  program,
  ready,
}: {
  program: typeof pdtpPrograms.$inferSelect
  ready: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, action, pending] = useActionState(publishPdtpTemplateAction, null)

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      router.refresh()
    }
  }, [state, router])

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--color-text)]">Reutilizar esta estructura</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Publica objetivos, actividades, frecuencias, evidencias, vistas y aprobaciones como una versión inmutable. No incluye ejecuciones ni firmas.
          </p>
        </div>
        <Button type="button" variant="secondary" disabled={!ready} onClick={() => setOpen(true)}>
          Publicar como plantilla
        </Button>
      </div>
      {!ready && (
        <p className="mt-2 text-xs text-[var(--color-signal)]">Completa la revisión antes de publicar una base reutilizable.</p>
      )}
      {state?.ok && <p role="status" className="mt-2 text-xs text-[var(--color-success)]">{state.message}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar versión de plantilla</DialogTitle>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="sourceProgramId" value={program.id} />
            <Field label="Nombre de la plantilla" htmlFor="pdtp-template-name" required>
              <Input id="pdtp-template-name" name="name" required minLength={3} maxLength={200} defaultValue={program.title} />
            </Field>
            <Field label="Descripción" htmlFor="pdtp-template-description">
              <Textarea
                id="pdtp-template-description"
                name="description"
                maxLength={1000}
                placeholder="Explica para qué tipos de operación o faena sirve esta base."
              />
            </Field>
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Si ya existe una plantilla con este nombre se publicará una versión nueva. Los programas creados con versiones anteriores no cambiarán.
            </p>
            {state?.message && !state.ok && <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>{pending ? "Publicando..." : "Publicar versión"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Tab Planificación: matriz semanal editable con bulk-fill por fila ──────
