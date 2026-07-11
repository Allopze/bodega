import Link from "next/link"
import {
  Truck,
  GasPump,
  Wrench,
  ArrowRight,
} from "@phosphor-icons/react/ssr"
import type { Permission } from "@/modules/permissions"

const LINKS = [
  {
    title:       "Vehículos",
    description: "Crear, editar y dar de baja vehículos asociados a faenas.",
    href:        "/admin/flota-catalogos/vehiculos",
    icon:        Truck,
    permission:  "combustibles:manage_vehicles" satisfies Permission,
  },
  {
    title:       "Proveedores de combustible",
    description: "Mantén el listado maestro de proveedores y sus condiciones.",
    href:        "/admin/flota-catalogos/proveedores-combustible",
    icon:        GasPump,
    permission:  "combustibles:manage_suppliers" satisfies Permission,
  },
  {
    title:       "Viajes y consumo",
    description: "Resumen operacional de viajes, combustible y kilómetros.",
    href:        "/flota",
    icon:        Truck,
    permission:  "combustibles:view" satisfies Permission,
  },
  {
    title:       "Mantenciones",
    description: "Programa y rastrea las mantenciones de vehículos y equipos.",
    href:        "/mantenciones",
    icon:        Wrench,
    permission:  "mantenciones:view" satisfies Permission,
  },
] as const

export function CatalogLinks({ permissions }: { permissions: string[] }) {
  const visibleLinks = LINKS.filter((link) => permissions.includes(link.permission))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
      {visibleLinks.map((link) => {
        const Icon = link.icon
        return (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-start gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] transition-[background-color,transform] duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
          >
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)] group-hover:bg-[var(--color-primary-tint)] group-hover:text-[var(--color-primary)]">
              <Icon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                {link.title}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-muted)]">
                {link.description}
              </span>
            </span>
            <ArrowRight size={14} className="mt-2 shrink-0 text-[var(--color-text-faint)] group-hover:text-[var(--color-primary)] group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )
      })}
    </div>
  )
}
