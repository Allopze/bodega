"use client"

import { useState, useCallback, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog"
import { toast } from "@/lib/toast"
import { saveResponsesAction, closeEvaluationAction } from "@/app/(app)/prevencion/actions"
import { calculateCompliance } from "@/lib/sst/compliance"
import type { ChecklistDefinition, StatusValue, ChecklistSection } from "@/lib/sst/types"
import type { SstEvaluation, SstResponse, SstScheduledFollowup, SstActionPlan } from "@/db/schema/sst"
import { ChecklistSectionPanel, type ItemResponse } from "./checklist-section"
import { ActionPlanPanel } from "./action-plan-panel"
import { FollowupsPanel } from "./followups-panel"
import { Printer, LockSimple, Warning } from "@phosphor-icons/react"

// ── Types ──────────────────────────────────────────────────────────────────────

type ResponseMap = Record<string, Record<string, ItemResponse>> // seccionId -> itemId -> resp

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildInitialResponseMap(
  responses: SstResponse[],
): ResponseMap {
  const map: ResponseMap = {}
  for (const r of responses) {
    if (!map[r.seccionId]) map[r.seccionId] = {}
    map[r.seccionId][r.itemId] = {
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

const RESULTADO_LABELS: Record<string, string> = {
  habilitado_autonomo:      "Habilitado autónomo",
  habilitado_restricciones: "Habilitado con restricciones",
  no_habilitado:            "No habilitado",
  requiere_reforzamiento:   "Requiere reforzamiento",
}

const RESULTADO_COLORS: Record<string, string> = {
  habilitado_autonomo:      "bg-emerald-100 text-emerald-800 border-emerald-300",
  habilitado_restricciones: "bg-amber-100 text-amber-800 border-amber-300",
  no_habilitado:            "bg-rose-100 text-rose-800 border-rose-300",
  requiere_reforzamiento:   "bg-blue-100 text-blue-800 border-blue-300",
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

  // ── State ──────────────────────────────────────────────────────────────────
  const [responseMap, setResponseMap] = useState<ResponseMap>(
    () => buildInitialResponseMap(initialResponses)
  )
  const [followups, setFollowups]     = useState(initialFollowups)
  const [actionPlan, setActionPlan]   = useState(initialActionPlan)
  const [saving, setSaving]           = useState(false)
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
  const applicableSections = getApplicableSections(definition, cargos)

  const allResponses = applicableSections.flatMap((sec) =>
    sec.items
      .filter((item) =>
        ["cumple_nocumple_obs","cumple_nocumple_na_obs","entregado_obs","apto_obs","si_no_obs"].includes(item.kind)
      )
      .map((item) => ({
        estado: responseMap[sec.id]?.[item.id]?.estado ?? null,
      }))
  )

  const compliance = calculateCompliance(allResponses)

  // ── Auto-save ──────────────────────────────────────────────────────────────
  function scheduleAutoSave(newMap: ResponseMap) {
    if (readOnly) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaving(true)
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
      setSaving(false)
      if (!result.ok) {
        toast.error(result.message ?? "Error al guardar respuestas")
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
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-[var(--color-text)]">{workerName}</h2>
              {workerRut && <span className="text-sm text-[var(--color-text-subtle)]">RUT {workerRut}</span>}
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">{worksiteName}</p>
            <p className="text-sm text-[var(--color-text-subtle)]">
              Cargos: {cargoLabels.join(", ")}
            </p>
            <p className="text-sm text-[var(--color-text-subtle)]">
              Fecha: {evaluation.fechaEvaluacion}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className={[
                "text-xs font-medium px-2 py-0.5 rounded-full border",
                isCerrado
                  ? "bg-slate-100 text-slate-700 border-slate-300"
                  : "bg-blue-100 text-blue-700 border-blue-300",
              ].join(" ")}>
                {isCerrado ? "Cerrado" : "Borrador"}
              </span>
              {evaluation.tipo === "seguimiento" && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-300">
                  Seguimiento
                </span>
              )}
            </div>

            {/* Compliance indicator */}
            <div className="text-right">
              <p className="text-2xl font-bold text-[var(--color-text)]">
                {compliance.percentage.toFixed(1)}%
              </p>
              <p className="text-xs text-[var(--color-text-subtle)]">
                cumplimiento ({compliance.cumplidos}/{compliance.cumplidos + compliance.noCumplidos})
              </p>
            </div>

            {evaluation.resultadoFinal && (
              <span className={[
                "text-xs font-semibold px-3 py-1 rounded-full border",
                RESULTADO_COLORS[evaluation.resultadoFinal] ?? "bg-slate-100 text-slate-700 border-slate-300",
              ].join(" ")}>
                {RESULTADO_LABELS[evaluation.resultadoFinal] ?? evaluation.resultadoFinal}
              </span>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border)]">
          {saving && (
            <span className="text-xs text-[var(--color-text-subtle)]">Guardando…</span>
          )}
          {!saving && !readOnly && (
            <span className="text-xs text-[var(--color-text-subtle)]">Autoguardado activo</span>
          )}
          {isCerrado && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-text-subtle)]">
              <LockSimple size={12} />
              Solo lectura — evaluación cerrada
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/sst/${evaluation.id}/print`} target="_blank">
                <Printer size={14} className="mr-1.5" />
                Imprimir
              </Link>
            </Button>

            {canClose && !isCerrado && (
              <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary">
                    <LockSimple size={14} className="mr-1.5" />
                    Cerrar evaluación
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cerrar evaluación</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="flex items-start gap-2 rounded-[var(--radius)] bg-amber-50 border border-amber-200 p-3">
                      <Warning size={16} className="shrink-0 mt-0.5 text-amber-600" />
                      <p className="text-sm text-amber-700">
                        Una vez cerrada, la evaluación es <strong>inmutable</strong> por requerimiento legal (DS N°44/2024). Esta acción no se puede deshacer.
                      </p>
                    </div>

                    {evaluation.definicionCode === "LC-SST-002" && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-[var(--color-text)]">Condiciones especiales</p>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasCritical}
                            onChange={(e) => setHasCritical(e.target.checked)}
                            className="rounded"
                          />
                          Existe desviación crítica
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasReincidence}
                            onChange={(e) => setHasReincidence(e.target.checked)}
                            className="rounded"
                          />
                          Existe reincidencia
                        </label>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-sm font-medium text-[var(--color-text)]">
                        Restricciones{" "}
                        <span className="font-normal text-[var(--color-text-subtle)]">(opcional)</span>
                      </label>
                      <Textarea
                        value={restricciones}
                        onChange={(e) => setRestricciones(e.target.value)}
                        placeholder="Indica restricciones para el trabajador…"
                        rows={3}
                        maxLength={500}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm font-medium text-[var(--color-text)]">
                        Observaciones generales{" "}
                        <span className="font-normal text-[var(--color-text-subtle)]">(opcional)</span>
                      </label>
                      <Textarea
                        value={observaciones}
                        onChange={(e) => setObservaciones(e.target.value)}
                        placeholder="Observaciones del evaluador…"
                        rows={4}
                        maxLength={1000}
                      />
                    </div>

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

      {/* Tabs */}
      <Tabs defaultValue={applicableSections[0]?.id ?? "acta"}>
        <div className="overflow-x-auto pb-1">
          <TabsList>
            {applicableSections.map((sec) => (
              <TabsTrigger key={sec.id} value={sec.id}>
                {sec.title}
              </TabsTrigger>
            ))}
            <TabsTrigger value="acta">Acta de cierre</TabsTrigger>
            {evaluation.tipo === "seguimiento" && (
              <TabsTrigger value="seguimientos">Seguimientos</TabsTrigger>
            )}
            <TabsTrigger value="plan">Plan de acción</TabsTrigger>
          </TabsList>
        </div>

        {applicableSections.map((sec) => (
          <TabsContent key={sec.id} value={sec.id}>
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-base font-semibold text-[var(--color-text)] mb-4">{sec.title}</h3>
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
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-5">
            <h3 className="text-base font-semibold text-[var(--color-text)]">Acta de Cierre</h3>

            {evaluation.motivo && (
              <div>
                <p className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide mb-1">Motivo</p>
                <p className="text-sm text-[var(--color-text)]">{evaluation.motivo}</p>
              </div>
            )}

            {isCerrado && evaluation.resultadoFinal && (
              <div>
                <p className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide mb-1">Resultado Final</p>
                <span className={[
                  "inline-flex text-sm font-semibold px-3 py-1 rounded-full border",
                  RESULTADO_COLORS[evaluation.resultadoFinal] ?? "bg-slate-100 text-slate-700 border-slate-300",
                ].join(" ")}>
                  {RESULTADO_LABELS[evaluation.resultadoFinal] ?? evaluation.resultadoFinal}
                </span>
                {evaluation.porcentajeCumplimiento !== null && (
                  <p className="mt-1 text-sm text-[var(--color-text-subtle)]">
                    Cumplimiento: {evaluation.porcentajeCumplimiento.toFixed(1)}%
                  </p>
                )}
              </div>
            )}

            {evaluation.restricciones && (
              <div>
                <p className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide mb-1">Restricciones</p>
                <p className="text-sm text-[var(--color-text)]">{evaluation.restricciones}</p>
              </div>
            )}

            {evaluation.observacionesGenerales && (
              <div>
                <p className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide mb-1">Observaciones generales</p>
                <p className="text-sm text-[var(--color-text)]">{evaluation.observacionesGenerales}</p>
              </div>
            )}

            {!isCerrado && (
              <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
                <p className="text-sm text-[var(--color-text-muted)]">
                  El acta de cierre se completa al cerrar la evaluación. Usa el botón <strong>Cerrar evaluación</strong> en la cabecera cuando hayas finalizado el checklist.
                </p>
              </div>
            )}

            {/* Roles de firma */}
            {definition.closingAct.signatureRoles.length > 0 && (
              <div>
                <p className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide mb-2">Firmas requeridas (en acta impresa)</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {definition.closingAct.signatureRoles.map((role) => (
                    <div
                      key={role}
                      className="h-16 rounded-[var(--radius)] border-2 border-dashed border-[var(--color-border)] flex flex-col items-center justify-end pb-1"
                    >
                      <span className="text-xs text-[var(--color-text-subtle)]">{role}</span>
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
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-base font-semibold text-[var(--color-text)] mb-4">Seguimientos programados</h3>
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
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
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
