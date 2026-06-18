"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { markFollowupAction } from "@/app/(app)/prevencion/actions"
import type { SstScheduledFollowup } from "@/db/schema/sst"
import { CheckCircle, Circle } from "@phosphor-icons/react"

interface Props {
  followups: SstScheduledFollowup[]
  canManage: boolean
  onUpdate: (followups: SstScheduledFollowup[]) => void
}

const INSTANCIA_LABELS: Record<string, string> = {
  dia_0:  "Día 0 (inmediato)",
  dia_7:  "Día 7",
  dia_15: "Día 15",
  dia_30: "Día 30",
}

function FollowupCard({
  followup,
  canManage,
  onUpdate,
}: {
  followup: SstScheduledFollowup
  canManage: boolean
  onUpdate: (updated: SstScheduledFollowup) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [obs, setObs] = useState(followup.observaciones ?? "")
  const [expanded, setExpanded] = useState(false)

  function handleToggleRealizado() {
    startTransition(async () => {
      const result = await markFollowupAction(followup.id, {
        realizado: !followup.realizado,
        cumple: followup.cumple ?? null,
        observaciones: obs,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al actualizar")
        return
      }
      onUpdate({ ...followup, realizado: !followup.realizado, observaciones: obs })
    })
  }

  function handleToggleCumple(val: boolean | null) {
    startTransition(async () => {
      const result = await markFollowupAction(followup.id, {
        realizado: followup.realizado,
        cumple: val,
        observaciones: obs,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al actualizar")
        return
      }
      onUpdate({ ...followup, cumple: val, observaciones: obs })
    })
  }

  function handleSaveObs() {
    startTransition(async () => {
      const result = await markFollowupAction(followup.id, {
        realizado: followup.realizado,
        cumple: followup.cumple ?? null,
        observaciones: obs,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al guardar")
        return
      }
      onUpdate({ ...followup, observaciones: obs })
      toast.success("Observaciones guardadas")
    })
  }

  return (
    <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-(--color-text)">
            {INSTANCIA_LABELS[followup.instancia] ?? followup.instancia}
          </p>
          <p className="text-xs text-text-subtle">
            Programado: {followup.fechaProgramada}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {followup.realizado ? (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle size={14} weight="fill" />
              Realizado
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-text-subtle">
              <Circle size={14} />
              Pendiente
            </span>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleToggleRealizado}
              disabled={isPending}
            >
              {followup.realizado ? "Marcar pendiente" : "Marcar realizado"}
            </Button>
          )}
        </div>
      </div>

      {followup.realizado && (
        <div className="space-y-2">
          <div
            role="group"
            aria-label="¿Este seguimiento cumple?"
            className="flex items-center gap-2"
          >
            <span className="text-xs text-text-subtle">¿Cumple?</span>
            {[{ val: true, label: "Sí" }, { val: false, label: "No" }].map(({ val, label }) => (
              <button
                key={label}
                type="button"
                disabled={!canManage || isPending}
                onClick={() => handleToggleCumple(followup.cumple === val ? null : val)}
                aria-pressed={followup.cumple === val}
                className={[
                  "px-2.5 py-1 text-xs font-semibold rounded-(--radius) border transition-colors",
                  followup.cumple === val
                    ? val
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-rose-500 text-white border-rose-500"
                    : "border-(--color-border) text-text-subtle hover:border-border-strong",
                  (!canManage || isPending) && "opacity-50 cursor-not-allowed",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="text-xs text-text-subtle underline"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? "Ocultar observaciones" : "Ver / editar observaciones"}
          </button>
          {expanded && (
            <div className="space-y-2">
              <Textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                disabled={!canManage}
                rows={3}
                placeholder="Observaciones del seguimiento…"
                maxLength={500}
              />
              {canManage && (
                <Button size="sm" variant="secondary" onClick={handleSaveObs} disabled={isPending}>
                  {isPending ? "Guardando…" : "Guardar observaciones"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function FollowupsPanel({ followups, canManage, onUpdate }: Props) {
  function handleItemUpdate(updated: SstScheduledFollowup) {
    onUpdate(followups.map((f) => f.id === updated.id ? updated : f))
  }

  if (followups.length === 0) {
    return (
      <p className="text-sm text-text-subtle italic">
        No hay seguimientos programados para esta evaluación.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--color-text-muted)">
        Seguimientos programados automáticamente al crear la evaluación.
      </p>
      {followups.map((f) => (
        <FollowupCard
          key={f.id}
          followup={f}
          canManage={canManage}
          onUpdate={handleItemUpdate}
        />
      ))}
    </div>
  )
}
