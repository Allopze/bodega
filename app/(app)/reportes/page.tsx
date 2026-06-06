import type { Metadata } from "next"
import { StubPage } from "@/lib/stub-page"
export const metadata: Metadata = { title: "Reportes" }
export default function Page() {
  return <StubPage title="Reportes y Dashboard" description="Pendientes por rol, matriz de trazabilidad, exportación CSV" phase={8} />
}
