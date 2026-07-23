"use client"

import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Check, SlidersHorizontal, X } from "@phosphor-icons/react"
import { excludeActivityForWorksiteAction, includeActivityForWorksiteAction, setPdtpActivityWorksiteParamsAction } from "../actions"

export type AplicabilidadActivity = {
  id: string
  n: number
  activity: string
  objective: string
  scheduleMode: string
  indicatorMode: string
}

export type AplicabilidadWorksite = {
  id: string
  name: string
  code: string
  workerCount: number
}

export type ExclusionsMap = Record<string, { reason: string; createdBy?: string }> // key: `${activityId}:${worksiteId}`
export type ParamsMap = Record<string, { expectedSubjectCount: number | null; targetCoveragePercent: number | null }> // key: `${activityId}:${worksiteId}`

type Props = {
  activities: AplicabilidadActivity[]
  worksites: AplicabilidadWorksite[]
  exclusions: ExclusionsMap
  params: ParamsMap
  canManage: boolean
}

export function PdtpAplicabilidadClient({ activities, worksites, exclusions, params, canManage }: Props) {
  const [selectedWorksiteId, setSelectedWorksiteId] = useState<string>(worksites[0]?.id ?? "")
  const [isPending, startTransition] = useTransition()

  // Diálogo para excluir/incluir actividad
  const [editingActivity, setEditingActivity] = useState<AplicabilidadActivity | null>(null)
  const [subjectCountInput, setSubjectCountInput] = useState<string>("")
  const [coveragePercentInput, setCoveragePercentInput] = useState<string>("")
  const [dialogOpen, setDialogOpen] = useState(false)

  const currentWorksite = worksites.find((w) => w.id === selectedWorksiteId)

  const handleOpenDialog = (act: AplicabilidadActivity) => {
    setEditingActivity(act)
    const key = `${act.id}:${selectedWorksiteId}`
    setSubjectCountInput(params[key]?.expectedSubjectCount ? String(params[key].expectedSubjectCount) : "")
    setCoveragePercentInput(params[key]?.targetCoveragePercent ? String(params[key].targetCoveragePercent) : "")
    setDialogOpen(true)
  }

  const handleToggleExclusion = (act: AplicabilidadActivity, isExcluded: boolean) => {
    if (!canManage || !selectedWorksiteId) return
    startTransition(async () => {
      if (isExcluded) {
        // Re-incluir
        await includeActivityForWorksiteAction({
          activityId: act.id,
          worksiteId: selectedWorksiteId,
          reason: "Inclusión manual por Jefatura",
        })
      } else {
        // Excluir
        const promptReason = prompt(`Motivo de exclusión para N° ${act.n} en ${currentWorksite?.name} (mínimo 10 caracteres):`)
        if (!promptReason || promptReason.trim().length < 10) {
          alert("Debe ingresar una justificación válida de al menos 10 caracteres.")
          return
        }
        await excludeActivityForWorksiteAction({
          activityId: act.id,
          worksiteId: selectedWorksiteId,
          reason: promptReason.trim(),
        })
      }
    })
  }

  const handleSaveParams = () => {
    if (!editingActivity || !selectedWorksiteId) return
    startTransition(async () => {
      const subjectCount = subjectCountInput ? parseInt(subjectCountInput, 10) : null
      const coveragePercent = coveragePercentInput ? parseFloat(coveragePercentInput) : null
      await setPdtpActivityWorksiteParamsAction({
        activityId: editingActivity.id,
        worksiteId: selectedWorksiteId,
        expectedSubjectCount: Number.isNaN(subjectCount) ? null : subjectCount,
        targetCoveragePercent: Number.isNaN(coveragePercent) ? null : coveragePercent,
      })
      setDialogOpen(false)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Faena a gestionar</label>
          <div className="mt-1 flex items-center gap-3">
            <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Seleccionar faena..." />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name} ({ws.code}) — {ws.workerCount} trabajad.
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentWorksite && (
              <Badge variant={currentWorksite.workerCount >= 25 ? "primary" : "outline"}>
                {currentWorksite.workerCount} trabajadores (CPHS: {currentWorksite.workerCount >= 25 ? "Aplica" : "No aplica <25"})
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">N°</TableHead>
              <TableHead>Actividad / Objetivo</TableHead>
              <TableHead className="w-[140px]">Modo / Indicador</TableHead>
              <TableHead className="w-[140px]">Estado Faena</TableHead>
              <TableHead className="w-[180px]">Parámetros (R1/R2)</TableHead>
              {canManage && <TableHead className="w-[120px] text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((act) => {
              const key = `${act.id}:${selectedWorksiteId}`
              const exclusion = exclusions[key]
              const param = params[key]
              const isExcluded = Boolean(exclusion)

              // CPHS auto-exclusion (11, 12, 13, 14 con < 25 trabajadores)
              const isCphsAct = [11, 12, 13, 14].includes(act.n)
              const isAutoExcludedCphs = isCphsAct && (currentWorksite?.workerCount ?? 0) < 25

              return (
                <TableRow key={act.id} className={isExcluded || isAutoExcludedCphs ? "bg-[var(--color-surface-muted)]/50 opacity-75" : ""}>
                  <TableCell className="font-mono font-bold text-sm">{act.n}</TableCell>
                  <TableCell>
                    <div className="font-medium text-[var(--color-text)]">{act.activity}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{act.objective}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className="w-fit text-[10px]">
                        {act.scheduleMode}
                      </Badge>
                      <span className="text-xs text-[var(--color-text-muted)] font-mono">{act.indicatorMode}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isExcluded ? (
                      <Badge variant="danger" title={exclusion?.reason}>
                        Excluida
                      </Badge>
                    ) : isAutoExcludedCphs ? (
                      <Badge variant="warning" title="Auto-excluida por CPHS < 25 trabajadores (R4)">
                        No aplica (&lt;25 trab.)
                      </Badge>
                    ) : (
                      <Badge variant="success">
                        <Check size={12} className="mr-1 inline" /> Aplica
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {param?.expectedSubjectCount != null && (
                      <div>Sujetos R1: {param.expectedSubjectCount}</div>
                    )}
                    {param?.targetCoveragePercent != null && (
                      <div>Meta R2: {param.targetCoveragePercent}%</div>
                    )}
                    {!param?.expectedSubjectCount && !param?.targetCoveragePercent && (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleOpenDialog(act)}
                          title="Configurar parámetros R1/R2"
                          disabled={isPending}
                        >
                          <SlidersHorizontal size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant={isExcluded ? "secondary" : "ghost"}
                          onClick={() => handleToggleExclusion(act, isExcluded)}
                          disabled={isPending || isAutoExcludedCphs}
                          title={isExcluded ? "Incluir actividad" : "Excluir de faena"}
                        >
                          {isExcluded ? <Check size={14} /> : <X size={14} />}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Diálogo de edición de parámetros R1 / R2 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Parámetros por Faena — Actividad N° {editingActivity?.n}</DialogTitle>
            <DialogDescription>
              Configura los sujetos esperados (Regla R1 todo-o-nada) o meta de cobertura (Regla R2) para {currentWorksite?.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label htmlFor="subjectCount" className="block text-sm font-medium text-[var(--color-text)]">
                Sujetos esperados en la faena (R1 - Todo o Nada)
              </label>
              <Input
                id="subjectCount"
                type="number"
                placeholder="Ej. 10 extintores o equipos..."
                value={subjectCountInput}
                onChange={(e) => setSubjectCountInput(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Si la inspección no alcanza este total de sujetos en la faena, la actividad cuenta 0.
              </p>
            </div>

            <div>
              <label htmlFor="coveragePercent" className="block text-sm font-medium text-[var(--color-text)]">
                Meta de cobertura de personas % (R2)
              </label>
              <Input
                id="coveragePercent"
                type="number"
                step="0.1"
                placeholder="Ej. 90.0"
                value={coveragePercentInput}
                onChange={(e) => setCoveragePercentInput(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Porcentaje objetivo de personas alcanzadas sobre el padrón de la faena.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveParams} disabled={isPending}>
              Guardar Parámetros
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
