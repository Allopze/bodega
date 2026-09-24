"use client"

import { useEffect, useRef } from "react"
import { acknowledgePdtpProgramAction } from "../actions/program-acknowledgments"

/**
 * Deja la toma de conocimiento del programa al abrirlo. Corre en el navegador
 * y no en el render del servidor para que sólo cuente una página que alguien
 * de verdad cargó (un prefetch no monta efectos). No pinta nada.
 */
export function ProgramAcknowledgmentBeacon({ programId }: { programId: string }) {
  const sent = useRef<string | null>(null)
  useEffect(() => {
    // StrictMode monta dos veces en desarrollo; la acción es idempotente, pero
    // no hay por qué pedirla dos veces.
    if (sent.current === programId) return
    sent.current = programId
    void acknowledgePdtpProgramAction(programId)
  }, [programId])
  return null
}
