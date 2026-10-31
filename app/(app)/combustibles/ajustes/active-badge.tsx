import { Badge } from "@/components/ui/badge"

/** Estado de un registro de catálogo: Activo / Inactivo (A6: nunca el booleano crudo). */
export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="success">Activo</Badge> : <Badge variant="neutral">Inactivo</Badge>
}
