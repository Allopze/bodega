"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { authErrorMessage, GENERIC_LOGIN_ERROR } from "@/lib/hooks/use-login"
import { IconAlert } from "./icons"

/** A dónde vuelve siempre: la app, nunca el escritorio de la plataforma. */
const APP_PATH = "/m/mantencion"

/**
 * Login propio de la app del mecánico. Es la misma cuenta y la misma
 * autenticación de la plataforma (`signIn("credentials")`, con su límite de
 * intentos y sus mensajes), pero en la pantalla y el estilo de la app: quien la
 * instaló en el teléfono no pasa por el login de escritorio.
 *
 * Al entrar recarga la app entera (no navega dentro de la página): así la app
 * arranca limpia con la sesión nueva y el documento queda bajo el service worker.
 */
export function AppLogin() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "").trim().toLowerCase()
    const password = String(form.get("password") ?? "")
    if (!email || !password) { setError("Escribe tu correo y tu contraseña."); return }
    setError(null)
    setPending(true)
    try {
      const result = await signIn("credentials", { email, password, redirect: false })
      if (result?.error) { setError(authErrorMessage(result.error)); setPending(false); return }
      // Recarga entera a propósito (ver el comentario del componente).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga entera a propósito
      window.location.assign(APP_PATH)
    } catch {
      setError(navigator.onLine ? GENERIC_LOGIN_ERROR : "Necesitas señal para entrar la primera vez en este teléfono.")
      setPending(false)
    }
  }

  return (
    <form onSubmit={(event) => { void submit(event) }} noValidate style={{ display: "flex", flexDirection: "column", gap: 18, textAlign: "left" }}>
      <div>
        <label className="lbl" htmlFor="app-email">Correo</label>
        <input
          id="app-email" name="email" type="email" className={`inp${error ? " bad" : ""}`}
          autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
          aria-describedby={error ? "app-login-error" : undefined} onChange={() => setError(null)}
        />
      </div>
      <div>
        <label className="lbl" htmlFor="app-password">Contraseña</label>
        <div style={{ position: "relative" }}>
          <input
            id="app-password" name="password" type={showPassword ? "text" : "password"} className={`inp${error ? " bad" : ""}`}
            autoComplete="current-password" style={{ paddingRight: 64 }}
            aria-describedby={error ? "app-login-error" : undefined} onChange={() => setError(null)}
          />
          <button
            type="button" className="lnk" onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Ocultar texto" : "Mostrar texto"}
            style={{ position: "absolute", top: 0, right: 0, height: 52, minWidth: 56, padding: "0 12px", border: 0, background: "transparent", fontWeight: 700, fontSize: 15 }}
          >
            {showPassword ? "Ocultar" : "Ver"}
          </button>
        </div>
      </div>
      {error ? <p id="app-login-error" className="err" role="alert"><IconAlert />{error}</p> : null}
      <button type="submit" className="btnp" disabled={pending} aria-busy={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
      <Link href="/recuperar" className="lnk" style={{ alignSelf: "center", fontWeight: 700, fontSize: 15, minHeight: 44, display: "inline-flex", alignItems: "center" }}>
        ¿Olvidaste tu contraseña?
      </Link>
    </form>
  )
}
