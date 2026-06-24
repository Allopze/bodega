"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useState, useTransition, useId } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  ShieldCheck,
  Briefcase,
  Car,
  Trash,
  Check,
  LockSimple,
  Calendar,
  Warning,
} from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { createEvaluationAction, deleteEvaluationAction } from "@/app/(app)/prevencion/actions"
import { CARGO_OPTIONS } from "@/lib/sst/cargos"
import type { SstEvaluation, SstWeeklyEvaluation } from "@/db/schema/sst"
import {
  RESULTADO_LABELS,
  estadoLabel,
  estadoBadgeVariant,
  resultadoBadgeVariant,
} from "@/lib/sst/badges"
import { formatDateDisplay } from "@/lib/sst/date"

interface Worker {
  id: string
  firstName: string
  lastName: string
  rut: string | null
  position: string | null
  worksiteId: string
  worksiteName: string | null
}

interface Props {
  worker: Worker
  evaluations: SstEvaluation[]
  weeklyEvals: SstWeeklyEvaluation[]
  permissions: {
    canCreate: boolean
    canEvaluateAcompanamiento: boolean
    canDelete: boolean
  }
  userEvaluatorRole?: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'
}

const MOTIVO_OPTIONS = [
  { value: "control_periodico",              label: "Control periódico" },
  { value: "post_incidente_persona",         label: "Post incidente — persona" },
  { value: "post_incidente_material",        label: "Post incidente — material" },
  { value: "post_incidente_ambiental",       label: "Post incidente — ambiental" },
  { value: "cuasi_accidente",                label: "Cuasi accidente" },
  { value: "incumplimiento_procedimiento",   label: "Incumplimiento de procedimiento" },
  { value: "reincidencia",                   label: "Reincidencia" },
  { value: "reincorporacion",                label: "Reincorporación" },
  { value: "otro",                           label: "Otro" },
]

const todayStr = new Date().toISOString().slice(0, 10)

export function WorkerEvaluations({
  worker,
  evaluations,
  weeklyEvals,
  permissions,
  userEvaluatorRole,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [deleteTarget, setDeleteTarget] = useState<SstEvaluation | null>(null)
  const [isDeletePending, startDelete] = useTransition()

  // Modal creation state
  const [createOpen, setCreateOpen] = useState(false)
  const [createRole, setCreateRole] = useState<'prevencionista_faena' | 'admin_contrato' | 'conductor_lider' | null>(null)
  
  // Creation form state
  const [fechaEvaluacion, setFecha] = useState(todayStr)
  const [definicionCode, setDefinicion] = useState("trabajador_nuevo")
  const [selectedCargos, setSelectedCargos] = useState<string[]>(() => {
    const defaultCargo = worker.position && CARGO_OPTIONS.some(o => o.value === worker.position)
      ? [worker.position]
      : []
    return defaultCargo
  })
  const [motivo, setMotivo] = useState("")
  const [motivoOtro, setMotivoOtro] = useState("")
  const [equipoPatente, setEquipoPatente] = useState("")
  const [descripcionEvento, setDescripcion] = useState("")

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const uid = useId()

  const isSeguimiento = definicionCode === "trabajador_antiguo"

  // Find evaluations for each role
  const prevEval = evaluations.find(e => e.evaluatorRole === 'prevencionista_faena' || e.evaluatorRole === null)
  const adminEval = evaluations.find(e => e.evaluatorRole === 'admin_contrato')
  const condEval = evaluations.find(e => e.evaluatorRole === 'conductor_lider')

  const handleOpenCreate = (role: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider') => {
    setCreateRole(role)
    // Conductor líder only does worker new evaluation
    if (role === 'conductor_lider') {
      setDefinicion("trabajador_nuevo")
    }
    setCreateOpen(true)
  }

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (!fechaEvaluacion) errors.fecha = "Fecha de evaluación requerida."
    if (selectedCargos.length === 0) errors.cargos = "Selecciona al menos un cargo."
    if (isSeguimiento && !motivo) errors.motivo = "Selecciona el motivo del seguimiento."
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    startTransition(async () => {
      const result = await createEvaluationAction({
        tipo: isSeguimiento ? "seguimiento" : "nuevo",
        definicionCode,
        workerId: worker.id,
        worksiteId: worker.worksiteId,
        fechaEvaluacion,
        cargos: selectedCargos,
        motivo: isSeguimiento && motivo ? motivo as any : undefined,
        motivoOtro: motivoOtro || undefined,
        equipoPatente: equipoPatente || undefined,
        descripcionEvento: descripcionEvento || undefined,
      })

      if (!result.ok) {
        toast.error(result.message ?? "Error al crear la evaluación")
        return
      }

      toast.success("Evaluación iniciada con éxito")
      setCreateOpen(false)
      router.push(`/prevencion/${result.data!.id}`)
    })
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    startDelete(async () => {
      const formData = new FormData()
      formData.append("evaluationId", deleteTarget.id)
      const result = await deleteEvaluationAction({ ok: false }, formData)
      if (result.ok) {
        toast.success("Evaluación eliminada correctamente")
        setDeleteTarget(null)
        router.refresh()
      } else {
        toast.error(result.message ?? "Error al eliminar")
      }
    })
  }

  const toggleCargo = (cargo: string) => {
    setSelectedCargos(prev =>
      prev.includes(cargo) ? prev.filter(c => c !== cargo) : [...prev, cargo]
    )
  }

  const renderCard = (
    title: string,
    role: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider',
    icon: React.ReactNode,
    evaluation: SstEvaluation | undefined
  ) => {
    const canUserCreateThis = userEvaluatorRole === role
    const isConductorLider = role === 'conductor_lider'

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
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">Semanas de Acompañamiento</p>
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
                    size="icon-sm"
                    className="text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"
                    aria-label="Eliminar evaluación"
                    onClick={() => setDeleteTarget(evaluation)}
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
                    : `Solo el rol "${role === 'prevencionista_faena' ? 'Prevencionista' : role === 'admin_contrato' ? 'Admin de Contrato' : 'Conductor Líder'}" puede iniciar esta evaluación.`
                  }
                </p>
              </div>
              {canUserCreateThis && permissions.canCreate ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => handleOpenCreate(role)}
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

  return (
    <div className="space-y-6">
      {/* 3-Column Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {renderCard("Prevencionista de Faena", "prevencionista_faena", <ShieldCheck size={18} />, prevEval)}
        {renderCard("Admin Contrato / Supervisor", "admin_contrato", <Briefcase size={18} />, adminEval)}
        {renderCard("Conductor Líder (Acompañamiento)", "conductor_lider", <Car size={18} />, condEval)}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Eliminar evaluación"
        description="Esta acción eliminará permanentemente esta evaluación SST, sus respuestas, seguimientos y plan de acción."
        confirmLabel="Eliminar"
        variant="destructive"
        loading={isDeletePending}
        onConfirm={handleDelete}
      />

      {/* Creation Modal Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Iniciar Evaluación como {createRole === 'prevencionista_faena' ? 'Prevencionista' : createRole === 'admin_contrato' ? 'Admin de Contrato' : 'Conductor Líder'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 pt-2">
            <Field label="Trabajador" htmlFor="dialog-worker">
              <input
                id="dialog-worker"
                type="text"
                disabled
                className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-1.5 text-sm opacity-70"
                value={`${worker.firstName} ${worker.lastName}`}
              />
            </Field>

            <Field label="Faena" htmlFor="dialog-worksite">
              <input
                id="dialog-worksite"
                type="text"
                disabled
                className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-1.5 text-sm opacity-70"
                value={worker.worksiteName ?? ""}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Fecha de Evaluación" htmlFor={uid + "-fecha"} error={formErrors.fecha}>
                <DatePicker
                  id={uid + "-fecha"}
                  value={fechaEvaluacion}
                  onChange={setFecha}
                />
              </Field>

              <Field label="Tipo de Evaluación" htmlFor={uid + "-definicion"}>
                <Select
                  value={definicionCode}
                  onValueChange={setDefinicion}
                  disabled={createRole === 'conductor_lider'}
                >
                  <SelectTrigger id={uid + "-definicion"}>
                    <SelectValue placeholder="Selecciona un tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trabajador_nuevo">Trabajador Nuevo</SelectItem>
                    <SelectItem value="trabajador_antiguo">Seguimiento</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Cargo(s) Aplicable(s)" error={formErrors.cargos}>
              <div className="grid grid-cols-2 gap-2 mt-1 p-2 border border-(--color-border) rounded-(--radius-lg) bg-(--color-surface-2)">
                {CARGO_OPTIONS.map((cargo) => (
                  <Checkbox
                    key={cargo.value}
                    id={`cargo-${cargo.value}`}
                    label={cargo.label}
                    checked={selectedCargos.includes(cargo.value)}
                    onChange={() => toggleCargo(cargo.value)}
                  />
                ))}
              </div>
            </Field>

            {isSeguimiento && (
              <div className="border-t border-(--color-border) pt-4 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">Detalles de Seguimiento</p>

                <Field label="Motivo de Seguimiento" htmlFor={uid + "-motivo"} error={formErrors.motivo}>
                  <Select value={motivo} onValueChange={setMotivo}>
                    <SelectTrigger id={uid + "-motivo"}>
                      <SelectValue placeholder="Selecciona motivo" />
                    </SelectTrigger>
                    <SelectContent>
                      {MOTIVO_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {motivo === "otro" && (
                  <Field label="Especificar Motivo" htmlFor={uid + "-motivo-otro"}>
                    <input
                      id={uid + "-motivo-otro"}
                      type="text"
                      className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-line)]"
                      value={motivoOtro}
                      onChange={(e) => setMotivoOtro(e.target.value)}
                      placeholder="Especifica el motivo..."
                    />
                  </Field>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Patente Equipo (Opcional)" htmlFor={uid + "-patente"}>
                    <input
                      id={uid + "-patente"}
                      type="text"
                      className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-line)]"
                      value={equipoPatente}
                      onChange={(e) => setEquipoPatente(e.target.value)}
                      placeholder="ABCD12..."
                    />
                  </Field>
                </div>

                <Field label="Descripción de Evento (Opcional)" htmlFor={uid + "-desc"}>
                  <Textarea
                    id={uid + "-desc"}
                    value={descripcionEvento}
                    onChange={(e) => setDescripcion(e.target.value)}
                    placeholder="Detalles sobre el evento o desviación..."
                    rows={3}
                  />
                </Field>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2 border-t border-(--color-border)">
              <DialogClose asChild>
                <Button variant="ghost" disabled={isPending}>Cancelar</Button>
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Iniciando..." : "Confirmar e Iniciar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
