"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { MagnifyingGlass, ArrowRight } from "@phosphor-icons/react"
import { NAV_ICONS } from "@/components/layout/nav-icons"
import type { NavTarget } from "@/components/layout/nav-items"
import { Button } from "@/components/ui/button"
import { resolveNotFound } from "@/lib/routing/not-found-suggestion"

/** Módulos que se ofrecen cuando la ruta no dice nada sobre dónde quería ir. */
const FALLBACK_LIMIT = 6

/**
 * Cuerpo de la pantalla 404.
 *
 * Es cliente por una sola razón: `not-found.tsx` no recibe la ruta que falló, y
 * `usePathname()` es la vía que documenta Next para leerla. Los destinos llegan
 * por prop desde el servidor, ya filtrados por permiso y módulos habilitados.
 */
export function NotFoundPanel({ targets }: { targets: NavTarget[] }) {
  const suggestion = resolveNotFound(usePathname(), targets)

  const { title, description } =
    suggestion.kind === "record"
      ? {
          title: "No encontramos este registro",
          description: `El registro que buscas no existe, fue eliminado o está fuera del alcance de tus faenas. Vuelve al listado de ${suggestion.target.label} para retomar el trabajo.`,
        }
      : suggestion.kind === "typo"
        ? {
            title: "Esta dirección no existe",
            description: `Revisa el enlace o el favorito que te trajo hasta aquí. ¿Quisiste decir ${suggestion.target.label}?`,
          }
        : {
            title: "Recurso no encontrado",
            description: "La página o el registro que buscas no existe, cambió de dirección o fue eliminado. Retoma el trabajo desde uno de los módulos:",
          }

  // /dashboard nunca necesita dos botones: sería el mismo destino dos veces.
  const primary = suggestion.kind === "unknown" || suggestion.target.href === "/dashboard"
    ? null
    : suggestion.target

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
        <MagnifyingGlass size={22} />
      </div>
      <p className="mt-5 font-mono text-xs uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">Error 404</p>
      <h1 className="mt-1 text-h1 text-[var(--color-text)]">{title}</h1>
      <p className="mt-2 max-w-[60ch] text-sub">{description}</p>

      {suggestion.kind === "unknown" && targets.length > 0 ? (
        <div className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius-2xl)] bg-[var(--color-border)] sm:grid-cols-2">
          {targets.slice(0, FALLBACK_LIMIT).map((target) => {
            const Icon = NAV_ICONS[target.iconName] ?? MagnifyingGlass
            return (
              <Link
                key={target.href}
                href={target.href}
                data-pressable
                className="group flex items-center gap-3 bg-[var(--color-surface)] p-4 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]">
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--color-text)]">{target.label}</span>
                  {/* Un módulo que es su propia área ("Mis pendientes") no se repite a sí mismo. */}
                  {target.areaLabel !== target.label && (
                    <span className="block truncate text-xs text-[var(--color-text-subtle)]">{target.areaLabel}</span>
                  )}
                </span>
                <ArrowRight size={15} className="shrink-0 text-[var(--color-text-faint)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]" />
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap gap-3">
          {primary && (
            <Button asChild>
              <Link href={primary.href}>
                {suggestion.kind === "record" ? `Volver a ${primary.label}` : `Ir a ${primary.label}`}
              </Link>
            </Button>
          )}
          <Button asChild variant={primary ? "secondary" : "primary"}>
            <Link href="/dashboard">Ir al inicio</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
