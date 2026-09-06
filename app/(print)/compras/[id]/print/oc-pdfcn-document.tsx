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
 * Anchos en px CSS. La caja útil de un A4 con 12 mm de margen lateral es
 * 793.7 − 2×45.35 ≈ 703 px; las columnas fijas suman ~344 y el resto queda para
 * Detalle, que es la única que crece.
 */
const COLUMNS: DataTableColumn<OcPdfRow>[] = [
  { key: "n",         header: "N°",            width: 22 },
  { key: "sku",       header: "Cod. Articulo", width: 70 },
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
  { key: "cantidad",  header: "Cant.",       align: "right",  width: 40 },
  { key: "unidad",    header: "U.M.",        align: "center", width: 32 },
  // 76 px y no 62: una línea sin precio imprime "Por definir", y por debajo de
  // ese ancho Takumi la parte en dos ("Por" / "definir"). Vale para las dos
  // columnas que pueden contener esa cadena.
  { key: "unitario",  header: "P. Unitario", align: "right",  width: 76 },
  { key: "descuento", header: "Descuento",   align: "right",  width: 52 },
  { key: "total",     header: "Total",       align: "right",  width: 76 },
]

/** Como el `FieldLine` de la vista: una fila vacía no se imprime. */
function entries(pairs: [string, string | null | undefined][]): KeyValueEntry[] {
  return pairs
    .filter((pair): pair is [string, string] => !!pair[1]?.trim())
    .map(([key, value]) => ({ key, value }))
}

export function OcPdfcnIntro({ data }: { data: OcPrintData }) {
  const { order, company, issuedDate } = data

  return (
    <View style={{ flexDirection: "column", gap: 8 }}>
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

        <Section variant="card" padding="sm">
          {company.rut && <Text noMargin variant="xs">R.U.T.: {company.rut}</Text>}
          <Heading level={4} noMargin>Orden de Compra</Heading>
          <Text noMargin weight="semibold">Nº {formatOrderNumber(order.code)}</Text>
        </Section>
      </Stack>

      <Section variant="card" padding="sm">
        <Stack direction="horizontal" gap="md" align="start">
          <View style={{ flex: 1 }}>
            <KeyValue
              size="sm"
              items={entries([
                ["Señor(es):", order.supplier?.name],
                ["Giro:", order.supplier?.businessActivity],
                ["Direccion:", order.supplier?.address],
                ["Comuna:", order.supplier?.commune],
                ["Ciudad:", order.supplier?.city],
              ])}
            />
          </View>
          <View style={{ flex: 1 }}>
            <KeyValue
              size="sm"
              items={entries([
                ["R.U.T.:", order.supplier?.rut],
                ["Fecha Emisión:", issuedDate],
                ["Forma Pago:", order.paymentTerms || order.supplier?.paymentTerms],
              ])}
            />
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

export function OcPdfcnDocument({
  data,
  rowChunks = [buildOcPdfRows(data)],
}: {
  data: OcPrintData
  rowChunks?: OcPdfRow[][]
}) {
  const { order, authorizedByName, authorizedDate, orderDetailLines, totalInWords } = data
  const pendingCostLines = countPendingCostLines(data)
  const aviso = pendingCostNotice(pendingCostLines)

  return (
    <View style={{ flexDirection: "column", gap: 8 }}>
      <OcPdfcnIntro data={data} />

      {rowChunks.map((rows, index) => (
        <View key={`items-page-${index}`} break={index > 0} wrap={false}>
          <OcPdfcnItemsTable data={data} rows={rows} />
        </View>
      ))}

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
