import type { Metadata } from "next"
import { ServiceWorker } from "./service-worker"

export const metadata: Metadata = {
  title: "PPA Digital — Para, Piensa y Actúa",
  description: "Evaluación preventiva antes de iniciar el trabajo. Funciona sin conexión a internet.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PPA Digital",
  },
}


export default function PpaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorker />
      {children}
    </>
  )
}
