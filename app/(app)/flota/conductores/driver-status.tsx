import { Warning } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { ExpiryStatus } from "@/components/ui/expiry-status"
import { expiryState } from "@/lib/expiry"
import type { DriverRosterRow } from "@/lib/services/driver-licenses-contract"
import { DRIVER_LICENSE_CLASS_INFO, DRIVER_STATUS_LABEL, type DriverLicenseClass } from "@/lib/validation/driver-licenses"
import { cn } from "@/lib/utils"
import { driverStatusDetail } from "./drivers-view"

/**
 * La vigencia de una persona en una celda: pastilla + frase, nunca sólo color.
 *
 * Vencida, por vencer, vigente y sin fecha las pinta `ExpiryStatus` (la misma
 * pastilla que Flota y Mantención, para que «vence en 9 días» se lea igual en
 * toda la plataforma). Lo que `ExpiryStatus` no sabe decir son los dos estados
 * que no se miden en días —sin licencia y clase insuficiente—, que llevan su
 * propia pastilla con el mismo tamaño y la misma frase al costado.
 */
export function DriverVigencia({
  row,
  today,
  warningDays,
  className,
}: {
  row: Pick<DriverRosterRow, "status" | "expiry" | "requiredClasses" | "license">
  today: string
  warningDays: number
  className?: string
}) {
  const wrapper = cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)

  if (row.status === "sin_licencia") {
    return (
      <span className={wrapper}>
        <Badge variant="neutral" size="sm" className="shrink-0">
          <Warning size={12} weight="bold" aria-hidden />
          {DRIVER_STATUS_LABEL.sin_licencia}
        </Badge>
        <span className="text-xs text-[var(--color-text-muted)]">{driverStatusDetail(row)}</span>
      </span>
    )
  }

  if (row.status === "clase_insuficiente") {
    return (
      <span className={wrapper}>
        <Badge variant="warning" size="sm" className="shrink-0">
          <Warning size={12} weight="bold" aria-hidden />
          {DRIVER_STATUS_LABEL.clase_insuficiente}
        </Badge>
        <span className="text-xs text-[var(--color-text-muted)]">{driverStatusDetail(row)}</span>
      </span>
    )
  }

  return (
    <ExpiryStatus
      status={row.expiry ?? expiryState(null, today, warningDays)}
      warningDays={warningDays}
      layout="compact"
      // Una licencia se «vence»: el rótulo por defecto («Vencido») es el de un documento.
      label={row.status === "vencida" ? DRIVER_STATUS_LABEL.vencida : undefined}
      emptyText="Falta registrar la fecha"
      className={className}
    />
  )
}

/**
 * Las clases de la licencia como etiquetas mono. La etiqueta corta es lo que
 * se ve; el nombre completo (`A4: Transporte de carga simple…`) va en `title`
 * y en texto para lectores de pantalla, porque un `title` solo no llega al teclado
 * ni al teléfono.
 */
export function ClassTags({ classes, className }: { classes: readonly DriverLicenseClass[]; className?: string }) {
  if (classes.length === 0) {
    return (
      <span className={cn("text-[var(--color-text-subtle)]", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">Sin clases registradas</span>
      </span>
    )
  }
  return (
    <ul aria-label="Clases de licencia" className={cn("flex flex-wrap gap-1", className)}>
      {classes.map((code) => {
        const info = DRIVER_LICENSE_CLASS_INFO[code]
        return (
          <li
            key={code}
            title={`${info.short}: ${info.name}`}
            className="list-none rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-2xs font-semibold leading-none text-[var(--color-text)]"
          >
            {info.short}
            <span className="sr-only">: {info.name}</span>
          </li>
        )
      })}
    </ul>
  )
}
