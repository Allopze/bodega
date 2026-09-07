/**
 * La Orden de Compra compuesta con los componentes pdfcn (base Takumi).
 *
 * Equivalente en contenido a `page.tsx`, no réplica de su CSS: las mismas
 * secciones, los mismos datos y **las mismas cadenas de texto**, maquetadas con
 * los componentes del registro en vez de con las 545 líneas de estilos de
 * impresión. Los importes salen de `oc-pdfcn-rows.ts`, que reutiliza los
 * formateadores de la vista de impresión.
 *
 * Este archivo no llama a `render()`: eso vive en `oc-pdfcn-render.ts`, para
 * que el árbol se pueda inspeccionar sin arrancar el motor wasm.
 */

import { DataTable } from "@/components/pdf/data-table/data-table"
import type { DataTableColumn } from "@/components/pdf/data-table/data-table.types"
import { Divider } from "@/components/pdf/divider/divider"
import { Heading } from "@/components/pdf/heading/heading"
import { KeyValue, type KeyValueEntry } from "@/components/pdf/key-value/key-value"
import { PdfImage } from "@/components/pdf/pdf-image/pdf-image"
import { Section } from "@/components/pdf/section/section"
import { Stack } from "@/components/pdf/stack/stack"
import { Text } from "@/components/pdf/text/text"
import { Text as RawText, View } from "@/components/pdf/lib/pdf-primitives"

import type { OcPrintData } from "./oc-print-data"
import { buildOcPdfRows, countPendingCostLines, pendingCostNotice, type OcPdfRow } from "./oc-pdfcn-rows"
import { formatOrderNumber, formatPlainCLP } from "./oc-print-formatters"

/** Ruta que `oc-pdfcn-render.ts` pre-carga en `images`. */
export const OC_LOGO_SRC = "/chome_logo.svg"

/**
 * Anchos en **puntos**, no en px CSS: `normalizeTakumiStyle` convierte todo
 * `width` numérico con `pointToCssPixel` (×96/72), que es la convención de los
 * componentes pdfcn. Takumi los aplica como caja de borde, así que el padding
 * de la celda va por dentro del número.
 *
 * La caja útil de un A4 con 12 mm de margen lateral es 527,2 pt (703 px CSS).
 * Las columnas fijas suman 306 pt y dejan 221 pt para Detalle, que es la única
 * que crece. Verificado sobre un PDF generado, midiendo la posición de cada
 * cabecera.
 *
 * Estos números van atados al padding de la celda compacta (3 pt por lado, ver
 * la reparación 6 del README de components/pdf): el ancho declarado incluye el
 * padding, así que subirlo obliga a ensanchar cada columna y se lo cobra
 * Detalle. Con los 8 pt de upstream las fijas necesitaban 368 pt y Detalle
 * bajaba a 156, partiendo casi todos los nombres de producto en dos líneas.
 *
 * Copiar los anchos de `page.tsx` NO funciona —probado—: su hoja usa celdas más
 * apretadas, y con sus 18/68/38/32/58/52/46 px la columna N° desaparece, las
 * cabeceras «Descuento» y «Total» se solapan y los importes salen cortados.
 *
 * Si se toca cualquier ancho hay que rehacer esa resta: Detalle se queda con lo
 * que sobre y es donde se nota, porque es la columna con el texto largo.
 */
const COLUMNS: DataTableColumn<OcPdfRow>[] = [
  { key: "n",         header: "N°",            width: 18 },
  { key: "sku",       header: "Cod. Articulo", width: 60 },
  {
    key: "nombre",
    header: "Detalle",
    // Celda multi-línea: el nombre y debajo las sub-notas (equipo, colaborador,
    // atributos, observaciones). El layout de Takumi es flex, así que la altura
    // de la fila la fija el contenido y no hay que reservarla.
    render: (_value, row) => (
      <View style={{ flexDirection: "column", gap: 1 }}>
        <RawText style={{ fontWeight: 600, fontSize: 8, lineHeight: 1.15 }}>{row.nombre}</RawText>
        {row.notas.map((nota, i) => (
          <RawText key={i} style={{ fontSize: 7, color: "#6a746d", lineHeight: 1.15 }}>{nota}</RawText>
        ))}
      </View>
    ),
  },
  { key: "cantidad",  header: "Cant.",       align: "right",  width: 30 },
  { key: "unidad",    header: "U.M.",        align: "center", width: 24 },
  // 66 pt y no menos: una línea sin precio imprime "Por definir", y por debajo
  // de ese ancho Takumi la parte en dos ("Por" / "definir"). Vale para las dos
  // columnas que pueden contener esa cadena, y es el suelo de ambas.
  { key: "unitario",  header: "P. Unitario", align: "right",  width: 66 },
  { key: "descuento", header: "Descuento",   align: "right",  width: 42 },
  { key: "total",     header: "Total",       align: "right",  width: 66 },
]

/** Como el `FieldLine` de la vista: una fila vacía no se imprime. */
function entries(pairs: [string, string | null | undefined][]): KeyValueEntry[] {
  return pairs
    .filter((pair): pair is [string, string] => !!pair[1]?.trim())
    .map(([key, value]) => ({ key, value }))
}

/** Geometría de `.field-row` de la hoja de impresión: 25 mm y 23 mm en puntos. */
const SUPPLIER_LABEL_WIDTH = 71
const SUPPLIER_RIGHT_LABEL_WIDTH = 65
/** `.supplier-panel` reparte `minmax(0, 1fr) 60mm`; 60 mm son 170 pt. */
const SUPPLIER_RIGHT_WIDTH = 170

/**
 * Fila etiqueta/valor del panel del proveedor, con la geometría de `.field-row`
 * de `oc-print-styles.ts`: etiqueta en columna fija y valor alineado a la
 * IZQUIERDA en lo que queda.
 *
 * No se usa `KeyValue` acá porque alinea el valor a la derecha (`flex: 1,
 * textAlign: "right"`), y un valor que envuelve dejaba la última palabra suelta
 * contra el borde derecho —«Av. Pedro Aguirre Cerda» / «4820»—, que además no
 * es lo que imprime la rama Chromium.
 */
function FieldRow({ label, value, labelWidth }: { label: string; value: string; labelWidth: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 3 }}>
      <View style={{ width: labelWidth }}>
        <RawText style={{ color: "#252a26", fontSize: 8.2, lineHeight: 1.35 }}>{label}</RawText>
      </View>
      <View style={{ flex: 1 }}>
        <RawText style={{ color: "#17221b", fontSize: 8.2, lineHeight: 1.35 }}>{value}</RawText>
      </View>
    </View>
  )
}

export function OcPdfcnIntro({ data }: { data: OcPrintData }) {
  const { order, company, issuedDate } = data

  // gap 16 pt ≈ los 6 mm que `.supplier-panel` pone de `margin-top`. Las dos
  // tarjetas llevan `spacing="none"` porque el `spacing="md"` que trae Section
  // por defecto son 28 pt de margen ARRIBA Y ABAJO: sumados al gap dejaban 60 pt
  // de vacío entre la cabecera y los datos del proveedor, 3,5 veces la hoja.
  return (
    <View style={{ flexDirection: "column", gap: 16 }}>
      <Stack direction="horizontal" justify="between" align="start">
        <Stack direction="horizontal" gap="sm" align="start">
          <PdfImage src={OC_LOGO_SRC} width={54} height={54} fit="contain" />
          <View style={{ flexDirection: "column" }}>
            <Heading level={4} noMargin>{company.name}</Heading>
            {entries([
              ["Giro", company.businessActivity],
              ["Casa Matriz", company.address],
              ["Fono", company.phone],
              ["Email", company.email],
              ["Web", company.website],
            ]).map((entry) => (
              <Text noMargin key={entry.key} variant="xs">{entry.key}: {entry.value}</Text>
            ))}
            {company.branchAddress?.trim() && (
              <>
                <Text noMargin variant="xs">Otras Direcciones o Sucursales:</Text>
                <Text noMargin variant="xs">{company.branchAddress}</Text>
              </>
            )}
          </View>
        </Stack>

        <Section variant="card" padding="sm" spacing="none">
          {company.rut && <Text noMargin variant="xs">R.U.T.: {company.rut}</Text>}
          <Heading level={4} noMargin>Orden de Compra</Heading>
          <Text noMargin weight="semibold">Nº {formatOrderNumber(order.code)}</Text>
        </Section>
      </Stack>

      <Section variant="card" padding="sm" spacing="none">
        <Stack direction="horizontal" gap="md" align="start">
          <View style={{ flex: 1, flexDirection: "column", gap: 2 }}>
            {entries([
              ["Señor(es):", order.supplier?.name],
              ["Giro:", order.supplier?.businessActivity],
              ["Direccion:", order.supplier?.address],
              ["Comuna:", order.supplier?.commune],
              ["Ciudad:", order.supplier?.city],
            ]).map((entry) => (
              <FieldRow key={entry.key} label={entry.key} value={entry.value} labelWidth={SUPPLIER_LABEL_WIDTH} />
            ))}
          </View>
          <View style={{ width: SUPPLIER_RIGHT_WIDTH, flexDirection: "column", gap: 2 }}>
            {entries([
              ["R.U.T.:", order.supplier?.rut],
              ["Fecha Emisión:", issuedDate],
              ["Forma Pago:", order.paymentTerms || order.supplier?.paymentTerms],
            ]).map((entry) => (
              <FieldRow key={entry.key} label={entry.key} value={entry.value} labelWidth={SUPPLIER_RIGHT_LABEL_WIDTH} />
            ))}
          </View>
        </Stack>
      </Section>
    </View>
  )
}

export function OcPdfcnItemsTable({
  data,
  rows,
}: {
  data: OcPrintData
  rows: OcPdfRow[]
}) {
  const supplierName = data.order.supplier?.name

  return (
    <View style={{ flexDirection: "column", gap: 2 }}>
      <View style={{ backgroundColor: "#f1f5f3", paddingHorizontal: 6, paddingVertical: 4 }}>
        <RawText style={{ color: "#17422b", fontSize: 7, fontWeight: 600, letterSpacing: 0.15 }}>
          Orden de Compra Nº {formatOrderNumber(data.order.code)}{supplierName ? ` · ${supplierName}` : ""}
        </RawText>
      </View>
      <DataTable columns={COLUMNS} data={rows} variant="grid" size="compact" />
    </View>
  )
}

/**
 * Cierre del documento: observaciones, totales y firma. Vive aparte para que
 * `oc-pdfcn-render.ts` pueda MEDIRLO y reservarle sitio en la última hoja de
 * ítems. Sin eso, la paginación llenaba la última hoja hasta el tope y empujaba
 * este bloque a una hoja nueva, que salía casi en blanco.
 */
export function OcPdfcnSummary({ data }: { data: OcPrintData }) {
  const { order, authorizedByName, authorizedDate, orderDetailLines, totalInWords } = data
  const pendingCostLines = countPendingCostLines(data)
  const aviso = pendingCostNotice(pendingCostLines)

  return (
    <View style={{ flexDirection: "column", gap: 8 }}>
      <Stack direction="horizontal" gap="md" align="start">
        <View style={{ flex: 1, flexDirection: "column", gap: 2 }}>
          {orderDetailLines.length > 0 && (
            <>
              <Text noMargin variant="xs" weight="semibold">Observaciones</Text>
              {orderDetailLines.map((line, i) => (
                <Text noMargin key={i} variant="xs">· {line}</Text>
              ))}
            </>
          )}
          <Text noMargin variant="xs" weight="semibold">{totalInWords}</Text>
          {aviso && <Text noMargin variant="xs">{aviso}</Text>}
        </View>

        <View style={{ width: 220 }}>
          <KeyValue
            size="sm"
            items={[
              { key: pendingCostLines > 0 ? "Neto conocido" : "Neto", value: `$ ${formatPlainCLP(order.netAmount)}` },
              { key: "IVA (19%)", value: `$ ${formatPlainCLP(order.taxAmount)}` },
            ]}
          />
          <Divider spacing="sm" />
          <KeyValue
            size="md"
            boldValue
            items={[{
              key:   pendingCostLines > 0 ? "Total conocido" : "Total",
              value: `$ ${formatPlainCLP(order.totalAmount)}`,
            }]}
          />
        </View>
      </Stack>

      {/* `spacing="sm"`: con el espaciado grande del tema, el bloque de firma
          empujaba solo a una hoja extra en OC cortas. */}
      <Section spacing="sm" padding="none">
        <Text noMargin variant="xs" weight="semibold">Autorización de emisión</Text>
        {authorizedByName && <Text noMargin weight="semibold">{authorizedByName}</Text>}
        <Divider spacing="sm" />
        {authorizedByName ? (
          <>
            <Text noMargin variant="xs">
              Firma electrónica simple{authorizedDate ? ` · ${authorizedDate}` : ""}
            </Text>
            <Text noMargin variant="xs">
              Persona responsable de la emisión de esta Orden de Compra
            </Text>
          </>
        ) : (
          <>
            <Text noMargin variant="xs">Pendiente de emisión</Text>
            <Text noMargin variant="xs">
              Nombre y firma de la persona responsable de la emisión de esta Orden de Compra
            </Text>
          </>
        )}
      </Section>
    </View>
  )
}

export function OcPdfcnDocument({
  data,
  rowChunks = [buildOcPdfRows(data)],
}: {
  data: OcPrintData
  rowChunks?: OcPdfRow[][]
}) {
  return (
    <View style={{ flexDirection: "column", gap: 8 }}>
      <OcPdfcnIntro data={data} />

      {rowChunks.map((rows, index) => (
        <View key={`items-page-${index}`} break={index > 0} wrap={false}>
          <OcPdfcnItemsTable data={data} rows={rows} />
        </View>
      ))}

      <OcPdfcnSummary data={data} />
    </View>
  )
}
