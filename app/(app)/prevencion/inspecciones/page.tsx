import type { Metadata } from "next"
import { InspectionsScreen } from "./inspections-screen"

export const metadata: Metadata = { title: "Inspecciones" }

export default async function InspeccionesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <InspectionsScreen searchParams={await searchParams} />
}
