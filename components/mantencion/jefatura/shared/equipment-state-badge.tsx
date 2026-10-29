import { MetaBadge } from "@/components/states/state-badge"
import type { BadgeProps } from "@/components/ui/badge"
import { EQUIPMENT_STATE_LABEL } from "@/lib/mantencion/format"
import type { MantEquipmentState } from "@/lib/mantencion/types"

/**
 * Estado de mantención de un equipo como etiqueta (regla 6). Colores de los
 * tokens de la plataforma (decisión D9): vencida = danger, próxima = warning,
 * al día = success, y los estados sin dato quedan en neutro. El estado SIEMPRE
 * va con su texto: el color nunca es la única señal.
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

export function EquipmentStateBadge({ state }: { state: MantEquipmentState }) {
  return <MetaBadge meta={{ label: EQUIPMENT_STATE_LABEL[state], variant: VARIANT[state] }} size="sm" />
}
