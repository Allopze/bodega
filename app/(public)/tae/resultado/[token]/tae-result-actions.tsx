"use client"

import Link from "next/link"
import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowCounterClockwise, SignOut } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { clearTaeAccessConfig, clearTaeAccessToken } from "@/lib/pwa/tae-offline-queue"

/** The result never reuses submission data. It only returns to a server-validated device access. */
export function TaeResultActions() {
  const router = useRouter()
  const [finishing, setFinishing] = React.useState(false)
  const [finishError, setFinishError] = React.useState<string | null>(null)

  async function finishOnThisDevice() {
    setFinishing(true)
    setFinishError(null)
    try {
      await Promise.all([clearTaeAccessToken(), clearTaeAccessConfig()])
      router.replace("/tae")
    } catch {
      setFinishError("No se pudo cerrar el acceso local. Borra los datos del sitio antes de entregar este dispositivo.")
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="mt-6 space-y-3 text-left">
      <Button asChild className="w-full" size="lg">
        <Link href="/tae" aria-label="Registrar otra carga con el acceso guardado"><ArrowCounterClockwise size={18} />Registrar otra carga</Link>
      </Button>
      <Button type="button" variant="secondary" className="w-full" onClick={() => void finishOnThisDevice()} loading={finishing}>
        <SignOut size={18} />Finalizar en este dispositivo
      </Button>
      <p className="text-center text-xs text-[var(--color-text-muted)]">Registrar otra carga abre un formulario nuevo y valida otra vez el acceso del dispositivo. Finalizar borra ese acceso local.</p>
      {finishError && <p role="alert" className="text-center text-xs text-[var(--color-danger-ink)]">{finishError}</p>}
    </div>
  )
}
