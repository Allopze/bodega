"use client"

import * as React from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircle,
  ClipboardText,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { SubmitButton } from "@/components/admin/submit-button"
import { toast } from "@/lib/toast"
import { createPdtpProgramAction } from "../actions"

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

type EnrichedProgram = {
  id: string
  title: string
  year: number
  version: number
  status: string
  compliancePercent: number | null
  activityCount: number
}

export function PdtpCreateProgramForm({
  userId,
  existingPrograms = [],
  suggestedYear = CURRENT_YEAR,
  hasActiveProgram = false,
}: {
  userId: string
  existingPrograms?: EnrichedProgram[]
  suggestedYear?: number
  hasActiveProgram?: boolean
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(createPdtpProgramAction, null)
  const [copyFrom, setCopyFrom] = React.useState("")
  const [year, setYear] = React.useState(suggestedYear)
  const [title, setTitle] = React.useState("")
  const [titleManuallyEdited, setTitleManuallyEdited] = React.useState(false)
  const [customYear, setCustomYear] = React.useState(false)

  // ── Auto-generar título cuando cambia el año ─────────────────────────────
  React.useEffect(() => {
    if (!titleManuallyEdited) {
      setTitle(`Programa de Trabajo Preventivo SG-SST ${year}`)
    }
  }, [year, titleManuallyEdited])

  // ── Navegar al editor después de crear ────────────────────────────────────
  React.useEffect(() => {
    if (state?.ok && state.programId) {
      toast.success("¡Programa creado!", {
        description: "Redirigiendo al editor para completar actividades…",
      })
      router.push(`/prevencion/pdtp/${state.programId}/editar`)
    }
  }, [state, router])

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value === "") {
      setTitleManuallyEdited(false)
    } else {
      setTitleManuallyEdited(true)
    }
    setTitle(e.target.value)
  }

  const handleYearSelect = (y: number) => {
    setCustomYear(false)
    setYear(y)
  }

  const handleCustomYear = () => {
    setCustomYear(true)
    setYear(CURRENT_YEAR)
  }

  // Si el año seleccionado coincide con uno de los predefinidos,
  // pero customYear está activo, sincronizar el flag.
  const isCustomYearActive = customYear || !YEAR_OPTIONS.includes(year)

  const programsForThisYear = existingPrograms.filter((p) => p.year === year)
  const programsForOtherYears = existingPrograms.filter((p) => p.year !== year)
  const sortedPrograms = [...programsForThisYear, ...programsForOtherYears]

  return (
    <form
      action={formAction}
      className="overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
    >
      <input type="hidden" name="userId" value={userId} />

      {/* ── D: Timeline/stepper del journey ───────────────────────────────── */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-1 sm:gap-2">
          {[
            { step: 1, label: "Crear", active: true },
            { step: 2, label: "Editar actividades", active: false },
            { step: 3, label: "Aprobar", active: false },
            { step: 4, label: "Activar", active: false },
          ].map((s, i) => (
            <React.Fragment key={s.step}>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
                    s.active
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-surface)] text-[var(--color-text-faint)]",
                  )}
                >
                  {s.active ? <Sparkle size={12} weight="fill" /> : s.step}
                </span>
                <span
                  className={cn(
                    "hidden text-xs font-medium sm:inline",
                    s.active ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < 3 && (
                <div
                  className={cn(
                    "h-px flex-1 min-w-[1rem]",
                    s.active ? "bg-[var(--color-primary)]/30" : "bg-[var(--color-border)]",
                  )}
                  aria-hidden
                />
              )}
            </React.Fragment>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Paso 1: Definir año y título. Después podrás editar actividades, hojas y planificación.
        </p>
      </div>

      <FieldGroup className="gap-6 p-5 sm:p-6">
        {/* ── A: Year picker visual ──────────────────────────────────────── */}
        <div role="group" aria-label="¿Qué año quieres planificar?">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle mb-2">
            ¿Qué año quieres planificar?
          </p>
          <input type="hidden" name="year" value={year} />
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Seleccionar año">
            {YEAR_OPTIONS.map((y) => {
              const programForYear = existingPrograms.find(
                (p) => p.year === y && p.status === "active",
              )
              const isActiveYear = y === CURRENT_YEAR && hasActiveProgram
              const isRecommended = y === suggestedYear && suggestedYear > CURRENT_YEAR
              const isSelected = year === y && !isCustomYearActive

              return (
                <button
                  key={y}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => handleYearSelect(y)}
                  className={cn(
                    "group relative flex flex-col items-center gap-1 rounded-[var(--radius)] border px-4 py-2.5 text-center transition-all",
                    isSelected
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] ring-1 ring-[var(--color-primary)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]",
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      isSelected
                        ? "text-[var(--color-primary-ink)]"
                        : "text-[var(--color-text)]",
                    )}
                  >
                    {y}
                  </span>
                  {isRecommended && (
                    <span className="text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
                      Sugerido
                    </span>
                  )}
                  {isActiveYear && (
                    <span className="text-[9px] uppercase tracking-wider text-[var(--color-success)]">
                      En curso
                    </span>
                  )}
                  {y < CURRENT_YEAR && !programForYear && (
                    <span className="text-[9px] text-[var(--color-text-faint)]">Pasado</span>
                  )}
                </button>
              )
            })}

            {/* Botón "Otro año" */}
            {customYear ? (
              <Input
                id="pdtp-year-custom"
                type="number"
                min={2024}
                max={CURRENT_YEAR + 2}
                value={year}
                onChange={(e) => {
                  setCustomYear(true)
                  setYear(Number(e.target.value))
                }}
                className="w-24"
                aria-label="Año personalizado"
              />
            ) : (
              <button
                type="button"
                role="radio"
                aria-checked={false}
                onClick={handleCustomYear}
                className={cn(
                  "flex items-center justify-center rounded-[var(--radius)] border border-dashed px-4 py-2.5 text-xs text-[var(--color-text-muted)] transition-colors",
                  "border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
                )}
              >
                Otro año…
              </button>
            )}
          </div>
        </div>

        {/* ── B: Título con auto-generación ─────────────────────────────── */}
        <Field label="Título del programa" htmlFor="pdtp-title" required>
          <Input
            id="pdtp-title"
            name="title"
            required
            value={title}
            onChange={handleTitleChange}
            placeholder={`Programa de Trabajo Preventivo SG-SST ${year}`}
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
            Se genera automáticamente. Puedes editarlo si lo necesitas.
          </p>
        </Field>

        {/* ── C: Selector visual de origen ──────────────────────────────── */}
        {existingPrograms.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                Partir desde un programa existente
              </p>
              {copyFrom && (
                <button
                  type="button"
                  onClick={() => setCopyFrom("")}
                  className="text-xs text-[var(--color-text-muted)] underline hover:text-[var(--color-text)]"
                >
                  No duplicar
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Copia hojas, actividades y planificación. Las ejecuciones no se copian.
            </p>
            <input type="hidden" name="copySheetsFromProgramId" value={copyFrom} />

            {/* Opción vacía */}
            <button
              type="button"
              role="radio"
              aria-checked={!copyFrom}
              onClick={() => setCopyFrom("")}
              className={cn(
                "w-full rounded-[var(--radius)] border p-3 text-left transition-all",
                !copyFrom
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] ring-1 ring-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                    !copyFrom
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : "border-[var(--color-border)] text-[var(--color-text-faint)]",
                  )}
                >
                  <ClipboardText size={13} />
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    Programa vacío
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Empieza con las 8 hojas plantilla. Luego agregarás actividades desde el editor.
                  </p>
                </div>
              </div>
            </button>

            {/* Cards de programas existentes */}
            <div className="space-y-2" role="radiogroup" aria-label="Programas existentes">
              {sortedPrograms.map((p) => {
                const isSelected = copyFrom === p.id
                const statusBadge = {
                  active: { label: "Activo", variant: "success" as const },
                  closed: { label: "Cerrado", variant: "default" as const },
                  draft: { label: "Borrador", variant: "warning" as const },
                }[p.status] ?? { label: p.status, variant: "default" as const }

                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setCopyFrom(p.id)}
                    className={cn(
                      "w-full rounded-[var(--radius)] border p-3 text-left transition-all hover:shadow-sm",
                      isSelected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] ring-1 ring-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                            isSelected
                              ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                              : "border-[var(--color-border)] text-[var(--color-text-faint)]",
                          )}
                        >
                          {p.year.toString().slice(-2)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-[var(--color-text)]">
                              {p.title}
                            </p>
                            <Badge variant={statusBadge.variant} size="sm">
                              {statusBadge.label}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                            <span>Año {p.year} · v{p.version}</span>
                            <span>{p.activityCount} actividades</span>
                            {p.compliancePercent !== null && (
                              <span
                                className={cn(
                                  "font-medium",
                                  p.compliancePercent >= 80
                                    ? "text-[var(--color-success)]"
                                    : "text-[var(--color-signal)]",
                                )}
                              >
                                {p.compliancePercent}% cumplimiento
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <CheckCircle
                          size={16}
                          weight="fill"
                          className="mt-0.5 shrink-0 text-[var(--color-primary)]"
                        />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Feedback ──────────────────────────────────────────────────── */}
        {state?.message && !state.ok && (
          <p
            role="alert"
            className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]"
          >
            {state.message}
          </p>
        )}
        {state?.ok && state.programId && (
          <p
            role="status"
            className="rounded-[var(--radius)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-3 py-2 text-sm text-[var(--color-success)]"
          >
            <span className="flex items-center gap-2">
              <CheckCircle size={16} weight="fill" />
              ¡Programa creado! Redirigiendo al editor…
            </span>
          </p>
        )}

        {/* ── Acciones ──────────────────────────────────────────────────── */}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancelar
          </Button>
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-[var(--color-text-faint)] sm:block">
              {copyFrom
                ? `Se duplicarán actividades desde el programa seleccionado`
                : `Programa vacío con 8 hojas plantilla`}
            </p>
            <SubmitButton label="Crear programa" loadingLabel="Creando..." />
          </div>
        </div>
      </FieldGroup>
    </form>
  )
}
