"use client"

import * as React from "react"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Button } from "@/components/ui/button"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { MONTH_LABELS } from "@/lib/utils"

/**
 * Barra de filtros del visor de actividades (`/prevencion/pdtp/actividades`).
 *
 * Existe en vez de reusar los `Pdtp*Picker` de `pdtp-sheet-table-ui.tsx` por dos
 * razones, y ninguna es estética:
 *
 * 1. **Esos pickers los comparten otras tres rutas** (`/prevencion/pdtp`,
 *    `/prevencion/pdtp/programas`, `/prevencion/pdtp/[programId]`) y su firma
 *    está bajo test (`pdtp-sheet-table-ui.test.tsx`). Cambiarlos para arreglar
 *    esta pantalla arrastraba tres pantallas ajenas al problema.
 * 2. **Cada uno reconstruía el querystring completo a mano**, así que recibía los
 *    otros seis filtros como props. Ese diseño tenía un defecto estructural: al
 *    agregarse `?asignado=`, nadie lo añadió a los seis sitios, y el filtro "sólo
 *    las asignadas a mí" se perdía al tocar cualquier otro control.
 *
 * Aquí la URL se muta con `useUrlFilters().setFilters(patch)`, que parte de los
 * `searchParams` actuales: **toda clave no mencionada en el patch sobrevive**. El
 * defecto no vuelve aunque mañana se agregue un parámetro nuevo — no hay ningún
 * sitio donde olvidarse de propagarlo.
 *
 * Reparto de controles (regla A2 de `AGENTS.md`: 4–6 primarios + "Más filtros"):
 * primarios son Faena, Período y Hoja —lo que se toca a diario—, más el
 * segmentado de vista y el botón de asignadas. Año, Programa y Objetivo bajan al
 * Sheet: Año y Programa son una sola decisión ("qué plan miro") que se toma una
 * vez, y el Objetivo ya está representado como agrupación de la tabla anual.
 */

/** Centinela de los `Select` para "sin filtro". `useUrlFilters` borra con `null`. */
const ALL = "all"

/** Mes del período PDTP (1–12); etiqueta en `MONTH_LABELS[mes - 1]`. */
const PDTP_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

type Option = { value: string; label: string }

export type PdtpActivitiesFiltersProps = {
  year: number
  years: number[]
  programId: string
  programs: Array<{ id: string; title: string; year: number; version: number }>
  sheetCode: string
  sheets: Array<{ code: string; label: string }>
  worksiteId?: string
  worksites: Array<{ id: string; name: string }>
  objectiveId?: string
  objectives: Array<{ id: string; code: string; name: string }>
  month: number
  week: number
  viewMode: "semana" | "anual"
  /** `?asignado=yo` activo. Sólo tiene sentido con una faena seleccionada. */
  assigneeFilterActive: boolean
  /** Hay asignaciones nominales que ofrecer; si no, el botón no se renderiza. */
  hasAssignees: boolean
}

export function PdtpActivitiesFilters({
  year,
  years,
  programId,
  programs,
  sheetCode,
  sheets,
  worksiteId,
  worksites,
  objectiveId,
  objectives,
  month,
  week,
  viewMode,
  assigneeFilterActive,
  hasAssignees,
}: PdtpActivitiesFiltersProps) {
  const { setFilters, clearFilters } = useUrlFilters()

  const yearOptions = React.useMemo(
    () => [...new Set([...years, year])].sort((a, b) => b - a),
    [years, year],
  )

  const currentObjective = objectives.find((item) => item.id === objectiveId)

  /**
   * Los filtros que viven en el Sheet, más `asignado`. Los primarios no llevan
   * chip: ya se leen en su propio control, y duplicarlos es el ruido que A2
   * intenta quitar.
   */
  const activeChips: ActiveFilterChip[] = []
  if (objectiveId && currentObjective) {
    activeChips.push({
      key: "objetivo",
      label: "Objetivo",
      value: objectiveId,
      displayValue: `${currentObjective.code} · ${currentObjective.name}`,
    })
  }
  if (assigneeFilterActive) {
    activeChips.push({ key: "asignado", label: "Asignación", value: "yo", displayValue: "Sólo las mías" })
  }
  // El año sólo se anuncia cuando NO es el que la pantalla habría elegido sola:
  // un chip "Año: 2026" permanente sería decoración. Éste es el que evita que
  // bajar el Año al Sheet lo vuelva invisible.
  const defaultYear = Math.max(...yearOptions)
  if (year !== defaultYear) {
    activeChips.push({ key: "anio", label: "Año", value: String(year), displayValue: String(year) })
  }

  const overflowActiveCount = activeChips.length

  const removeChip = (key: string) => setFilters({ [key]: null })

  // `programa` y `hoja` sobreviven a "Limpiar": no son un recorte de la lista,
  // son qué planilla se está mirando. Limpiar filtros no debe dejar al usuario
  // en una pantalla sin hoja seleccionada.
  const clearAll = () => clearFilters(["programa", "hoja"])

  return (
    <FilterToolbar
      activeChips={activeChips}
      onRemoveChip={removeChip}
      onClearAll={clearAll}
      hasActiveFilters={overflowActiveCount > 0}
      activeCount={overflowActiveCount}
      overflowFilters={
        <>
          <Field label="Año" hint="El programa se recarga con los programas de ese año.">
            <Select value={String(year)} onValueChange={(value) => setFilters({ anio: value, programa: null, objetivo: null })}>
              <SelectTrigger aria-label="Seleccionar año"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {programs.length > 1 && (
            <Field label="Programa" hint="Por defecto, la versión activa del año.">
              {/* Cambiar de programa limpia `objetivo`: un objetivo pertenece a un
                  programa y arrastrarlo dejaría la tabla vacía sin decir por qué.
                  El server ya lo revalida (`page.tsx`), esto sólo evita el parpadeo. */}
              <Select value={programId} onValueChange={(value) => setFilters({ programa: value, objetivo: null })}>
                <SelectTrigger aria-label="Seleccionar programa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {programs.map((program) => (
                    <SelectItem key={program.id} value={program.id}>
                      {program.title} · {program.year} · v{program.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {objectives.length > 0 && (
            <Field label="Objetivo" hint="La vista anual ya agrupa por objetivo; esto deja sólo uno.">
              <Select
                value={objectiveId ?? ALL}
                onValueChange={(value) => setFilters({ objetivo: value === ALL ? null : value })}
              >
                <SelectTrigger aria-label="Seleccionar objetivo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los objetivos</SelectItem>
                  {objectives.map((objective) => (
                    <SelectItem key={objective.id} value={objective.id}>
                      {objective.code} · {objective.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </>
      }
      actions={
        <SegmentedControl
          eyebrow="Vista"
          ariaLabel="Cambiar vista"
          variant="segmented"
          items={[
            { key: "semana", label: "Esta semana", active: viewMode === "semana", onClick: () => setFilters({ vista: "semana" }) },
            { key: "anual", label: "Vista anual", active: viewMode === "anual", onClick: () => setFilters({ vista: "anual" }) },
          ]}
        />
      }
    >
      {worksites.length > 1 && (
        <LabelledSelect
          eyebrow="Faena"
          ariaLabel="Seleccionar faena"
          width="w-56"
          value={worksiteId ?? ALL}
          // Sin faena no hay asignación nominal que filtrar (`page.tsx` sólo
          // consulta asignados con faena), así que `asignado` se retira al
          // volver al agregado en vez de quedar activo sin efecto.
          onValueChange={(value) => setFilters(value === ALL ? { faena: null, asignado: null } : { faena: value })}
          options={[
            { value: ALL, label: "Todas las faenas autorizadas" },
            ...worksites.map((worksite) => ({ value: worksite.id, label: worksite.name })),
          ]}
        />
      )}

      <div className="flex items-center gap-1.5">
        <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Período</span>
        <Select value={String(month)} onValueChange={(value) => setFilters({ mes: value })}>
          <SelectTrigger className="w-28" aria-label="Seleccionar mes"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PDTP_MONTHS.map((value) => (
              <SelectItem key={value} value={String(value)}>{MONTH_LABELS[value - 1]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* La semana sólo tiene efecto en la vista semanal: en la anual el control
            no cambia nada observable y era uno de los siete comboboxes que hacían
            fallar A2. `?semana=` SIGUE en la URL y el server la sigue leyendo —
            se oculta el control, no el estado, para no romper deep links. */}
        {viewMode === "semana" && (
          <Select value={String(week)} onValueChange={(value) => setFilters({ semana: value })}>
            <SelectTrigger className="w-24" aria-label="Seleccionar semana"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>Sem {value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {sheets.length > 1 && (
        <LabelledSelect
          eyebrow="Hoja"
          ariaLabel="Seleccionar hoja"
          width="w-64"
          value={sheetCode}
          onValueChange={(value) => setFilters({ hoja: value })}
          options={sheets.map((sheet) => ({ value: sheet.code, label: sheet.label }))}
        />
      )}

      {worksiteId && hasAssignees && (
        <Button
          type="button"
          size="sm"
          variant={assigneeFilterActive ? "primary" : "secondary"}
          aria-pressed={assigneeFilterActive}
          onClick={() => setFilters({ asignado: assigneeFilterActive ? null : "yo" })}
        >
          {assigneeFilterActive ? "Ver todas las actividades" : "Sólo las asignadas a mí"}
        </Button>
      )}
    </FilterToolbar>
  )
}

function LabelledSelect({
  eyebrow,
  ariaLabel,
  width,
  value,
  onValueChange,
  options,
}: {
  eyebrow: string
  ariaLabel: string
  width: string
  value: string
  onValueChange: (value: string) => void
  options: Option[]
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">{eyebrow}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={width} aria-label={ariaLabel}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
