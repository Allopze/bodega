"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ArrowLeft, CheckCircle, WarningCircle } from "@phosphor-icons/react"
import type { ParsedFuelLoad, ImportError } from "@/lib/combustibles/import"
import { CREATE_FAENA, SKIP_FAENA } from "./import-fuel-modal.helpers"
import type { Worksite } from "./import-fuel-modal.helpers"

interface PreviewStepProps {
  fileName: string
  loads: ParsedFuelLoad[]
  errors: ImportError[]
  duplicates: number[]
  importing: boolean
  createMissing: boolean
  distinctFaenas: Array<[string, number]>
  faenaMap: Record<string, string>
  allFaenasMapped: boolean
  worksites: Worksite[]
  onBack: () => void
  onConfirm: () => void
  onToggleCreateMissing: (checked: boolean) => void
  onFaenaMapChange: (faena: string, value: string) => void
}

export function PreviewStep({
  fileName,
  loads,
  errors,
  duplicates,
  importing,
  createMissing,
  distinctFaenas,
  faenaMap,
  allFaenasMapped,
  worksites,
  onBack,
  onConfirm,
  onToggleCreateMissing,
  onFaenaMapChange,
}: PreviewStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <p className="text-sm text-muted-foreground">
            Archivo: <span className="font-mono">{fileName}</span>
          </p>
        </div>
        <Button
          onClick={onConfirm}
          disabled={importing || loads.length === 0 || !allFaenasMapped}
        >
          {importing
            ? "Importando..."
            : `Confirmar (${loads.length} cargas)`}
        </Button>
      </div>

      {loads.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-[var(--color-warning-tint)] rounded-md">
          <Checkbox
            id="createMissing"
            label="Crear automáticamente vehículos y proveedores faltantes"
            checked={createMissing}
            onChange={(e) => onToggleCreateMissing(e.target.checked)}
          />
        </div>
      )}

      {distinctFaenas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Mapeo de faenas ({distinctFaenas.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Asocia cada faena del Excel con una del sistema. Las que no
              existan puedes crearlas u omitir sus filas.{" "}
              {!allFaenasMapped && (
                <span className="text-[var(--color-danger)]">
                  Faltan faenas por asignar.
                </span>
              )}
            </p>
            {distinctFaenas.map(([faena, count]) => (
              <div key={faena} className="flex items-center gap-3">
                <span
                  className="flex-1 truncate text-sm"
                  title={faena}
                >
                  {faena}{" "}
                  <span className="font-mono text-muted-foreground">
                    ({count})
                  </span>
                </span>
                <Select
                  value={faenaMap[faena] || undefined}
                  onValueChange={(v) => onFaenaMapChange(faena, v)}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Elegir faena…" />
                  </SelectTrigger>
                  <SelectContent>
                    {worksites.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={CREATE_FAENA}>
                      ➕ Crear faena «{faena}»
                    </SelectItem>
                    <SelectItem value={SKIP_FAENA}>
                      ⊘ Omitir estas filas
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-[var(--color-success)]" />
              <div>
                <p className="text-xl font-bold">{loads.length}</p>
                <p className="text-xs text-muted-foreground">Válidas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <WarningCircle className="h-5 w-5 text-[var(--color-danger)]" />
              <div>
                <p className="text-xl font-bold">{errors.length}</p>
                <p className="text-xs text-muted-foreground">Errores</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <WarningCircle className="h-5 w-5 text-[var(--color-warning)]" />
              <div>
                <p className="text-xl font-bold">{duplicates.length}</p>
                <p className="text-xs text-muted-foreground">Duplicados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[var(--color-danger)]">
              Errores encontrados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
              {errors.map((err, i) => (
                <p key={i} className="text-[var(--color-danger)]">
                  Fila {err.rowIndex} — {err.field}: {err.message}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Vista previa ({loads.length} cargas)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Serv.</TableHead>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Nro Fact.</TableHead>
                  <TableHead className="text-right">Litros</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loads.slice(0, 100).map((l) => (
                  <TableRow key={l.rowIndex}>
                    <TableCell className="font-mono text-xs">
                      {l.rowIndex}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.loadDate}
                    </TableCell>
                    <TableCell>{l.serviceType}</TableCell>
                    <TableCell>{l.vehicle}</TableCell>
                    <TableCell>{l.supplier}</TableCell>
                    <TableCell className="max-w-32 truncate">
                      {l.worksite}
                    </TableCell>
                    <TableCell>{l.product}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.receiptNumber}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {l.liters.toLocaleString("es-CL")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {l.totalAmount.toLocaleString("es-CL")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {loads.length > 100 && (
            <p className="text-xs text-muted-foreground mt-2">
              Mostrando 100 de {loads.length} cargas
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
