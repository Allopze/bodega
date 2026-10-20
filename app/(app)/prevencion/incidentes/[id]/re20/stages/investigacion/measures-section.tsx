"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle, Plus, Trash, WarningCircle } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, Label } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"
import { createCapaFromRe20MeasureAction } from "../../../../actions"
import { Re20CatalogSelect, Re20Date, Re20PersonPicker, Re20Text, Re20TextArea, isoToLocalInput, localInputToIso } from "../../fields"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { newRe20Id } from "../../workspace-data"
import { ID } from "./checks"
import { rootCauses } from "./model"

/** INV.DEF.ACC!B90, literal. */
export const CONTROL_HIERARCHY_NOTE = "Para cada causa raíz prioriza: 1) eliminar o evitar el riesgo; 2) controlar en la fuente (ingeniería); 3) medidas administrativas u organizacionales; 4) EPP solo para el riesgo residual. Capacitar o sancionar, por sí solos, rara vez eliminan una causa técnica u organizacional."

/** Orden de la jerarquía de controles (L_CONTROL): lo más fuerte primero. */
export const CONTROL_FALLBACK = ["Eliminación", "Ingeniería", "Administrativa", "EPP"] as const
const CONTROL_HINTS: Record<string, string> = {
  Eliminación: "Quitar el peligro o evitar la exposición.",
  Ingeniería: "Controlar en la fuente: resguardos, diseño, bloqueos.",
  Administrativa: "Procedimientos, turnos, señalización, supervisión.",
  EPP: "Sólo para el riesgo que queda después de lo anterior.",
}

/** El formato trae ocho filas de medidas (INV.DEF.ACC!B92:B99). */
const MAX_MEASURES = 8

/** ¿Una medida «administrativa» o de EPP que sólo capacita o sanciona? B90 pide no darla por suficiente. */
export function weakControlWarning(controlType: string | null | undefined, description: string | null | undefined) {
  if (controlType !== "Administrativa" && controlType !== "EPP") return null
  return /capacit|sanci|amonest|instruir|inducci/i.test(description ?? "")
    ? "Capacitar o sancionar por sí solo rara vez elimina una causa técnica u organizacional. ¿Hay una medida más arriba en la jerarquía?"
    : null
}

type Measure = Re20WorkspaceApi["data"]["measures"][number]

function emptyMeasure(rootCauseId: string | null): Measure {
  return {
    id: newRe20Id("measure"), rootCauseId, description: "", controlType: null, correctivePreventive: null, scope: null, priority: null,
    responsibleUserId: null, responsibleRole: null, resources: null, dueAt: null, status: null, evidence: null,
    verifierUserId: null, verifiedAt: null, effectiveness: {}, capaId: null,
  }
}

const dateOf = (iso: string | null | undefined) => isoToLocalInput(iso).slice(0, 10)
const isoOf = (date: string | null) => (date ? localInputToIso(`${date}T12:00`) : null)

export function MeasuresSection({ ws }: { ws: Re20WorkspaceApi }) {
  const tree = ws.data.causalTree
  const roots = rootCauses(tree)
  const measures = ws.data.measures
  const [removing, setRemoving] = React.useState<number | null>(null)
  const full = measures.length >= MAX_MEASURES
  const controlOptions = React.useMemo(() => {
    const configured = ws.options.filter((o) => o.category === "control_type" && o.isActive).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((o) => o.name)
    return configured.length > 0 ? configured : [...CONTROL_FALLBACK]
  }, [ws.options])
  const attached = new Set(roots)
  const stray = measures.map((m, index) => ({ m, index })).filter(({ m }) => !m.rootCauseId || !attached.has(m.rootCauseId))

  function add(rootCauseId: string | null) {
    if (full) return
    ws.update((data) => ({ ...data, measures: [...data.measures, emptyMeasure(rootCauseId)] }))
  }

  const row = (index: number) => (
    <MeasureRow key={measures[index]!.id} ws={ws} index={index} roots={roots} controlOptions={controlOptions} onRemove={() => (measures[index]!.description.trim() || measures[index]!.capaId ? setRemoving(index) : ws.update((data) => ({ ...data, measures: data.measures.filter((_, i) => i !== index) })))} />
  )

  return (
    <div className="space-y-5">
      <Callout tone="info" title="Jerarquía de controles">
        <p>{CONTROL_HIERARCHY_NOTE}</p>
      </Callout>

      {roots.length === 0 && stray.length === 0 && (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-sm text-[var(--color-text-muted)]">
          Las medidas se piden por causa raíz, y todavía no hay ninguna. Termina el árbol de causas (paso D): cuando un hecho quede sin antecedentes aparecerá aquí con su medida pendiente.
        </p>
      )}

      {roots.map((rootId) => {
        const own = measures.map((m, index) => ({ m, index })).filter(({ m }) => m.rootCauseId === rootId)
        const text = tree.events.find((event) => event.id === rootId)?.description.trim()
        return (
          <section key={rootId} id={ID(`medidas-${rootId}`)} aria-labelledby={ID(`medidas-${rootId}-title`)} className="space-y-3">
            <div className="flex flex-wrap items-start gap-2">
              <h4 id={ID(`medidas-${rootId}-title`)} className="min-w-0 flex-1 text-sm font-semibold text-[var(--color-text)]">
                <span className="font-mono">{rootId}</span> · {text || "Causa raíz sin descripción"}
              </h4>
              {own.length === 0
                ? <Badge variant="warning" size="sm">Pendiente: sin medida</Badge>
                : <Badge variant="outline" size="sm">{own.length} {own.length === 1 ? "medida" : "medidas"}</Badge>}
            </div>
            {own.length > 0 && (
              <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">{own.map(({ index }) => row(index))}</ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button id={ID(`medida-${rootId}-agregar`)} type="button" variant={own.length === 0 ? "primary" : "secondary"} onClick={() => add(rootId)} disabled={full}>
                <Plus aria-hidden className="size-4" />Agregar medida para {rootId}
              </Button>
              {full && <p className="text-xs text-[var(--color-text-muted)]">El formato admite hasta {MAX_MEASURES} medidas.</p>}
            </div>
          </section>
        )
      })}

      {stray.length > 0 && (
        <section aria-labelledby={ID("medidas-sueltas-title")} className="space-y-3">
          <h4 id={ID("medidas-sueltas-title")} className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <WarningCircle aria-hidden weight="fill" className="size-4 text-[var(--color-warning-ink)]" />Medidas sin una causa raíz vigente
          </h4>
          <p className="text-xs text-[var(--color-text-muted)]">Estas medidas no apuntan a una causa raíz del árbol actual (cambió el árbol o nunca se asignaron). Elige a cuál responden.</p>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">{stray.map(({ index }) => row(index))}</ul>
        </section>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title="Quitar la medida"
        description="Se borra la medida del informe. Si ya creaste una CAPA desde ella, la CAPA sigue existiendo."
        confirmLabel="Quitar medida"
        variant="destructive"
        onConfirm={() => { if (removing !== null) ws.update((data) => ({ ...data, measures: data.measures.filter((_, i) => i !== removing) })); setRemoving(null) }}
      />
    </div>
  )
}

function MeasureRow({ ws, index, roots, controlOptions, onRemove }: { ws: Re20WorkspaceApi; index: number; roots: string[]; controlOptions: string[]; onRemove: () => void }) {
  const measure = ws.data.measures[index]!
  const path = (field: string) => ["measures", index, field] as const
  const set = (field: string) => (value: unknown) => ws.patch(path(field), value)
  const [creating, setCreating] = React.useState(false)
  const [createdCapaId, setCreatedCapaId] = React.useState<string | null>(null)
  const capaId = measure.capaId ?? createdCapaId
  const capa = ws.capa.find((item) => item.id === capaId)
  const sameAsResponsible = Boolean(measure.responsibleUserId) && measure.responsibleUserId === measure.verifierUserId
  const weak = weakControlWarning(measure.controlType, measure.description)
  const hint = measure.controlType ? CONTROL_HINTS[measure.controlType] : null
  const capaBlocker = measure.description.trim().length < 3 ? "Describe la medida para crear su CAPA." : !measure.dueAt ? "Pon una fecha compromiso para crear su CAPA." : null
  const eff = measure.effectiveness ?? {}
  const effFilled = [eff.criterion, eff.method, eff.result, eff.residualRisk, eff.additionalAction].filter((v) => v?.trim()).length

  async function createCapa() {
    setCreating(true)
    try {
      const result = await ws.runServerAction((version) => createCapaFromRe20MeasureAction({ incidentId: ws.incident.id, measureId: measure.id, expectedWorkspaceVersion: version }))
      if (result?.ok && result.capaId) setCreatedCapaId(result.capaId)
    } finally {
      setCreating(false)
    }
  }

  return (
    <li aria-label={`Medida ${index + 1}`} className="space-y-4 py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Re20TextArea id={ID(`measure-${index}-description`)} label={`Medida ${index + 1}`} required rows={2} maxLength={3000} value={measure.description} onChange={set("description")} helper="Específica y viable: qué se hará, dónde y sobre qué." />
        </div>
        <Button type="button" variant="ghost-danger" size="icon-sm" className="mt-6" aria-label={`Quitar la medida ${index + 1}`} onClick={onRemove}>
          <Trash aria-hidden className="size-4" />
        </Button>
      </div>

      {(!measure.rootCauseId || !roots.includes(measure.rootCauseId)) && (
        <Field label="Causa raíz a la que responde" htmlFor={ID(`measure-${index}-rootCause`)} required>
          <OptionSelect
            id={ID(`measure-${index}-rootCause`)}
            options={roots.map((root) => ({ value: root, label: root }))}
            value={measure.rootCauseId ?? ""}
            onValueChange={(value) => set("rootCauseId")(value || null)}
            placeholder="Elige la causa raíz"
            emptyLabel="Sin asignar"
          />
        </Field>
      )}

      <div id={ID(`measure-${index}-controlType`)} className="space-y-1.5" role="group" aria-labelledby={ID(`measure-${index}-controlType-label`)}>
        <Label id={ID(`measure-${index}-controlType-label`)} required>Tipo de control, de más a menos fuerte</Label>
        <SegmentedControl
          ariaLabel={`Tipo de control de la medida ${index + 1}`}
          variant="pills"
          items={controlOptions.map((name, i) => ({ key: name, label: `${i + 1}. ${name}`, active: measure.controlType === name, onClick: () => set("controlType")(measure.controlType === name ? null : name) }))}
        />
        {hint && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
        {weak && <p role="status" className="flex items-start gap-2 text-xs text-[var(--color-warning-ink)]"><WarningCircle aria-hidden weight="fill" className="mt-0.5 size-3.5 shrink-0" />{weak}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Re20CatalogSelect id={ID(`measure-${index}-correctivePreventive`)} label="Correctiva o preventiva" category="corrective_preventive" value={measure.correctivePreventive} onChange={set("correctivePreventive")} />
        <Re20CatalogSelect id={ID(`measure-${index}-scope`)} label="Alcance" category="action_scope" value={measure.scope} onChange={set("scope")} />
        <Re20CatalogSelect id={ID(`measure-${index}-priority`)} label="Prioridad" category="priority" value={measure.priority} onChange={set("priority")} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Re20PersonPicker id={ID(`measure-${index}-responsible`)} label="Responsable" required value={measure.responsibleUserId} onChange={set("responsibleUserId")} />
        <Re20PersonPicker
          id={ID(`measure-${index}-verifier`)}
          label="Verificador"
          required
          value={measure.verifierUserId}
          excludeIds={[measure.responsibleUserId]}
          onChange={set("verifierUserId")}
          error={sameAsResponsible ? "El verificador debe ser otra persona que el responsable." : undefined}
          helper="Debe ser una persona distinta del responsable: así quien comprueba la medida no se evalúa a sí mismo."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Re20Date id={ID(`measure-${index}-dueAt`)} label="Fecha compromiso" value={dateOf(measure.dueAt)} onChange={(value) => set("dueAt")(isoOf(value))} />
        <Re20CatalogSelect id={ID(`measure-${index}-status`)} label="Estado" category="action_status" value={measure.status} onChange={set("status")} />
        <Re20Date id={ID(`measure-${index}-verifiedAt`)} label="Fecha de verificación" value={dateOf(measure.verifiedAt)} onChange={(value) => set("verifiedAt")(isoOf(value))} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Re20Text id={ID(`measure-${index}-resources`)} label="Recursos" value={measure.resources} maxLength={1000} onChange={set("resources")} />
        <Re20Text id={ID(`measure-${index}-evidence`)} label="Evidencia de cumplimiento" value={measure.evidence} maxLength={3000} onChange={set("evidence")} />
      </div>

      <details className="group rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] [&::-webkit-details-marker]:hidden">
          <span className="flex-1">Verificación de eficacia (10.1)</span>
          <span className="text-xs font-normal text-[var(--color-text-muted)]">{effFilled === 0 ? "Sin completar" : eff.result ? eff.result : `${effFilled} de 5`}</span>
        </summary>
        <div className="space-y-4 border-t border-[var(--color-border)] p-3">
          <p className="text-xs text-[var(--color-text-muted)]">Implementada: hay evidencia de ejecución. Verificada: otra persona competente confirma su cumplimiento. Eficaz: reduce o elimina el riesgo y no crea riesgos nuevos.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Re20TextArea id={ID(`measure-${index}-eff-criterion`)} label="Criterio de eficacia" rows={2} maxLength={1000} value={eff.criterion} onChange={(value) => ws.patch(["measures", index, "effectiveness", "criterion"], value)} />
            <Re20TextArea id={ID(`measure-${index}-eff-method`)} label="Método de verificación" rows={2} maxLength={1000} value={eff.method} onChange={(value) => ws.patch(["measures", index, "effectiveness", "method"], value)} />
            <Re20CatalogSelect id={ID(`measure-${index}-eff-result`)} label="Resultado" category="effectiveness" value={eff.result} onChange={(value) => ws.patch(["measures", index, "effectiveness", "result"], value)} />
            <Re20CatalogSelect id={ID(`measure-${index}-eff-residualRisk`)} label="Riesgo residual" category="residual_risk" value={eff.residualRisk} onChange={(value) => ws.patch(["measures", index, "effectiveness", "residualRisk"], value)} />
          </div>
          <Re20TextArea id={ID(`measure-${index}-eff-additionalAction`)} label="Acción adicional" rows={2} maxLength={1000} value={eff.additionalAction} onChange={(value) => ws.patch(["measures", index, "effectiveness", "additionalAction"], value)} />
        </div>
      </details>

      <div className={cn("flex flex-wrap items-center gap-3")}>
        {capaId ? (
          <p className="flex items-center gap-2 text-sm text-[var(--color-success-ink)]">
            <CheckCircle aria-hidden weight="fill" className="size-4" />
            <Link href={`/prevencion/capa/${capaId}`} className="font-medium underline underline-offset-2">{capa ? `CAPA ${capa.code}` : "Ver la CAPA creada"}</Link>
          </p>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={() => void createCapa()} loading={creating} disabled={Boolean(capaBlocker) || ws.offlineOnly || !ws.online}>
              Crear CAPA desde esta medida
            </Button>
            <p className="text-xs text-[var(--color-text-muted)]">{capaBlocker ?? "Crea la acción correctiva en CAPA y la deja vinculada a esta medida."}</p>
          </>
        )}
      </div>
    </li>
  )
}
