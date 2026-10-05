"use client"

import Link from "next/link"
import { IT_TICKET_STATUS_META } from "@/lib/services/ti/constants"
import { IT_TICKET_STATUSES } from "@/lib/validation/ti"

/**
 * Pastillas de estado con el total de cada uno. Los contadores llegan del
 * servidor sin aplicar el filtro de estado, así que no se vacían al filtrar.
 * `<Link scroll={false}>` en vez de `<a href>`: cambiar de filtro no debe
 * recargar la página ni perder la posición de scroll.
 */
export function TicketStatusPills({
  current,
  counts,
  query,
}: {
  current: string
  counts: Record<string, number>
  query: Record<string, string | string[] | undefined>
}) {
  function hrefFor(status: string) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      // Cambiar de estado cambia el conjunto: la página que se miraba ya no vale.
      if (k !== "estado" && k !== "pagina" && typeof v === "string" && v) params.set(k, v)
    }
    if (status) params.set("estado", status)
    const qs = params.toString()
    return qs ? `/ti/tickets?${qs}` : "/ti/tickets"
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

  const allOptions: { value: string; label: string; count: number }[] = [
    { value: "", label: "Todos", count: total },
    // Los ocho estados, no seis: `en_diagnostico` y `esperando_proveedor`
    // quedaban sin pastilla y solo se alcanzaban desde "Todos".
    ...IT_TICKET_STATUSES.map((status) => ({
      value: status,
      label: IT_TICKET_STATUS_META[status]?.label ?? status,
      count: counts[status] ?? 0,
    })),
  ]

  // Una pastilla en 0 no lleva a ninguna parte: se oculta, salvo «Todos» y la
  // que está activa (si no, quien llegó por un enlace no vería dónde está).
  const options = allOptions.filter((option) => option.value === "" || option.value === current || option.count > 0)

  return (
    <nav aria-label="Filtrar por estado" className="mb-4 flex flex-wrap gap-2">
      {options.map((option) => {
        const active = current === option.value
        return (
          <Link
            key={option.value || "todos"}
            href={hrefFor(option.value)}
            scroll={false}
            // Es un filtro, no navegación entre páginas: `page` anunciaba
            // «página actual» donde no hay páginas.
            aria-current={active ? "true" : undefined}
            // 44 px de alto en móvil; en escritorio conserva la densidad.
            className={`inline-flex min-h-11 items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors sm:min-h-0 ${
              active
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {option.label} ({option.count})
          </Link>
        )
      })}
    </nav>
  )
}
