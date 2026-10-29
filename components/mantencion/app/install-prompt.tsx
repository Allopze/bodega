"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  detectPlatform, hasDeferredPrompt, installMode, installSnapshot, isInstalledFlag, isStandalone,
  promptInstall, readSnooze, subscribeInstall, writeSnooze, type InstallMode,
} from "@/lib/mantencion/client/install"
import { IconInstall, IconShare } from "./icons"

/**
 * Invitación a instalar la app, arriba del login y del inicio, mientras la app
 * se abra en el navegador y no desde la pantalla de inicio. Se calla tres días
 * con «Ahora no». La lógica de cuándo mostrarla vive en `lib/mantencion/client/install.ts`.
 */
export function InstallPrompt() {
  const snapshot = useSyncExternalStore(subscribeInstall, installSnapshot, () => "server")
  // Hora en que se abrió la pantalla (la regla de «Ahora no» se mide contra ella);
  // 0 mientras no se monta, porque el HTML del servidor no sabe nada del teléfono.
  const [openedAt, setOpenedAt] = useState(0)
  const [snoozedAt, setSnoozedAt] = useState<number | null>(null)
  useEffect(() => {
    setSnoozedAt(readSnooze())
    setOpenedAt(Date.now())
  }, [])

  // Hasta montar no se sabe si está instalada ni en qué teléfono: el HTML del servidor no la muestra.
  const mode: InstallMode = openedAt === 0 || snapshot === "server"
    ? "hidden"
    : installMode({
      standalone: isStandalone(),
      installed: isInstalledFlag(),
      platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
      hasPrompt: hasDeferredPrompt(),
      snoozedAt,
      now: openedAt,
    })
  if (mode === "hidden") return null

  const later = () => {
    const now = Date.now()
    writeSnooze(now)
    setSnoozedAt(now)
  }
  const laterButton = <button type="button" className="lnk" onClick={later}>Ahora no</button>

  return (
    <section className="banner okb" aria-labelledby="install-title" style={{ flexDirection: "column", gap: 0, textAlign: "left" }}>
      <strong id="install-title" style={{ fontSize: 16 }}>
        {mode === "ios" ? "Instala la app en tu iPhone" : "Instala la app en tu teléfono"}
      </strong>
      <div>Queda en tu pantalla de inicio, se abre sin el navegador y funciona sin señal.</div>

      {mode === "prompt" ? (
        <div className="banner-actions">
          <button type="button" className="btns pri" onClick={() => { void promptInstall() }}>
            <IconInstall />Instalar app
          </button>
          {laterButton}
        </div>
      ) : null}

      {mode === "ios" ? (
        <>
          <ol className="banner-steps">
            <li>Toca <strong>Compartir</strong> <IconShare /> en la barra de Safari.</li>
            <li>Elige <strong>Agregar a inicio</strong>.</li>
            <li>Toca <strong>Agregar</strong>.</li>
          </ol>
          <div className="hint" style={{ fontSize: 14 }}>Si no ves «Compartir», abre este enlace en Safari.</div>
          <div className="banner-actions">{laterButton}</div>
        </>
      ) : null}

      {mode === "android-manual" ? (
        <>
          <ol className="banner-steps">
            <li>Abre el menú <strong aria-label="de tres puntos">⋮</strong> del navegador.</li>
            <li>Toca <strong>Instalar app</strong> o <strong>Agregar a la pantalla principal</strong>.</li>
          </ol>
          <div className="banner-actions">{laterButton}</div>
        </>
      ) : null}
    </section>
  )
}
