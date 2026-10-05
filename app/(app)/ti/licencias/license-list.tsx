"use client"

import * as React from "react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { EmptyState } from "@/components/ui/empty-state"
import { LicensePanel } from "./license-panel"

type PanelProps = React.ComponentProps<typeof LicensePanel>

/**
 * Lista de licencias filtrada por el buscador de la shell (TopBar): nombre,
 * proveedor, tipo o responsable (TIUX-35). La ruta no está en
 * `ROUTES_WITH_OWN_SEARCH`, así que el TopBar pinta el buscador; sin esto
 * escribir en él no hacía nada.
 */
export function LicenseList({ licenses, ...shared }: Omit<PanelProps, "license"> & { licenses: PanelProps["license"][] }) {
  const { searchQuery } = useSafeShellHeader()
  const query = searchQuery.trim().toLowerCase()

  const visible = query
    ? licenses.filter((license) =>
      [license.name, license.supplierName, license.type, license.responsibleName]
        .some((value) => value?.toLowerCase().includes(query)))
    : licenses

  if (visible.length === 0) {
    return (
      <EmptyState
        compact
        title="Ninguna licencia coincide"
        description={`No hay licencias que coincidan con «${searchQuery.trim()}». Prueba con el nombre o el proveedor.`}
      />
    )
  }

  return (
    <div className="space-y-4">
      {visible.map((license) => (
        <LicensePanel key={license.id} license={license} {...shared} />
      ))}
    </div>
  )
}
