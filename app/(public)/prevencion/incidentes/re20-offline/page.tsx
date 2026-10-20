import type { Metadata } from "next"
import { Re20OfflineShell } from "./offline-shell"

export const metadata: Metadata = {
  title: "Borradores offline RE-20",
  description: "Desbloqueo local cifrado para continuar borradores RE-20 sin conexión.",
  robots: { index: false, follow: false },
}

export default function Re20OfflinePage() {
  return <Re20OfflineShell />
}
