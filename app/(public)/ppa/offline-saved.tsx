"use client"

/**
 * app/(public)/ppa/offline-saved.tsx
 *
 * Shown after the worker saves a PPA offline.
 * Confirms the data is stored and will sync automatically.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, WifiHigh, Bell } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { usePpaOfflineQueue } from "@/lib/pwa/hooks"
import { requestNotificationPermission, getNotificationPermission, isIosSafari } from "@/lib/pwa/notifications"

interface OfflineSavedMessageProps {
  /**
   * Cuando se pasa (uso inline desde ppa-form.tsx tras un submit offline sin
   * navegar), "Realizar otro PPA" resetea estado local en vez de navegar —
   * router.push seguiría dependiendo de un roundtrip de red que puede no
   * existir aún. Sin este prop (acceso directo a /ppa?saved=offline por link
   * o refresh de página), sí navega vía router.push normalmente.
   */
  onRequestNew?: () => void
}

export function OfflineSavedMessage({ onRequestNew }: OfflineSavedMessageProps = {}) {
  const router = useRouter()
  const { online, pendingCount, triggerSync, syncing } = usePpaOfflineQueue()
  const [notifPermission, setNotifPermission] = React.useState<NotificationPermission>(() =>
    typeof window !== "undefined" ? getNotificationPermission() : "default",
  )

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <div className="rounded-xl border-2 border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-6 text-center" role="status" aria-live="polite">
        <CheckCircle size={40} weight="fill" className="mx-auto text-[var(--color-warning-ink)]" aria-hidden />
        <p className="mt-3 text-2xl font-extrabold tracking-tight text-[var(--color-warning-ink)]">
          PPA guardado offline
        </p>
        <p className="mt-2 text-sm font-medium text-[var(--color-warning-ink)]">
          Tu evaluación se ha almacenado en este dispositivo.
          {online
            ? " Se enviará ahora automáticamente."
            : " Se enviará cuando vuelva la conexión a internet."}
        </p>
      </div>

      {pendingCount > 0 && (
        <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm">
            <WifiHigh size={16} className="shrink-0 text-[var(--color-info)]" />
            <span className="font-medium">
              {pendingCount} PPA{pendingCount > 1 ? "s" : ""} pendiente{pendingCount > 1 ? "s" : ""} de envío
            </span>
          </div>
          {online && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3 w-full"
              loading={syncing}
            onClick={async () => {
              try {
                const remaining = await triggerSync()
                if (remaining.length === 0) {
                  router.refresh()
                }
              } catch {
                // P2-6: swallow — triggerSync handles errors internally;
                // the user can retry by clicking again.
              }
            }}
            >
              Enviar ahora
            </Button>
          )}
        </div>
      )}

      <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <h2 className="mb-2 text-sm font-semibold">¿Qué pasa con mi PPA?</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text-muted)]">
          <li>Los datos están seguros en la memoria de tu navegador.</li>
          <li>Se enviarán al servidor automáticamente cuando vuelva la conexión.</li>
          <li>Podrás ver el resultado una vez sincronizado.</li>
          <li>No cierres esta aplicación hasta que se envíe.</li>
        </ul>
      </div>

      {notifPermission === "default" && (
        <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm">
            <Bell size={16} className="shrink-0 text-[var(--color-info)]" />
            <span className="flex-1 font-medium">
              Recibe una notificación cuando tu PPA se envíe.
            </span>
          </div>
          {isIosSafari() && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              En iPhone/iPad, primero agrega esta app a tu pantalla de inicio desde el botón de compartir.
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="mt-3 w-full"
            onClick={async () => {
              const perm = await requestNotificationPermission()
              setNotifPermission(perm)
            }}
          >
            Activar notificaciones
          </Button>
        </div>
      )}

      <div className="mt-8 text-center">
        <Button variant="secondary" onClick={onRequestNew ?? (() => router.push("/ppa"))}>
          Realizar otro PPA
        </Button>
      </div>
    </main>
  )
}
