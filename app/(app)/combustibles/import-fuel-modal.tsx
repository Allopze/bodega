"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, FileText, CheckCircle, WarningCircle, ArrowLeft } from "@phosphor-icons/react"
import { parseFuelExcel, type ParsedFuelLoad, type ImportError } from "@/lib/combustibles/import"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"

type Step = "upload" | "preview" | "done"

// Sentinels para el desplegable de mapeo de faenas (valores no vacíos: Radix
// Select no admite value="").
const CREATE_FAENA = "__create__"
const SKIP_FAENA = "__skip__"

type Worksite = { id: string; name: string }

/** Normaliza un nombre de faena para auto-emparejar: minúsculas, sin tildes,
 *  sin la palabra "faena", solo alfanumérico. */
function normFaena(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\bfaena\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()
}

/** Devuelve el worksiteId que mejor calza con la faena del Excel, o "" si
 *  ninguno. Coincidencia exacta normalizada o por contención de tokens. */
function autoMatchWorksite(fileFaena: string, worksites: Worksite[]): string {
  const target = normFaena(fileFaena)
  if (!target) return ""
  let best = ""
  let bestLen = 0
  for (const w of worksites) {
    const wn = normFaena(w.name)
    if (!wn) continue
    const hit = target === wn || target.includes(wn) || wn.includes(target)
    if (hit && wn.length > bestLen) { best = w.id; bestLen = wn.length }
  }
  return best
}

function resetState() {
  return {
    step: "upload" as Step,
    fileName: "",
    loads: [] as ParsedFuelLoad[],
    errors: [] as ImportError[],
    duplicates: [] as number[],
    importing: false,
    result: null as { imported: number; errors: ImportError[]; created: Array<{ type: string; name: string }> } | null,
    createMissing: false,
  }
}

export function ImportFuelLoadsModal({ worksites }: { worksites: Worksite[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [loads, setLoads] = useState<ParsedFuelLoad[]>([])
  const [errors, setErrors] = useState<ImportError[]>([])
  const [duplicates, setDuplicates] = useState<number[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: ImportError[]; created: Array<{ type: string; name: string }> } | null>(null)
  const [createMissing, setCreateMissing] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  // Mapeo faena-del-Excel → worksiteId | CREATE_FAENA | SKIP_FAENA | "" (sin elegir)
  const [faenaMap, setFaenaMap] = useState<Record<string, string>>({})

  // Faenas distintas presentes en el archivo, con su conteo de filas.
  const distinctFaenas = Array.from(
    loads.reduce((m, l) => m.set(l.worksite, (m.get(l.worksite) ?? 0) + 1), new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1])
  const allFaenasMapped = distinctFaenas.every(([f]) => faenaMap[f])

  function handleOpen(value: boolean) {
    if (!value) {
      // reset on close
      const s = resetState()
      setStep(s.step)
      setFileName(s.fileName)
      setLoads(s.loads)
      setErrors(s.errors)
      setDuplicates(s.duplicates)
      setImporting(s.importing)
      setResult(s.result)
      setCreateMissing(s.createMissing)
      setFaenaMap({})
    }
    setOpen(value)
  }

  function processFile(file: File) {
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error("El archivo debe ser .xlsx o .xls")
      return
    }
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer
        const parsed = await parseFuelExcel(buffer)
        setLoads(parsed.loads)
        setErrors(parsed.errors)
        setDuplicates(parsed.duplicates)
        // Pre-mapear cada faena del Excel con auto-match contra las del sistema.
        const distinct = Array.from(new Set(parsed.loads.map(l => l.worksite)))
        setFaenaMap(Object.fromEntries(distinct.map(f => [f, autoMatchWorksite(f, worksites)])))
        setStep("preview")
      } catch (err) {
        console.error("parseFuelExcel failed:", err)
        toast.error(`Error al leer el Excel: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    reader.onerror = () => {
      console.error("FileReader error:", reader.error)
      toast.error(`No se pudo leer el archivo: ${reader.error?.message ?? "error desconocido"}`)
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function handleConfirm() {
    if (loads.length === 0) {
      toast.error("No hay cargas válidas para importar")
      return
    }
    if (!allFaenasMapped) {
      toast.error("Asigna todas las faenas del Excel antes de importar")
      return
    }

    setImporting(true)
    try {
      const response = await fetch("/api/combustibles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loads, createMissing, faenaMapping: faenaMap }),
      })
      const data = await response.json()
      if (data.ok) {
        setResult({ imported: data.imported, errors: data.errors ?? [], created: data.created ?? [] })
        setStep("done")
        toast.success(`${data.imported} cargas importadas`)
      } else {
        toast.error(data.message ?? "Error al importar")
      }
    } catch (err) {
      console.error("import request failed:", err)
      toast.error(`Error al importar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  function handleClose() {
    if (step === "done") router.refresh()
    handleOpen(false)
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1.5" />
        Importar Excel
      </Button>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className={cn("w-[calc(100%-2rem)]", step === "preview" ? "max-w-4xl" : "max-w-xl")}>
          <DialogHeader>
            <DialogTitle>Importar cargas desde Excel</DialogTitle>
            <DialogDescription>Sube el archivo Excel de TCT Copec</DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-4">
            {(["upload", "preview", "done"] as const).map((s, i) => {
              const labels = ["Subir archivo", "Revisar datos", "Completado"]
              const active = step === s
              const isLast = i === 2
              return (
                <div key={s} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 text-sm ${active ? `font-semibold ${isLast ? "text-[var(--color-success)]" : "text-[var(--color-primary)]"}` : "text-muted-foreground"}`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${active ? (isLast ? "bg-[var(--color-success)] text-white" : "bg-[var(--color-primary)] text-white") : "bg-muted"}`}>
                      {i + 1}
                    </span>
                    {labels[i]}
                  </div>
                  {i < 2 && <div className="w-8 h-px bg-muted" />}
                </div>
              )
            })}
          </div>

          {step === "upload" && (
            <div className="space-y-3">
              <label
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 cursor-pointer text-center",
                  "rounded-[var(--radius-xl)] border-2 border-dashed px-6 py-10",
                  "transition-[border-color,background-color] duration-[var(--duration-fast)]",
                  dragActive
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)]"
                    : "border-[var(--color-border)] hover:border-[var(--color-primary-line)] hover:bg-[var(--color-surface-2)]",
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary-tint)]">
                  <Upload className="h-6 w-6 text-[var(--color-primary)]" weight="bold" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    Arrastra tu archivo aquí o <span className="text-[var(--color-primary)]">haz clic para buscar</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Excel de TCT Copec — .xlsx o .xls</p>
                </div>
                <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="sr-only" />
              </label>

              <details className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3.5 py-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Formato esperado
                </summary>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Columnas: MES-AÑO, SERVICIO, VEHICULO, PROVEEDOR, CLIENTE, FAENA, PRODUCTO, FACTURA, LITROS, IEC Fijo, IEC Variable, Base Afecta, IMPUESTO IEC, IVA, TOTAL FACTURA A PAGAR
                </p>
              </details>

              <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 text-sm">
                <WarningCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>Los vehículos, proveedores y faenas deben existir previamente en el sistema. Podrás revisar los datos antes de confirmar.</p>
              </div>
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
                <Button onClick={handleConfirm} disabled={importing || loads.length === 0 || !allFaenasMapped}>
                  {importing ? "Importando..." : `Confirmar (${loads.length} cargas)`}
                </Button>
              </div>

              {loads.length > 0 && (
                <div className="flex items-center gap-2 p-3 bg-[var(--color-warning-tint)] rounded-md">
                  <Checkbox
                    id="createMissing"
                    label="Crear automáticamente vehículos y proveedores faltantes"
                    checked={createMissing}
                    onChange={(e) => setCreateMissing(e.target.checked)}
                  />
                </div>
              )}

              {distinctFaenas.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Mapeo de faenas ({distinctFaenas.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Asocia cada faena del Excel con una del sistema. Las que no existan
                      puedes crearlas u omitir sus filas. {!allFaenasMapped && (
                        <span className="text-[var(--color-danger)]">Faltan faenas por asignar.</span>
                      )}
                    </p>
                    {distinctFaenas.map(([faena, count]) => (
                      <div key={faena} className="flex items-center gap-3">
                        <span className="flex-1 truncate text-sm" title={faena}>
                          {faena} <span className="font-mono text-muted-foreground">({count})</span>
                        </span>
                        <Select
                          value={faenaMap[faena] || undefined}
                          onValueChange={(v) => setFaenaMap((m) => ({ ...m, [faena]: v }))}
                        >
                          <SelectTrigger className="w-64">
                            <SelectValue placeholder="Elegir faena…" />
                          </SelectTrigger>
                          <SelectContent>
                            {worksites.map((w) => (
                              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                            ))}
                            <SelectItem value={CREATE_FAENA}>➕ Crear faena «{faena}»</SelectItem>
                            <SelectItem value={SKIP_FAENA}>⊘ Omitir estas filas</SelectItem>
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
                  <CardHeader><CardTitle className="text-sm text-[var(--color-danger)]">Errores encontrados</CardTitle></CardHeader>
                  <CardContent>
                    <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                      {errors.map((err, i) => (
                        <p key={i} className="text-[var(--color-danger)]">Fila {err.rowIndex} — {err.field}: {err.message}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle className="text-sm">Vista previa ({loads.length} cargas)</CardTitle></CardHeader>
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
            <div className="text-center space-y-4 py-4">
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
                <div className="text-sm text-left p-3 bg-[var(--color-warning-tint)] rounded-md">
                  <p className="font-medium text-[var(--color-warning)] mb-1">
                    {result.errors.length} filas omitidas por errores:
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-0.5 text-muted-foreground">
                    {Object.entries(
                      result.errors.reduce<Record<string, number>>((acc, e) => {
                        const key = `${e.field}: ${e.message}`
                        acc[key] = (acc[key] ?? 0) + 1
                        return acc
                      }, {}),
                    )
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, count]) => (
                        <p key={reason}>• {reason} <span className="font-mono">({count})</span></p>
                      ))}
                  </div>
                </div>
              )}
              <div className="flex justify-center gap-3">
                <Button variant="secondary" onClick={() => {
                  const s = resetState()
                  setStep(s.step)
                  setFileName(s.fileName)
                  setLoads(s.loads)
                  setErrors(s.errors)
                  setResult(s.result)
                }}>
                  Importar otro archivo
                </Button>
                <Button onClick={handleClose}>Cerrar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
