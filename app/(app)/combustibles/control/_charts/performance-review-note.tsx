import Link from "next/link"

/**
 * Cuántas cargas en revisión quedan FUERA del promedio y la desviación que se
 * muestran. Una cifra de rendimiento sin este aviso parece completa cuando no lo
 * es; el enlace lleva a la cola de revisión con los mismos filtros.
 */
export function ReviewExclusionNote({ count, href, className }: { count: number; href: string; className?: string }) {
  return (
    <p className={`text-xs text-[var(--color-text-muted)] ${className ?? ""}`}>
      {count > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-[var(--color-text)]">{count.toLocaleString("es-CL")}</span>
          {count === 1 ? " carga en revisión no entra" : " cargas en revisión no entran"} al promedio.{" "}
          <Link href={href} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2 hover:no-underline">
            Revisarlas
          </Link>
        </>
      ) : (
        "Ninguna carga en revisión queda fuera del promedio."
      )}
    </p>
  )
}
