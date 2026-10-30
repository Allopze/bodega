"use client"

import * as React from "react"
import { Check, Minus, Warning } from "@phosphor-icons/react"
import type { Icon } from "@phosphor-icons/react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { MantBrandRuleValue } from "@/lib/mantencion/types"
import type { EditorBrandRuleRow } from "@/lib/services/mantencion/schedules"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { setBrandRuleAction } from "@/app/(app)/mantencion/pautas/[id]/actions"
import { SectionCard } from "../shared/section-card"
import { useGridNavigation } from "./use-grid-navigation"

/** El símbolo va DENTRO de cada celda: el color refuerza, nunca es la única señal. */
const RULE: Record<MantBrandRuleValue, { label: string; Icon: Icon; cell: string }> = {
  A: { label: "Aplica", Icon: Check, cell: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)] border-[var(--color-success-line)]" },
  W: { label: "Revisar con pauta del fabricante", Icon: Warning, cell: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)] border-[var(--color-warning-line)]" },
  X: { label: "No aplica", Icon: Minus, cell: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-[var(--color-border-strong)]" },
}
const NEXT: Record<MantBrandRuleValue, MantBrandRuleValue> = { A: "W", W: "X", X: "A" }

const rowKey = (activity: string, brandId: string) => `${activity}\u0000${brandId}`

/**
 * Reglas por marca: por actividad y marca, A aplica, W revisar («Confirmar con
 * pauta del fabricante») y X no aplica (la app oculta el ítem). Cada celda rota
 * A → W → X → A con un clic y se guarda al instante; se pinta de inmediato
 * (`useOptimistic`) y vuelve atrás si el servidor la rechaza. Para el teclado la
 * tabla es una sola parada de Tab y las flechas se mueven por las celdas.
 */
export function ScheduleBrandRules({ scheduleId, brands, rows }: {
  scheduleId: string
  brands: Array<{ id: string; name: string }>
  rows: EditorBrandRuleRow[]
}) {
  const serverValues = React.useMemo(() => {
    const map: Record<string, MantBrandRuleValue> = {}
    for (const row of rows) for (const brand of brands) map[rowKey(row.activity, brand.id)] = row.values[brand.id] ?? "A"
    return map
  }, [rows, brands])
  const [values, setValue] = React.useOptimistic(serverValues, (state, update: { key: string; value: MantBrandRuleValue }) => ({ ...state, [update.key]: update.value }))
  const [, startTransition] = React.useTransition()
  const rowIds = React.useMemo(() => rows.map((row) => row.activity), [rows])
  const colIds = React.useMemo(() => brands.map((brand) => brand.id), [brands])
  const grid = useGridNavigation(rowIds, colIds)
  const hintId = React.useId()

  function rotate(activity: string, brandId: string, current: MantBrandRuleValue) {
    const next = NEXT[current]
    startTransition(async () => {
      setValue({ key: rowKey(activity, brandId), value: next })
      const result = await setBrandRuleAction({ scheduleId, activity, brandId, value: next })
      if (!result.ok) toast.error(result.message)
    })
  }

  return (
    <SectionCard
      title="Diferencias por marca"
      description="Solo las actividades que cambian según la marca. Toca un cuadro para cambiarlo: con «No aplica» la app oculta el ítem para esa marca; con «Revisar» lo muestra con el aviso «Confirmar con pauta del fabricante». Las marcas que no figuran aquí aplican todos los ítems."
    >
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Significado de los símbolos">
        {(Object.keys(RULE) as MantBrandRuleValue[]).map((key) => {
          const { label, Icon, cell } = RULE[key]
          return (
            <li key={key} className="flex items-center gap-2">
              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded border", cell)}><Icon size={13} weight="bold" aria-hidden /></span>
              {label}
            </li>
          )
        })}
      </ul>
      {/* Sin borde propio: la tarjeta ya enmarca. Las casillas son una sola parada de Tab (flechas), así que la región de scroll no necesita la suya. */}
      <TableRoot className="rounded-none border-0" tabIndex={undefined}>
        <p id={hintId} className="sr-only">
          Las casillas son una sola parada de tabulación: usa las flechas para moverte y Enter o espacio para cambiar la regla.
        </p>
        <Table aria-describedby={hintId} className="min-w-[40rem]">
          <caption className="sr-only">Reglas por marca de cada actividad</caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-44 px-3 py-2">Actividad</TableHead>
              {brands.map((brand) => <TableHead key={brand.id} className="px-2 py-2 text-center">{brand.name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.activity}>
                <th scope="row" className="px-3 py-1.5 text-left text-sm font-normal text-[var(--color-text)]">
                  {row.activity}
                  {!row.inSchedule && <span className="ml-1 text-xs text-[var(--color-text-muted)]">(no está en la pauta)</span>}
                </th>
                {brands.map((brand) => {
                  const value = values[rowKey(row.activity, brand.id)] ?? "A"
                  const { label, Icon, cell } = RULE[value]
                  return (
                    <TableCell key={brand.id} className="px-2 py-0.5 text-center sm:py-1">
                      <button
                        type="button"
                        {...grid.cell(row.activity, brand.id)}
                        onClick={() => rotate(row.activity, brand.id, value)}
                        aria-label={`${row.activity}, ${brand.name}: ${label}. Tocar para cambiar a ${RULE[NEXT[value]].label}.`}
                        className={cn("inline-flex h-11 w-12 items-center justify-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] sm:h-7 sm:w-10", cell)}
                      >
                        <Icon size={14} weight="bold" aria-hidden />
                      </button>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </SectionCard>
  )
}
