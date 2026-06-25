"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Upload, FileText, CheckCircle, WarningCircle, ArrowLeft } from "@phosphor-icons/react"
import { parseFuelExcel, type ParsedFuelLoad, type ImportError } from "@/lib/combustibles/import"
import { toast } from "@/lib/toast"
import { useRouter } from "next/navigation"

type Step = "upload" | "preview" | "done"

export function ImportFuelLoadsWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [loads, setLoads] = useState<ParsedFuelLoad[]>([])
  const [errors, setErrors] = useState<ImportError[]>([])
  const [duplicates, setDuplicates] = useState<number[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: ImportError[]; created: Array<{ type: string; name: string }> } | null>(null)
  const [createMissing, setCreateMissing] = useState(false)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer
        const parsed = parseFuelExcel(buffer)
        setLoads(parsed.loads)
        setErrors(parsed.errors)
        setDuplicates(parsed.duplicates)
        setStep("preview")
      } catch {
        toast.error("Error al leer el archivo Excel")
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleConfirm() {
    // Pre-validate: check for critical issues
    if (loads.length === 0) {
      toast.error("No hay cargas válidas para importar")
      return
    }
    if (errors.length > 0 && loads.length === 0) {
      toast.error("Todas las filas tienen errores. Corrige el archivo e intenta de nuevo.")
      return
    }

    setImporting(true)
    try {
      const response = await fetch("/api/combustibles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loads, createMissing }),
      })
      const data = await response.json()
      if (data.ok) {
        setResult({ imported: data.imported, errors: data.errors ?? [], created: data.created ?? [] })
        setStep("done")
        toast.success(`${data.imported} cargas importadas`)
      } else {
        toast.error(data.message ?? "Error al importar")
      }
    } catch {
      toast.error("Error al importar")
    } finally {
      setImporting(false)
    }
  }

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Importar" }]} />
      <PageHeader title="Importar cargas desde Excel" description="Sube el archivo Excel de TCT Copec" />

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        <div className={`flex items-center gap-1.5 text-sm ${step === "upload" ? "font-semibold text-[var(--color-primary)]" : "text-muted-foreground"}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === "upload" ? "bg-[var(--color-primary)] text-white" : "bg-muted"}`}>1</span>
          Subir archivo
        </div>
        <div className="w-8 h-px bg-muted" />
        <div className={`flex items-center gap-1.5 text-sm ${step === "preview" ? "font-semibold text-[var(--color-primary)]" : "text-muted-foreground"}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === "preview" ? "bg-[var(--color-primary)] text-white" : "bg-muted"}`}>2</span>
          Revisar datos
        </div>
        <div className="w-8 h-px bg-muted" />
        <div className={`flex items-center gap-1.5 text-sm ${step === "done" ? "font-semibold text-[var(--color-success)]" : "text-muted-foreground"}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === "done" ? "bg-[var(--color-success)] text-white" : "bg-muted"}`}>3</span>
          Completado
        </div>
      </div>

      {step === "upload" && (
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Formato esperado
              </CardTitle>
              <CardDescription>
                Columnas: MES-AÑO, SERVICIO, VEHICULO, PROVEEDOR, CLIENTE, FAENA, PRODUCTO, FACTURA, LITROS, IEC Fijo, IEC Variable, Base Afecta, IMPUESTO IEC, IVA, TOTAL FACTURA A PAGAR
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Archivo Excel (.xlsx)</Label>
                  <Input type="file" accept=".xlsx,.xls" onChange={handleFile} />
                </div>
                <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 text-sm">
                  <WarningCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>Los vehículos, proveedores y faenas deben existir previamente en el sistema. Podrás revisar los datos antes de confirmar.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setStep("upload")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Volver
              </Button>
              <p className="text-sm text-muted-foreground">Archivo: <span className="font-mono">{fileName}</span></p>
            </div>
            <Button onClick={handleConfirm} disabled={importing || loads.length === 0}>
              {importing ? "Importando..." : `Confirmar importación (${loads.length} cargas)`}
            </Button>
          </div>

          {/* Auto-create option */}
          {errors.some(e => e.field === "VEHICULO" || e.field === "PROVEEDOR") && (
            <div className="flex items-center gap-2 p-3 bg-[var(--color-warning-tint)] rounded-md">
              <Checkbox
                id="createMissing"
                label="Crear automáticamente vehículos y proveedores faltantes"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
              />
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-[var(--color-success)]" />
                  <div>
                    <p className="text-2xl font-bold">{loads.length}</p>
                    <p className="text-xs text-muted-foreground">Cargas válidas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <WarningCircle className="h-5 w-5 text-[var(--color-danger)]" />
                  <div>
                    <p className="text-2xl font-bold">{errors.length}</p>
                    <p className="text-xs text-muted-foreground">Errores</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <WarningCircle className="h-5 w-5 text-[var(--color-warning)]" />
                  <div>
                    <p className="text-2xl font-bold">{duplicates.length}</p>
                    <p className="text-xs text-muted-foreground">Duplicados</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Errors list */}
          {errors.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base text-[var(--color-danger)]">Errores encontrados</CardTitle></CardHeader>
              <CardContent>
                <div className="max-h-40 overflow-y-auto space-y-1 text-sm">
                  {errors.map((err, i) => (
                    <p key={i} className="text-[var(--color-danger)]">Fila {err.rowIndex} — {err.field}: {err.message}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Preview table */}
          <Card>
            <CardHeader><CardTitle className="text-base">Vista previa ({loads.length} cargas)</CardTitle></CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto max-h-96 overflow-y-auto">
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
                        <TableCell className="font-mono text-xs">{l.rowIndex}</TableCell>
                        <TableCell className="font-mono text-xs">{l.loadDate}</TableCell>
                        <TableCell>{l.serviceType}</TableCell>
                        <TableCell>{l.vehicle}</TableCell>
                        <TableCell>{l.supplier}</TableCell>
                        <TableCell className="max-w-32 truncate">{l.worksite}</TableCell>
                        <TableCell>{l.product}</TableCell>
                        <TableCell className="font-mono text-xs">{l.receiptNumber}</TableCell>
                        <TableCell className="text-right font-mono">{l.liters.toLocaleString("es-CL")}</TableCell>
                        <TableCell className="text-right font-mono">{l.totalAmount.toLocaleString("es-CL")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {loads.length > 100 && <p className="text-xs text-muted-foreground mt-2">Mostrando 100 de {loads.length} cargas</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {step === "done" && result && (
        <div className="max-w-lg">
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <CheckCircle className="h-12 w-12 mx-auto text-[var(--color-success)]" />
              <div>
                <p className="text-2xl font-bold">{result.imported}</p>
                <p className="text-muted-foreground">cargas importadas exitosamente</p>
              </div>
              {result.created.length > 0 && (
                <div className="text-sm text-left p-3 bg-[var(--color-surface-2)] rounded-md">
                  <p className="font-medium mb-1">Entidades creadas automáticamente:</p>
                  {result.created.map((c, i) => <p key={i} className="text-muted-foreground">• {c.type}: {c.name}</p>)}
                </div>
              )}
              {result.errors.length > 0 && (
                <p className="text-sm text-[var(--color-warning)]">{result.errors.length} filas omitidas por errores</p>
              )}
              <div className="flex justify-center gap-3">
                <Button variant="secondary" onClick={() => { setStep("upload"); setResult(null); setLoads([]); setErrors([]) }}>
                  Importar otro archivo
                </Button>
                <Button onClick={() => router.push("/combustibles")}>
                  Ver dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  )
}
