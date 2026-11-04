import Link from "next/link"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from "@/components/ui/tooltip"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"
import {
  cellDescription, RISK_MATRIX_CONSEQUENCES, RISK_MATRIX_PROBABILITIES, SCALE_WORD,
  type MatrixCellRef, type ResidualData, type RiskMatrixCell, type RiskMatrixData,
} from "@/lib/prevention/miper/risk-matrix"
import { cn, countOf, pluralize } from "@/lib/utils"
import { RISK_BAND_CELL, RISK_BAND_FILL } from "./risk-bands"

/**
 * Mapa de calor probabilidad × consecuencia de la MIPER (CHART-007).
 *
 * Responde «¿dónde se concentra el riesgo?» con la forma que el dominio ya
 * conoce: una grilla de 3 × 3 (P y C ∈ {1, 2, 4}) con la probabilidad más alta
 * arriba, el conteo de riesgos por celda y cada celda pintada con la
 * clasificación discreta que le toca (`classify`), nunca interpolada.
 *
 * Es una `<table>` de verdad —encabezados de fila y de columna con `scope`— y
 * cada celda dice su conteo **y** su clasificación en texto: el color refuerza,
 * no es la única señal. Las abreviaturas P y C llevan su nombre completo en
 * `title` (A6). Su propia estructura es la alternativa en datos, por eso no
 * lleva «Ver datos».
 *
 * Los riesgos sin P o C no son una celda ni un cero: se dicen fuera de la grilla.
 *
 * Al pasar el puntero o enfocar con el teclado una celda con riesgos aparece un
 * tooltip con sus 3 peligros más frecuentes (P-3). No es un `title` nativo (que
 * ni el teclado ni el teléfono alcanzan): es el `Tooltip` de la plataforma, que
 * se abre con el foco y queda como descripción accesible del enlace de la celda.
 */

/**
 * Lo que recibe `renderLink`: el enlace de una celda ya armado. Trae también
 * `ref` y los manejadores del tooltip (`onFocus`, `aria-describedby`…): quien
 * dibuja el enlace debe esparcirlos sobre su `<a>`.
 */
export type RiskMatrixLinkProps = ComponentPropsWithRef<"a"> & { href: string; className: string }

function DefaultLink({ href, ...rest }: RiskMatrixLinkProps) {
  return <Link href={href} scroll={false} {...rest} />
}

const CELL_BASE = "flex min-h-16 flex-col items-center justify-center rounded-[var(--radius)] px-1 py-2 text-center sm:min-h-20"

function CellBody({ cell }: { cell: RiskMatrixCell }) {
  return (
    <>
      <span className="text-2xl font-semibold leading-none tabular-nums">
        {cell.count}
        <span className="sr-only"> {pluralize(cell.count, "riesgo")}, </span>
      </span>
      <span className="mt-1.5 text-[11px] font-medium leading-tight">{CLASSIFICATION_LABEL[cell.classification]}</span>
    </>
  )
}

/** Lo que dice el enlace de una celda: lleva a los riesgos de ESA celda (P × C exacto), o quita el filtro si ya es la vigente. */
function linkTitle(cell: RiskMatrixCell, selected: boolean) {
  if (selected) return "Quitar el filtro de esta celda"
  return `Ver ${cell.count === 1 ? "el riesgo" : `los ${cell.count} riesgos`} de ${cellDescription(cell)}`
}

/** Lo que dice el tooltip del enlace: la acción en pocas palabras, sin repetir la celda que el puntero ya tiene encima. */
function linkAction(cell: RiskMatrixCell, selected: boolean) {
  if (selected) return "Clic para quitar el filtro"
  return cell.count === 1 ? "Clic para ver este riesgo" : `Clic para ver estos ${cell.count} riesgos`
}

/** El contenido del tooltip: los peligros más frecuentes de la celda y, si es un enlace, qué hace el clic. */
function HazardTip({ cell, action }: { cell: RiskMatrixCell; action?: string }) {
  // Los separadores `sr-only` dan pausas a la copia que lee el lector de pantalla (los bloques no las traen) sin sumar ruido visual.
  return (
    <span className="block space-y-1">
      <span className="block font-semibold">{cell.topHazards.length === 1 ? "Peligro más frecuente" : "Peligros más frecuentes"}<span className="sr-only">. </span></span>
      {cell.topHazards.map((hazard) => (
        <span key={hazard.label} className="block">
          {hazard.label}
          {cell.count > 1 && <><span aria-hidden="true"> · </span><span className="sr-only">, </span><span className="opacity-75">{countOf(hazard.count, "riesgo")}</span></>}
          <span className="sr-only">. </span>
        </span>
      ))}
      {cell.moreHazards > 0 && <span className="block opacity-75">y {countOf(cell.moreHazards, "peligro")} más<span className="sr-only">. </span></span>}
      {action && <span className="block opacity-75">{action}</span>}
    </span>
  )
}

export function RiskMatrix({
  matrix,
  caption,
  hrefFor,
  selected = null,
  renderLink: RenderLink = DefaultLink,
  className,
}: {
  matrix: RiskMatrixData
  /** Nombre accesible de la tabla. Visible sólo para lectores de pantalla. */
  caption: string
  /**
   * Destino de una celda con riesgos: debe llevar a los riesgos de ESA celda
   * (P × C exacto), o a quitar el filtro si es la `selected`. Sin esta función
   * las celdas no son enlaces; una celda sin riesgos nunca lo es (A1).
   */
  hrefFor?: (cell: RiskMatrixCell) => string | undefined
  /** La celda que hoy filtra la lista: se marca con un anillo y `aria-current`, y su enlace la desactiva. */
  selected?: MatrixCellRef | null
  renderLink?: (props: RiskMatrixLinkProps) => ReactNode
  className?: string
}) {
  const cellAt = (probability: number, consequence: number) =>
    matrix.cells.find((cell) => cell.probability === probability && cell.consequence === consequence)!
  return (
    <div className={cn("min-w-0", className)}>
      {/* Un solo proveedor para la grilla: al pasar de una celda a la vecina el tooltip abre sin la espera inicial. */}
      <TooltipProvider delayDuration={200} skipDelayDuration={500}>
        <table className="w-full table-fixed border-separate border-spacing-1">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-20 sm:w-28"><span className="sr-only">Probabilidad por consecuencia</span></th>
              {RISK_MATRIX_CONSEQUENCES.map((consequence) => (
                <th key={consequence} scope="col" className="px-1 pb-1 text-center text-xs font-semibold text-[var(--color-text)]">
                  <span className="block text-[11px] font-normal text-[var(--color-text-muted)]">Consecuencia </span>
                  {SCALE_WORD[consequence]}{" "}
                  <span title={`Consecuencia ${SCALE_WORD[consequence]} (${consequence})`} className="font-mono text-[11px] font-normal text-[var(--color-text-muted)]">C{consequence}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RISK_MATRIX_PROBABILITIES.map((probability) => (
              <tr key={probability}>
                <th scope="row" className="pr-2 text-left text-xs font-semibold text-[var(--color-text)]">
                  <span className="block text-[11px] font-normal text-[var(--color-text-muted)]">Probabilidad </span>
                  {SCALE_WORD[probability]}{" "}
                  <span title={`Probabilidad ${SCALE_WORD[probability]} (${probability})`} className="font-mono text-[11px] font-normal text-[var(--color-text-muted)]">P{probability}</span>
                </th>
                {RISK_MATRIX_CONSEQUENCES.map((consequence) => {
                  const cell = cellAt(probability, consequence)
                  const style = RISK_BAND_CELL[cell.classification]
                  const href = cell.count > 0 ? hrefFor?.(cell) : undefined
                  const isSelected = selected?.probability === cell.probability && selected.consequence === cell.consequence
                  const surface = cn(CELL_BASE, cell.count > 0 ? style.filled : style.zone, isSelected && "ring-2 ring-inset ring-[var(--color-text)]")
                  const hasTip = cell.topHazards.length > 0
                  const title = linkTitle(cell, isSelected)
                  // Con tooltip, el `title` nativo saldría encima de él: la acción pasa a la descripción accesible.
                  const trigger = href ? (
                    <RenderLink
                      href={href}
                      title={hasTip ? undefined : title}
                      aria-current={isSelected ? "true" : undefined}
                      className={cn(surface, "hover:ring-2 hover:ring-inset hover:ring-[var(--color-border-control-hover)] focus-visible:outline-2 focus-visible:outline-offset-1")}
                    >
                      <CellBody cell={cell} />
                    </RenderLink>
                  ) : hasTip ? (
                    // Sin enlace el tooltip igual debe alcanzarse con el teclado.
                    <span tabIndex={0} className={cn(surface, "focus-visible:outline-2 focus-visible:outline-offset-1")}><CellBody cell={cell} /></span>
                  ) : (
                    <span className={surface}><CellBody cell={cell} /></span>
                  )
                  return (
                    <td key={consequence} className="p-0">
                      {hasTip ? (
                        <TooltipRoot>
                          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[18rem] text-left"><HazardTip cell={cell} action={href ? linkAction(cell, isSelected) : undefined} /></TooltipContent>
                        </TooltipRoot>
                      ) : trigger}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TooltipProvider>
      {matrix.unevaluated > 0 && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {countOf(matrix.unevaluated, "riesgo")} sin evaluar:{" "}
          {matrix.unevaluated === 1 ? "le falta probabilidad o consecuencia y no entra" : "les falta probabilidad o consecuencia y no entran"} en la grilla.
        </p>
      )}
    </div>
  )
}

/**
 * El otro lado del par: el riesgo residual, que `residual_level` guarda en
 * cuatro escalones (no en P × C) y por eso no admite grilla. Lo compara con el
 * inherente banda por banda: la diferencia entre las dos columnas es el efecto
 * de las medidas. Si no todos los riesgos tienen residual, lo advierte: una
 * columna a medias leída como completa sería un efecto inventado.
 */
export function ResidualBands({
  caption,
  inherent,
  residual,
  className,
}: {
  caption: string
  inherent: Record<RiskClassification, number>
  residual: ResidualData
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs text-[var(--color-text-muted)]">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Clasificación</th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">Inherente</th>
            <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Residual</th>
          </tr>
        </thead>
        <tbody>
          {RISK_CLASSIFICATIONS.map((classification) => (
            <tr key={classification} className="border-t border-[var(--color-border)]">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-[var(--color-text)]">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: RISK_BAND_FILL[classification] }} />
                  {CLASSIFICATION_LABEL[classification]}
                </span>
              </th>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{inherent[classification]}</td>
              <td className="py-2 pl-3 text-right font-mono font-semibold tabular-nums">{residual.counts[classification]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {residual.recorded < residual.total && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Residual registrado en {residual.recorded} de {residual.total} riesgos.</p>
      )}
    </div>
  )
}
