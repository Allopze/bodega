/**
 * «Excluye uso personal»: la nota del Panel cuando el período tiene días de uso personal de
 * algún equipo del alcance. Los litros y el rendimiento de los gráficos no cuentan esos días
 * (la cuadratura y los pagos sí los ven enteros); sin la nota, una cifra menor a la de la
 * factura parecería un error. Sin días, no hay nada que avisar y no se dibuja.
 */
export function PersonalUseNote({ days }: { days: number }) {
  if (days <= 0) return null
  return (
    <p
      className="mb-4 text-sm text-[var(--color-text-muted)]"
      title="Los días en que un equipo estuvo con su dueño no suman en los litros ni en el rendimiento de los gráficos. Se marcan en la ficha del equipo."
    >
      Excluye uso personal
    </p>
  )
}
