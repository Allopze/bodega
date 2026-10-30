import { MetaBadge } from "@/components/states/state-badge"
import type { BadgeProps } from "@/components/ui/badge"
import { EQUIPMENT_STATE_LABEL, plural } from "@/lib/mantencion/format"
import type { MantEquipmentState } from "@/lib/mantencion/types"

/**
 * Estado de mantención de un equipo como etiqueta (regla 6). Colores de los
 * tokens de la plataforma (decisión D9): vencida = danger, próxima = warning,
 * al día = success, y los estados sin dato quedan en neutro. El estado SIEMPRE
 * va con su texto: el color nunca es la única señal.
 *
 * Un equipo detenido en taller lleva primero «En taller · N días» (señal: es
 * trabajo pendiente) y después su estado de pauta, con el mismo estilo de
 * etiqueta. Antes «Al día» quedaba como lo principal en un camión con 15 días
 * en taller.
 *
 * La usan el panel, la lista y la ficha de equipos (L4) y la de registros.
 */
const VARIANT: Record<MantEquipmentState, NonNullable<BadgeProps["variant"]>> = {
  vencida: "danger",
  proxima: "warning",
  al_dia: "success",
  sin_lecturas: "neutral",
  sin_pauta: "neutral",
  baja: "outline",
}

export interface EquipmentWorkshopMark {
  /** Días corridos desde que entró a taller (0 = entró hoy; `null` = sin fecha de ingreso, datos heredados). */
  days: number | null
}

export function workshopBadgeLabel(workshop: EquipmentWorkshopMark): string {
  if (workshop.days === null) return "En taller"
  return workshop.days <= 0 ? "En taller · desde hoy" : `En taller · ${plural(workshop.days, "día", "días")}`
}

export function EquipmentStateBadge({ state, workshop }: { state: MantEquipmentState; workshop?: EquipmentWorkshopMark | null }) {
  const stateBadge = <MetaBadge meta={{ label: EQUIPMENT_STATE_LABEL[state], variant: VARIANT[state] }} size="sm" />
  if (!workshop) return stateBadge
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <MetaBadge meta={{ label: workshopBadgeLabel(workshop), variant: "signal" }} size="sm" />
      {stateBadge}
    </span>
  )
}
