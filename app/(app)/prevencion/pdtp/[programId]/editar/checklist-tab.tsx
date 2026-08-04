"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import {
  savePdtpChecklistTemplateAction,
  ensureDefaultPdtpChecklistAction,
  deletePdtpChecklistTemplateAction,
} from "../../actions/checklist-actions"
import type { pdtpActivities } from "@/db/schema"
import type { PdtpChecklistTemplate } from "@/lib/services/prevention-pdtp"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { pdtpChecklistDefinitionSchema } from "@/lib/validation/prevention"
import { ChecklistSectionPanel } from "@/app/(app)/prevencion/[id]/checklist-section"
import { getApplicableSections } from "@/app/(app)/prevencion/[id]/evaluation-detail/helpers"
import { ChecklistBuilder, buildSkeletonDefinition, cloneDefinitionForActivity } from "./checklist-builder"

type PdtpActivityRow = typeof pdtpActivities.$inferSelect

/** Fuente para "Copiar desde otra actividad" (F12): plantilla de otra actividad. */
type CopySource = {
  activityId: string
  activityName: string
  templateLabel: string
  definition: ChecklistDefinition
}

/**
 * Editor "JSON avanzado" con un editor visual de secciones/ítems como modo
 * por defecto (complementa el JSON, no lo reemplaza — code/version/
 * legalFramework/closingAct siguen editándose en modo JSON). "Usar plantilla
 * por defecto" evita escribir JSON a mano para el caso simple (1 ítem
 * "ejecutada conforme").
 */
export function ChecklistTab({ programId, activities, checklists }: {
  programId: string
  activities: PdtpActivityRow[]
  checklists: PdtpChecklistTemplate[]
}) {
  const byActivity = React.useMemo(() => {
    const map = new Map<string, PdtpChecklistTemplate>()
    for (const c of checklists) map.set(c.activityId, c)
    return map
  }, [checklists])

  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
        Sin actividades. Agrega actividades antes de definir sus checklists.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        Cada actividad puede tener una plantilla de checklist activa que se instancia al iniciar la
        verificación de una ejecución. Los ítems marcados &ldquo;No cumple&rdquo; generan automáticamente
        acciones en el plan de acción.
      </p>
      {activities.map((activity) => (
        <ChecklistRow
          key={activity.id}
          programId={programId}
          activity={activity}
          template={byActivity.get(activity.id) ?? null}
          copySources={activities
            .filter((a) => a.id !== activity.id)
            .map((a) => {
              const t = byActivity.get(a.id)
              return t
                ? { activityId: a.id, activityName: a.activity, templateLabel: t.label, definition: t.definition }
                : null
            })
            .filter((c): c is CopySource => c !== null)}
        />
      ))}
    </div>
  )
}

function ChecklistRow({ programId, activity, template, copySources }: {
  programId: string
  activity: PdtpActivityRow
  template: PdtpChecklistTemplate | null
  copySources: CopySource[]
}) {
  const router = useRouter()
  const itemCount = template?.definition.sections.reduce((s, sec) => s + sec.items.length, 0) ?? 0

  return (
    <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm">
        <span className="min-w-0">
          <span className="font-mono text-xs text-[var(--color-text-subtle)]">N°{activity.n}</span>{" "}
          <span className="font-medium text-[var(--color-text)]">{activity.activity}</span>
        </span>
        {template ? (
          <Badge variant="success">Editar checklist ({itemCount} ítems) v{template.version}</Badge>
        ) : (
          <Badge variant="outline">Definir checklist</Badge>
        )}
      </summary>
      <div className="border-t border-[var(--color-border)] p-4">
        <ChecklistEditor
          programId={programId}
          activity={activity}
          template={template}
          copySources={copySources}
          onSaved={() => router.refresh()}
        />
      </div>
    </details>
  )
}

function ChecklistEditor({ programId, activity, template, copySources, onSaved }: {
  programId: string
  activity: PdtpActivityRow
  template: PdtpChecklistTemplate | null
  copySources: CopySource[]
  onSaved: () => void
}) {
  const [label, setLabel] = React.useState(template?.label ?? activity.activity)
  // Sin plantilla: se siembra un esqueleto mínimo (F1) para que el editor
  // visual sea la vista por defecto y no haya que escribir JSON para empezar.
  const [raw, setRaw] = React.useState(
    template
      ? JSON.stringify(template.definition, null, 2)
      : JSON.stringify(buildSkeletonDefinition(activity.id, activity.activity), null, 2),
  )
  const [mode, setMode] = React.useState<"visual" | "json" | "preview">("visual")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [copySourceId, setCopySourceId] = React.useState("")
  // F12 — copiar reemplaza raw/label; si hay cambios sin guardar, pedir
  // confirmación igual que al borrar (el trabajo a medias no se pierde en el
  // acto, como sugirió la revisión de la Fase 3).
  const [pendingCopySourceId, setPendingCopySourceId] = React.useState<string | null>(null)

  function handleCopyRequested(sourceId: string) {
    setCopySourceId("")
    if (isDirty) {
      setPendingCopySourceId(sourceId)
      return
    }
    applyCopyFrom(sourceId)
  }

  // F12 — copiar la plantilla de otra actividad como punto de partida: la
  // definición se clona con code/ids nuevos (no comparte ids con la fuente).
  function applyCopyFrom(sourceId: string) {
    const source = copySources.find((c) => c.activityId === sourceId)
    if (!source) return
    const cloned = cloneDefinitionForActivity(source.definition, activity.id)
    setLabel(`${source.templateLabel} (copia)`)
    setRaw(JSON.stringify(cloned, null, 2))
    setMode("visual")
    setError(null)
    setCopySourceId("")
    setPendingCopySourceId(null)
  }

  // F3 — cambios sin guardar: se compara el JSON actual contra el último
  // guardado (estado, no ref: derivar dirty en render exige estado). El
  // guardado sigue siendo manual (D1 del plan) pero el usuario siempre sabe
  // si hay trabajo pendiente antes de navegar/recargar.
  const [savedRaw, setSavedRaw] = React.useState(raw)
  const [savedLabel, setSavedLabel] = React.useState(label)
  // La etiqueta se guarda con la misma acción y también se pierde al navegar:
  // sin ella en el dirty check, editar solo la etiqueta dejaría el badge en
  // "Guardado" con trabajo sin guardar.
  const isDirty = raw !== savedRaw || label !== savedLabel

  // Definición parseada para el editor visual — null si el JSON no es válido
  // o no tiene la forma mínima esperada (aún no se creó ninguna plantilla).
  const parsedDefinition = React.useMemo<ChecklistDefinition | null>(() => {
    if (!raw.trim()) return null
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.sections)) return null
      return parsed as ChecklistDefinition
    } catch {
      return null
    }
  }, [raw])

  // Pre-validación client-side con el mismo schema que valida la Server Action
  // (F1): deshabilita Guardar y explica qué falta en español, en vez de esperar
  // el error genérico "Revisa los campos marcados" al enviar.
  const validation = React.useMemo(() => {
    if (label.trim().length === 0) {
      return { ok: false as const, message: "Ingresa una etiqueta para la plantilla." }
    }
    if (!parsedDefinition) {
      return { ok: false as const, message: "Ingresa una definición JSON válida para poder guardar." }
    }
    const result = pdtpChecklistDefinitionSchema.safeParse(parsedDefinition)
    if (result.success) return { ok: true as const, message: "" }
    if (parsedDefinition.sections.length === 0) {
      return { ok: false as const, message: "Agrega al menos una sección con un ítem para poder guardar." }
    }
    const emptySection = parsedDefinition.sections.find((s) => s.items.length === 0)
    if (emptySection) {
      return {
        ok: false as const,
        message: `La sección «${emptySection.title || "sin título"}» debe tener al menos un ítem.`,
      }
    }
    return { ok: false as const, message: result.error.issues[0]?.message ?? "Revisa la definición antes de guardar." }
  }, [parsedDefinition, label])

  // No dejar un error obsoleto en pantalla una vez que la definición es válida.
  React.useEffect(() => {
    if (validation.ok) setError(null)
  }, [validation.ok])

  // F3 — advertir antes de cerrar/recargar con cambios sin guardar.
  React.useEffect(() => {
    function warnBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [isDirty])

  // F6 — secciones que se previsualizan: solo las aplicables a los roles del
  // checklist (respeta `appliesWhen`, igual que el flujo de llenado real).
  const previewSections = parsedDefinition
    ? getApplicableSections(parsedDefinition, ["prevencionista_faena", "admin_contrato", "jefe_faena"])
    : []

  function handleVisualChange(next: ChecklistDefinition) {
    setRaw(JSON.stringify(next, null, 2))
  }

  async function handleUseDefault() {
    setPending(true)
    setError(null)
    try {
      const result = await ensureDefaultPdtpChecklistAction(activity.id, programId, activity.activity)
      if (!result.ok) setError(result.message ?? "Error al crear la plantilla por defecto.")
      else onSaved()
    } finally {
      setPending(false)
    }
  }

  async function handleSave() {
    if (!validation.ok) { setError(validation.message); return }
    setPending(true)
    setError(null)
    try {
      const result = await savePdtpChecklistTemplateAction({
        activityId: activity.id, programId, label, definitionRaw: raw,
      })
      if (!result.ok) setError(result.message ?? "Error al guardar la plantilla.")
      else {
        setSavedRaw(raw)
        setSavedLabel(label)
        onSaved()
      }
    } finally {
      setPending(false)
    }
  }

  async function handleDelete() {
    if (!template) return
    setPending(true)
    setError(null)
    try {
      const result = await deletePdtpChecklistTemplateAction({ checklistId: template.id, programId })
      if (!result.ok) setError(result.message ?? "Error al eliminar la plantilla.")
      else onSaved()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      {!template && (
        <Button type="button" variant="secondary" size="sm" onClick={handleUseDefault} disabled={pending}>
          Usar plantilla por defecto (1 ítem)
        </Button>
      )}

      {copySources.length > 0 && (
        <Field
          label="Copiar desde otra actividad"
          htmlFor={`cl-copy-${activity.id}`}
          helper="Trae la plantilla de otra actividad como punto de partida (ids nuevos)."
        >
          <Select value={copySourceId} onValueChange={handleCopyRequested}>
            <SelectTrigger id={`cl-copy-${activity.id}`} className="h-9 text-sm">
              <SelectValue placeholder="Selecciona una actividad..." />
            </SelectTrigger>
            <SelectContent>
              {copySources.map((c) => (
                <SelectItem key={c.activityId} value={c.activityId}>
                  {c.activityName} — {c.templateLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field label="Etiqueta de la plantilla" htmlFor={`cl-label-${activity.id}`}>
        <Input id={`cl-label-${activity.id}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
      </Field>

      {parsedDefinition && (
        <div className="flex gap-1 rounded-[var(--radius)] border border-[var(--color-border)] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("visual")}
            className={`rounded-[calc(var(--radius)-2px)] px-2 py-1 ${mode === "visual" ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : "text-[var(--color-text-muted)]"}`}
          >
            Editor visual
          </button>
          <button
            type="button"
            onClick={() => setMode("json")}
            className={`rounded-[calc(var(--radius)-2px)] px-2 py-1 ${mode === "json" ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : "text-[var(--color-text-muted)]"}`}
          >
            JSON avanzado
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`rounded-[calc(var(--radius)-2px)] px-2 py-1 ${mode === "preview" ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : "text-[var(--color-text-muted)]"}`}
          >
            Vista previa
          </button>
        </div>
      )}

      {parsedDefinition && mode === "visual" ? (
        <ChecklistBuilder definition={parsedDefinition} onChange={handleVisualChange} />
      ) : parsedDefinition && mode === "preview" ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Así lo verá quien llene la verificación (solo lectura).
          </p>
          {previewSections.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">Sin secciones para previsualizar.</p>
          ) : (
            previewSections.map((section) => (
              <ChecklistSectionPanel
                key={section.id}
                section={section}
                responses={Object.fromEntries(
                  section.items.map((item) => [item.id, { estado: null, observacion: "", accionCorrectiva: "" }]),
                )}
                readOnly
                onChange={() => {}}
              />
            ))
          )}
          {parsedDefinition.closingAct && (
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                {parsedDefinition.closingAct.title || "Cierre de verificación"}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {parsedDefinition.closingAct.resultOptions.map((o) => (
                  <Badge key={o.value} variant="outline">{o.label}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <Field
          label="Definición (JSON — ChecklistDefinition)"
          htmlFor={`cl-json-${activity.id}`}
          helper="Estructura: { code, version, title, tipo, sections: [{ id, title, items: [{ id, label, kind }] }], closingAct }."
        >
          <Textarea
            id={`cl-json-${activity.id}`}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={12}
            className="font-mono text-xs"
            placeholder='{"code": "...", "sections": [...], ...}'
          />
        </Field>
      )}

      {!validation.ok && (
        <p role="status" className="rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          {validation.message}
        </p>
      )}

      {error && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={pendingCopySourceId !== null}
        onOpenChange={(open) => { if (!open) setPendingCopySourceId(null) }}
        title="Copiar desde otra actividad"
        description="Al copiar se reemplazará el contenido actual de esta plantilla, incluidos los cambios sin guardar. ¿Continuar?"
        confirmLabel="Copiar y reemplazar"
        variant="destructive"
        onConfirm={() => { if (pendingCopySourceId) applyCopyFrom(pendingCopySourceId) }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={pending || !validation.ok}>
          {pending ? "Guardando..." : "Guardar plantilla"}
        </Button>
        {template && (
          <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={pending}>
            Eliminar
          </Button>
        )}
        {isDirty ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-warning-ink)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning-ink)]" aria-hidden="true" />
            Cambios sin guardar
          </span>
        ) : template ? (
          <span className="text-[11px] text-[var(--color-text-muted)]">Guardado</span>
        ) : null}
      </div>
    </div>
  )
}
