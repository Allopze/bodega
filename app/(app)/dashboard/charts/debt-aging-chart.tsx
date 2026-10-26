"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { formatMoney } from "@/lib/services/billing/money"
import { cn, formatCompactCLP } from "@/lib/utils"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "./chart-frame"

/**
 * Antigüedad de la deuda: una barra apilada y, debajo, la lista de tramos.
 *
 * **Los tramos van en el orden de los días, nunca por monto.** Es una línea de
 * tiempo (No vencida → Más de 90 días): el ranking genérico que la dibujaba
 * antes reordenaba por monto y ponía «Más de 90 días» delante de «No vencida».
 * El orden lo define quien arma `buckets` (`AGING_BUCKETS` en
 * `lib/services/billing/config.ts`); este componente jamás ordena.
 *
 * Sin recharts a propósito: son cinco segmentos de flexbox, no un eje. Eso lo
 * deja fuera del chunk de gráficos y sin el `ssr: false` que obliga a pagar un
 * esqueleto.
 *
 * Sólo recibe datos serializables: lo instancia un Server Component
 * (`finance-section.tsx`) y no pueden cruzar la frontera funciones ni formatos.
 */

export interface DebtAgingBucket {
  key: string
  label: string
  /** Saldo del tramo en la moneda del gráfico. */
  amount: number
  /**
   * Facturas del tramo. `null` cuando no se puede decir: el conteo del servicio
   * suma todas las monedas y el gráfico dibuja una sola, así que con varias
   * monedas un número acá sería de otro conjunto que el monto.
   */
  count: number | null
  /** Destino del tramo. Sólo si existe un filtro que reproduzca exactamente ese tramo. */
  href?: string
}

export interface DebtAgingChartProps {
  buckets: DebtAgingBucket[]
  /** Saldo pendiente total (la cifra grande). */
  totalAmount: number
  /** Parte del total con fecha de vencimiento anterior a hoy. */
  overdueAmount: number
  /** ISO-4217. CLP se compacta ($2.489M); otra moneda va completa, nunca con signo de peso. */
  currency?: string
  description?: string
  /** Lista de cobranza: todo lo abierto. */
  openHref?: string
  /** Lista de facturas vencidas. */
  overdueHref?: string
}

/**
 * Escala de un solo tono hacia el peligro: del 15 % (No vencida) al 100 % (el
 * tramo más viejo). Se mezcla contra la superficie y no contra blanco, así que
 * en modo oscuro la escala se invierte sola. El tono es el orden, no una
 * categoría: por eso no se usa la paleta categórica.
 */
function bucketColor(index: number, count: number) {
  const pct = count <= 1 ? 100 : Math.round(15 + (85 * index) / (count - 1))
  return `color-mix(in oklch, var(--color-danger) ${pct}%, var(--color-surface))`
}

function plural(count: number) {
  return `${count.toLocaleString("es-CL")} ${count === 1 ? "factura" : "facturas"}`
}

export function DebtAgingChart({
  buckets,
  totalAmount,
  overdueAmount,
  currency = "CLP",
  description = "Saldo pendiente por días desde el vencimiento",
  openHref,
  overdueHref,
}: DebtAgingChartProps) {
  // Un solo estado para barra y filas: apuntar a una destaca ambas.
  const [activeKey, setActiveKey] = React.useState<string | null>(null)

  const compact = (amount: number) => (currency === "CLP" ? formatCompactCLP(amount) : formatMoney(amount, currency))
  const exact = (amount: number) => formatMoney(amount, currency)

  const withDebt = buckets.filter((bucket) => bucket.amount > 0)

  if (withDebt.length === 0) {
    return (
      <ChartFrame title="Antigüedad de la deuda" description={description}>
        {/* Buena noticia, pero dicha como estado vacío (A4): qué significa, qué
            hacer y un enlace real. `as="p"`: el título del gráfico ya es el h3. */}
        <EmptyState
          compact
          align="start"
          tone="success"
          as="p"
          className="px-0 py-2"
          icon={<CheckCircle size={20} weight="fill" aria-hidden />}
          title="Sin saldo pendiente"
          description="No hay facturas por cobrar. Cuando haya una abierta, se reparte acá según los días que lleva vencida."
          action={(
            <Button asChild size="sm" variant="secondary">
              <Link href="/facturacion">Ver facturación</Link>
            </Button>
          )}
        />
      </ChartFrame>
    )
  }

  const invoiceTotal = buckets.every((bucket) => bucket.count !== null)
    ? buckets.reduce((sum, bucket) => sum + (bucket.count ?? 0), 0)
    : null

  // El largo de cada segmento es su parte del total, normalizada a 1000: con
  // los montos crudos, una suma de `flex-grow` menor que 1 (monedas con
  // decimales) deja de repartir todo el ancho y la barra no llega al borde.
  const sumAmounts = withDebt.reduce((sum, bucket) => sum + bucket.amount, 0)

  const summary = withDebt
    .map((bucket) => `${bucket.label} ${exact(bucket.amount)}${bucket.count === null ? "" : `, ${plural(bucket.count)}`}`)
    .join("; ")

  const overdueLabel = overdueAmount > 0
    ? <>vencido <span className="font-semibold tabular-nums text-[var(--color-text)]" title={exact(overdueAmount)}>{compact(overdueAmount)}</span></>
    : "sin saldo vencido"

  return (
    <ChartFrame
      title="Antigüedad de la deuda"
      description={description}
      aside={openHref ? (
        <Link
          href={openHref}
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          Cobranza
          <ArrowRight size={12} weight="bold" aria-hidden />
        </Link>
      ) : undefined}
      headline={(
        <>
          <span title={exact(totalAmount)}><ChartHeadlineValue>{compact(totalAmount)}</ChartHeadlineValue></span>
          <ChartHeadlineCaption>{invoiceTotal === null ? "por cobrar" : `en ${plural(invoiceTotal)}`}</ChartHeadlineCaption>
          {overdueAmount > 0 && overdueHref ? (
            <Link
              href={overdueHref}
              className="text-sm text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              {overdueLabel}
            </Link>
          ) : (
            <span className="text-sm text-[var(--color-text-muted)]">{overdueLabel}</span>
          )}
        </>
      )}
    >
      <div onMouseLeave={() => setActiveKey(null)}>
        <div
          role="img"
          aria-label={`Saldo pendiente por antigüedad: ${summary}`}
          className="flex h-3.5 gap-0.5 overflow-hidden rounded-full"
        >
          {withDebt.map((bucket) => {
            const index = buckets.indexOf(bucket)
            const state = activeKey === null ? "idle" : activeKey === bucket.key ? "active" : "dimmed"
            return (
              <div
                key={bucket.key}
                data-segment={bucket.key}
                data-state={state}
                title={`${bucket.label}: ${exact(bucket.amount)}${bucket.count === null ? "" : ` · ${plural(bucket.count)}`}`}
                onMouseEnter={() => setActiveKey(bucket.key)}
                // `min-w-1`: un tramo de 0,1 % del total no desaparece.
                className={cn(
                  "h-full min-w-1 basis-0 origin-left transition-opacity duration-[var(--duration-fast)]",
                  "motion-safe:animate-[bar-grow-x_700ms_var(--ease-out)_backwards]",
                  state === "dimmed" && "opacity-35",
                )}
                style={{
                  flexGrow: (bucket.amount / sumAmounts) * 1000,
                  background: bucketColor(index, buckets.length),
                  animationDelay: `${index * 70}ms`,
                }}
              />
            )
          })}
        </div>

        <ul aria-label="Saldo pendiente por tramo de antigüedad" className="mt-3.5 flex flex-col">
          {buckets.map((bucket, index) => {
            const zero = bucket.amount <= 0
            const state = activeKey === null ? "idle" : activeKey === bucket.key ? "active" : "dimmed"
            const rowClass = cn(
              "-mx-2 grid grid-cols-[14px_1fr_auto_auto] items-center gap-2.5 rounded-lg px-2 py-2 text-sm",
              "transition-[opacity,background-color] duration-[var(--duration-fast)]",
              state === "active" && "bg-[var(--color-surface-2)]",
              state === "dimmed" && "opacity-35",
              zero ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]",
              bucket.href && "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
            )
            const cells = (
              <>
                <span
                  aria-hidden
                  className={cn("size-2.5 rounded-[3px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]", state === "active" && "scale-125")}
                  style={{ background: bucketColor(index, buckets.length) }}
                />
                <span className="truncate">{bucket.label}</span>
                <span className="min-w-[76px] text-right text-[13px] tabular-nums text-[var(--color-text-muted)]">
                  {bucket.count === null ? "" : bucket.count > 0 ? plural(bucket.count) : "—"}
                </span>
                <span className={cn("text-right tabular-nums", !zero && "font-semibold")} title={exact(bucket.amount)}>
                  {compact(bucket.amount)}
                </span>
              </>
            )
            return (
              <li
                key={bucket.key}
                data-bucket={bucket.key}
                data-state={state}
                data-zero={zero ? "" : undefined}
                onMouseEnter={() => setActiveKey(bucket.key)}
                onFocus={() => setActiveKey(bucket.key)}
                onBlur={() => setActiveKey(null)}
              >
                {bucket.href ? <Link href={bucket.href} className={rowClass}>{cells}</Link> : <div className={rowClass}>{cells}</div>}
              </li>
            )
          })}
        </ul>
      </div>
    </ChartFrame>
  )
}
