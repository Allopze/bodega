"use client"

import * as React from "react"
import { Plus, UploadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { CatalogImportPanel } from "@/components/admin/catalog-import-panel"
import { importFuelVehiclesFromXlsx } from "../actions"
import { VehicleForm } from "./vehicle-form"

export function VehicleActions({
  worksites,
  users,
}: {
  worksites: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
}) {
  const [formOpen, setFormOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
        <UploadSimple size={14} />Importar
      </Button>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nuevo vehículo
      </Button>

      <VehicleForm
        key="nuevo"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        worksites={worksites}
        users={users}
        editVehicle={null}
      />
      <CatalogImportPanel
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar vehículos desde XLSX"
        description="Crea o actualiza vehículos por patente usando el consolidado de combustibles de Chome."
        action={importFuelVehiclesFromXlsx}
        helperText="Columnas requeridas: CODIGO, PATENTE, FAENA, TIPO, MARCA, MODELO y AÑO. Las faenas deben existir y estar dentro de tu alcance."
      />
    </>
  )
}
