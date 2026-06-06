import type { Metadata } from "next"
import { StubPage } from "@/lib/stub-page"
export const metadata: Metadata = { title: "Entregas" }
export default function Page() {
  return <StubPage title="Entregas" description="Entrega a faena o trabajador" phase={6} />
}
