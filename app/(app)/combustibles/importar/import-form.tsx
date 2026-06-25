"use client"

import { useActionState, useRef, useState } from "react"
import { importFuelLoadsAction } from "../actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Upload, FileText, CheckCircle, WarningCircle } from "@phosphor-icons/react"
import type { ActionState } from "../actions"

export function ImportFuelLoadsForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(importFuelLoadsAction, { ok: false })
  const errors = state.data?.errors as Array<{ rowIndex: number; field: string; message: string }> | undefined
  const importedCount = state.data?.imported as number | undefined
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState("")

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Importar" }]} />
      <PageHeader title="Importar cargas desde Excel" description="Sube el archivo Excel de TCT Copec con las cargas de combustible" />

      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Formato esperado
            </CardTitle>
            <CardDescription>
              El archivo debe tener una hoja con las columnas: MES-AÑO, SERVICIO, VEHICULO, PROVEEDOR, CLIENTE, FAENA, PRODUCTO, FACTURA, LITROS, IEC Fijo, IEC Variable, Base Afecta, IMPUESTO IEC, IVA, TOTAL FACTURA A PAGAR
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="file">Archivo Excel (.xlsx)</Label>
                <div className="flex items-center gap-3">
                  <Input
                    ref={fileRef}
                    id="file"
                    name="file"
                    type="file"
                    accept=".xlsx,.xls"
                    required
                    onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                    className="flex-1"
                  />
                </div>
                {fileName && <p className="text-sm text-muted-foreground">Archivo: {fileName}</p>}
              </div>

              <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 text-sm">
                <WarningCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>Los vehículos, proveedores y faenas deben existir previamente en el sistema. Las filas con entidades no encontradas serán omitidas.</p>
              </div>

              <div className="flex justify-end gap-3">
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.form?.reset()}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Importando..." : "Importar"}
                  <Upload className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </form>

            {state.message && (
              <div className="mt-4">
                <div className={`flex items-start gap-2 p-3 rounded-md text-sm ${state.ok ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300" : "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300"}`}>
                  {state.ok ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <WarningCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  <p>{state.message}</p>
                </div>

                {errors && errors.length > 0 && (
                  <div className="mt-3 max-h-60 overflow-y-auto">
                    <p className="text-sm font-medium mb-2">Errores encontrados:</p>
                    <ul className="text-sm space-y-1">
                      {errors.map((err, i) => (
                        <li key={i} className="text-red-600 dark:text-red-400">
                          Fila {err.rowIndex} — {err.field}: {err.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {typeof importedCount === "number" && (
                  <p className="mt-2 text-sm text-green-600">
                    ✓ {importedCount} cargas importadas exitosamente
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
