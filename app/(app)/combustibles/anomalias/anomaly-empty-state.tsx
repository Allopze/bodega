import Link from "next/link"
import { FunnelSimple, ShieldCheck } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * Lista de casos vacía. Dos situaciones que piden cosas distintas (regla A4):
 *
 * - `filtered`: hay filtros puestos y ninguno coincide; la salida es quitarlos.
 * - sin filtros: no hay un solo caso. Se explica qué hace que aparezca uno (una
 *   regla de control) y se lleva a donde se ajustan, o a las cargas si quien
 *   mira no puede administrar reglas.
 */
export function AnomalyEmptyState({ filtered, canManageRules }: { filtered: boolean; canManageRules: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        icon={<FunnelSimple size={24} />}
        title="Ningún caso coincide con los filtros"
        description="Prueba con otra faena, estado o severidad, o quita los filtros para ver todos los casos."
        action={<Button asChild variant="secondary" size="sm"><Link href="/combustibles/anomalias">Limpiar filtros</Link></Button>}
      />
    )
  }
  return (
    <EmptyState
      icon={<ShieldCheck size={24} />}
      tone="success"
      title="Aún no hay anomalías de combustible"
      description="Un caso aparece cuando una carga rompe una regla de control, por ejemplo un medidor que retrocede, litros sobre la capacidad del estanque o un sello repetido. Todavía no se ha detectado ninguno."
      action={canManageRules
        ? <Button asChild variant="secondary" size="sm"><Link href="/combustibles/anomalias/reglas">Ver reglas</Link></Button>
        : <Button asChild variant="secondary" size="sm"><Link href="/combustibles/bitacora">Ver cargas</Link></Button>}
    />
  )
}
