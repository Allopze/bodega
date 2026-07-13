import type { Metadata } from "next"
import { TaePwaRegister } from "@/components/pwa/tae-pwa-register"

export const metadata: Metadata = {
  title: "Control TAE",
  description: "Registro operativo de cargas TAE de Copec, incluso sin conexión.",
  manifest: "/tae-manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Control TAE" },
}

export default function TaeLayout({ children }: { children: React.ReactNode }) {
  return <><TaePwaRegister />{children}</>
}
