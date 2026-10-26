import { cn, formatPercent } from "@/lib/utils"

/*
 * Medidor de marcas radiales: un semicírculo de rayitas en vez de un arco
 * continuo. Las marcas llenas dicen cuánto se avanzó; dos más largas dicen
 * dónde se debería ir (esperado al período) y a dónde se quiere llegar (meta).
 * Con un arco liso esas dos referencias eran un trazo más sobre la misma
 * curva y no se distinguían.
 *
 * SVG puro, sin recharts ni hooks: se renderiza en el servidor y la entrada es
 * una animación CSS (`tick-in`) que `motion-safe:` apaga sola.
 */

const TICKS = 41
const W = 300
const H = 186
const CX = W / 2
const CY = H - 8
const RADIUS = W * 0.44
const TICK_LEN = 16
const MARKER_LEN = 26

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value))
}

/** Índice de la marca más cercana a un porcentaje (0-100). */
function nearestTick(percent: number) {
  return Math.round((clampPercent(percent) / 100) * (TICKS - 1))
}


type TickKind = "fill" | "expected" | "target" | "rest"

function tickColor(kind: TickKind) {
  switch (kind) {
    case "fill": return "var(--color-primary)"
    case "expected": return "var(--color-text)"
    case "target": return "var(--color-text-subtle)"
    default: return "var(--color-border-strong)"
  }
}

export function RadialTickGauge({
  percent,
  expectedPercent,
  targetPercent,
  caption = "avance real",
  className,
}: {
  /** Avance real, 0-100. `null` cuando no hay programa vigente que medir. */
  percent: number | null
  /** Avance que correspondería al período transcurrido; omitido, no se dibuja. */
  expectedPercent?: number | null
  targetPercent: number
  /** Rótulo bajo la cifra; con `percent === null` lo reemplaza "Sin programa vigente". */
  caption?: string
  className?: string
}) {
  // Se muestra el valor tal cual llega; sólo la geometría se acota a 0-100.
  const value = typeof percent === "number" && Number.isFinite(percent) ? percent : null
  const expected = typeof expectedPercent === "number" && Number.isFinite(expectedPercent) ? expectedPercent : null
  const expectedIndex = expected !== null ? nearestTick(expected) : -1
  const targetIndex = nearestTick(targetPercent)
  // Por debajo de lo esperado la cifra se pinta de alerta; sin referencia no hay con qué comparar.
  const behind = value !== null && expected !== null && value < expected

  const label = [
    value !== null ? `Avance ${formatPercent(value)}` : "Sin programa vigente",
    expected !== null ? `esperado ${formatPercent(expected)}` : null,
    `meta ${formatPercent(targetPercent)}`,
  ].filter(Boolean).join("; ")

  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const p = (i / (TICKS - 1)) * 100
    const angle = Math.PI * (1 - p / 100)
    // Si esperado y meta caen en la misma marca gana el esperado: es el que
    // se compara con la cifra, y la meta ya figura en la leyenda.
    const marker: "expected" | "target" | null = i === expectedIndex ? "expected" : i === targetIndex ? "target" : null
    const len = marker ? MARKER_LEN : TICK_LEN
    const kind: TickKind = value !== null && value > 0 && p <= clampPercent(value) ? "fill" : (marker ?? "rest")
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return { i, marker, kind, x1: CX + (RADIUS - len) * cos, y1: CY - (RADIUS - len) * sin, x2: CX + RADIUS * cos, y2: CY - RADIUS * sin }
  })

  return (
    <div className={cn("w-full", className)}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="mx-auto block overflow-visible"
        style={{ maxWidth: W }}
      >
        {ticks.map((tick) => (
          <line
            key={tick.i}
            data-tick=""
            data-marker={tick.marker ?? undefined}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tickColor(tick.kind)}
            strokeWidth={tick.marker ? 3 : 2.6}
            strokeLinecap="round"
            className="motion-safe:animate-[tick-in_.45s_var(--ease-out)_both]"
            style={{ animationDelay: `${tick.i * 14}ms` }}
          />
        ))}
        <text
          x={CX}
          y={CY - 22}
          textAnchor="middle"
          fontSize={34}
          fontWeight={600}
          fill={behind ? "var(--color-danger-ink)" : "var(--color-text)"}
          style={{ fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums" }}
        >
          {value !== null ? formatPercent(value) : "—"}
        </text>
        <text x={CX} y={CY - 2} textAnchor="middle" fontSize={12} fill="var(--color-text-muted)" style={{ fontFamily: "var(--font-sans)" }}>
          {value !== null ? caption : "Sin programa vigente"}
        </text>
      </svg>
      <p className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1.5 text-xs text-[var(--color-text-muted)]">
        {expected !== null && (
          <>
            <span>Esperado al período <b className="font-semibold text-[var(--color-text)]">{formatPercent(expected)}</b></span>
            {/* Los espacios no se ven en el flex, pero hacen legible el texto copiado y el de lectores. */}
            {" "}<span aria-hidden>·</span>{" "}
          </>
        )}
        <span>Meta <b className="font-semibold text-[var(--color-text)]">{formatPercent(targetPercent)}</b></span>
      </p>
    </div>
  )
}
