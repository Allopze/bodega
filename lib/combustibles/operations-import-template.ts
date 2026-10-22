/**
 * Plantilla descargable del consolidado de cargas (I-05). Los encabezados son
 * EXACTAMENTE los que lee `parseFuelOperationsExcel`; la hoja «Instrucciones»
 * explica cada columna con los formatos que el importador acepta.
 */
import ExcelJS from "exceljs"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"

export const OPERATIONS_TEMPLATE_COLUMNS: ReadonlyArray<{ header: string; required: boolean; width: number; help: string }> = [
  { header: "Codigo", required: false, width: 12, help: "Código interno del equipo (ej. CAM-12). Si la patente ya existe, completa el código que falte." },
  { header: "Patente", required: true, width: 12, help: "Patente del equipo, con o sin guion (ej. AB1234 o AB-12-34). Es la llave para asociar la carga al equipo." },
  { header: "Fecha", required: true, width: 14, help: "Día de la carga en formato dd-mm-aaaa (ej. 15-01-2026) o una celda de fecha de Excel. Las fechas de relleno como 30-12-1899 se rechazan." },
  { header: "Hora Carga", required: false, width: 12, help: "Hora de la carga como celda de hora de Excel (HH:MM). Opcional; ayuda a distinguir varias cargas del mismo equipo en un día." },
  { header: "Faena", required: false, width: 22, help: "Nombre de la faena tal como está en la plataforma. Sin faena reconocida la carga se importa, pero queda fuera de los cálculos por faena hasta vincularla." },
  { header: "Tipo Equipo", required: false, width: 16, help: "Camion, Camioneta, Cargador, Tractor, Excavadora, Bulldozer, Minicargador, Retroexcavadora, Estanque, Tracto, Hidrolavadora, Station Wagon o Camion 3/4." },
  { header: "Marca", required: false, width: 14, help: "Marca del equipo." },
  { header: "Modelo", required: false, width: 14, help: "Modelo del equipo." },
  { header: "Año", required: false, width: 8, help: "Año de fabricación (4 dígitos)." },
  { header: "Horometro / Odometro", required: false, width: 18, help: "Lectura del tablero en la carga, con coma decimal (ej. 12.345,6). Debe ser la lectura real del medidor del equipo." },
  { header: "Medido Por Hora O Km", required: false, width: 18, help: "Hora o Km. Es solo informativo: la unidad del rendimiento (km/L o L/h) la define el medidor del equipo en el catálogo, no esta columna." },
  { header: "LT", required: true, width: 10, help: "Litros cargados, mayores que cero, con coma decimal (ej. 85,5). Las filas con 0 litros o vacías se rechazan." },
  { header: "Operador Conductor", required: false, width: 22, help: "Nombre de quien operó o condujo el equipo." },
  { header: "Supervisor Turno", required: false, width: 22, help: "Nombre del supervisor del turno." },
  { header: "Suministro Entregado Por:", required: false, width: 22, help: "Quién entregó el combustible (proveedor, surtidor, tarjeta). Se compara con el catálogo de proveedores y medios de suministro." },
  { header: "Rendimiento", required: false, width: 14, help: "Solo referencia. La plataforma NO usa este valor: calcula el rendimiento con las lecturas y los litros. Se guarda como «rendimiento declarado» para contrastarlo." },
  { header: "Tipo De Rendimiento", required: false, width: 18, help: "Km/Lt o Lt/Hr. Solo referencia; ver «Rendimiento»." },
  { header: "$/lt", required: false, width: 10, help: "Precio por litro en pesos." },
  { header: "Monto ($)", required: false, width: 12, help: "Monto total de la carga en pesos." },
]

export async function buildOperationsTemplateBase64(): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const data = workbook.addWorksheet("Cargas")
  data.columns = OPERATIONS_TEMPLATE_COLUMNS.map((column) => ({ header: column.header, key: column.header, width: column.width }))
  data.getRow(1).font = { bold: true }
  data.views = [{ state: "frozen", ySplit: 1 }]

  const guide = workbook.addWorksheet("Instrucciones")
  guide.columns = [
    { header: "Columna", key: "column", width: 28 },
    { header: "¿Obligatoria?", key: "required", width: 14 },
    { header: "Qué poner", key: "help", width: 110 },
  ]
  guide.getRow(1).font = { bold: true }
  for (const column of OPERATIONS_TEMPLATE_COLUMNS) {
    guide.addRow({ column: column.header, required: column.required ? "Sí" : "No", help: column.help })
  }
  guide.addRow({})
  const notes = [
    "Una fila por carga real. Borra cualquier fila de ejemplo antes de subir el archivo.",
    "Formatos: fechas dd-mm-aaaa; números con coma decimal (85,5) y punto de miles opcional (1.250,5).",
    "Unidad del rendimiento: km/L para equipos con odómetro y L/h para equipos con horómetro. La define el equipo en el catálogo de la plataforma, no el archivo.",
    "Qué se rechaza: patente vacía, fecha vacía, inválida o de relleno (30-12-1899), litros en cero o vacíos y sellos de relleno (777777, 666666, 000000).",
    "Qué se importa y se marca para revisión: proveedor desconocido, lectura menor que la anterior, rendimiento fuera de lo normal. Esas filas aparecen en Control › Revisión.",
    "Las filas rechazadas quedan guardadas con su motivo en el detalle del lote, con un Excel para corregirlas y volver a subirlas.",
  ]
  for (const note of notes) guide.addRow({ column: "Nota", help: note })
  guide.getColumn("help").alignment = { wrapText: true, vertical: "top" }
  return xlsxToBase64(workbook)
}
