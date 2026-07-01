"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import type { PermitRequest, PermitSignoff, PermitTemplate } from "@/db/schema"
import { approvePermitRequestAction } from "./actions"
import { PermitSignoffForm } from "./permit-signoff-form"

interface Props {
  permit: PermitRequest
  template: PermitTemplate | undefined
  signoffs: PermitSignoff[]
  canManage: boolean
}

export function PermisoDetail({ permit, template, signoffs, canManage }: Props) {
  const router = useRouter()
  const [approving, setApproving] = React.useState(false)
  const [showSignoffForm, setShowSignoffForm] = React.useState(false)

  const requiredRoles = template ? Object.keys(template.requiresSignoff as Record<string, boolean>) : []
  const signedRoles = new Set(signoffs.map((s) => s.role))

  async function onApprove() {
    setApproving(true)
    const result = await approvePermitRequestAction(permit.id)
    setApproving(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo aprobar el permiso.")
      return
    }
    toast.success("Permiso aprobado.")
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <p><span className="text-[var(--color-text-subtle)]">Tarea:</span> {permit.task}</p>
        <p><span className="text-[var(--color-text-subtle)]">Ubicación:</span> {permit.location}</p>
        <p><span className="text-[var(--color-text-subtle)]">Inicio:</span> {new Date(permit.plannedStart).toLocaleString("es-CL")}</p>
        <p><span className="text-[var(--color-text-subtle)]">Término:</span> {new Date(permit.plannedEnd).toLocaleString("es-CL")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Firmas requeridas</h3>
          {canManage && permit.status === "aprobado" ? (
            <Button size="sm" variant={showSignoffForm ? "ghost" : "secondary"} onClick={() => setShowSignoffForm((s) => !s)}>
              {showSignoffForm ? "Cancelar" : "Firmar"}
            </Button>
          ) : null}
        </div>
        {requiredRoles.length === 0 ? (
          <p className="text-xs text-[var(--color-text-subtle)]">Esta plantilla no exige firmas adicionales.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {requiredRoles.map((role) => (
              <li key={role}>
                <Badge variant={signedRoles.has(role) ? "success" : "warning"}>
                  {role} {signedRoles.has(role) ? "✓" : "pendiente"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {showSignoffForm ? (
          <PermitSignoffForm permitId={permit.id} onDone={() => setShowSignoffForm(false)} />
        ) : null}
      </div>

      {canManage && permit.status === "solicitado" ? (
        <div className="flex justify-end">
          <Button size="sm" disabled={approving} onClick={onApprove}>
            {approving ? "Aprobando…" : "Aprobar solicitud"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
