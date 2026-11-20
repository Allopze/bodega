import { Tooltip } from "@/components/ui/tooltip"

/**
 * «Excluye uso personal»: la nota del Panel cuando el período tiene días de uso personal de
 * algún equipo del alcance. Los litros y el rendimiento de los gráficos no cuentan esos días
 * (la cuadratura y los pagos sí los ven enteros); sin la nota, una cifra menor a la de la
 * factura parecería un error. Sin días, no hay nada que avisar y no se dibuja.
 *
 * El texto largo va en el `Tooltip` del design system con el aviso enfocable (`tabIndex={0}`), como la nota
 * de Control operacional: un `title` no llega por teclado ni por lector de pantalla.
 */
export function PersonalUseNote({ days }: { days: number }) {
  if (days <= 0) return null
  return (
    <p className="mb-4 text-sm text-[var(--color-text-muted)]">
      <Tooltip
        content="Los días en que un equipo estuvo con su dueño no suman en los litros ni en el rendimiento de los gráficos. Se marcan en la ficha del equipo."
        side="top"
      >
        <span tabIndex={0} className="underline decoration-dotted underline-offset-2">Excluye uso personal</span>
      </Tooltip>
    </p>
  )
}
