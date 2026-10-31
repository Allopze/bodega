"use client"

import * as React from "react"
import { clearTaeDraft, getTaeDraft, saveTaeDraft } from "@/lib/pwa/tae-offline-queue"
import { EMPTY_OTRO_DIA, type OtroDiaValue } from "./otro-dia"

/**
 * Recuerda en el dispositivo la fecha y el motivo de una carga de otro día,
 * con el mismo ciclo de vida que el borrador del formulario (misma clave de
 * faena y punto; se guarda al escribir y se borra al enviar o empezar de nuevo).
 *
 * No es un detalle de comodidad: si el borrador se recuperara sin esto, una
 * carga de otro día que se dejó a medias se enviaría como una carga de hoy, con
 * la hora de la plataforma, sin que nada lo avisara.
 */
const KEY_PREFIX = "otro-dia:"

interface StoredOtroDia extends Record<string, unknown> {
  value: OtroDiaValue
}

export function useOtroDiaMemory({
  scopeKey,
  value,
  onRestore,
}: {
  scopeKey: string
  value: OtroDiaValue
  /** Se llama una vez, con lo que había guardado para esta faena y punto. */
  onRestore: (restored: OtroDiaValue) => void
}) {
  const key = `${KEY_PREFIX}${scopeKey}`
  const restoreRef = React.useRef(onRestore)
  React.useEffect(() => { restoreRef.current = onRestore })
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    let active = true
    void (async () => {
      const stored = await getTaeDraft<StoredOtroDia>(key)
      if (!active) return
      if (stored?.value?.open) restoreRef.current({ ...EMPTY_OTRO_DIA, ...stored.value })
      setReady(true)
    })()
    return () => { active = false }
  }, [key])

  React.useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      if (value.open) void saveTaeDraft(key, { value })
      else void clearTaeDraft(key)
    }, 400)
    return () => clearTimeout(timer)
  }, [key, ready, value])

  const clear = React.useCallback(() => { void clearTaeDraft(key) }, [key])
  return { ready, clear }
}
