import Link from "next/link"
import { formatQty } from "@/lib/utils"

/**
 * Cuántas cargas por decidir quedan FUERA del promedio y la variación que se
 * muestran. Una cifra de rendimiento sin este aviso parece completa cuando no
 * lo es; el enlace lleva a «Por revisar» para decidirlas.
 */
export function ReviewExclusionNote({ count, href, className }: { count: number; href: string; className?: string }) {
  return (
    <p className={`text-xs text-[var(--color-text-muted)] ${className ?? ""}`}>
      {count > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-[var(--color-text)]">{formatQty(count)}</span>
          {count === 1 ? " carga por decidir no entra" : " cargas por decidir no entran"} al promedio.{" "}
          <Link href={href} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2 hover:no-underline">
            Revisarlas
          </Link>
        </>
      ) : (
        "Ninguna carga por decidir queda fuera del promedio."
      )}
    </p>
  )
}
