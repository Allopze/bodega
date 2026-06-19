"use client"

import { useState, useCallback, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog"
import { toast } from "@/lib/toast"
import { saveResponsesAction, closeEvaluationAction } from "@/app/(app)/prevencion/actions"
import { calculateCompliance } from "@/lib/sst/compliance"
import { getApplicableResponseStatuses } from "@/lib/sst/checklist"
import { SIGNATURE_ROLE_LABELS } from "@/lib/sst/cargos"
import { RESULTADO_LABELS, MOTIVO_LABELS, resultadoBadgeVariant, estadoBadgeVariant, tipoBadgeVariant } from "@/lib/sst/badges"
import { Badge } from "@/components/ui/badge"
import { Field } from "@/components/ui/field"
import { formatDateDisplay } from "@/lib/sst/date"
import type { ChecklistDefinition, StatusValue, ChecklistSection } from "@/lib/sst/types"
import type { SstEvaluation, SstResponse, SstScheduledFollowup, SstActionPlan } from "@/db/schema/sst"
import { ChecklistSectionPanel, type ItemResponse } from "./checklist-section"
import { ActionPlanPanel } from "./action-plan-panel"
import { FollowupsPanel } from "./followups-panel"
import { CaretLeft, CaretRight, Check, LockSimple, Printer, Warning } from "@phosphor-icons/react"

// ── Types ──────────────────────────────────────────────────────────────────────

type ResponseMap = Record<string, Record<string, ItemResponse>> // seccionId -> itemId -> resp

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildInitialResponseMap(
  responses: SstResponse[],
): ResponseMap {
  const map: ResponseMap = {}
  for (const r of responses) {
    ;(map[r.seccionId] ??= {})[r.itemId] = {
      estado: r.estado as StatusValue ?? null,
      observacion: r.observacion ?? "",
      accionCorrectiva: r.accionCorrectiva ?? "",
    }
  }
  return map
}

function getApplicableSections(
  definition: ChecklistDefinition,
  cargos: string[],
): ChecklistSection[] {
  return definition.sections.filter((sec) => {
    if (!sec.appliesWhen || sec.appliesWhen.length === 0) return true
    return cargos.some((c) => sec.appliesWhen!.includes(c))
  })
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface Props {
  evaluation: SstEvaluation
  definition: ChecklistDefinition
  responses: SstResponse[]
  followups: SstScheduledFollowup[]
  actionPlan: SstActionPlan[]
  workerName: string
  workerRut: string
  worksiteName: string
  cargoLabels: string[]
  canClose: boolean
  canEdit: boolean
  canManage: boolean
}

export function EvaluationDetail({
  evaluation,
  definition,
  responses: initialResponses,
  followups: initialFollowups,
  actionPlan: initialActionPlan,
  workerName,
  workerRut,
  worksiteName,
  cargoLabels,
  canClose,
  canEdit,
  canManage,
}: Props) {
  const router = useRouter()
  const isCerrado = evaluation.estado === "cerrado"
  const readOnly  = isCerrado || !canEdit

  const cargos = (evaluation.cargosJson as string[]) ?? []
  const applicableSections = getApplicableSections(definition, cargos)
  const navigationItems = [
    ...applicableSections.map((section) => ({
      value: section.id,
      label: section.title,
    })),
    { value: "acta", label: "Acta de cierre" },
    ...(evaluation.tipo === "seguimiento"
      ? [{ value: "seguimientos", label: "Seguimientos" }]
      : []),
    { value: "plan", label: "Plan de acción" },
  ]

  // ── State ──────────────────────────────────────────────────────────────────
  const [responseMap, setResponseMap] = useState<ResponseMap>(
    () => buildInitialResponseMap(initialResponses)
  )
  const [followups, setFollowups]     = useState(initialFollowups)
  const [actionPlan, setActionPlan]   = useState(initialActionPlan)
  const [activeSection, setActiveSection] = useState(() => navigationItems[0]?.value ?? "acta")

  // autosave state: null = idle | "saving" | { ts: string } = last-saved | "error"
  const [saveState, setSaveState] = useState<null | "saving" | { ts: string } | "error">(null)

  const [closePending, startClose]    = useTransition()

  // Close dialog fields
  const [closeOpen, setCloseOpen]         = useState(false)
  const [restricciones, setRestricciones] = useState(evaluation.restricciones ?? "")
  const [observaciones, setObservaciones] = useState(evaluation.observacionesGenerales ?? "")
  const [hasCritical, setHasCritical]     = useState(false)
  const [hasReincidence, setHasReincidence] = useState(false)

  // Debounced save
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Compliance ─────────────────────────────────────────────────────────────
  const activeNavigationIndex = Math.max(
    navigationItems.findIndex((item) => item.value === activeSection),
    0,
  )
  const selectedNavigation = navigationItems[activeNavigationIndex] ?? navigationItems[0]

  const visibleResponses = Object.entries(responseMap).flatMap(([seccionId, items]) =>
    Object.entries(items).map(([itemId, response]) => ({
      seccionId,
      itemId,
      estado: response.estado,
    }))
  )
  const allResponses = getApplicableResponseStatuses(definition, cargos, visibleResponses)

  const compliance = calculateCompliance(allResponses)

  // ── Auto-save ──────────────────────────────────────────────────────────────
  function scheduleAutoSave(newMap: ResponseMap) {
    if (readOnly) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaveState("saving")
      const batch = applicableSections.flatMap((sec) =>
        sec.items.map((item) => {
          const r = newMap[sec.id]?.[item.id] ?? { estado: null, observacion: "", accionCorrectiva: "" }
          return {
            evaluationId:     evaluation.id,
            seccionId:        sec.id,
            itemId:           item.id,
            estado:           r.estado,
            observacion:      r.observacion || undefined,
            accionCorrectiva: r.accionCorrectiva || undefined,
          }
        })
      )
      const result = await saveResponsesAction(evaluation.id, batch)
      if (!result.ok) {
        setSaveState("error")
        toast.error(result.message ?? "Error al guardar respuestas")
      } else {
        const now = new Date()
        const ts  = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
        setSaveState({ ts })
        // Reset to idle after 4 s so the confirmation fades away
        setTimeout(() => setSaveState(null), 4000)
      }
    }, 800)
  }

  const handleResponseChange = useCallback(
    (seccionId: string, itemId: string, patch: Partial<ItemResponse>) => {
      setResponseMap((prev) => {
        const next = {
          ...prev,
          [seccionId]: {
            ...(prev[seccionId] ?? {}),
            [itemId]: {
              ...(prev[seccionId]?.[itemId] ?? { estado: null, observacion: "", accionCorrectiva: "" }),
              ...patch,
            },
          },
        }
        scheduleAutoSave(next)
        return next
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [evaluation.id, readOnly]
  )

  function moveActiveSection(offset: number) {
    const next = navigationItems[activeNavigationIndex + offset]
    if (next) setActiveSection(next.value)
  }

  // ── Close evaluation ────────────────────────────────────────────────────────
  function handleClose() {
    startClose(async () => {
      const result = await closeEvaluationAction(evaluation.id, {
        evaluationId:           evaluation.id,
        restricciones:          restricciones || undefined,
        observacionesGenerales: observaciones || undefined,
        hasCriticalDeviation:   hasCritical,
        hasReincidence,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al cerrar la evaluación")
        return
      }
      toast.success("Evaluación cerrada exitosamente")
      setCloseOpen(false)
      router.refresh()
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-(--color-text)">{workerName}</h2>
              {workerRut && <span className="text-sm text-text-subtle">RUT {workerRut}</span>}
            </div>
            <p className="text-sm text-(--color-text-muted)">{worksiteName}</p>
            <p className="text-sm text-text-subtle">
              Cargos: {cargoLabels.join(", ")}
            </p>
            <p className="text-sm text-text-subtle">
              Fecha: {formatDateDisplay(evaluation.fechaEvaluacion)}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={estadoBadgeVariant(evaluation.estado)}>
                {isCerrado ? "Cerrado" : "Borrador"}
              </Badge>
              {evaluation.tipo === "seguimiento" && (
                <Badge variant={tipoBadgeVariant(evaluation.tipo)}>
                  Seguimiento
                </Badge>
              )}
            </div>

            {/* Compliance indicator */}
            <div className="text-right">
              {compliance.total === 0 ? (
                <p className="text-sm text-text-subtle">Sin respuestas aún</p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-(--color-text) tabular-nums">
                    {compliance.percentage.toFixed(1)}%
                  </p>
                  <p className="text-xs text-text-subtle">
                    cumplimiento ({compliance.cumplidos}/{compliance.cumplidos + compliance.noCumplidos})
                  </p>
                </>
              )}
            </div>

            {evaluation.resultadoFinal && (
              <Badge variant={resultadoBadgeVariant(evaluation.resultadoFinal)}>
                {RESULTADO_LABELS[evaluation.resultadoFinal] ?? evaluation.resultadoFinal}
              </Badge>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 pt-1 border-t border-(--color-border)">
          {/* Autosave status */}
          {saveState === "saving" && (
            <span className="text-xs text-text-subtle">Guardando…</span>
          )}
          {saveState === "error" && (
            <span className="text-xs text-danger font-medium">
              Error al guardar — verifica tu conexión
            </span>
          )}
          {saveState !== null && saveState !== "saving" && saveState !== "error" && (
            <span className="flex items-center gap-1 text-xs text-text-subtle">
              <Check size={12} />
              Guardado {saveState.ts}
            </span>
          )}
          {saveState === null && !readOnly && (
            <span className="text-xs text-text-subtle">Autoguardado activo</span>
          )}
          {isCerrado && (
            <span className="flex items-center gap-1 text-xs text-text-subtle">
              <LockSimple size={12} />
              Solo lectura — evaluación cerrada
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/sst/${evaluation.id}/print`} target="_blank" rel="noopener noreferrer">
                <Printer size={14} className="mr-1.5" />
                Imprimir
              </Link>
            </Button>

            {canClose && !isCerrado && (
              <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="signal">
                    <LockSimple size={14} className="mr-1.5" />
                    Cerrar evaluación
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cerrar evaluación</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="flex items-start gap-2 rounded-(--radius) bg-(--color-warning-tint) border border-(--color-warning-line) p-3">
                      <Warning size={16} className="shrink-0 mt-0.5 text-(--color-warning-ink)" />
                      <p className="text-sm text-(--color-warning-ink)">
                        Una vez cerrada, la evaluación es <strong>inmutable</strong> por requerimiento legal (DS N°44/2024). Esta acción no se puede deshacer.
                      </p>
                    </div>

                    {evaluation.definicionCode === "trabajador_antiguo" && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-(--color-text)">Condiciones especiales</p>
                        <Checkbox
                          id="hasCritical"
                          label="Existe desviación crítica"
                          checked={hasCritical}
                          onChange={(e) => setHasCritical(e.target.checked)}
                        />
                        <Checkbox
                          id="hasReincidence"
                          label="Existe reincidencia"
                          checked={hasReincidence}
                          onChange={(e) => setHasReincidence(e.target.checked)}
                        />
                      </div>
                    )}

                    <Field label="Restricciones" htmlFor="close-restricciones" helper="Opcional">
                      <Textarea
                        id="close-restricciones"
                        value={restricciones}
                        onChange={(e) => setRestricciones(e.target.value)}
                        placeholder="Indica restricciones para el trabajador…"
                        rows={3}
                        maxLength={500}
                      />
                    </Field>

                    <Field label="Observaciones generales" htmlFor="close-observaciones" helper="Opcional">
                      <Textarea
                        id="close-observaciones"
                        value={observaciones}
                        onChange={(e) => setObservaciones(e.target.value)}
                        placeholder="Observaciones del evaluador…"
                        rows={4}
                        maxLength={1000}
                      />
                    </Field>

                    <div className="flex gap-2 justify-end">
                      <DialogClose asChild>
                        <Button variant="ghost" disabled={closePending}>Cancelar</Button>
                      </DialogClose>
                      <Button onClick={handleClose} disabled={closePending}>
                        {closePending ? "Cerrando…" : "Confirmar cierre"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </div>

      {/* Section navigation */}
      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-3 shadow-[var(--shadow-card)] sm:p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Sección activa</p>
              <p className="mt-1 truncate text-sm font-semibold text-(--color-text)">
                {selectedNavigation?.label ?? "Selecciona una sección"}
              </p>
            </div>
            <p className="shrink-0 text-xs font-medium text-text-subtle">
              {activeNavigationIndex + 1} de {navigationItems.length}
            </p>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <Select value={activeSection} onValueChange={setActiveSection}>
              <SelectTrigger aria-label="Seleccionar sección de evaluación" className="h-10">
                <SelectValue placeholder="Selecciona una sección" />
              </SelectTrigger>
              <SelectContent>
                {navigationItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} textValue={item.label}>
                    <span className="truncate">{item.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => moveActiveSection(-1)}
                disabled={activeNavigationIndex === 0}
              >
                <CaretLeft size={14} weight="bold" aria-hidden="true" />
                Anterior
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => moveActiveSection(1)}
                disabled={activeNavigationIndex >= navigationItems.length - 1}
              >
                Siguiente
                <CaretRight size={14} weight="bold" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        {applicableSections.map((sec) => (
          <TabsContent key={sec.id} value={sec.id}>
            <div className="border border-(--color-border) bg-(--color-surface) p-5">
              <h3 className="text-base font-semibold text-(--color-text) mb-4">{sec.title}</h3>
              <ChecklistSectionPanel
                section={sec}
                responses={responseMap[sec.id] ?? {}}
                readOnly={readOnly}
                onChange={handleResponseChange}
              />
            </div>
          </TabsContent>
        ))}

        {/* Acta de cierre */}
        <TabsContent value="acta">
          <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-5">
            <h3 className="text-base font-semibold text-(--color-text)">Acta de Cierre</h3>

            {evaluation.motivo && (
              <div>
                <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Motivo</p>
                <p className="text-sm text-(--color-text)">{MOTIVO_LABELS[evaluation.motivo] ?? evaluation.motivo}</p>
              </div>
            )}

            {isCerrado && evaluation.resultadoFinal && (
              <div>
                <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Resultado Final</p>
                <Badge variant={resultadoBadgeVariant(evaluation.resultadoFinal)}>
                  {RESULTADO_LABELS[evaluation.resultadoFinal] ?? evaluation.resultadoFinal}
                </Badge>
                {evaluation.porcentajeCumplimiento !== null && (
                  <p className="mt-1 text-sm text-text-subtle">
                    Cumplimiento: {evaluation.porcentajeCumplimiento.toFixed(1)}%
                  </p>
                )}
              </div>
            )}

            {evaluation.restricciones && (
              <div>
                <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Restricciones</p>
                <p className="text-sm text-(--color-text)">{evaluation.restricciones}</p>
              </div>
            )}

            {evaluation.observacionesGenerales && (
              <div>
                <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-1">Observaciones generales</p>
                <p className="text-sm text-(--color-text)">{evaluation.observacionesGenerales}</p>
              </div>
            )}

            {!isCerrado && (
              <div className="rounded-(--radius) border border-(--color-border) bg-surface-2 px-4 py-3">
                <p className="text-sm text-(--color-text-muted)">
                  El acta de cierre se completa al cerrar la evaluación. Usa el botón <strong>Cerrar evaluación</strong> en la cabecera cuando hayas finalizado el checklist.
                </p>
              </div>
            )}

            {/* Roles de firma */}
            {definition.closingAct.signatureRoles.length > 0 && (
              <div>
                <p className="text-xs font-medium text-text-subtle uppercase tracking-wide mb-2">Firmas requeridas (en acta impresa)</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {definition.closingAct.signatureRoles.map((role) => (
                    <div
                      key={role}
                      className="h-16 rounded-(--radius) border-2 border-dashed border-(--color-border) flex flex-col items-center justify-end pb-1"
                    >
                      <span className="text-xs text-text-subtle">{SIGNATURE_ROLE_LABELS[role] ?? role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Seguimientos */}
        {evaluation.tipo === "seguimiento" && (
          <TabsContent value="seguimientos">
            <div className="border border-(--color-border) bg-(--color-surface) p-5">
              <h3 className="text-base font-semibold text-(--color-text) mb-4">Seguimientos programados</h3>
              <FollowupsPanel
                followups={followups}
                canManage={canManage}
                onUpdate={setFollowups}
              />
            </div>
          </TabsContent>
        )}

        {/* Plan de acción */}
        <TabsContent value="plan">
          <div className="border border-(--color-border) bg-(--color-surface) p-5">
            <ActionPlanPanel
              evaluationId={evaluation.id}
              items={actionPlan}
              readOnly={readOnly}
              onUpdate={setActionPlan}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
