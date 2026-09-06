/**
 * Render de la OC con Takumi. Es el único archivo que importa `takumi-pdf`, para
 * que el documento y el mapeo de filas se puedan testear sin arrancar el wasm.
 *
 * Se importa el entry raíz (`takumi-pdf`) y **no** `takumi-pdf/next`: ese último
 * carga el binario con `import ... from "...wasm?module"`, convención de
 * bundler/edge. La condición `node` del entry raíz lo lee con `readFileSync`
 * relativo al módulo, que es lo que necesita este proyecto —runtime Node y
 * `output: "standalone"`—, igual que ya se resolvió para `pdfjs-dist`.
 *
 * Advertencia operativa: el render wasm **bloquea el event loop** mientras dura
 * (medido: ~98 ms para 40 líneas, ~260 ms para 300). No hay pool ni semáforo que
 * lo module, a diferencia de la rama Chromium: una OC larga frena las demás
 * peticiones del proceso. Si eso empieza a doler, la salida es un worker thread.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import { createElement } from "react"
import type { ReactNode } from "react"
import { measure, render } from "takumi-pdf"
import { View } from "@/components/pdf/lib/pdf-primitives"
import { A4_MARGIN, parseMmMargin } from "@/lib/pdf/page-options"
import {
  OcPdfcnDocument,
  OcPdfcnIntro,
  OcPdfcnItemsTable,
  OC_LOGO_SRC,
} from "./oc-pdfcn-document"
import { buildOcPdfRows, type OcPdfRow } from "./oc-pdfcn-rows"
import type { OcPrintData } from "./oc-print-data"

/**
 * Mismo texto que el `FOOTER_TEMPLATE` de `lib/pdf/page-options.ts`: los nodos
 * con clase `pageNumber` / `totalPages` reciben el contador, igual que las
 * plantillas de impresión de Chromium. Que la cadena coincida es lo que permite
 * a las pruebas afirmar lo mismo contra los dos motores.
 */
const FOOTER = `<div style="width:100%;font-family:sans-serif;font-size:7pt;color:#6a746d;text-align:center">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`

const A4_CSS_WIDTH = (210 / 25.4) * 96
const A4_CSS_HEIGHT = (297 / 25.4) * 96
const PAGE_MARGIN = parseMmMargin(A4_MARGIN)
const PAGE_CONTENT_WIDTH = A4_CSS_WIDTH - PAGE_MARGIN.left - PAGE_MARGIN.right
const PAGE_CONTENT_HEIGHT = A4_CSS_HEIGHT - PAGE_MARGIN.top - PAGE_MARGIN.bottom

// El logo no viaja por red: se lee del disco una vez por proceso. Takumi resuelve
// `src` contra las imágenes pre-cargadas, no contra un origen HTTP, así que esta
// rama no necesita `resolvePdfRenderOrigin` ni reenviar la cookie de sesión.
let logoPromise: Promise<Buffer> | null = null

function loadLogo(): Promise<Buffer> {
  if (!logoPromise) {
    logoPromise = readFile(path.join(process.cwd(), "public", "chome_logo.svg"))
      .catch((err) => {
        logoPromise = null
        throw err
      })
  }
  return logoPromise
}

async function measureWithinPage(
  node: ReactNode,
  logo: Buffer,
): Promise<number> {
  const measured = await measure(
    createElement(View, { style: { width: `${PAGE_CONTENT_WIDTH}px` } }, node),
    {
      size: "a4",
      images: [{ src: OC_LOGO_SRC, data: logo }],
      lang: "es-CL",
    },
  )
  return measured.height
}

async function largestFittingChunk(
  rows: OcPdfRow[],
  start: number,
  fits: (candidate: OcPdfRow[]) => Promise<boolean>,
): Promise<number> {
  const remaining = rows.length - start
  if (remaining <= 0) return 0

  let low = 1
  let high = remaining
  let best = 0
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    if (await fits(rows.slice(start, start + count))) {
      best = count
      low = count + 1
    } else {
      high = count - 1
    }
  }

  // A single pathological row can be taller than a page. Keep it in the
  // document rather than looping forever; Takumi will split that row itself.
  return best || 1
}

/**
 * Takumi 0.14.2 does not repeat a `thead` in the current WASM renderer even
 * though its HTML documentation describes that behavior. Each measured
 * fragment therefore owns its caption and column header, and continuation
 * fragments start on an explicit page. Measuring the same fragment that is
 * rendered avoids a fixed rows-per-page guess when Detail wraps differently.
 */
async function paginateOcRows(data: OcPrintData, logo: Buffer): Promise<OcPdfRow[][]> {
  const rows = buildOcPdfRows(data)
  if (rows.length === 0) return [[]]

  const firstCount = await largestFittingChunk(rows, 0, async (candidate) => {
    const height = await measureWithinPage(
      createElement(
        View,
        { style: { gap: 8 } },
        createElement(OcPdfcnIntro, { data }),
        createElement(OcPdfcnItemsTable, { data, rows: candidate }),
      ),
      logo,
    )
    return height <= PAGE_CONTENT_HEIGHT
  })

  const chunks: OcPdfRow[][] = [rows.slice(0, firstCount)]
  let start = firstCount
  while (start < rows.length) {
    const count = await largestFittingChunk(rows, start, async (candidate) => {
      const height = await measureWithinPage(
        createElement(OcPdfcnItemsTable, { data, rows: candidate }),
        logo,
      )
      return height <= PAGE_CONTENT_HEIGHT
    })
    chunks.push(rows.slice(start, start + count))
    start += count
  }
  return chunks
}

export async function renderOcPdf(data: OcPrintData): Promise<Uint8Array> {
  const logo = await loadLogo()
  const rowChunks = await paginateOcRows(data, logo)

  return render(OcPdfcnDocument({ data, rowChunks }), {
    size: "a4",
    margin: PAGE_MARGIN,
    footer: FOOTER,
    images: [{ src: OC_LOGO_SRC, data: logo }],
    lang: "es-CL",
    metadata: { title: `Orden de compra ${data.order.code}` },
  })
}
