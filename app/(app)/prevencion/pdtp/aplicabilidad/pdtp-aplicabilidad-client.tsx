"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Check, SlidersHorizontal, X } from "@phosphor-icons/react"
import { useOperation } from "@/lib/hooks/use-operation"
import { setPdtpActivityWorksiteAdjustmentAction } from "../actions"

export type AplicabilidadActivity = {
  id: string
  n: number
  activity: string
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
  const router = useRouter()
  const [selectedWorksiteId, setSelectedWorksiteId] = useState<string>(worksites[0]?.id ?? "")
  const { pending, message, setMessage, run } = useOperation()

  // Diálogo para excluir/incluir actividad
  const [editingActivity, setEditingActivity] = useState<AplicabilidadActivity | null>(null)
  const [subjectCountInput, setSubjectCountInput] = useState<string>("")
  const [coveragePercentInput, setCoveragePercentInput] = useState<string>("")
  const [reasonInput, setReasonInput] = useState<string>("")
  const [dialogOpen, setDialogOpen] = useState(false)

  const currentWorksite = worksites.find((w) => w.id === selectedWorksiteId)

  const handleOpenDialog = (act: AplicabilidadActivity) => {
    setEditingActivity(act)
    const key = `${act.id}:${selectedWorksiteId}`
    setSubjectCountInput(params[key]?.expectedSubjectCount ? String(params[key].expectedSubjectCount) : "")
    setCoveragePercentInput(params[key]?.targetCoveragePercent ? String(params[key].targetCoveragePercent) : "")
    setReasonInput("")
    setMessage("")
    setDialogOpen(true)
  }

  const handleToggleExclusion = (act: AplicabilidadActivity, isExcluded: boolean) => {
    if (!canManage || !selectedWorksiteId) return
    const promptReason = isExcluded
      ? "Inclusión manual autorizada por Jefatura"
      : prompt(`Motivo de exclusión para N° ${act.n} en ${currentWorksite?.name} (mínimo 10 caracteres):`)
    if (!promptReason || promptReason.trim().length < 10) {
      setMessage("Debe ingresar una justificación válida de al menos 10 caracteres.")
      return
    }
    run(
      () => setPdtpActivityWorksiteAdjustmentAction({
        activityId: act.id,
        worksiteId: selectedWorksiteId,
        excluded: !isExcluded,
        reason: promptReason.trim(),
      }),
      () => router.refresh(),
    )
  }

  const handleSaveParams = () => {
    if (!editingActivity || !selectedWorksiteId) return
    if (reasonInput.trim().length < 10) {
      setMessage("Indica un motivo de ajuste de al menos 10 caracteres.")
      return
    }
    const subjectCount = subjectCountInput ? parseInt(subjectCountInput, 10) : null
    const coveragePercent = coveragePercentInput ? parseFloat(coveragePercentInput) : null
    const key = `${editingActivity.id}:${selectedWorksiteId}`
    run(
      () => setPdtpActivityWorksiteAdjustmentAction({
        activityId: editingActivity.id,
        worksiteId: selectedWorksiteId,
        excluded: Boolean(exclusions[key]),
        reason: reasonInput.trim(),
        expectedSubjectCount: Number.isNaN(subjectCount) ? null : subjectCount,
        targetCoveragePercent: Number.isNaN(coveragePercent) ? null : coveragePercent,
      }),
      () => {
        setDialogOpen(false)
        router.refresh()
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div>
          <label htmlFor="pdtp-applicability-worksite" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Faena a gestionar</label>
          <div className="mt-1 flex items-center gap-3">
            <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}>
              <SelectTrigger id="pdtp-applicability-worksite" className="w-[260px]">
                <SelectValue placeholder="Seleccionar faena..." />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name} ({ws.code}) · {ws.workerCount} trabajad.
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentWorksite && (
              <MetaBadge meta={{ label: `${currentWorksite.workerCount} trabajadores (CPHS: ${currentWorksite.workerCount >= 25 ? "Aplica" : "No aplica <25"})`, variant: currentWorksite.workerCount >= 25 ? "primary" : "outline" }} />
            )}
          </div>
        </div>
      </div>
      {message && !dialogOpen && (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">{message}</p>
      )}

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">N°</TableHead>
              <TableHead>Actividad</TableHead>
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
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <MetaBadge meta={{ label: act.scheduleMode, variant: "outline" }} className="w-fit text-[10px]" />
                      <span className="text-xs text-[var(--color-text-muted)] font-mono">{act.indicatorMode}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isExcluded ? (
                      <MetaBadge meta={{ label: "Excluida", variant: "danger" }} title={exclusion?.reason} />
                    ) : isAutoExcludedCphs ? (
                      <MetaBadge meta={{ label: "No aplica (&lt;25 trab.)", variant: "warning" }} title="Auto-excluida por CPHS < 25 trabajadores (R4)" />
                    ) : (
                      <MetaBadge meta={{ label: "Aplica", variant: "success" }}>
                        <Check size={12} className="mr-1 inline" /> Aplica
                      </MetaBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {param?.expectedSubjectCount != null && (
                      <div>Sujetos R1: {param.expectedSubjectCount}</div>
                    )}
                    {param?.targetCoveragePercent != null && (
                      <div>Meta R2: {param.targetCoveragePercent}%</div>
                    )}
                    {/* Una actividad de cobertura sin padrón no se puede medir "X de Y":
                        el cálculo cae a la cantidad planificada del mes, que responde
                        otra pregunta. Antes esto se veía igual que una actividad que no
                        necesita padrón —un guion— y no había forma de notarlo. */}
                    {act.indicatorMode === "coverage" && param?.expectedSubjectCount == null && (
                      <MetaBadge meta={{ label: "Sin padrón", variant: "warning" }} title="Mide por cobertura pero nadie cargó su padrón. Mientras falte, se mide por la cantidad planificada del mes en vez de contra el total de sujetos." className="w-fit text-[10px] font-sans" />
                    )}
                    {act.indicatorMode !== "coverage" && !param?.expectedSubjectCount && !param?.targetCoveragePercent && (
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
                          disabled={pending}
                        >
                          <SlidersHorizontal size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant={isExcluded ? "secondary" : "ghost"}
                          onClick={() => handleToggleExclusion(act, isExcluded)}
                          disabled={pending || isAutoExcludedCphs}
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
            <DialogTitle>Parámetros por Faena: Actividad N° {editingActivity?.n}</DialogTitle>
            <DialogDescription>
              Configura los sujetos esperados (Regla R1 todo-o-nada) o meta de cobertura (Regla R2) para {currentWorksite?.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Field
              label="Sujetos esperados en la faena (R1 - Todo o Nada)"
              htmlFor="subjectCount"
              helper="Si la inspección no alcanza este total de sujetos en la faena, la actividad cuenta 0."
            >
              <Input
                id="subjectCount"
                type="number"
                min={0}
                placeholder="Ej. 10 extintores o equipos..."
                value={subjectCountInput}
                onChange={(e) => setSubjectCountInput(e.target.value)}
              />
            </Field>

            <Field
              label="Meta de cobertura de personas % (R2)"
              htmlFor="coveragePercent"
              helper="Porcentaje objetivo de personas alcanzadas sobre el padrón de la faena."
            >
              <Input
                id="coveragePercent"
                type="number"
                min={0}
                max={100}
                step="0.1"
                placeholder="Ej. 90.0"
                value={coveragePercentInput}
                onChange={(e) => setCoveragePercentInput(e.target.value)}
              />
            </Field>

            <Field
              label="Motivo del ajuste"
              htmlFor="adjustmentReason"
              required
              helper="Quedará incorporado en la bitácora y en la revisión firmada."
              error={message && !message.startsWith("Guardado") ? message : undefined}
            >
              <Input
                id="adjustmentReason"
                value={reasonInput}
                onChange={(event) => setReasonInput(event.target.value)}
                placeholder="Explica por qué se ajustan estos parámetros..."
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveParams} disabled={pending}>
              Guardar Parámetros
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
