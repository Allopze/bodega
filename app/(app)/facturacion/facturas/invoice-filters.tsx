"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { X } from "@phosphor-icons/react"
import { formatPeriodOption, recentPeriods } from "@/components/ui/period-picker"

/**
 * Filtros del listado de facturas.
 *
 * Van en la URL porque definen QUÉ conjunto se está mirando: eso hace el
 * resultado compartible, enlazable desde el resumen y sobreviviente a un
 * refresco. Cada filtro aplicado se muestra como chip removible para que nadie
 * lea una tabla filtrada creyendo que la ve completa.
 */
export function InvoiceFiltersBar({ clients }: { clients: { id: string; name: string; rut: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    // Cambiar un filtro invalida la página actual.
    params.delete("pagina")
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  const activeChips = [
    chip("periodo", "Período", searchParams.get("periodo")),
    chip("cliente", "Cliente", clients.find((client) => client.id === searchParams.get("cliente"))?.name ?? null),
    chip("pago", "Estado de pago", PAYMENT_LABELS[searchParams.get("pago") ?? ""] ?? null),
    chip("documento", "Estado documental", DOCUMENT_LABELS[searchParams.get("documento") ?? ""] ?? null),
    chip("fuente", "Fuente", SOURCE_LABELS[searchParams.get("fuente") ?? ""] ?? null),
    chip("vencidas", "Solo vencidas", searchParams.get("vencidas") === "1" ? "Sí" : null),
    chip("q", "Búsqueda", searchParams.get("q")),
  ].filter((entry): entry is { key: string; label: string; value: string } => entry !== null)

  return (
    <section aria-label="Filtros" className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Período">
          {/* Select propio en vez de <input type="month">: el nativo muestra
              "August 2026" o "-------- ----" según el locale del navegador
              (UI/UX 2026-08-05, M8). */}
          <select
            defaultValue={searchParams.get("periodo") ?? ""}
            onChange={(event) => setParam("periodo", event.target.value)}
            className={inputClass}
            aria-label="Período de emisión"
          >
            <option value="">Todos</option>
            {recentPeriods(24).map((value) => (
              <option key={value} value={value}>{formatPeriodOption(value)}</option>
            ))}
          </select>
        </Field>

        <Field label="Cliente">
          <select
            value={searchParams.get("cliente") ?? ""}
            onChange={(event) => setParam("cliente", event.target.value)}
            className={inputClass}
          >
            <option value="">Todos</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Estado de pago">
          <select
            value={searchParams.get("pago") ?? ""}
            onChange={(event) => setParam("pago", event.target.value)}
            className={inputClass}
          >
            <option value="">Todos</option>
            {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>

        <Field label="Estado documental">
          <select
            value={searchParams.get("documento") ?? ""}
            onChange={(event) => setParam("documento", event.target.value)}
            className={inputClass}
          >
            <option value="">Vigentes (excluye anuladas)</option>
            {Object.entries(DOCUMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>

        <Field label="Fuente">
          <select
            value={searchParams.get("fuente") ?? ""}
            onChange={(event) => setParam("fuente", event.target.value)}
            className={inputClass}
          >
            <option value="">Todas</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>

        <Field label="Folio o RUT">
          <input
            type="search"
            defaultValue={searchParams.get("q") ?? ""}
            placeholder="Ej: 1234 o 76543210-K"
            onKeyDown={(event) => {
              if (event.key === "Enter") setParam("q", event.currentTarget.value)
            }}
            onBlur={(event) => setParam("q", event.target.value)}
            className={inputClass}
          />
        </Field>

        <label className="flex items-center gap-2 pb-1.5 text-sm text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={searchParams.get("vencidas") === "1"}
            onChange={(event) => setParam("vencidas", event.target.checked ? "1" : "")}
            className="size-4 rounded border-[var(--color-border)]"
          />
          Solo vencidas
        </label>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Filtros aplicados:</span>
          {activeChips.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setParam(entry.key, "")}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text)] hover:border-[var(--color-primary)]"
            >
              <span className="text-[var(--color-text-muted)]">{entry.label}:</span> {entry.value}
              <X size={12} aria-label={`Quitar filtro ${entry.label}`} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => startTransition(() => router.push(pathname))}
            className="text-xs font-medium text-[var(--color-primary-ink)] underline underline-offset-2"
          >
            Quitar todos
          </button>
        </div>
      )}
    </section>
  )
}

const inputClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"

const PAYMENT_LABELS: Record<string, string> = {
  unpaid:   "Pendiente de pago",
  partial:  "Pago parcial",
  paid:     "Pagada",
  overpaid: "Pagada de más",
}

const DOCUMENT_LABELS: Record<string, string> = {
  accepted: "Aceptada por el SII",
  issued:   "Emitida",
  rejected: "Rechazada por el SII",
  draft:    "Pendiente de envío",
  void:     "Anulada",
  unknown:  "Sin estado",
}

const SOURCE_LABELS: Record<string, string> = {
  factura_en_linea: "FacturaEnLínea",
  chipax:           "Chipax",
  manual:           "Carga manual",
}

function chip(key: string, label: string, value: string | null) {
  return value ? { key, label, value } : null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-text-muted)]">{label}</span>
      {children}
    </label>
  )
}
