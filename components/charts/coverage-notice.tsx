import Link from "next/link"
import { CalendarX } from "@phosphor-icons/react/dist/ssr"
import { coverageNoticeText, type CoverageNoticeInput } from "@/lib/combustibles/coverage-notice"
import { cn } from "@/lib/utils"

/**
 * Aviso de cobertura de datos de un gráfico de combustible o de integraciones: en una
 * línea, qué meses de la ventana del gráfico no tienen datos del proveedor o están
 * incompletos, y qué cifras quedan cortas por eso. Es el estado que «Fuentes de datos»
 * dibuja como mapa (CHART-022), dicho donde se lee el número.
 *
 * **Una sola representación (A5).** Es el único lugar donde una pantalla dice «sin datos
 * del proveedor»: no se repite en el subtítulo del gráfico, en el detalle de un tile ni en
 * una nota al pie. El gráfico marca el hueco (columna tenue, línea cortada); este aviso lo
 * nombra. La redacción sale de `coverageNoticeText`, la misma que la hoja «Metadatos» de las
 * exportaciones, así que pantalla y archivo no se contradicen.
 *
 * - `subject` dice, en plural, qué cifras de la pantalla dependen del proveedor («los
 *   totales de 12 meses», «las cifras de tarjeta Copec»). Es obligatorio: la frase tiene que
 *   ser cierta de lo que ese gráfico muestra, y sólo quien lo dibuja lo sabe.
 * - `sourcesHref` lleva a «Fuentes de datos» (`fuelSourcesHref(session)`); sin él —quien no
 *   puede abrir esa pantalla— el aviso queda sin enlace en vez de apuntar a `/forbidden`.
 * - Sin meses que advertir no pinta nada: la ausencia de aviso es la buena noticia.
 *
 * Componente de servidor. El ícono es decorativo: el estado lo dice el texto (regla de
 * accesibilidad: nunca sólo color o ícono), y los tokens son `-ink` porque es texto.
 */
export interface CoverageNoticeProps extends CoverageNoticeInput {
  sourcesHref?: string
  className?: string
}

export function CoverageNotice({ sourcesHref, className, ...input }: CoverageNoticeProps) {
  const text = coverageNoticeText(input)
  if (!text) return null
  return (
    <p data-coverage-notice="" className={cn("flex items-start gap-1.5 text-xs text-[var(--color-text-muted)] text-pretty", className)}>
      <CalendarX size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-[var(--color-warning-ink)]" />
      <span className="min-w-0">
        {text}
        {sourcesHref && (
          <>
            {" "}
            <Link href={sourcesHref} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2 hover:no-underline">
              Ver cobertura de las fuentes
            </Link>
          </>
        )}
      </span>
    </p>
  )
}
