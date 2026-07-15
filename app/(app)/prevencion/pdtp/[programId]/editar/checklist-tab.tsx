"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import {
  savePdtpChecklistTemplateAction,
  ensureDefaultPdtpChecklistAction,
  deletePdtpChecklistTemplateAction,
} from "../../actions/checklist-actions"
import type { pdtpActivities } from "@/db/schema"
import type { PdtpChecklistTemplate } from "@/lib/services/prevention-pdtp"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { ChecklistBuilder } from "./checklist-builder"

type PdtpActivityRow = typeof pdtpActivities.$inferSelect

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
        />
      ))}
    </div>
  )
}

function ChecklistRow({ programId, activity, template }: {
  programId: string
  activity: PdtpActivityRow
  template: PdtpChecklistTemplate | null
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
          onSaved={() => router.refresh()}
        />
      </div>
    </details>
  )
}

function ChecklistEditor({ programId, activity, template, onSaved }: {
  programId: string
  activity: PdtpActivityRow
  template: PdtpChecklistTemplate | null
  onSaved: () => void
}) {
  const [label, setLabel] = React.useState(template?.label ?? activity.activity)
  const [raw, setRaw] = React.useState(template ? JSON.stringify(template.definition, null, 2) : "")
  const [mode, setMode] = React.useState<"visual" | "json">("visual")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

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
    if (!raw.trim()) { setError("Ingresa la definición JSON o usa la plantilla por defecto."); return }
    setPending(true)
    setError(null)
    try {
      const result = await savePdtpChecklistTemplateAction({
        activityId: activity.id, programId, label, definitionRaw: raw,
      })
      if (!result.ok) setError(result.message ?? "Error al guardar la plantilla.")
      else onSaved()
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
        </div>
      )}

      {parsedDefinition && mode === "visual" ? (
        <ChecklistBuilder definition={parsedDefinition} onChange={handleVisualChange} />
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

      {error && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "Guardando..." : "Guardar plantilla"}
        </Button>
        {template && (
          <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={pending}>
            Eliminar
          </Button>
        )}
      </div>
    </div>
  )
}
