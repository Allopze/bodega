"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Trash } from "@phosphor-icons/react"
import type { SstEvaluation, SstWeeklyEvaluation } from "@/db/schema/sst"
import {
  RESULTADO_LABELS,
  estadoLabel,
  estadoBadgeVariant,
  resultadoBadgeVariant,
} from "@/lib/sst/badges"
import { formatDateDisplay } from "@/lib/sst/date"
import { evaluatorRoleLabel } from "@/lib/prevention/admin-contrato-label"

interface EvaluationCardProps {
  title: string
  /** Título del cargo admin_contrato en el contrato de la faena. */
  worksiteAdminContratoLabel: string | null
  role: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'
  icon: React.ReactNode
  evaluation: SstEvaluation | undefined
  weeklyEvals: SstWeeklyEvaluation[]
  permissions: {
    canCreate: boolean
    canEvaluateAcompanamiento: boolean
    canDelete: boolean
  }
  userEvaluatorRole?: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'
  onStart: (role: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider') => void
  onDelete: (evaluation: SstEvaluation) => void
}

export function EvaluationCard({
  title,
  worksiteAdminContratoLabel,
  role,
  icon,
  evaluation,
  weeklyEvals,
  permissions,
  userEvaluatorRole,
  onStart,
  onDelete,
}: EvaluationCardProps) {
  const router = useRouter()
  const canUserCreateThis = userEvaluatorRole === role
  const isConductorLider = role === 'conductor_lider'
  const canStartThisEvaluation = canUserCreateThis && (
    isConductorLider
      ? permissions.canEvaluateAcompanamiento
      : permissions.canCreate
  )

  return (
    <Card className="flex flex-col h-full border border-(--color-border) bg-(--color-surface) hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-start justify-between border-b border-(--color-border) bg-(--color-surface-2) p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-(--radius-lg) bg-(--color-primary-tint) text-(--color-primary)">
            {icon}
          </span>
          <div>
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </div>
        </div>
        {evaluation && (
          <Badge variant={estadoBadgeVariant(evaluation.estado)}>
            {estadoLabel(evaluation.estado)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col flex-1 p-5 space-y-4">
        {evaluation ? (
          <div className="flex-1 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-(--color-text-muted)">Fecha:</span>
                <span className="font-medium">{formatDateDisplay(evaluation.fechaEvaluacion)}</span>
              </div>

              {evaluation.porcentajeCumplimiento !== null && (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-(--color-text-muted)">Cumplimiento:</span>
                    <span className="font-bold">{evaluation.porcentajeCumplimiento.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-[var(--color-border)] h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[var(--color-primary)] h-full"
                      style={{ width: `${Math.min(100, evaluation.porcentajeCumplimiento)}%` }}
                    />
                  </div>
                </div>
              )}

              {evaluation.resultadoFinal && (
                <div className="flex justify-between text-sm items-center">
                  <span className="text-(--color-text-muted)">Resultado:</span>
                  <Badge variant={resultadoBadgeVariant(evaluation.resultadoFinal)}>
                    {RESULTADO_LABELS[evaluation.resultadoFinal] ?? evaluation.resultadoFinal}
                  </Badge>
                </div>
              )}

              {isConductorLider && weeklyEvals.length > 0 && (
                <div className="mt-4 pt-4 border-t border-(--color-border) space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
                    Semanas de Acompañamiento
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {weeklyEvals.map((week) => {
                      const isLocked = new Date().toISOString().slice(0, 10) < week.fechaDesbloqueo
                      const statusColor = week.estado === 'completada'
                        ? 'text-[var(--color-success)] bg-[var(--color-success-tint)]'
                        : isLocked
                          ? 'text-[var(--color-text-subtle)] bg-[var(--color-border)]'
                          : 'text-[var(--color-warning-ink)] bg-[var(--color-warning-tint)]'
                      const statusLabel = week.estado === 'completada'
                        ? 'Completada'
                        : isLocked
                          ? 'Bloqueada'
                          : 'Pendiente'
                      return (
                        <div key={week.id} className="p-2 border border-(--color-border) rounded-(--radius) flex flex-col gap-1 text-xs">
                          <span className="font-medium">Semana {week.semana}</span>
                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] text-center font-bold ${statusColor}`}>
                            {statusLabel}
                          </span>
                          <span className="text-[10px] text-(--color-text-muted) italic">
                            Desb. {formatDateDisplay(week.fechaDesbloqueo)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-(--color-border)">
              <Button
                className="flex-1"
                size="sm"
                onClick={() => router.push(`/prevencion/${evaluation.id}`)}
              >
                Ver / Editar
              </Button>
              {permissions.canDelete && (
                <Button
                  variant="ghost"
                  size="icon-mobile-sm"
                  className="text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"
                  aria-label="Eliminar evaluación"
                  onClick={() => onDelete(evaluation)}
                >
                  <Trash size={14} />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between items-center text-center py-6 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-(--color-text-muted)">Sin evaluación iniciada</p>
              <p className="text-xs text-text-subtle">
                {canUserCreateThis
                  ? "Puedes iniciar una nueva evaluación para este rol."
                  : `Solo el rol "${evaluatorRoleLabel(role, worksiteAdminContratoLabel)}" puede iniciar esta evaluación.`
                }
              </p>
            </div>
            {canStartThisEvaluation ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-full mt-2"
                onClick={() => onStart(role)}
              >
                + Iniciar Evaluación
              </Button>
            ) : (
              <span className="text-xs text-text-subtle italic text-(--color-text-muted)">
                No habilitado
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
