import type { Metadata } from "next"
import { Re20OfflineShell } from "./offline-shell"

export const metadata: Metadata = {
  title: "Borradores offline RE-20",
  description: "Continúa sin conexión los borradores RE-20 guardados en este equipo.",
  robots: { index: false, follow: false },
}

export default function Re20OfflinePage() {
  return <Re20OfflineShell />
}
