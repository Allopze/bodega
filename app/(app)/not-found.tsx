import Link from "next/link"
import {
  MagnifyingGlass, House, ClipboardText, ShoppingCart,
  Truck, Warehouse, ChartBar, ArrowRight,
} from "@phosphor-icons/react/dist/ssr"
import { PageContainer } from "@/components/ui/page-container"

const RECOVERY_LINKS = [
  { href: "/dashboard",   label: "Dashboard",          description: "Resumen y cola de trabajo",   icon: <House size={18} /> },
  { href: "/solicitudes", label: "Solicitudes",        description: "Repuestos, servicios y EPP",  icon: <ClipboardText size={18} /> },
  { href: "/compras",     label: "Órdenes de compra",  description: "Generación y seguimiento",    icon: <ShoppingCart size={18} /> },
  { href: "/recepcion",   label: "Recepción",          description: "Ingreso de mercadería",       icon: <Truck size={18} /> },
  { href: "/bodega",      label: "Bodega",             description: "Stock, kardex y devoluciones", icon: <Warehouse size={18} /> },
  { href: "/reportes",    label: "Reportes",           description: "Resumen y exportaciones",     icon: <ChartBar size={18} /> },
]

export default function NotFound() {
  return (
    <PageContainer width="form">
      <div className="mx-auto max-w-2xl py-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
          <MagnifyingGlass size={22} />
        </div>
        <p className="mt-5 font-mono text-xs uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">Error 404</p>
        <h1 className="mt-1 text-h1 text-[var(--color-text)]">Recurso no encontrado</h1>
        <p className="mt-2 max-w-[60ch] text-sub">
          La página o el registro que buscas no existe, cambió de dirección o fue eliminado.
          Retoma el trabajo desde uno de los módulos:
        </p>

        <div className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius-2xl)] bg-[var(--color-border)] sm:grid-cols-2">
          {RECOVERY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-pressable
              className="group flex items-center gap-3 bg-[var(--color-surface)] p-4 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]">
                {link.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-text)]">{link.label}</span>
                <span className="block truncate text-xs text-[var(--color-text-subtle)]">{link.description}</span>
              </span>
              <ArrowRight size={15} className="shrink-0 text-[var(--color-text-faint)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]" />
            </Link>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
