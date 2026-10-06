import Link from "next/link"
import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { formatDateRelative } from "@/lib/utils"
import type { BodegaAttention } from "./attention"

export interface AttentionItem {
  key: string
  count: number
  label: string
  detail?: string
  href: string
}

/**
 * Lo que la bodega tiene que hacer, como enlaces a su subconjunto (BOD-03).
 *
 * Reglas de densidad: máximo 4 ítems (A1), cada uno oculto en 0, y si nada está
 * pendiente una sola línea tranquila — nunca cuatro ceros. Las guías
 * despachadas sin confirmar no alimentaban ninguna pantalla: aquí aparecen con
 * la antigüedad de la más vieja, que es lo que decide si es urgente.
 */
export function buildAttentionItems(
  attention: BodegaAttention,
  hrefs: { guides: string; epp: string; stockouts: string; drafts: string },
  { canViewGuides = true, canDeliver = true }: { canViewGuides?: boolean; canDeliver?: boolean } = {},
): AttentionItem[] {
  const items: AttentionItem[] = []

  if (canViewGuides && attention.guides.count > 0) {
    items.push({
      key: "guides",
      count: attention.guides.count,
      label: attention.guides.count === 1 ? "Guía por confirmar" : "Guías por confirmar",
      detail: attention.guides.oldestSince
        ? `la más antigua, ${formatDateRelative(attention.guides.oldestSince)}`
        : undefined,
      href: hrefs.guides,
    })
  }
  if (canDeliver && attention.eppToDeliver > 0) {
    items.push({
      key: "epp",
      count: attention.eppToDeliver,
      label: "EPP por entregar",
      detail: "recibido en faena, con stock",
      href: hrefs.epp,
    })
  }
  if (attention.stockoutsWithDemand > 0) {
    items.push({
      key: "stockouts",
      count: attention.stockoutsWithDemand,
      label: "Sin stock con demanda",
      detail: "en cero y con pedidos por llegar",
      href: hrefs.stockouts,
    })
  }
  const drafts = attention.countDrafts.reduce((sum, draft) => sum + draft.count, 0)
  if (drafts > 0) {
    const first = attention.countDrafts[0]
    items.push({
      key: "drafts",
      count: drafts,
      label: drafts === 1 ? "Conteo en borrador" : "Conteos en borrador",
      detail: attention.countDrafts.length === 1 && first ? first.worksiteName : `en ${attention.countDrafts.length} faenas`,
      href: hrefs.drafts,
    })
  }
  return items
}

export function BodegaAttentionStrip({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="mb-4 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <CheckCircle size={14} aria-hidden className="text-[var(--color-success-ink)]" />
        Nada pendiente en bodega
      </p>
    )
  }

  return (
    <nav aria-label="Pendientes de bodega" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.key} className="min-w-0 max-w-full">
            <Link
              href={item.href}
              scroll={false}
              className="group flex min-h-11 items-center gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-3 py-1.5 text-left transition-colors hover:border-[var(--color-signal-ink)] sm:min-h-10"
            >
              <span className="font-mono text-lg font-semibold tabular-nums text-[var(--color-signal-ink)]">
                {item.count.toLocaleString("es-CL")}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight text-[var(--color-text)]">{item.label}</span>
                {item.detail && (
                  <span className="block text-xs leading-tight text-[var(--color-text-muted)]">{item.detail}</span>
                )}
              </span>
              <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--color-text-subtle)] transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
