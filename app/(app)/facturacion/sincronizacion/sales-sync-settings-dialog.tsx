"use client"

import { useActionState, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { SETTING_SOURCE_LABELS } from "@/components/admin/secret-setting-field"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useOperation } from "@/lib/hooks/use-operation"
import type { ActionState } from "@/lib/validation/masters"
import type { SalesSyncAdminStatus } from "@/lib/services/billing/config"
import { clearSalesSyncSettingsAction, saveSalesSyncSettingsAction } from "../actions"

/**
 * Interruptor de la sincronización automática de facturas de venta.
 *
 * Es lo único de FacturaEnLínea que se administra desde esta pantalla: las
 * credenciales del portal siguen en Administración › Sincronización DTE (otro
 * permiso) y el período mínimo de importación es una decisión del despliegue.
 * Sin secretos de por medio, el diálogo no depende del llavero del servidor.
 */
export function SalesSyncSettingsDialog({
  status,
  credentialsConfigured,
  canManageCredentials,
}: {
  status: SalesSyncAdminStatus
  /** Si el portal ya tiene credenciales: sin ellas la automatización fallaría a diario. */
  credentialsConfigured: boolean
  /** Si quien mira puede entrar a `/admin/dte`: sólo entonces se enlaza. */
  canManageCredentials: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(status.enabled)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const clear = useOperation({ feedback: "toast" })
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveSalesSyncSettingsAction,
    { ok: false },
  )

  // Abrir el diálogo relee el estado del servidor: cerrar con Escape después de
  // mover el interruptor no debe dejarlo movido al reabrir, mostrando un cambio
  // que nunca se guardó.
  function handleOpenChange(next: boolean) {
    if (next) setEnabled(status.enabled)
    setOpen(next)
  }

  useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      setOpen(false)
      router.refresh()
    } else {
      toast.error(state.message)
    }
  }, [state, router])

  function handleClear() {
    clear.run(clearSalesSyncSettingsAction, () => {
      setConfirmClearOpen(false)
      setOpen(false)
      router.refresh()
    }, () => setConfirmClearOpen(false))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm">Automatización</Button>
        </DialogTrigger>
        <DialogContent>
          <form action={formAction} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Automatización de FacturaEnLínea</DialogTitle>
              <DialogDescription>
                Decide si la plataforma trae sola las facturas de venta desde el portal, sin que nadie
                tenga que ejecutar la sincronización a mano.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">
                  Sincronización automática de facturas de venta
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Corre todos los días y trae el mes actual y el anterior. Apagada, las facturas de
                  venta solo se sincronizan a mano desde esta pantalla.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                label="Sincronización automática de facturas de venta"
                id="sales-sync-enabled"
              />
              <input type="hidden" name="syncEnabled" value={enabled ? "on" : ""} />
            </div>

            <p className="text-xs text-[var(--color-text-muted)]">
              Origen del valor actual: <strong className="font-semibold">{SETTING_SOURCE_LABELS[status.source]}</strong>.
              {status.source === "environment" && " Guardar lo deja fijo en la plataforma."}
              {status.source === "missing" && " Mientras no se configure, la automatización queda apagada."}
            </p>

            {enabled && !credentialsConfigured && (
              <p
                role="status"
                className="rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-xs text-[var(--color-warning-ink)]"
              >
                Faltan las credenciales del portal: con la automatización activa, la corrida diaria
                fallaría hasta que se carguen.
              </p>
            )}

            <p className="text-xs text-[var(--color-text-subtle)]">
              Las credenciales del portal (RUT, clave y código de empresa) no se editan acá: se
              administran en{" "}
              {canManageCredentials ? (
                <Link href="/admin/dte" className="text-[var(--color-primary-ink)] underline underline-offset-2 hover:no-underline">
                  Administración › Sincronización DTE
                </Link>
              ) : (
                "Administración › Sincronización DTE"
              )}
              .
            </p>

            <DialogFooter>
              {status.hasStoredSettings && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clear.pending || pending}
                  onClick={() => setConfirmClearOpen(true)}
                >
                  Restaurar la del servidor
                </Button>
              )}
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="¿Restaurar la configuración del servidor?"
        description="Se borra el interruptor guardado en la plataforma y la automatización de facturas de venta vuelve a regirse por el .env del servidor. No cambia nada en FacturaEnLínea."
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clear.pending}
      />
    </>
  )
}
