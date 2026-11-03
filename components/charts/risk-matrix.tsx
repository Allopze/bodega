import Link from "next/link"
import type { ReactNode } from "react"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"
import {
  RISK_MATRIX_CONSEQUENCES, RISK_MATRIX_PROBABILITIES, SCALE_WORD,
  type ResidualData, type RiskMatrixCell, type RiskMatrixData,
} from "@/lib/prevention/miper/risk-matrix"
import { cn, countOf, pluralize } from "@/lib/utils"
import { RISK_BAND_CELL, RISK_BAND_FILL, RISK_BAND_PLURAL } from "./risk-bands"

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
 */

/** Lo que recibe `renderLink`: el enlace de una celda ya armado. */
export type RiskMatrixLinkProps = { href: string; className: string; title: string; children: ReactNode }

function DefaultLink({ href, className, title, children }: RiskMatrixLinkProps) {
  return <Link href={href} scroll={false} className={className} title={title}>{children}</Link>
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

/** «Ver los 4 riesgos Importantes de la matriz»: el enlace filtra por clasificación, que puede abarcar más de una celda. */
function linkTitle(classification: RiskClassification, bandCount: number) {
  return bandCount === 1
    ? `Ver el riesgo ${CLASSIFICATION_LABEL[classification]} de la matriz`
    : `Ver los ${bandCount} riesgos ${RISK_BAND_PLURAL[classification]} de la matriz`
}

export function RiskMatrix({
  matrix,
  caption,
  hrefFor,
  renderLink: RenderLink = DefaultLink,
  className,
}: {
  matrix: RiskMatrixData
  /** Nombre accesible de la tabla. Visible sólo para lectores de pantalla. */
  caption: string
  /**
   * Destino de una celda con riesgos. Hoy no existe un filtro por P × C, así que
   * el destino es la clasificación de la celda: lleva a TODOS los riesgos de esa
   * banda (P4 × C2 y P2 × C4 comparten la suya), y el `title` lo dice. Sin esta
   * función las celdas no son enlaces; una celda sin riesgos nunca lo es (A1).
   */
  hrefFor?: (cell: RiskMatrixCell) => string | undefined
  renderLink?: (props: RiskMatrixLinkProps) => ReactNode
  className?: string
}) {
  const cellAt = (probability: number, consequence: number) =>
    matrix.cells.find((cell) => cell.probability === probability && cell.consequence === consequence)!
  return (
    <div className={cn("min-w-0", className)}>
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
                const surface = cn(CELL_BASE, cell.count > 0 ? style.filled : style.zone)
                return (
                  <td key={consequence} className="p-0">
                    {href ? (
                      <RenderLink
                        href={href}
                        title={linkTitle(cell.classification, matrix.byClassification[cell.classification])}
                        className={cn(surface, "hover:ring-2 hover:ring-inset hover:ring-[var(--color-border-control-hover)] focus-visible:outline-2 focus-visible:outline-offset-1")}
                      >
                        <CellBody cell={cell} />
                      </RenderLink>
                    ) : (
                      <span className={surface}><CellBody cell={cell} /></span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
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
