"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { formatDateDisplay } from "@/lib/sst/date"
import { RESULTADO_LABELS, resultadoBadgeVariant, estadoBadgeVariant, tipoBadgeVariant } from "@/lib/sst/badges"
import { Check, LockSimple, Printer, Warning } from "@phosphor-icons/react"
import { ROLE_LABELS } from "./helpers"

interface Props {
  workerName: string
  workerRut: string
  worksiteName: string
  cargoLabels: string[]
  evaluation: {
    evaluatorRole?: string | null
    fechaEvaluacion: Date | string
    estado: string
    tipo: string
    resultadoFinal?: string | null
    definicionCode?: string | null
    id: string
  }
  isCerrado: boolean
  canViewFullEvaluation: boolean
  canClose: boolean
  closePending: boolean
  compliance: { total: number; percentage: number; cumplidos: number; noCumplidos: number }
  saveState: null | "saving" | { ts: string } | "error"
  canEditAnyVisible: boolean
  closeOpen: boolean
  setCloseOpen: (v: boolean) => void
  restricciones: string
  setRestricciones: (v: string) => void
  observaciones: string
  setObservaciones: (v: string) => void
  hasCritical: boolean
  setHasCritical: (v: boolean) => void
  hasReincidence: boolean
  setHasReincidence: (v: boolean) => void
  handleClose: () => void
}

export function EvaluationInfoSection({
  workerName,
  workerRut,
  worksiteName,
  cargoLabels,
  evaluation,
  isCerrado,
  canViewFullEvaluation,
  canClose,
  closePending,
  compliance,
  saveState,
  canEditAnyVisible,
  closeOpen,
  setCloseOpen,
  restricciones,
  setRestricciones,
  observaciones,
  setObservaciones,
  hasCritical,
  setHasCritical,
  hasReincidence,
  setHasReincidence,
  handleClose,
}: Props) {
  return (
    <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-(--color-text)">{workerName}</h2>
            {workerRut && <span className="text-sm text-text-subtle">RUT {workerRut}</span>}
            {evaluation.evaluatorRole && (
              <Badge variant="outline">
                Rol: {ROLE_LABELS[evaluation.evaluatorRole] ?? evaluation.evaluatorRole}
              </Badge>
            )}
          </div>
          <p className="text-sm text-(--color-text-muted)">{worksiteName}</p>
          <p className="text-sm text-text-subtle">
            Cargos: {cargoLabels.join(", ")}
          </p>
          <p className="text-sm text-text-subtle">
            Fecha: {formatDateDisplay(evaluation.fechaEvaluacion as string)}
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

          {canViewFullEvaluation && (
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
          )}

          {canViewFullEvaluation && evaluation.resultadoFinal && (
            <Badge variant={resultadoBadgeVariant(evaluation.resultadoFinal)}>
              {RESULTADO_LABELS[evaluation.resultadoFinal] ?? evaluation.resultadoFinal}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-(--color-border)">
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
        {saveState === null && canEditAnyVisible && (
          <span className="text-xs text-text-subtle">Autoguardado activo</span>
        )}
        {isCerrado && (
          <span className="flex items-center gap-1 text-xs text-text-subtle">
            <LockSimple size={12} />
            Solo lectura — evaluación cerrada
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canViewFullEvaluation && (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/sst/${evaluation.id}/print`} target="_blank" rel="noopener noreferrer">
                <Printer size={14} className="mr-1.5" />
                Imprimir
              </Link>
            </Button>
          )}

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
  )
}
