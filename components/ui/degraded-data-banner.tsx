/**
 * Aviso de degradación parcial (CO-037): cuando una o más fuentes de una
 * página cayeron a su fallback, la página sigue rindiendo (no se cae entera),
 * pero mostrar ceros/listas vacías como si fueran el dato real es peor que
 * avisar. El logger ya registra cada falla server-side con su label; este
 * banner es la señal visible para quien mira la pantalla.
 */
export function DegradedDataBanner({ degraded, total }: { degraded: string[]; total: number }) {
  if (degraded.length === 0) return null
  return (
    <div role="alert" className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm">
      <p className="text-[var(--color-warning-ink)]">
        {`Algunos datos no pudieron cargarse (${degraded.length} de ${total} fuentes). Reintenta o contacta soporte.`}
      </p>
    </div>
  )
}
