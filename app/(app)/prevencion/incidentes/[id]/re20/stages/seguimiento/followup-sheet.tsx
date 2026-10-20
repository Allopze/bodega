"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatDate } from "@/lib/utils"
import { recordBiweeklyFollowupAction } from "../../../../actions"
import { Re20CatalogSelect, Re20Date, Re20Fact, Re20PersonPicker, Re20Text, Re20TextArea } from "../../fields"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { newRe20Id } from "../../workspace-data"
import {
  FOLLOWUP_FORM_CODE,
  FOLLOWUP_ID,
  LEVEL_LABELS,
  LEVEL_ORDER,
  applyFollowupToData,
  emptyFollowupForm,
  followupBlockers,
  followupPayload,
  levelAtLeast,
  levelFlags,
  type FollowupForm,
  type FollowupRecord,
  type MeasureLevel,
  type Re20Measure,
} from "./model"

const LEVEL_HINTS: Record<MeasureLevel, string> = {
  pending: "Aún no se ejecuta. Registra lo que se constató hoy.",
  implemented: "La medida ya está en terreno.",
  verified: "Otra persona comprobó que está bien hecha. Incluye «Implementada».",
  effective: "Se comprobó que el riesgo bajó. Incluye «Implementada» y «Verificada».",
}

/** Registro de un seguimiento (RE-20-08 / RE-20-09) con el estado Implementada / Verificada / Eficaz. */
export function FollowupSheet({ ws, measure, kind, initialLevel, effectiveLabel, causeText, onClose, onRecorded }: {
  ws: Re20WorkspaceApi
  measure: Re20Measure
  kind: "accident" | "damage"
  initialLevel: MeasureLevel
  effectiveLabel: string
  causeText: string
  onClose: () => void
  onRecorded: (record: FollowupRecord) => void
}) {
  const [form, setForm] = useState<FollowupForm>(() => emptyFollowupForm(measure, initialLevel))
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const flags = levelFlags(form.level)
  const blockers = followupBlockers(form, measure)
  const set = <K extends keyof FollowupForm>(key: K) => (value: FollowupForm[K] | null) => setForm((current) => ({ ...current, [key]: (value ?? "") as FollowupForm[K] }))
  const responsible = ws.people.find((person) => person.id === measure.responsibleUserId)?.name ?? measure.responsibleRole?.trim() ?? "Sin responsable"
  const errorFor = (fieldId: string) => (attempted ? blockers.find((item) => item.fieldId === fieldId)?.label : undefined)

  async function submit() {
    setAttempted(true)
    if (blockers[0]) return ws.focusField(blockers[0].fieldId)
    setBusy(true)
    const payload = followupPayload(form, measure, kind)
    const result = await ws.runServerAction(() => recordBiweeklyFollowupAction({ incidentId: ws.incident.id, ...payload }))
    if (result?.ok) {
      onRecorded({
        id: newRe20Id("followup"),
        kind,
        followupDate: payload.followupDate,
        note: payload.note,
        measureId: measure.id,
        implementedAt: payload.implementedAt ?? null,
        verified: payload.verified,
        effective: payload.effective,
        verifierUserId: payload.verifierUserId ?? null,
        verifiedAt: payload.verifiedAt ?? null,
        residualRisk: payload.residualRisk ?? null,
        lostDays: payload.lostDays ?? null,
        lossDescription: payload.lossDescription ?? null,
        createdAt: new Date().toISOString(),
      })
      // La verificación también queda en la medida del expediente (§10.1), como pide el protocolo.
      await ws.save((data) => applyFollowupToData(data, {
        measureId: measure.id,
        level: form.level,
        verifierUserId: form.verifierUserId,
        verifiedAt: form.verifiedAt,
        residualRisk: form.residualRisk,
        controlType: form.controlType,
        effectiveLabel,
      }))
      onClose()
    }
    setBusy(false)
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <div className="min-w-0">
            <SheetTitle>Registrar seguimiento</SheetTitle>
            <SheetDescription>{FOLLOWUP_FORM_CODE[kind]} · {measure.description}</SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Re20Fact label="Causa raíz" value={causeText || "Sin causa raíz asociada"} />
            <Re20Fact label="Responsable de la medida" value={responsible} />
            <Re20Fact label="Fecha compromiso" value={measure.dueAt ? formatDate(measure.dueAt) : "Sin fecha"} mono />
            <Re20Fact label="Evidencia de la mejora" value={measure.evidence?.trim() || "Sin evidencia"} />
          </dl>

          <div className="grid gap-4 sm:grid-cols-2">
            <Re20Date id={FOLLOWUP_ID("followupDate")} label="Fecha del seguimiento" required value={form.followupDate} onChange={set("followupDate")} error={errorFor(FOLLOWUP_ID("followupDate"))} />
            <Re20CatalogSelect id={FOLLOWUP_ID("controlType")} label="Tipo de control" category="control_type" value={form.controlType} onChange={set("controlType")} />
          </div>
          <Re20TextArea id={FOLLOWUP_ID("note")} label="Qué se constató" required rows={3} maxLength={5000} value={form.note} onChange={set("note")} error={errorFor(FOLLOWUP_ID("note"))} helper="Avance, obstáculos y lo que se acordó en esta revisión." />

          <div className="space-y-2">
            <p id={FOLLOWUP_ID("level-label")} className="text-sm font-medium text-[var(--color-text)]">Estado de la medida</p>
            <ChoiceCardGroup
              aria-labelledby={FOLLOWUP_ID("level-label")}
              options={LEVEL_ORDER.map((level) => ({ value: level, title: LEVEL_LABELS[level], description: LEVEL_HINTS[level] }))}
              value={form.level}
              onChange={(level) => setForm((current) => ({ ...current, level }))}
            />
          </div>

          {flags.implemented && (
            <Re20Date id={FOLLOWUP_ID("implementedAt")} label="Fecha en que se implementó" required value={form.implementedAt} onChange={set("implementedAt")} max={form.followupDate || undefined} error={errorFor(FOLLOWUP_ID("implementedAt"))} />
          )}

          {flags.verified && (
            <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
              <p className="text-sm text-[var(--color-text-muted)]">La verifica una persona distinta del responsable de la medida.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Re20PersonPicker id={FOLLOWUP_ID("verifier")} label="Quién verificó" required value={form.verifierUserId} onChange={set("verifierUserId")} excludeIds={[measure.responsibleUserId]} error={errorFor(FOLLOWUP_ID("verifier"))} />
                <Re20Date id={FOLLOWUP_ID("verifiedAt")} label="Fecha de la verificación" required value={form.verifiedAt} onChange={set("verifiedAt")} max={form.followupDate || undefined} error={errorFor(FOLLOWUP_ID("verifiedAt"))} />
              </div>
              <Re20CatalogSelect id={FOLLOWUP_ID("residualRisk")} label="Riesgo residual" required category="residual_risk" value={form.residualRisk} onChange={set("residualRisk")} error={errorFor(FOLLOWUP_ID("residualRisk"))} />
            </div>
          )}

          <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
            {kind === "accident" ? (
              <Re20Text id={FOLLOWUP_ID("lostDays")} label="Días perdidos" type="number" inputMode="numeric" value={form.lostDays} onChange={set("lostDays")} error={errorFor(FOLLOWUP_ID("lostDays"))} helper="Los acumulados a la fecha, si hay licencia." />
            ) : (
              <Re20TextArea id={FOLLOWUP_ID("lossDescription")} label="Daño o pérdida" rows={2} maxLength={2000} value={form.lossDescription} onChange={set("lossDescription")} helper="Qué se dañó y cuánto, si aplica." />
            )}
            <Re20Text id={FOLLOWUP_ID("evidenceRef")} label="Evidencia de este seguimiento" value={form.evidenceRef} onChange={set("evidenceRef")} maxLength={4000} helper="Opcional: folio, enlace o nombre del archivo." />
          </div>
          {levelAtLeast(form.level, "verified") && <p className="text-xs text-[var(--color-text-subtle)]">Al guardar, la verificación también queda en la medida del expediente (sección 10.1).</p>}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="button" loading={busy} onClick={() => void submit()}>Registrar seguimiento</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
