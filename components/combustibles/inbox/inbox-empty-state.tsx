import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { FuelInboxKind } from "@/lib/combustibles/inbox/types"
import { formatQty } from "@/lib/utils"

const KIND_COPY: Record<FuelInboxKind, { title: string; description: string }> = {
  carga: {
    title: "No hay cargas por decidir",
    description: "Una carga llega aquí cuando la plataforma duda de ella: un rendimiento atípico, una lectura menor a la anterior, litros sobre la capacidad del estanque, una posible duplicada, una fecha pasada o un equipo sin ficha.",
  },
  caso: {
    title: "No hay casos vigentes",
    description: "Un caso aparece cuando una carga rompe una regla de control, por ejemplo un sello repetido o un medidor que retrocede, y alguien debe investigarlo y cerrarlo.",
  },
  patente: {
    title: "No hay patentes sin vincular",
    description: "Una patente aparece cuando un reporte de tarjeta trae una que ningún equipo de la faena tiene: sus litros no cuentan en ningún equipo hasta que la vinculas.",
  },
  pedido: {
    title: "No hay pedidos de revisión",
    description: "Un pedido aparece cuando alguien, desde Cargas, pide que revisen una carga que le parece rara y deja una nota.",
  },
}

/**
 * Bandeja vacía, en palabras: qué significa, qué hacer y un enlace real (regla A4).
 * Distingue cuatro situaciones que piden cosas distintas: filtros puestos que no
 * coinciden con nada (quitarlos), un tipo sin nada (ver todo), «Decididas» vacía
 * (ver lo pendiente) y nada pendiente en absoluto (ir a Cargas o a lo decidido).
 */
export function InboxEmptyState({
  view,
  kind,
  filtered,
  clearHref,
  allHref,
  otherViewHref,
  cargasHref,
  followUp,
}: {
  view: "pendientes" | "decididas"
  kind?: FuelInboxKind
  /** Hay filtros de faena o de caso puestos. */
  filtered: boolean
  clearHref: string
  /** Mismo período y filtros, sin el tipo. */
  allHref: string
  /** La otra pestaña, con el mismo período. */
  otherViewHref: string
  cargasHref: string
  /** En «Por decidir» vacía: los casos abiertos, que viven en «En seguimiento». */
  followUp?: { count: number; href: string }
}) {
  if (filtered) {
    return (
      <EmptyState
        title="Nada coincide con los filtros"
        description="Prueba con otra faena o gravedad, o quita los filtros para ver todo lo que espera."
        action={<Button asChild variant="secondary" size="sm"><Link href={clearHref}>Limpiar filtros</Link></Button>}
      />
    )
  }
  if (view === "decididas") {
    return (
      <EmptyState
        title="Aún no hay decisiones en este período"
        description="Cuando alguien decida si una carga cuenta, cierre un caso, vincule una patente o revise un pedido, quedará aquí con su nota y la fecha. Desde aquí también se puede deshacer una decisión."
        action={<Button asChild variant="secondary" size="sm"><Link href={otherViewHref}>Ver lo pendiente</Link></Button>}
      />
    )
  }
  if (kind) {
    const copy = KIND_COPY[kind]
    return (
      <EmptyState
        tone="success"
        title={copy.title}
        description={`${copy.description} Mira también los otros tipos.`}
        action={<Button asChild variant="secondary" size="sm"><Link href={allHref}>Ver todo lo pendiente</Link></Button>}
      />
    )
  }
  // «Por decidir» sin nada: los casos abiertos no cuentan aquí, pero si existen son el siguiente lugar a mirar.
  const cases = followUp && followUp.count > 0 ? followUp : null
  return (
    <EmptyState
      tone="success"
      title="Nada espera una decisión"
      description="Aquí aparece lo que la plataforma no puede decidir sola: cargas dudosas, patentes sin vincular y pedidos de revisión. Los casos de las reglas de control están en «En seguimiento» y lo ya decidido, en «Decididas»."
      action={cases
        ? <Button asChild variant="secondary" size="sm"><Link href={cases.href}>{cases.count === 1 ? "Ver el caso en seguimiento" : `Ver los ${formatQty(cases.count, undefined, { maximumFractionDigits: 0 })} casos en seguimiento`}</Link></Button>
        : <Button asChild variant="secondary" size="sm"><Link href={cargasHref}>Ver las cargas del período</Link></Button>}
      secondaryAction={<Button asChild variant="ghost" size="sm"><Link href={otherViewHref}>Ver lo decidido</Link></Button>}
    />
  )
}
