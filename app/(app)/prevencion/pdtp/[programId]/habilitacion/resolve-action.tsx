"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { useOperation } from "@/lib/hooks/use-operation"
import { remindTemplateApprovalAction } from "@/app/(app)/prevencion/inspecciones/actions"
import { remindTrainingCourseVersionApprovalAction } from "@/app/(app)/prevencion/capacitacion/actions"
import { remindEmergencyPlanApprovalAction } from "@/app/(app)/prevencion/emergencias/actions"

/**
 * Qué puede hacer **este** usuario con **esta** fila.
 *
 * Se resuelve en el servidor (`page.tsx`) y llega ya decidida: el cliente no
 * ve permisos ni ids de usuario, sólo la forma que le toca renderizar. Es lo
 * que permite que la decisión considere cosas que el cliente no sabe, como si
 * quien mira es el autor del borrador.
 */
export type ReadinessResolution =
  /** Puede ir al registro y arreglarlo. */
  | { kind: "open"; href: string; label: string }
  /** Puede gestionar pero no firmar: le avisa a quien sí puede. */
  | { kind: "request"; target: RequestTarget; label: string; hint?: string }
  /** Hueco de permisos de rol, no de instrumento. */
  | { kind: "roles"; href: string }
  /** No puede hacer nada él mismo: se le dice a quién pedírselo. */
  | { kind: "blocked"; askRoles: string[]; permissionLabel: string }
  /** No hay nada que resolver. */
  | { kind: "none" }

export type RequestTarget =
  | { kind: "template"; templateId: string }
  | { kind: "course"; versionId: string }
  | { kind: "plan"; planId: string }

/**
 * Pedirle la firma a quien la tiene.
 *
 * Al éxito el botón **se reemplaza** por una confirmación en vez de quedar
 * disponible: el servicio deduplica por día, así que volver a pulsarlo no hace
 * nada y dejarlo activo sugiere lo contrario.
 */
export function RequestInstrumentApprovalButton({ target, label }: { target: RequestTarget; label: string }) {
  const operation = useOperation()
  const [sent, setSent] = React.useState(false)

  if (sent) {
    return (
      <Badge variant="info" size="sm">
        {operation.message || "Solicitud enviada"}
      </Badge>
    )
  }

  return (
    <div className="text-right">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={operation.pending}
        onClick={() => operation.run(
          () => {
            if (target.kind === "template") return remindTemplateApprovalAction({ templateId: target.templateId })
            if (target.kind === "course") return remindTrainingCourseVersionApprovalAction({ versionId: target.versionId })
            return remindEmergencyPlanApprovalAction({ planId: target.planId })
          },
          (result) => {
            const notified = result.data?.notified
            if (Array.isArray(notified) && notified.length > 0) {
              operation.setMessage(`Solicitud enviada a ${notified.join(", ")}`)
            } else {
              operation.setMessage("Solicitud enviada")
            }
            setSent(true)
          },
        )}
      >
        {operation.pending ? "Enviando…" : label}
      </Button>
      {/* Un fallo sí tiene que verse: el `role="status"` lo anuncia sin robar el foco. */}
      {operation.message && !sent && <p role="status" className="mt-1 max-w-64 text-xs text-[var(--color-danger-ink)]">{operation.message}</p>}
    </div>
  )
}

export function ResolveAction({
  resolution,
  activityLabel,
}: {
  resolution: ReadinessResolution
  /** Para el nombre accesible: con veinte filas, veinte "Abrir" idénticos
   *  dejan el árbol de accesibilidad sin forma de distinguirlas. */
  activityLabel: string
}) {
  if (resolution.kind === "none") return null

  if (resolution.kind === "open" || resolution.kind === "roles") {
    const href = resolution.href
    const label = resolution.kind === "roles" ? "Administrar roles" : resolution.label
    return (
      <div className="flex items-center justify-end">
        <Button asChild size="sm" variant="ghost">
          <Link href={href} aria-label={`${label} · ${activityLabel}`}>
            {/* El verbo repetido en cada fila era una columna de texto idéntico
                leída de arriba abajo. La flecha queda siempre; el verbo aparece
                al posar o al enfocar la fila, y `aria-label` lo conserva. */}
            <span aria-hidden className="opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-within:opacity-100">
              {label}
            </span>
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>
    )
  }

  if (resolution.kind === "request") {
    return (
      <div className="flex items-center justify-end">
        <RequestInstrumentApprovalButton target={resolution.target} label={resolution.label} />
      </div>
    )
  }

  /* Un botón deshabilitado en una lista de triage se lee como "roto" y no dice
   * qué hacer. Nombrar a la persona sí: es la única acción que le queda a quien
   * no tiene el permiso. */
  return (
    <div className="flex items-center justify-end text-right">
      <Tooltip content={`Requiere el permiso para ${resolution.permissionLabel}`}>
        <span className="text-xs text-[var(--color-text-subtle)]">
          {resolution.askRoles.length > 0
            ? `Pídeselo a ${resolution.askRoles.join(" o ")}`
            : "Pídeselo a quien administra este módulo"}
        </span>
      </Tooltip>
    </div>
  )
}
