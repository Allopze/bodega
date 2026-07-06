"use client"

export function WarehouseHeaderMetrics({
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  lowStockCount,
  movementCount,
}: {
  worksiteCount: number
  worksitesWithStock: number
  productsWithStock: number
  lowStockCount: number
  movementCount: number
}) {
  const stats: Array<{ label: string; value: string; tone?: "signal" }> = [
    { label: "Faenas con stock", value: `${worksitesWithStock}/${worksiteCount}` },
    { label: "Productos activos", value: productsWithStock.toLocaleString("es-CL") },
    { label: "Bajo mínimo", value: lowStockCount.toLocaleString("es-CL"), tone: lowStockCount > 0 ? "signal" : undefined },
    { label: "Movimientos", value: movementCount.toLocaleString("es-CL") },
  ]

  return (
    <div className="flex items-center gap-3 whitespace-nowrap text-xs">
      {stats.map((stat, i) => (
        <div key={stat.label} className="flex items-center gap-2">
          {i > 0 && (
            <span className="text-[var(--color-border-strong)]" aria-hidden>·</span>
          )}
          <span className="text-[var(--color-text-muted)]">{stat.label}</span>
          <span
            className={[
              "font-mono font-semibold tabular-nums",
              stat.tone === "signal" ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]",
            ].join(" ")}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  )
}
