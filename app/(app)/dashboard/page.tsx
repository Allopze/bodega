import type { Metadata } from "next"
import { auth } from "@/lib/auth/auth"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import {
  ClipboardText, CheckSquare, ShoppingCart, Receipt,
  WarningCircle, Package,
} from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Dashboard" }

// Role-aware pending summary cards — data wired in Phase 8
const PENDING_CARDS: Record<string, { title: string; description: string; icon: React.FC<{ size: number; className?: string }> }[]> = {
  solicitante: [
    { title: "Mis solicitudes activas",   description: "Solicitudes que creaste pendientes de resolución", icon: ClipboardText },
  ],
  jefe_faena: [
    { title: "Pendientes de aprobación",  description: "Solicitudes de tu faena esperando tu decisión",   icon: CheckSquare   },
    { title: "Ítems aprobados sin compra", description: "Ítems que aprobaste y aún no están en una OC",  icon: WarningCircle  },
  ],
  compras: [
    { title: "Ítems aprobados pendientes",  description: "Ítems listos para incluir en una OC",          icon: ShoppingCart   },
    { title: "Órdenes de compra en curso",  description: "OC emitidas esperando confirmación o recepción", icon: Package      },
  ],
  recepcion: [
    { title: "OC pendientes de recepción", description: "Órdenes confirmadas que deben registrarse",     icon: Package        },
  ],
  finanzas: [
    { title: "Facturas pendientes",        description: "Facturas registradas esperando conciliación",    icon: Receipt        },
    { title: "Facturas observadas",        description: "Facturas con diferencias que requieren resolución", icon: WarningCircle },
  ],
  administrador: [
    { title: "Ítems pendientes (global)", description: "Todos los ítems aprobados no comprados en el sistema", icon: WarningCircle },
  ],
  gerencia: [
    { title: "Solicitudes abiertas",       description: "Vista ejecutiva del flujo de abastecimiento",   icon: ClipboardText  },
  ],
}

export default async function DashboardPage() {
  const session = await auth()
  const primaryRole = session?.user.roles?.[0] ?? "solicitante"
  const cards = PENDING_CARDS[primaryRole] ?? PENDING_CARDS.solicitante

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Bienvenido, ${session?.user.name?.split(" ")[0] ?? "usuario"}`}
      />

      {/* Pending summary — empty state until Phase 8 data */}
      <div className="grid gap-px bg-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
        {cards.map(({ title, description, icon: Icon }) => (
          <div key={title} className="bg-[var(--color-surface)] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] flex items-center justify-center shrink-0">
                <Icon size={16} className="text-[var(--color-text-subtle)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
              </div>
              <div className="ml-auto font-mono text-lg font-semibold text-[var(--color-text-subtle)]">
                —
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <EmptyState
          icon={<ClipboardText size={22} />}
          title="Datos disponibles en Fase 8"
          description="Los conteos de pendientes y el dashboard operativo se implementan en la Fase 8 (reportes). La estructura del layout y el sistema de badges están listos."
          compact
        />
      </div>
    </>
  )
}
