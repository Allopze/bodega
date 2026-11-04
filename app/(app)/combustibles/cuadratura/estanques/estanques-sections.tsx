import Link from "next/link"
import { ArrowSquareOut, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { BulletBar } from "@/components/charts/bullet-bar"
import { ChartSection } from "@/components/charts/chart-section"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { differenceSeverity, type CycleAmount, type CycleDifference, type DifferenceSeverity, type FuelStorageBalance } from "@/lib/combustibles/fuel-cycle"
import { fuelEquipmentHref, fuelLoadHref } from "@/lib/combustibles/routes"
import { describeStorageLevel, summarizeStorageLevels } from "@/lib/combustibles/storage-level"
import { formatDateTime, formatQty } from "@/lib/utils"
import { litersText } from "../_components/format"

const BADGE: Record<DifferenceSeverity, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  normal: { label: "Normal", variant: "success" },
  warning: { label: "Advertencia", variant: "warning" },
  critical: { label: "Crítico", variant: "danger" },
  unavailable: { label: "Sin comparar", variant: "neutral" },
}

export const severityBadge = (difference: CycleDifference) => BADGE[differenceSeverity(difference)]

/** El valor de una etapa, o «Sin registros»: nunca un 0 inventado. */
export const stageAmount = (amount: CycleAmount | null) => (amount ? `${formatQty(amount.liters, undefined, { maximumFractionDigits: 0 })} L` : "Sin registros")

/**
 * La frase que abre la vista: lo que entró a los estanques contra lo que se
 * entregó a equipos, y su diferencia. Si falta una de las dos etapas, dice cuál
 * en vez de inventar la comparación.
 */
export function cycleAnswer(
  comparison: { received: CycleAmount | null; delivered: CycleAmount | null; differences: { receivedVsDelivered: CycleDifference } },
  periodPhrase: string,
): string {
  const { received, delivered } = comparison
  const difference = comparison.differences.receivedVsDelivered
  if (!received && !delivered) return `No hay recepciones ni entregas en los estanques ${periodPhrase}.`
  if (!received) return `Se entregaron ${litersText(delivered?.liters)} a equipos ${periodPhrase}, pero no hay recepciones registradas para compararlas.`
  if (!delivered) return `Entraron ${litersText(received.liters)} a los estanques ${periodPhrase}, pero no hay entregas registradas para compararlas.`
  const absolute = difference.status === "available" ? Math.abs(difference.absolute) : 0
  const pct = difference.status === "available" && difference.percent !== null ? ` (${formatQty(Math.abs(difference.percent), undefined, { maximumFractionDigits: 1 })} %)` : ""
  return `En los estanques entraron ${litersText(received.liters)} y se entregaron ${litersText(delivered.liters)} a equipos ${periodPhrase}: la diferencia es ${litersText(absolute)}${pct}.`
}

/**
 * CHART-020: «¿cuánto queda en cada estanque?» como una barra de nivel sobre
 * capacidad por estanque, con la frase que lo responde arriba. Reemplaza al
 * gráfico plegado que repetía las cifras de los tiles (A5): aquí el dibujo
 * muestra lo que la tabla de abajo sólo enumeraba.
 *
 * No hay marca de reposición: el catálogo de estanques no registra un punto de
 * reposición ni un mínimo, sólo la capacidad (ver `lib/combustibles/storage-level.ts`).
 * Un estanque sin capacidad informada muestra su nivel como cifra, sin escala.
 */
export function StorageLevelBars({ balances, canEditTanks = false }: { balances: FuelStorageBalance[]; canEditTanks?: boolean }) {
  if (balances.length === 0) return null
  // Sin ninguna capacidad no hay barra que dibujar: listar los niveles sólo repetiría
  // la tabla de abajo (A5). Salvo que un nivel esté mal, que eso sí hay que verlo.
  const views = balances.map(describeStorageLevel)
  if (views.every((view) => !view.hasCapacity && !view.problem)) {
    return (
      <ChartSection
        title="Nivel contra capacidad"
        headingLevel={3}
        empty={{
          label: "Ningún estanque tiene capacidad informada",
          hint: "Con la capacidad cargada, acá se ve cuánto queda en cada uno. Por ahora el nivel está en la tabla de abajo.",
          ...(canEditTanks ? { ctaLabel: "Cargar capacidades", ctaHref: "/admin/flota-catalogos/estanques-combustible" } : {}),
        }}
      />
    )
  }
  return (
    <ChartSection
      title="Nivel contra capacidad"
      headingLevel={3}
      summary={summarizeStorageLevels(balances)}
    >
      <ul className="grid list-none gap-x-10 gap-y-5 p-0 md:grid-cols-2" data-testid="estanques-niveles">
        {balances.map((balance) => {
          const view = describeStorageLevel(balance)
          return (
            <li key={balance.storageLocationId} className="min-w-0">
              {view.hasCapacity && balance.capacityLiters != null ? (
                <BulletBar label={balance.name} value={balance.balanceLiters} max={balance.capacityLiters} valueText={view.valueText} tone={view.tone} note={view.note} />
              ) : (
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-[var(--color-text)]">{balance.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-[var(--color-text)]">{view.valueText}</span>
                  </div>
                  <p className={`mt-1.5 text-xs ${view.problem ? "font-medium text-[var(--color-danger-ink)]" : "text-[var(--color-text-muted)]"}`}>
                    {view.problem ? view.note : "Sin capacidad informada: no hay una escala contra la que comparar el nivel."}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </ChartSection>
  )
}

/** Nivel por estanque: lo que tenía al empezar, lo que recibió, lo que entregó y cómo quedó contra su capacidad. */
export function StorageLevels({ balances, canCreateTank }: { balances: FuelStorageBalance[]; canCreateTank: boolean }) {
  if (balances.length === 0) {
    return (
      <EmptyState
        compact
        title="No hay estanques activos con estos filtros"
        description="Un estanque es un depósito de combustible de la empresa en faena. Sin estanques activos no hay nivel que mostrar; pide que creen el de tu faena."
        action={canCreateTank ? <Button asChild variant="secondary" size="sm"><Link href="/admin/flota-catalogos/estanques-combustible">Crear un estanque</Link></Button> : undefined}
      />
    )
  }
  return (
    <TableRoot aria-label="Nivel de los estanques de combustible">
      <Table className="min-w-[700px]">
        {/*
          COM-001 (auditoría 2026-09-14): la columna se llamaba «Saldo» y mostraba el
          flujo neto del período —negativo si el rango sólo contenía entregas— y aun
          así se comparaba con la capacidad física. Ahora la apertura es una columna
          propia y el nivel es la suma, lo único comparable con la capacidad.
        */}
        <TableHeader>
          <TableRow>
            <TableHead>Estanque</TableHead>
            <TableHead className="text-right" title="Lo que había antes del primer día del período">Al inicio</TableHead>
            <TableHead className="text-right">Recibido</TableHead>
            <TableHead className="text-right">Entregado</TableHead>
            <TableHead className="text-right" title="Al inicio + recibido − entregado">Nivel</TableHead>
            <TableHead className="text-right">Capacidad</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {balances.map((balance) => {
            const overCapacity = balance.capacityLiters != null && balance.balanceLiters > balance.capacityLiters
            return (
              <TableRow key={balance.storageLocationId}>
                <TableCell className="font-medium">{balance.name}</TableCell>
                <TableCellNum className="text-[var(--color-text-muted)]">{litersText(balance.openingLiters)}</TableCellNum>
                <TableCellNum>{litersText(balance.receivedLiters + balance.transferInLiters)}</TableCellNum>
                <TableCellNum>{litersText(balance.deliveredLiters + balance.transferOutLiters)}</TableCellNum>
                <TableCellNum className={overCapacity ? "text-[var(--color-danger-ink)]" : undefined}>
                  {litersText(balance.balanceLiters)}
                  {overCapacity ? <Badge variant="danger" className="ml-2">Sobre su capacidad</Badge> : null}
                </TableCellNum>
                <TableCellNum className="text-[var(--color-text-muted)]">{balance.capacityLiters != null ? litersText(balance.capacityLiters) : "Sin capacidad informada"}</TableCellNum>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
        El nivel arrastra todo lo registrado antes del período («Al inicio») y le suma el movimiento del rango. No distingue una merma real de una carga no registrada: para eso falta el aforo físico periódico del estanque.
      </p>
    </TableRoot>
  )
}

const EVENT_LABEL: Record<string, string> = {
  received: "Recepción en estanque",
  transfer: "Traspaso entre estanques",
  tank_delivery: "Entrega desde estanque",
  direct_delivery: "Entrega directa",
}

export interface CycleMovementRow {
  id: string
  eventType: string
  occurredAt: string
  quantity: number
  documentNumber: string | null
  sourceType: string | null
  sourceId: string | null
  worksite: { name: string }
  product: { name: string }
  sourceLocation: { name: string } | null
  targetLocation: { name: string } | null
  vehicle: { id: string; plate: string; code: string | null } | null
  supplier: { name: string } | null
}

/** Ficha de la carga que respalda un movimiento, si la tiene. */
export function movementSourceHref(type: string | null, id: string | null): string | null {
  if (!id) return null
  if (type === "fuel_load") return fuelLoadHref({ origen: "factura", id })
  if (type === "tae_submission") return fuelLoadHref({ origen: "terreno", id })
  return null
}

/** Movimientos del período: recepciones, traspasos y entregas, con el documento que los respalda. */
export function MovementsTable({ rows }: { rows: CycleMovementRow[] }) {
  return (
    <TableRoot aria-label="Movimientos de los estanques">
      <Table className="min-w-[850px]">
        <TableHeader>
          <TableRow>
            <TableHead>Cuándo</TableHead>
            <TableHead>Qué</TableHead>
            <TableHead>Faena y producto</TableHead>
            <TableHead>Ruta</TableHead>
            <TableHead className="text-right">Litros</TableHead>
            <TableHead>Documento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((movement) => {
            const href = movementSourceHref(movement.sourceType, movement.sourceId)
            const target = movement.targetLocation?.name ?? (movement.vehicle ? (
              <Link href={fuelEquipmentHref(movement.vehicle.id)} className="underline-offset-4 hover:underline">{movement.vehicle.code ?? movement.vehicle.plate}</Link>
            ) : "—")
            return (
              <TableRow key={movement.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">{formatDateTime(movement.occurredAt)}</TableCell>
                <TableCell className="font-medium">{EVENT_LABEL[movement.eventType] ?? movement.eventType}</TableCell>
                <TableCell>{movement.worksite.name}<span className="block text-xs text-[var(--color-text-muted)]">{movement.product.name}</span></TableCell>
                <TableCell>{movement.sourceLocation?.name ?? movement.supplier?.name ?? "—"} <span className="text-[var(--color-text-muted)]">→</span> {target}</TableCell>
                <TableCellNum>{litersText(movement.quantity)}</TableCellNum>
                <TableCell>
                  {movement.documentNumber ? <span className="mr-2 font-mono text-xs">{movement.documentNumber}</span> : null}
                  {href
                    ? <Link className="inline-flex min-h-6 items-center gap-1 text-[var(--color-primary-ink)] hover:underline" href={href}>Abrir carga <ArrowSquareOut size={14} aria-hidden /></Link>
                    : movement.documentNumber ? null : <span className="inline-flex min-h-6 items-center gap-1 text-[var(--color-text-muted)]"><WarningCircle size={14} aria-hidden />Sin documento</span>}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
