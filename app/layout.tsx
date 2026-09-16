import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import localFont from "next/font/local"
import "./globals.css"

// El proxy (`proxy.ts` → `lib/security/csp.ts`) emite una CSP con nonce por
// request, y Next sólo puede estampar ese nonce en el HTML que renderiza en la
// petición: en una página prerenderizada el `<script>` inline del flight queda
// horneado **sin** nonce y el navegador lo bloquea, así que la app nunca
// hidrata. Se veía en /recuperar (la única página HTML estática junto con el
// 404): dos violaciones de `script-src` y React #412 en cada carga. Declararlo
// en el layout raíz es lo que garantiza el invariante para toda ruta presente y
// futura — repetirlo página por página ya falló una vez (login, /tae y /ppa lo
// tenían; /recuperar no).
export const dynamic = "force-dynamic"

const exo = localFont({
  variable: "--font-exo",
  display: "swap",
  src: [
    { path: "../fonts/exo/woff2/Exo-Regular.woff2",   weight: "400", style: "normal" },
    { path: "../fonts/exo/woff2/Exo-Medium.woff2",    weight: "500", style: "normal" },
    { path: "../fonts/exo/woff2/Exo-DemiBold.woff2",  weight: "600", style: "normal" },
    { path: "../fonts/exo/woff2/Exo-Bold.woff2",      weight: "700", style: "normal" },
    { path: "../fonts/exo/woff2/Exo-ExtraBold.woff2", weight: "800", style: "normal" },
  ],
})

const myriad = localFont({
  variable: "--font-myriad",
  display: "swap",
  src: [
    { path: "../fonts/myriad-pro/woff2/myriadpro-light.woff2",      weight: "300", style: "normal" },
    { path: "../fonts/myriad-pro/woff2/myriadpro-regular.woff2",    weight: "400", style: "normal" },
    { path: "../fonts/myriad-pro/woff2/myriadpro-semibold.woff2",   weight: "600", style: "normal" },
    { path: "../fonts/myriad-pro/woff2/myriadpro-bold.woff2",       weight: "700", style: "normal" },
  ],
})

export const metadata: Metadata = {
  title: {
    default: "Plataforma Chome",
    template: "%s · Plataforma Chome",
  },
  description: "Plataforma interna para operación, trazabilidad, prevención y gestión por faena, de Chome",
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="es-CL"
      className={`${exo.variable} ${myriad.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
