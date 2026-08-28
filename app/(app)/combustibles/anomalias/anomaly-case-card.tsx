"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { OptionSelect } from "@/components/ui/option-select"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { updateAnomalyStatusAction, commentAnomalyAction } from "./actions"
import { ANOMALY_SEVERITY_LABELS, ANOMALY_STATUS_LABELS, METER_RESOLUTION_KIND_LABELS, METER_RESOLUTION_KINDS, anomalySeverityVariant, requiresMeterResolutionKind } from "@/lib/combustibles/anomaly-labels"
import type { AnomalyCaseRow, AnomalyCaseStatus } from "@/lib/combustibles/anomaly-cases"

/** resolved/dismissed requieren `combustibles:resolve_anomalies`; el resto sólo `combustibles:review_anomalies`. */
const NEXT_STATUS: Record<AnomalyCaseStatus, Array<{ status: AnomalyCaseStatus; label: string; requiresResolve?: boolean }>> = {
  open: [{ status: "in_review", label: "Iniciar revisión" }, { status: "dismissed", label: "Descartar", requiresResolve: true }],
  in_review: [{ status: "resolved", label: "Resolver", requiresResolve: true }, { status: "dismissed", label: "Descartar", requiresResolve: true }],
  resolved: [{ status: "reopened", label: "Reabrir" }],
  dismissed: [{ status: "reopened", label: "Reabrir" }],
  reopened: [{ status: "in_review", label: "Iniciar revisión" }, { status: "dismissed", label: "Descartar", requiresResolve: true }],
}

export function AnomalyCaseCard({ anomalyCase, canReview, canResolve }: { anomalyCase: AnomalyCaseRow; canReview: boolean; canResolve: boolean }) {
  const router = useRouter()
  const [comment, setComment] = useState("")
  const [pending, setPending] = useState(false)
  const [resolution, setResolution] = useState("")
  const [resolutionKind, setResolutionKind] = useState("")
  // Cerrar un caso de medidor decide si la serie del equipo se corta acá, así
  // que el revisor tiene que decir cuál de las dos cosas pasó.
  const needsKind = requiresMeterResolutionKind(anomalyCase.ruleCode)
  const sv = { label: ANOMALY_SEVERITY_LABELS[anomalyCase.severity] ?? anomalyCase.severity, variant: anomalySeverityVariant(anomalyCase.severity) }

  async function doStatus(status: AnomalyCaseStatus) {
    setPending(true)
    const result = await updateAnomalyStatusAction({
      caseId: anomalyCase.id, expectedStatus: anomalyCase.status, status, resolution,
      resolutionKind: needsKind && resolutionKind ? resolutionKind : undefined,
    })
    if (result.ok) { toast.success(result.message ?? "Actualizado"); setResolution(""); setResolutionKind(""); router.refresh() }
    else toast.error(result.message)
    setPending(false)
  }

  async function doComment() {
    if (!comment.trim()) return
    setPending(true)
    const result = await commentAnomalyAction({ caseId: anomalyCase.id, body: comment })
    if (result.ok) { toast.success("Comentario añadido"); setComment(""); router.refresh() }
    else toast.error(result.message)
    setPending(false)
  }

  return (
    <div className="border border-(--color-border) bg-(--color-surface) p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={sv.variant} size="sm">{sv.label}</Badge>
            <Badge variant="outline" size="sm">{ANOMALY_STATUS_LABELS[anomalyCase.status] ?? anomalyCase.status}</Badge>
            {anomalyCase.ruleName && <span className="text-sm font-medium">{anomalyCase.ruleName}</span>}
          </div>
          <p className="mt-2 text-sm">{anomalyCase.description}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-text-muted)">
            {anomalyCase.worksiteName && <span>Faena: {anomalyCase.worksiteName}</span>}
            {anomalyCase.vehiclePlate && <span>Equipo: {anomalyCase.vehiclePlate}</span>}
            {anomalyCase.observedValue && <span>Observado: <span className="font-mono">{anomalyCase.observedValue}</span></span>}
            {anomalyCase.expectedValue && <span>Esperado: <span className="font-mono">{anomalyCase.expectedValue}</span></span>}
            {anomalyCase.assigneeName && <span>Asignado: {anomalyCase.assigneeName}</span>}
            {anomalyCase.resolvedByName && <span>Resuelto por: {anomalyCase.resolvedByName}</span>}
          </div>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            Detectado: {formatDateTime(anomalyCase.detectedAt)}
            {anomalyCase.resolvedAt && <> · Resuelto: {formatDateTime(anomalyCase.resolvedAt)}</>}
          </p>
        </div>
      </div>

      {/* Comments */}
      {anomalyCase.comments.length > 0 && (
        <div className="mt-3 border-t border-(--color-border) pt-3 space-y-2">
          {anomalyCase.comments.map((c) => (
            <div key={c.id} className="text-xs">
              <span className="font-medium text-(--color-text)">{c.userName ?? "Sistema"}</span>
              <span className="mx-1 text-(--color-text-muted)">· {formatDateTime(c.createdAt)}</span>
              <p className="mt-0.5 text-(--color-text-muted)">{c.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {(() => {
        const available = (NEXT_STATUS[anomalyCase.status] ?? []).filter((next) => (next.requiresResolve ? canResolve : canReview))
        if (available.length === 0) return null
        const needsResolution = available.some((next) => next.requiresResolve)
        return (
          <div className="mt-3 border-t border-(--color-border) pt-3">
            {needsResolution && (
              <div className="mb-2 space-y-2">
                <Textarea placeholder="Motivo (obligatorio para resolver o descartar)" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className="text-xs" />
                {needsKind && (
                  <div>
                    <OptionSelect
                      aria-label="Qué pasó con el medidor"
                      placeholder="¿Qué pasó con el medidor?"
                      value={resolutionKind}
                      onValueChange={setResolutionKind}
                      options={METER_RESOLUTION_KINDS.map((kind) => ({ value: kind, label: METER_RESOLUTION_KIND_LABELS[kind] }))}
                    />
                    <p className="mt-1 text-xs text-(--color-text-muted)">
                      Sólo un medidor reemplazado reinicia la serie del equipo en Flota y Mantenciones.
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {available.map((next) => (
                <Button key={next.status} size="sm" variant={next.status === "dismissed" ? "destructive" : "secondary"} disabled={pending || (next.requiresResolve && (!resolution.trim() || (needsKind && !resolutionKind)))} onClick={() => doStatus(next.status)}>
                  {next.label}
                </Button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Comment form */}
      {canReview && (
        <div className="mt-3 border-t border-(--color-border) pt-3">
          <Textarea placeholder="Añadir comentario..." value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="text-xs" />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="secondary" disabled={pending || !comment.trim()} onClick={doComment}>Comentar</Button>
          </div>
        </div>
      )}
    </div>
  )
}
