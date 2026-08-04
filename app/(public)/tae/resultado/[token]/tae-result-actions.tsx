"use client"

import Link from "next/link"
import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowCounterClockwise, SignOut } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { clearTaeAccessConfig, clearTaeAccessToken, countPendingTaeSubmissions } from "@/lib/pwa/tae-offline-queue"
import { countOf } from "@/lib/utils"

/** The result never reuses submission data. It only returns to a server-validated device access. */
export function TaeResultActions() {
  const router = useRouter()
  const [finishing, setFinishing] = React.useState(false)
  const [finishError, setFinishError] = React.useState<string | null>(null)
  const [pendientes, setPendientes] = React.useState<number | null>(null)

  /*
   * Cargas sin enviar en un dispositivo compartido (decisión de 2026-08-04).
   *
   * "Finalizar" borra el acceso local, no la cola: las cargas encoladas sin red
   * —con sus cuatro fotos— sobreviven en IndexedDB. El escenario real es un
   * turno que registra una carga sin cobertura, finaliza y entrega el teléfono
   * al turno siguiente: sus datos quedan bajo el uso de otra persona y se
   * sincronizan después sin que él se entere de si llegaron.
   *
   * La atribución no se rompe —cada carga guarda su propio `accessToken` y se
   * registra a nombre de quien la hizo—, así que el riesgo no es un dato mal
   * asignado sino un trabajador que no sabe si su registro existe.
   *
   * Entre esperar y perder trabajo, se elige esperar: en terreno una carga
   * perdida cuesta más que unos minutos. El aviso convierte un silencio en una
   * decisión suya.
   */
  const refrescarPendientes = React.useCallback(async () => {
    try {
      setPendientes(await countPendingTaeSubmissions())
    } catch {
      // Si no se puede leer la cola, no se puede afirmar que esté vacía. Se
      // trata como "hay pendientes": bloquear de más es recuperable, borrar el
      // acceso sobre una cola que no se pudo consultar no lo es.
      setPendientes(1)
    }
  }, [])

  React.useEffect(() => {
    void refrescarPendientes()
    // La cola se vacía sola al recuperar red; sin revisar, el botón se quedaría
    // bloqueado después de que el motivo del bloqueo ya no exista.
    const id = setInterval(() => void refrescarPendientes(), 5_000)
    return () => clearInterval(id)
  }, [refrescarPendientes])

  const bloqueado = pendientes === null || pendientes > 0

  async function finishOnThisDevice() {
    setFinishing(true)
    setFinishError(null)
    try {
      // Se vuelve a consultar justo antes de borrar: entre el último refresco y
      // el clic pueden haberse encolado cargas nuevas.
      if (await countPendingTaeSubmissions() > 0) {
        await refrescarPendientes()
        setFinishError("Quedaron cargas sin enviar. Espera a recuperar señal antes de entregar este dispositivo.")
        return
      }
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
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => void finishOnThisDevice()}
        loading={finishing}
        disabled={bloqueado}
      >
        <SignOut size={18} />Finalizar en este dispositivo
      </Button>
      {bloqueado && pendientes !== null && pendientes > 0 && (
        // El bloqueo dice **cuántas** cargas retienen el dispositivo: sin la
        // cifra, un botón deshabilitado es indistinguible de uno roto.
        <p role="status" className="rounded-(--radius) border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-center text-xs text-[var(--color-warning-ink)]">
          {countOf(pendientes, "carga")} sin enviar en este dispositivo. Se enviarán solas al recuperar señal; hasta entonces no puedes finalizar sin perderlas.
        </p>
      )}
      <p className="text-center text-xs text-[var(--color-text-muted)]">Registrar otra carga abre un formulario nuevo y valida otra vez el acceso del dispositivo. Finalizar borra ese acceso local.</p>
      {finishError && <p role="alert" className="text-center text-xs text-[var(--color-danger-ink)]">{finishError}</p>}
    </div>
  )
}
