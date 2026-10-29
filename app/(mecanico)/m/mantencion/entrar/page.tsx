import type { Metadata, Viewport } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { AppLogin } from "@/components/mantencion/app/app-login"
import { InstallPrompt } from "@/components/mantencion/app/install-prompt"
import { MANT_APP_METADATA, MANT_APP_VIEWPORT } from "../app-metadata"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { ...MANT_APP_METADATA, title: "Entrar · Mantención" }
export const viewport: Viewport = MANT_APP_VIEWPORT

/**
 * Login de la app del mecánico. Es pública (está en `PUBLIC_PATHS`) porque es la
 * puerta de entrada de quien abre la app instalada sin sesión; no muestra ningún
 * dato. Vive dentro del alcance del service worker (`/m/mantencion`), así que la
 * app instalada nunca salta al login de escritorio de la plataforma.
 */
export default async function MantencionLoginPage() {
  // Al ser pública, el proxy no aplica el interruptor del módulo: se pregunta aquí.
  if (!(await isRouteOperational("/m/mantencion"))) {
    return (
      <div className="mant-shell">
        <div className="scr">
          <div className="pin-full">
            <Brand />
            <div>
              <h1 className="h2">La app no está disponible</h1>
              <p className="hint">La mantención de equipos está desactivada por ahora. Consulta a tu jefatura.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const session = await auth()
  if (session && can(session, "mant:app:use")) redirect("/m/mantencion")

  return (
    <div className="mant-shell">
      <div className="scr">
        <div className="pin-full" style={{ justifyContent: "flex-start", paddingTop: 48 }}>
          <Brand />
          <div>
            <h1 className="h1">Entrar</h1>
            <p className="hint" style={{ maxWidth: 340, margin: "8px auto 0" }}>
              {session
                ? "Tu cuenta no tiene acceso a la app de mantención. Entra con la cuenta de mecánico."
                : "Con tu cuenta de Chome. La primera vez necesitas señal; después la app funciona sin conexión."}
            </p>
          </div>
          <InstallPrompt />
          <AppLogin />
        </div>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <div className="brand" style={{ justifyContent: "center" }}>
      <b>CHOME</b><span className="cap" style={{ fontSize: 11 }}>Mantención</span>
    </div>
  )
}
