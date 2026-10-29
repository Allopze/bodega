"use client"

import { IconWifiOff } from "./icons"

export function Splash({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="scr">
      <div className="splash" role="status">
        <div className="brand"><b>CHOME</b><span className="cap" style={{ fontSize: 11 }}>Mantención</span></div>
        <h1 className="h2" style={{ fontSize: 21 }}>{title}</h1>
        {children ? <p>{children}</p> : null}
        {action}
      </div>
    </div>
  )
}

export const Loading = () => <Splash title="Preparando la app…" />

export const NeedSignal = ({ onRetry }: { onRetry: () => void }) => (
  <Splash title="Necesitas señal para entrar" action={<button type="button" className="btns wide" style={{ maxWidth: 320 }} onClick={onRetry}><IconWifiOff size={16} />Reintentar</button>}>
    La primera vez que entras en este teléfono hace falta señal. Después podrás registrar sin conexión.
  </Splash>
)

export const NoPermission = () => (
  <Splash title="Sin acceso a la app">Tu cuenta no tiene permiso para usar la app de mantención. Avisa a tu jefatura.</Splash>
)

export const Broken = ({ message }: { message: string }) => <Splash title="No pudimos abrir la app">{message}</Splash>
