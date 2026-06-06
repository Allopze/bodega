import type { Metadata } from "next"
import { StubPage } from "@/lib/stub-page"
export const metadata: Metadata = { title: "Facturas" }
export default function Page() {
  return <StubPage title="Facturación y conciliación" description="Registro manual de facturas y comparación con OC/recepción" phase={7} />
}
