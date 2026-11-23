"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ONWAY_CHALLENGE_KEYS,
  type OnwayChallengeKey,
  type OnwayChallengeStatus,
  type OnwayChallengeViewport,
} from "@/lib/integrations/onway/onway-interactive-auth-contract"
import { toast } from "@/lib/toast"

const START_URL = "/api/flota/monitoreo/onway-verificacion"
const FRAME_INTERVAL_MS = 700
const STATUS_INTERVAL_MS = 1_200
const MOVE_THROTTLE_MS = 45

type StartResponse = {
  ok?: boolean
  status?: "awaiting" | "authenticated"
  id?: string
  expiresAt?: number
  viewport?: OnwayChallengeViewport
  message?: string
}

type StatusResponse = {
  ok?: boolean
  status?: OnwayChallengeStatus
  expiresAt?: number
  remainingMs?: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function cancelRequest(id: string): void {
  void fetch(`${START_URL}/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  }).catch(() => undefined)
}

/**
 * Vista de un solo uso sobre el Chromium del servidor. No es un iframe del
 * portal: Auth0 lo bloquea y la sesión que hay que resolver es la del scraper.
 * Cada frame es una captura real y cada clic/tecla se reenvía al navegador.
 */
export function OnwayVerificationDialog({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onVerified: () => void
}) {
  const [attempt, setAttempt] = React.useState(0)
  const [phase, setPhase] = React.useState<"starting" | "live" | "error">("starting")
  const [error, setError] = React.useState<string | null>(null)
  const [challengeId, setChallengeId] = React.useState<string | null>(null)
  const [frameUrl, setFrameUrl] = React.useState<string | null>(null)
  const [remainingMs, setRemainingMs] = React.useState(0)

  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const challengeIdRef = React.useRef<string | null>(null)
  const solvedRef = React.useRef(false)
  const pressedRef = React.useRef(false)
  const lastMoveAtRef = React.useRef(0)
  const frameUrlRef = React.useRef<string | null>(null)
  const expiresAtRef = React.useRef(0)
  const onVerifiedRef = React.useRef(onVerified)
  const onOpenChangeRef = React.useRef(onOpenChange)

  React.useEffect(() => { onVerifiedRef.current = onVerified }, [onVerified])
  React.useEffect(() => { onOpenChangeRef.current = onOpenChange }, [onOpenChange])

  const clearFrame = React.useCallback(() => {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
    frameUrlRef.current = null
    setFrameUrl(null)
  }, [])

  // Cerrar cancela el desafío si sigue vivo. Si ya se resolvió, la sesión
  // autenticada se conserva para que la sincronización la reutilice.
  React.useEffect(() => {
    if (open) return
    const id = challengeIdRef.current
    if (id && !solvedRef.current) cancelRequest(id)
    challengeIdRef.current = null
    solvedRef.current = false
    setChallengeId(null)
    setPhase("starting")
    setError(null)
    setRemainingMs(0)
    expiresAtRef.current = 0
    clearFrame()
  }, [open, clearFrame])

  // Abrir el navegador del servidor. La petición puede tardar: Auth0 navega y,
  // si no hay desafío, la respuesta dice que la sesión ya estaba autenticada.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    solvedRef.current = false
    setPhase("starting")
    setError(null)
    setChallengeId(null)
    challengeIdRef.current = null
    setRemainingMs(0)
    expiresAtRef.current = 0
    clearFrame()

    void (async () => {
      try {
        const response = await fetch(START_URL, { method: "POST" })
        const body = await response.json().catch(() => null) as StartResponse | null
        if (body?.status === "awaiting" && body.id) {
          if (cancelled) {
            // Si una reapertura ya adoptó este mismo id, no se cancela: la
            // vista vigente lo está mostrando.
            if (challengeIdRef.current !== body.id) cancelRequest(body.id)
            return
          }
          challengeIdRef.current = body.id
          setChallengeId(body.id)
          expiresAtRef.current = body.expiresAt ?? 0
          setRemainingMs(Math.max(0, (body.expiresAt ?? 0) - Date.now()))
          setPhase("live")
          return
        }
        if (cancelled) return
        if (response.ok && body?.status === "authenticated") {
          toast.success("La sesión de OnWay ya está activa. Actualizando…")
          onOpenChangeRef.current(false)
          onVerifiedRef.current()
          return
        }
        setError(body?.message ?? "No se pudo abrir la verificación de OnWay.")
        setPhase("error")
      } catch {
        if (!cancelled) {
          setError("Sin conexión: no se pudo abrir la verificación de OnWay.")
          setPhase("error")
        }
      }
    })()

    return () => { cancelled = true }
  }, [open, attempt, clearFrame])

  // Frames: se piden uno a uno para no encolar capturas si una tarda más que el
  // intervalo. Un 404/409/410 corta el bucle; el estado decide el desenlace.
  React.useEffect(() => {
    if (!open || phase !== "live" || !challengeId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (stopped) return
      try {
        const response = await fetch(
          `${START_URL}/${encodeURIComponent(challengeId)}?frame=1&t=${Date.now()}`,
          { cache: "no-store" },
        )
        if (response.ok) {
          const blob = await response.blob()
          if (stopped) return
          const next = URL.createObjectURL(blob)
          const previous = frameUrlRef.current
          frameUrlRef.current = next
          setFrameUrl(next)
          // Se revoca después: el <img> puede no haber decodificado el frame
          // anterior cuando llega el siguiente.
          if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1_000)
        } else if (response.status === 404 || response.status === 409 || response.status === 410) {
          stopped = true
          return
        }
      } catch {
        // Un frame perdido se reintenta con el siguiente intervalo.
      }
      if (!stopped) timer = setTimeout(tick, FRAME_INTERVAL_MS)
    }

    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [open, phase, challengeId])

  // Estado: es quien detecta que el humano resolvió el desafío y dispara la
  // sincronización, o que venció/canceló.
  React.useEffect(() => {
    if (!open || phase !== "live" || !challengeId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (stopped) return
      try {
        const response = await fetch(
          `${START_URL}/${encodeURIComponent(challengeId)}?t=${Date.now()}`,
          { cache: "no-store" },
        )
        const body = await response.json().catch(() => null) as StatusResponse | null
        if (stopped) return

        if (response.status === 401 || response.status === 403 || response.status === 404) {
          stopped = true
          setPhase("error")
          setError(response.status === 404
            ? "La verificación ya no está disponible. Vuelve a abrirla."
            : "No tienes acceso a esta verificación.")
          return
        }

        if (response.ok && body?.status === "awaiting") {
          // El reloj del navegador puede estar corrido respecto del servidor:
          // el vencimiento se ancla al `remainingMs` que acaba de responder.
          if (typeof body.remainingMs === "number") {
            expiresAtRef.current = Date.now() + body.remainingMs
            setRemainingMs(body.remainingMs)
          } else if (typeof body.expiresAt === "number") {
            expiresAtRef.current = body.expiresAt
            setRemainingMs(Math.max(0, body.expiresAt - Date.now()))
          }
        } else if (response.ok && body?.status === "solved") {
          stopped = true
          solvedRef.current = true
          toast.success("Verificación completada. Actualizando OnWay…")
          onOpenChangeRef.current(false)
          onVerifiedRef.current()
          return
        } else if (response.ok && body?.status) {
          stopped = true
          setPhase("error")
          setError(body.status === "expired"
            ? "La verificación expiró. Vuelve a abrirla."
            : "La verificación se cerró. Vuelve a abrirla.")
          return
        }
      } catch {
        // Se reintenta: el portal puede estar en una transición.
      }
      if (!stopped) timer = setTimeout(tick, STATUS_INTERVAL_MS)
    }

    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [open, phase, challengeId])

  React.useEffect(() => {
    if (!open || phase !== "live") return
    const timer = setInterval(() => setRemainingMs(Math.max(0, expiresAtRef.current - Date.now())), 1_000)
    return () => clearInterval(timer)
  }, [open, phase])

  React.useEffect(() => {
    if (phase === "live") imageRef.current?.focus()
  }, [phase])

  // Salir de Monitoreo con la vista abierta no debe dejar el navegador tomado
  // hasta el vencimiento ni conservar blobs de frames.
  React.useEffect(() => () => {
    const id = challengeIdRef.current
    if (id && !solvedRef.current) cancelRequest(id)
    challengeIdRef.current = null
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
    frameUrlRef.current = null
  }, [])

  const send = React.useCallback((payload: Record<string, unknown>) => {
    const id = challengeIdRef.current
    if (!id || solvedRef.current) return
    void fetch(`${START_URL}/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => undefined)
  }, [])

  function pointOf(event: React.PointerEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (!frameUrl) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* puntero ya liberado */ }
    pressedRef.current = true
    const point = pointOf(event)
    if (point) send({ kind: "down", ...point })
    imageRef.current?.focus()
  }

  function handlePointerMove(event: React.PointerEvent<HTMLImageElement>) {
    // Se envía también sin botón presionado: los captchas por riesgo miran el
    // recorrido real del mouse, no sólo el clic final.
    const now = performance.now()
    if (now - lastMoveAtRef.current < MOVE_THROTTLE_MS) return
    lastMoveAtRef.current = now
    const point = pointOf(event)
    if (point) send({ kind: "move", ...point })
  }

  function handlePointerUp(event: React.PointerEvent<HTMLImageElement>) {
    if (!pressedRef.current) return
    pressedRef.current = false
    const point = pointOf(event)
    if (point) send({ kind: "up", ...point })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLImageElement>) {
    if (!frameUrl || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === "Tab") {
      event.preventDefault()
      send({ kind: "key", key: event.shiftKey ? "Shift+Tab" : "Tab" })
      return
    }
    if ((ONWAY_CHALLENGE_KEYS as readonly string[]).includes(event.key)) {
      event.preventDefault()
      send({ kind: "key", key: event.key as OnwayChallengeKey })
      return
    }
    if (event.key.length === 1) {
      event.preventDefault()
      send({ kind: "text", text: event.key })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Verificación de Entel OnWay</DialogTitle>
          <DialogDescription>
            {phase === "starting"
              ? "El servidor está abriendo el portal y presentando las credenciales."
              : "Resuelve aquí la verificación que pide el portal. Esta vista es el navegador del servidor, no una captura, y no se graba."}
          </DialogDescription>
        </DialogHeader>

        {phase === "error" ? (
          <div className="space-y-3">
            <Callout tone="warning" role="alert">
              {error ?? "No se pudo completar la verificación."}
            </Callout>
            <DialogFooter>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                Reintentar
              </Button>
              <Button type="button" size="sm" onClick={() => onOpenChangeRef.current(false)}>
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        ) : phase === "starting" ? (
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
            <p className="text-sm text-[var(--color-text-muted)]">Preparando la verificación…</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-black">
              {frameUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- el frame es un blob efímero del navegador del servidor; next/image no puede optimizarlo y lo cachearía.
                <img
                  ref={imageRef}
                  src={frameUrl}
                  alt="Verificación de Entel OnWay"
                  tabIndex={0}
                  draggable={false}
                  className="block h-auto w-full cursor-crosshair touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  onDragStart={(event) => event.preventDefault()}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onKeyDown={handleKeyDown}
                />
              ) : (
                <div className="flex min-h-48 items-center justify-center text-sm text-white/70">
                  Cargando la verificación…
                </div>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Haz clic dentro de la imagen y escribe si el portal pide un código. No escribas tu contraseña: ya está ingresada.
            </p>
            <DialogFooter className="items-center justify-between">
              <span className="text-xs tabular-nums text-[var(--color-text-subtle)]">
                Se cierra en {formatRemaining(remainingMs)}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChangeRef.current(false)}>
                Cancelar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
