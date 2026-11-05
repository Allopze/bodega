/**
 * Reparto por día del agregado mensual TCT de una patente reasignada.
 *
 * El informe TCT trae, por patente, el total del MES. Cuando el equipo cambió de
 * faena a mitad de mes ese total no se puede atribuir a una sola faena
 * (`plate-resolver.ts`), y el mes no podía cerrarse nunca (auditoría
 * 2026-11-05, § 9.3). Decisión del usuario (2026-11-05): repartir el total por
 * día. Cada transacción del detalle se atribuye a la faena —y al vehículo— que
 * la patente tenía asignada ESE día, y el total de cada faena es la suma de sus
 * transacciones.
 *
 * No se adivina nada:
 * - sin detalle por transacción no hay reparto (prorratear por días de
 *   calendario inventaría el consumo de cada faena);
 * - si un día no tiene asignación, tampoco: falta decidir a quién va esa carga;
 * - si el detalle no suma el total del mes (litros y monto, con tolerancia de
 *   redondeo), el detalle no describe el mismo consumo y no se reparte.
 * En cualquiera de esos casos la fila sigue pendiente, como antes.
 */

export interface DaySplitTransaction {
  /** Día civil de la carga (`YYYY-MM-DD…`). */
  sourceDate: string
  liters: number
  amount: number
}

export interface DaySplitPart {
  worksiteId: string
  vehicleId: string
  liters: number
  amount: number
  transactions: number
  /** Primer y último día con cargas de esta parte. */
  from: string
  to: string
}

export type DaySplitResult =
  | { ok: true; parts: DaySplitPart[] }
  | { ok: false; reason: string }

/** Tolerancia de litros: redondeo del proveedor por transacción, con piso de 0,5 L. */
function litersTolerance(total: number): number {
  return Math.max(0.5, Math.abs(total) * 0.001)
}

/** Tolerancia de monto: un peso por transacción, con piso del 0,1 % del total. */
function amountTolerance(total: number, transactions: number): number {
  return Math.max(transactions, Math.abs(total) * 0.001)
}

export function splitAggregateByDay(input: {
  aggregate: { cantidadUnidad: number; monto: number }
  transactions: readonly DaySplitTransaction[]
  resolveOnDay: (day: string) => { id: string; worksiteId: string } | undefined
}): DaySplitResult {
  const { aggregate, transactions } = input
  if (transactions.length === 0) return { ok: false, reason: "el informe no trae el detalle por transacción de esa patente" }

  const parts = new Map<string, DaySplitPart>()
  for (const transaction of [...transactions].sort((left, right) => left.sourceDate.localeCompare(right.sourceDate))) {
    const day = transaction.sourceDate.slice(0, 10)
    const vehicle = input.resolveOnDay(day)
    if (!vehicle) return { ok: false, reason: `el ${day} la patente no tiene faena asignada` }
    const key = `${vehicle.worksiteId}|${vehicle.id}`
    const part = parts.get(key) ?? { worksiteId: vehicle.worksiteId, vehicleId: vehicle.id, liters: 0, amount: 0, transactions: 0, from: day, to: day }
    part.liters += transaction.liters
    part.amount += transaction.amount
    part.transactions += 1
    part.to = day
    parts.set(key, part)
  }

  const liters = transactions.reduce((total, transaction) => total + transaction.liters, 0)
  const amount = transactions.reduce((total, transaction) => total + transaction.amount, 0)
  if (Math.abs(liters - aggregate.cantidadUnidad) > litersTolerance(aggregate.cantidadUnidad)) {
    return { ok: false, reason: `el detalle suma ${round(liters, 2)} L y el total del mes es ${round(aggregate.cantidadUnidad, 2)} L` }
  }
  if (Math.abs(amount - aggregate.monto) > amountTolerance(aggregate.monto, transactions.length)) {
    return { ok: false, reason: `el detalle suma $${Math.round(amount)} y el total del mes es $${Math.round(aggregate.monto)}` }
  }

  return {
    ok: true,
    parts: [...parts.values()]
      .map((part) => ({ ...part, liters: round(part.liters, 4), amount: round(part.amount, 2) }))
      .sort((left, right) => left.from.localeCompare(right.from) || left.worksiteId.localeCompare(right.worksiteId)),
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
