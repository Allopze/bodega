import type { Session } from "next-auth"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderRejections, fuelProviderTransactions, fuelReconciliationLinks } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { resolveFuelPeriod } from "@/lib/combustibles/period/parse"
import { getFuelSourceStatuses, summarizeFuelSources, type FuelSourceStatus } from "@/lib/combustibles/sources-status"
import { logger } from "@/lib/logger"

/**
 * Estado compacto de las fuentes de combustible y de la conciliación, para la
 * tarjeta lateral del Panel operacional.
 *
 * La fuente de verdad es la misma de `/combustibles/fuentes`: no se reimplementa
 * el estado de cada importador ni sus permisos. La tarjeta sólo resume; el
 * detalle y las acciones viven en esa pantalla.
 */
export interface OperationalSourceHealthItem {
  key: string
  name: string
  status: FuelSourceStatus["status"]
  statusLabel: string
  problem: string | null
  problemLink?: { href: string; label: string }
}

export interface OperationalReconciliationHealth {
  unmatched: number
  ambiguous: number
  acceptedExceptions: number
  openRejections: number
}

export interface OperationalSourceHealth {
  ready: boolean
  total: number
  pending: OperationalSourceHealthItem[]
  lastUpdateAt: string | null
  reconciliation: OperationalReconciliationHealth | null
}

function toItem(source: FuelSourceStatus): OperationalSourceHealthItem {
  return {
    key: source.key,
    name: source.name,
    status: source.status,
    statusLabel: source.statusLabel,
    problem: source.problem,
    ...(source.problemLink ? { problemLink: source.problemLink } : {}),
  }
}

function lastUpdate(statuses: readonly FuelSourceStatus[]): string | null {
  const values = statuses
    .map((source) => source.lastUpdateAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  return values[values.length - 1] ?? null
}

export async function getOperationalReconciliationHealth(session: Session): Promise<OperationalReconciliationHealth> {
  const [links, rejections] = await Promise.all([
    db.select({
      unmatched: sql<number>`(count(*) filter (where ${fuelReconciliationLinks.status} = 'unmatched'))::int`,
      ambiguous: sql<number>`(count(*) filter (where ${fuelReconciliationLinks.status} = 'ambiguous'))::int`,
      acceptedExceptions: sql<number>`(count(*) filter (where ${fuelReconciliationLinks.status} = 'accepted_exception'))::int`,
    })
      .from(fuelReconciliationLinks)
      .innerJoin(fuelProviderTransactions, eq(fuelProviderTransactions.id, fuelReconciliationLinks.providerTransactionId))
      .where(and(worksiteScopeSql(session, fuelProviderTransactions.worksiteId))),
    db.select({ open: sql<number>`count(*)::int` })
      .from(fuelProviderRejections)
      .where(and(
        eq(fuelProviderRejections.status, "open"),
        worksiteScopeSql(session, fuelProviderRejections.worksiteId),
      )),
  ])

  return {
    unmatched: Number(links[0]?.unmatched ?? 0),
    ambiguous: Number(links[0]?.ambiguous ?? 0),
    acceptedExceptions: Number(links[0]?.acceptedExceptions ?? 0),
    openRejections: Number(rejections[0]?.open ?? 0),
  }
}

export async function getOperationalSourceHealth(
  session: Session,
  period: { from: string; to: string },
): Promise<OperationalSourceHealth | null> {
  if (!can(session, "combustibles:view")) return null

  const resolved = resolveFuelPeriod({
    searchParams: { desde: period.from, hasta: period.to },
    cookieValue: null,
    fallback: { kind: "range", from: period.from, to: period.to },
  })

  try {
    const [statuses, reconciliation] = await Promise.all([
      getFuelSourceStatuses(session, resolved),
      getOperationalReconciliationHealth(session).catch((error) => {
        logger.error("[control-operacional] conciliación de combustible falló", error)
        return null
      }),
    ])
    const summary = summarizeFuelSources(statuses)
    return {
      ready: statuses.length > 0 && summary.ready,
      total: statuses.length,
      pending: summary.pending.map(toItem),
      lastUpdateAt: lastUpdate(statuses),
      reconciliation,
    }
  } catch (error) {
    logger.error("[control-operacional] estado de fuentes de combustible falló", error)
    return {
      ready: false,
      total: 0,
      pending: [{
        key: "fuentes",
        name: "Fuentes de combustible",
        status: "pendiente",
        statusLabel: "No se pudo consultar",
        problem: "No se pudo consultar el estado de las fuentes.",
      }],
      lastUpdateAt: null,
      reconciliation: null,
    }
  }
}
