# Auditoría integral — OCR de facturas adjuntas

**Fecha:** 2026-07-30  
**Muestra auditada:** `DOC-33-3064428.pdf` (Factura electrónica Treck S.A., folio 3064428)  
**Alcance:** carga de factura de OC, API de extracción, extracción PDF/OCR, parser, modelo de datos, UI de conciliación y pruebas. El alcance original no modificó lógica; la reauditoría analiza los fixes posteriores.

> **Actualización de reauditoría — 2026-07-30 (posterior a los fixes):** el problema concreto del PDF textual de Treck está corregido, pero el OCR de facturas como capacidad general **no está listo para declararse resuelto**. La rama PDF con texto y el contrato DTE mejoraron; el fallback para PDF escaneado falla en el runtime actual y la interfaz aún puede perder líneas no asociadas a la OC. Los hallazgos y evidencia vigentes están en la siguiente sección; el diagnóstico histórico se conserva abajo como línea base.

## Segunda pasada de cierre — 2026-07-31

**Qué la motivó:** los hallazgos que la pasada anterior dejó abiertos eran, casi todos, de cobertura: el módulo se probaba con el motor OCR simulado. Al ejercitarlo de verdad (SVG → PNG → PDF sintético, sharp + Tesseract + parser, sin mocks) aparecieron dos defectos de parser que ninguna prueba con texto fabricado podía ver.

| Hallazgo previo | Estado ahora | Evidencia |
|---|---|---|
| **P0** Runtime de PDF/OCR incompatible | **No se reproduce** | Con el código actual (build `legacy` de `pdfjs-dist` + rasterizado por `@napi-rs/canvas`) el PDF escaneado se rasteriza y el OCR recupera folio y total **incluso en Node 20.19**. El test corre sin gating por versión: si un runtime vuelve a romperlo, falla en vez de saltarse. |
| **P1** Confianza 100% ≠ verificada | **Corregido** | `ExtractionResult.confidence` se reemplazó por `quality: { coverage, engineConfidence, totalsConsistent }`. La UI ya no anuncia un porcentaje de "confianza" sobre un puntaje de presencia y avisa aparte cuando neto + IVA no cuadra con el total. La confianza de *conciliación* queda donde siempre estuvo: la resuelve el operador línea por línea. |
| **P1** Advertencias sin auditar | **Corregido** | `POST /api/purchase-orders/invoices/extract` registra método, cobertura, confianza del motor, cuadratura, tamaño y número de advertencias. No registra folio, RUT ni montos. |
| **P2** Cobertura insuficiente | **Corregido** | `lib/services/purchasing-module/invoice-ocr.test.ts` ejercita OCR real sobre imagen y sobre PDF escaneado, más el caso sin `traineddata` local (debe quedar manual, nunca caer a la CDN). Los fixtures se generan en el test: un comprobante tributario real no se versiona. |
| Matriz de fixtures por proveedor/layout | **Pendiente** | Sigue habiendo un solo layout sintético. Para prometer cobertura por proveedor hace falta una matriz de documentos reales autorizados, que este repo no puede alojar. |

### Defectos de parser que sólo aparecieron con OCR real

| Defecto | Efecto | Corrección |
|---|---|---|
| El ordinal `N°` se exigía literal | Tesseract lo rinde como `N*`, `N?`, `No` o `N` según resolución y tipografía. **Toda factura escaneada perdía el folio**, y sin folio el extractor la declara "manual": el operador retipeaba todo aunque el OCR hubiera leído bien el documento. | `ORDINAL` tolera las degradaciones habituales del ordinal. |
| `Total\s*:?\s*(…)` cruzaba el salto de línea | El encabezado de columna "… PRECIO **TOTAL**" seguido de la fila "**05-03-008** GUANTE …" daba un total de **$5**. No es un caso raro: es el layout normal de una factura con tabla. | Los montos se leen anclados a su línea (`[^\S\n]`), se descarta un número que continúa con `-` o `/` (códigos y fechas) y se prefiere la última aparición, porque los totales van al pie. |

### Runtime

CI y deploy corrían en Node 20 mientras `engines` y la imagen de producción exigen 22.13: se validaba sobre un runtime distinto del que se despliega — precisamente el punto que dejó este fallback sin cobertura confiable. Ambos workflows quedaron en 22.13.

## Cierre de implementación — 2026-07-30

**Estado final: GO para desplegar los controles de seguridad y trazabilidad; OCR sigue siendo asistido, no una conciliación automática.** La condición anterior de P0 —fallback de PDF no ejecutable en la imagen productiva— quedó cerrada. No se autoriza tratar una extracción OCR como dato conciliado sin la revisión que ahora exige la interfaz.

| Hallazgo auditado | Estado tras implementación | Evidencia |
|---|---|---|
| Runtime PDF/OCR incompatible | **Corregido** | Imagen actualizada a Node 22.13, compatible con `pdfjs-dist@6.1.200`; la imagen final rasterizó el PDF y ejecutó Tesseract. |
| Dependencia de red para modelos | **Corregido** | `spa` y `eng` se empaquetan desde dependencias directas, se usan por `langPath` local y `cacheMethod: "none"`. La prueba se ejecutó con `--network none`. |
| Dependencias dinámicas omitidas por standalone | **Corregido** | Se trazó `pdfjs-dist` y se copió la clausura del worker de Tesseract (`bmp-js`, `node-fetch` y dependencias) al contenedor final. |
| Línea OCR sin match de OC perdida | **Corregido** | Se conserva nombre, código y unidad documentales; queda en estado `needs_review` hasta asociar una línea de OC o confirmar explícitamente “sin asociar”. La acción del servidor rechaza el envío ambiguo. |
| Nombre de OC sustituía el documento | **Corregido** | El formulario persiste el nombre literal extraído y muestra la referencia de OC por separado. |
| Éxito con datos semánticamente pobres | **Corregido** | OCR exige folio, fecha y total válidos. Si sólo hay texto/confianza sin esos campos, devuelve `manual` con advertencias visibles. |
| Cabecera PDF sin detalle | **Corregido** | Conserva la cabecera PDF, intenta OCR para las líneas y devuelve `pdf_text_ocr` con diagnósticos, nunca una certeza silenciosa. |
| Sin límites de rasterización | **Corregido** | Máximo configurable de 10 páginas (tope 20), 24 MP por página (tope 48 MP) y procesamiento secuencial de render/worker. |
| Matching ambiguo | **Corregido** | Normaliza código/nombre, usa unidad sólo para desambiguar y deja cualquier múltiple candidato sin enlace. |

### Evidencia de aceptación posterior

```text
Imagen: plataforma-chome:ocr-fixes (Node v22.13.1)
Prueba offline: Docker --network none, usuario nextjs
Documento: DOC-33-3064428.pdf rasterizado con pdfjs + @napi-rs/canvas
Tesseract spa+eng local: 1.682 caracteres, confianza 72%, folio 3064428 presente

Gates de código:
  tsc --noEmit: PASS
  db:verify-migrations: PASS (132 entradas, hasta 0131)
  26/26 pruebas focalizadas: PASS
  eslint focal: PASS
  Docker build final: PASS
```

La misma muestra es un PDF textual y se resuelve por la ruta preferida `pdf_text`; se usó rasterizada sólo para demostrar que el fallback productivo arranca sin red. Su texto OCR no supera los nuevos gates semánticos de folio+fecha+total de forma fiable, por lo que el sistema lo deja manual con advertencias en vez de inventar una conciliación. Falta todavía una matriz de fixtures autorizados de PDF escaneado y JPG/PNG con expectativas por proveedor/layout antes de prometer cobertura universal.

## Reauditoría posterior a los fixes

### Veredicto

**Estado: PARCIAL / NO-GO para afirmar “OCR funcional para cualquier factura”.**

| Capacidad | Estado | Evidencia actual |
|---|---|---|
| PDF textual con el layout de Treck | **Corregido** | La ejecución real entrega método `pdf_text`, folio 3064428, fecha 2026-07-14, Treck S.A., RUT 96.542.490-3, neto 57.500, IVA 10.925, total 68.425 y la línea de 50 guantes a 1.150, con código `05-03-008-T-XL`. |
| Unidad de DTE XML | **Corregido en código; pendiente de migración en destino** | `UnmdItem` llega al contrato común, UI y columnas `product_code`/`unit_of_measure` de la migración 0131. El test cubre `PAR`. Debe ejecutarse `db:migrate` antes de desplegar código que consulte la columna. |
| Unidad ausente en el comprobante | **Correcto para la muestra** | La línea Treck queda con `unitOfMeasure: null`; no se inventa `UN` ni se copia silenciosamente desde la OC. |
| PDF escaneado / fallback OCR | **No probado y actualmente fallando** | La prueba directa del fallback sobre el PDF de muestra rasteriza 1 página, retorna confianza 0,35 y sólo 9 caracteres (`—`, `_`, `nu`, `—`). El proceso registra `buffer.transferToFixedLength is not a function`. |
| Imagen JPG/PNG real | **No probado** | No existe fixture ni prueba end-to-end que confirme extracción, unidades, conservación y guardado. |
| Línea no asociada a una OC | **Defectuoso** | La UI presenta “Ítem”, pero envía `productName` vacío y la Server Action la descarta silenciosamente. |

### Cambios que sí resolvieron la causa inicial

1. El parser ya no aplana el texto usado para las líneas. Para cabeceras conserva una versión normalizada y para la tabla usa el texto original.
2. Se añadió el patrón de columnas emitido por Crystal Reports (`precio`, `total`, `cantidad`, `descripción`, `código`) y validación aproximada `cantidad × precio = monto` de esa fila.
3. El modelo de ítem común, la persistencia y la vista incorporan código y unidad documental; DTE XML ya no pierde `UnmdItem`.
4. El endpoint de preextracción ahora reutiliza máximo de tamaño y validación de bytes mágicos de la carga definitiva.
5. La imagen de producción compila con el import de canvas diferido, evitando el error de empaquetado de Turbopack.

### Hallazgos vigentes

| Prioridad | Hallazgo | Evidencia | Riesgo / corrección requerida |
|---|---|---|---|
| **P0** | El OCR de PDFs escaneados falla por incompatibilidad de runtime. | El proyecto y la imagen usan Node 20; `pdfjs-dist@6.1.200` declara Node `>=22.13.0 || >=24`. Al llamar `extractInvoiceTextOcr()` aparece `buffer.transferToFixedLength is not a function` y el texto es inútil. | No desplegar el fallback como capacidad operativa hasta elevar Node a una versión soportada o fijar un renderer compatible y probarlo en la imagen final. El warning debe convertirse en error estructurado, no quedar en stderr. |
| **P0** | Una línea extraída sin match de OC se pierde antes de persistir. | `matchItemsToOcItems()` devuelve `ocItemId: null`; `lineItems` lo convierte a `""`; la UI usa `ocItem?.productName ?? ""` en el input oculto; `addInvoiceAction()` sólo inserta si `productName && quantity > 0`. | Conservar nombre/código/unidad extraídos en el estado, permitir que el operador seleccione la línea OC o confirme “sin vínculo”, y bloquear el envío mientras exista una línea no resuelta. Nunca descartarla silenciosamente. |
| **P1** | El resultado OCR puede declararse exitoso aunque el parser no haya reconocido campos útiles. | En las ramas OCR basta `ocrResult.text && confidence > 0.4`; se devuelve `data: parsed` sin exigir la confianza calculada ni campos mínimos. La UI considera cualquier `result.data` como éxito. | Exigir identidad y total válidos, o al menos un umbral de `calculateConfidence`, antes de devolver método `ocr`; entregar advertencias por campo y estado “requiere revisión”. |
| **P1** | Un PDF con cabecera fácil pero tabla fallida no llega a OCR. | La ruta `pdf_text` retorna con confianza mayor a 0,3 aunque no haya ítems; por diseño la presencia de folio, fecha y total ya supera el umbral. | Decidir por campo: conservar cabecera PDF, pero invocar OCR de página cuando la tabla sea requerida y esté vacía/no cuente aritméticamente. No usar una sola cifra global como corte. |
| **P1** | Confianza 100% no significa extracción verificada. | `calculateConfidence()` suma sólo presencia de folio, fecha, total e ítems. La muestra da 100% aunque la unidad no está declarada y no hay verificación de neto+IVA=total ni de vínculo OC. | Separar `coverage`, `document confidence` y `reconciliation confidence`; comprobar totales, líneas, código/unidad y match antes de automatizar valores. |
| **P1** | Las advertencias de OCR no llegan al usuario ni quedan auditadas. | `OcrInvoiceResult.warning` existe, pero `ExtractionResult` no tiene diagnósticos; `extractInvoiceData()` captura errores vacíamente; la UI sólo muestra un toast genérico. | Propagar `warnings`, página, motivo de fallback y campos ausentes al API/UI; registrar telemetría sin guardar contenido tributario sensible. |
| **P1** | El modelo entrenado no está empaquetado ni configurado localmente. | No hay archivos `*.traineddata` bajo `tesseract.js`/`tesseract.js-core`; `createWorker("spa+eng")` no define `langPath` ni cache. | Empaquetar/versionar datos `spa` y `eng` o configurar almacenamiento/cache explícitos y validar arranque offline en la imagen. No depender de red en una carga productiva. |
| **P1** | El nombre documental se sustituye por el nombre de la OC tras un match. | La UI persiste `ocItem?.productName` en vez de `m.item.productName`. Una discrepancia del proveedor queda invisible, aun si se guarda su código/unidad. | Guardar el texto literal de factura separado del nombre OC, mostrar ambos y requerir revisión si divergen. |
| **P2** | La rasterización no tiene límites de páginas, píxeles ni tiempo. | `rasterizePdfPages()` hace `Promise.all` de todas las páginas a escala 2 y el worker las procesa después; el límite de MB no limita cantidad ni área de páginas. | Definir máximo de páginas/píxeles/duración y procesar con cola acotada; devolver una causa accionable al superar el límite. |
| **P2** | Matching de catálogo incompleto y potencialmente ambiguo. | Código se compara de forma exacta; luego nombre por inclusión en ambos sentidos y primer resultado. No considera unidad, precio ni múltiples candidatos. | Normalizar SKU, producir candidatos, preferir código+unidad+precio y exigir intervención humana ante más de una coincidencia. |
| **P2** | Cobertura de pruebas insuficiente para los cambios de mayor riesgo. | Los 22 tests focalizados cubren parser textual, DTE y extractor PDF mínimo. No cubren rasterización real, PDF escaneado, JPG/PNG, ausencia de traineddata, API multipart, UI, persistencia ni líneas sin match. | Añadir fixtures sintéticos de imagen/PDF escaneado y pruebas de servicio/UI que comprueben no pérdida, diagnósticos y persistencia de unidad/código. |

### Evidencia de la reauditoría

```text
PDF Treck, extractInvoiceData()
  method: pdf_text, confidence: 1
  folio: 3064428; fecha: 2026-07-14; total: 68425
  ítem: 50 × 1150; código 05-03-008-T-XL; unidad null (no declarada)

PDF Treck, extractInvoiceTextOcr() forzado
  stderr: buffer.transferToFixedLength is not a function
  pageCount: 1; confidence: 0.35; textLength: 9
  texto: — / _ / nu / —

Runtime
  Node: v20.19.2
  pdfjs-dist@6.1.200 engines: >=22.13.0 || >=24

Gates
  22/22 tests focalizados: PASS
  npx tsc --noEmit: PASS
  npm run db:verify-migrations: PASS (0131 incluida)
  build de producción: PASS en host e imagen Docker
```

### Cierre y orden de corrección

La corrección previa es **suficiente para `DOC-33-3064428.pdf` como PDF textual**, y corrige la pérdida de unidad desde DTE XML en código. No es suficiente para el objetivo más amplio de OCR de facturas.

1. **Antes de habilitar OCR para escaneados:** resolver el runtime Node/pdfjs y demostrar reconocimiento de un PDF escaneado y JPG/PNG dentro de la imagen Docker, sin red.
2. **Antes de confiar conciliación de líneas:** impedir la pérdida de ítems no asociados y preservar siempre el nombre literal del documento.
3. **Antes de automatizar datos:** reemplazar la confianza por presencia por validación aritmética/semántica y diagnóstico visible por campo.
4. **Después:** fijar límites de recursos, telemetría y una matriz de fixtures con aceptación por proveedor/layout.

El estado de aceptación original queda reemplazado por este veredicto: **GO sólo para el layout textual verificado y DTE XML después de aplicar la migración; NO-GO para OCR de PDF escaneado, imágenes y conciliación automática no ambigua.**

## Línea base histórica — auditoría previa a los fixes

## Resumen ejecutivo

El flujo no es todavía un OCR de facturas fiable: es un extractor por expresiones regulares con OCR como último recurso. En la muestra, el PDF contiene texto digital y la línea de detalle (`50` unidades de guante, precio unitario `$1.150`, total `$57.500`), pero el resultado real de `extractInvoiceData()` es `{ data: null, method: "manual", confidence: 0 }`.

La razón inmediata no es que el documento sea ilegible. Es una combinación de contrato incompleto y parser no apto para el orden visual de un PDF de factura:

1. El parser aplana todos los saltos de línea antes de intentar extraer líneas, por lo que su propio `extractItems()` nunca puede iterar líneas de detalle.
2. Su única expresión de ítem sólo acepta `descripción + cantidad + precio + total`. La extracción de este PDF entrega las columnas por posición de pantalla y en otro orden: precio, total, cantidad y descripción.
3. `ParsedInvoiceItem`, la respuesta de API, el formulario y `purchase_order_invoice_items` no modelan `unitOfMeasure`. El XML DTE sí lee `UnmdItem`, pero `invoice-extractor.ts` lo descarta al adaptarlo al contrato común.
4. Si el texto del PDF no da confianza suficiente, el supuesto fallback OCR pasa el PDF directamente a `sharp`; para esta muestra devuelve texto vacío y confianza 0. No hay rasterización de las páginas PDF ni diagnóstico del fallo.

Por tanto, no es correcto prometer que “se auto-extraen datos” de PDF/JPG/PNG como si fueran equivalentes. XML DTE es la única ruta estructurada y con semántica de unidad; PDFs e imágenes son best-effort y hoy no son verificables ni suficientes para conciliación de ítems.

## Evidencia reproducida con DOC-33-3064428.pdf

| Comprobación | Resultado | Interpretación |
|---|---:|---|
| Archivo | PDF de 1 página, 89 KB, generado por Crystal Reports | No es una imagen escaneada; hay capa de texto. |
| `extractTextFromPdf()` | 1 página y texto extraído | El extractor PDF funciona a nivel de texto. |
| Texto de detalle | `1.150   57.500 50 Guante Cabritilla Activex con Forro gris T- XL 05-03-008-T-XL` | La cantidad, precio, total, nombre y código están presentes, pero no en el patrón asumido. |
| Unidad en el comprobante | No hay columna ni valor de unidad en la tabla visible | No se puede inferir una unidad documental con certeza; para este caso correspondería conservar la unidad de la OC o solicitar confirmación, no inventarla. |
| `parseInvoiceText(texto)` | todos los campos `null`, `items: []` | No reconoce la factura pese a tener texto. |
| `extractInvoiceTextOcr(pdf)` | `{ text: "", confidence: 0 }` | El fallback OCR no procesa el PDF de la muestra. |
| `extractInvoiceData()` | `{ data: null, method: "manual", confidence: 0 }` | El usuario recibe fracaso total y debe digitar todo. |

La factura además contiene folio `3064428`, fecha `14/07/2026`, emisor Treck S.A. (RUT `96.542.490-3`), neto `$57.500`, IVA `$10.925` y total `$68.425`; están disponibles en el texto, pero las expresiones sólo cubren rótulos en orden `rótulo: valor`. En este PDF varios rótulos y valores quedan separados por el orden de extracción del motor PDF.

## Hallazgos

| Prioridad | Hallazgo | Evidencia y efecto |
|---|---|---|
| P0 | PDF sin rasterización en el fallback OCR | `invoice-ocr.ts` llama `sharp(buffer)` sobre el PDF. La muestra retorna vacío. Un PDF escaneado no se convierte explícitamente a imágenes por página, así que el camino denominado OCR no cubre su caso principal. |
| P0 | Se destruye la estructura antes de extraer ítems | `parseInvoiceText()` reemplaza `\s+` por un espacio y después `extractItems()` hace `text.split(/\n/)`. Ya no quedan saltos: el loop recibe una sola línea y no puede hallar líneas de detalle. |
| P0 | El modelo común no soporta unidad de medida | `ParsedInvoiceItem`, `CreateInvoiceItemInput`, UI y `purchase_order_invoice_items` sólo tienen nombre, cantidad, precio y subtotal. La unidad extraída desde XML (`UnmdItem`) se pierde en el adaptador. Ninguna implementación posterior puede “detectar unidades” porque no existe un campo que devolver, mostrar o persistir. |
| P1 | Parser rígido ante layout y orden de columnas | Sólo admite `descripción cantidad precio total`, exige 5–60 caracteres iniciales y no captura código, descuento ni unidad. La muestra presenta `precio total cantidad descripción código`, típico de extracción posicionada de informes Crystal. |
| P1 | Confianza mide presencia, no corrección | `calculateConfidence()` pondera folio, fecha, total e “ítems existentes”; no compara `cantidad × precio = subtotal`, neto + IVA = total, ni evalúa si cada ítem tiene unidad o está vinculado a una línea OC. Un dato erróneo puede parecer confiable. |
| P1 | No hay trazabilidad operacional de la extracción | La API devuelve sólo `method` y una cifra. No guarda texto fuente, páginas, advertencias, campos candidatos, error de OCR ni versión/configuración del motor. El usuario ve “Datos extraídos” incluso sin revisión por campo ni una explicación de lo no extraído. |
| P1 | API de preextracción carece de límites y validación binaria | `POST /api/purchase-orders/invoices/extract` confía en `file.type`, no aplica el máximo configurable ni `validateFileBuffer` que sí usa la acción final de adjuntar. Puede consumir memoria/CPU en un archivo que después será rechazado. |
| P1 | OCR sin observabilidad y con configuración mínima | Todos los errores se silencian. El worker Tesseract se crea y destruye por archivo, usa sólo `spa`, no define segmentación/orientación y aplica binarización fija a 128 tras reducir a 1600 px. Esto es frágil para tablas, fuentes pequeñas y documentos mixtos. |
| P2 | La UI pierde la identidad extraída y hace matching débil | Tras extraer, el formulario reemplaza el nombre por el de la OC y asocia sólo por inclusión de nombre; no usa código de producto, unidad ni señal de confianza por línea. Un match ambiguo puede alimentar conciliación con la línea equivocada. |
| P2 | Pruebas no representan documentos reales | Hay tests de expresiones aisladas y un PDF mínimo de una línea. No hay fixture sintético con tabla, layout reordenado, PDF escaneado, OCR de imagen, unidades, errores de rasterizado, importes decimales ni contrato API/UI. |

## Por qué no detecta las unidades

Hay dos situaciones distintas que hoy se confunden:

- **Esta factura:** no declara una unidad de medida en su tabla. El sistema debe marcar `unidad no declarada en documento` y proponer la de la línea de OC sólo como referencia revisable; no puede afirmar que detectó “unidad”.
- **DTE XML que sí trae `<UnmdItem>`:** `dte-parser.ts` la detecta, pero `invoice-extractor.ts` la elimina al construir `ParsedInvoiceItem`. Después tampoco existe una columna ni control UI para conservarla. Es una pérdida determinista, no un problema de OCR.

En ambos casos, el dato que debe conciliarse es: `cantidad + unidad + código/nombre + precio unitario + monto`, ligado explícitamente a la línea de OC. Hoy la conciliación sólo compara cantidad por una asociación de nombre insegura.

## Flujo actual y punto de quiebre

```text
Archivo adjunto
  ├─ XML DTE → parseDteXml (sí conoce UnmdItem)
  │            → adaptador común (descarta unidad) → UI/BD (no hay campo unidad)
  └─ PDF → pdfjs texto
           ├─ parser aplana saltos y usa regex lineal → no reconoce DOC-33-3064428
           └─ “OCR” → sharp(PDF) → vacío para la muestra → manual
```

## Controles que sí están presentes

- Autenticación y permiso `purchasing:send_order` en la API y en la acción de persistencia.
- Validación de bytes mágicos, MIME permitido y tamaño configurable al adjuntar definitivamente.
- Persistencia transaccional, unicidad de folio por OC y validación de que las líneas vinculadas pertenezcan a la OC.
- Extracción PDF mediante `pdfjs-dist/legacy`, que sí funcionó localmente con la muestra.
- Límite de concurrencia de OCR configurable (`INVOICE_OCR_MAX_CONCURRENT`, por defecto 1), que evita paralelismo sin tope.

Estos controles no subsanan la exactitud semántica de la extracción ni la diferencia entre una previsualización OCR y un dato conciliado.

## Plan de remediación recomendado

### Fase 1 — corregir el contrato y evitar falsos positivos (P0)

1. Agregar `unitOfMeasure: string | null`, `productCode`, `source` y `warnings` al contrato de ítem extraído; persistir la unidad y el código en `purchase_order_invoice_items` mediante migración generada. Mantener `documentUnit: null` cuando el comprobante no la declara.
2. Propagar `UnmdItem` desde DTE XML sin pérdida. En UI mostrar “Unidad del documento” y, si falta, “Unidad OC propuesta”, requiriendo revisión antes de confirmar una divergencia.
3. Separar texto normalizado para campos de cabecera del texto con saltos/posición para tablas. Rehacer el parser de ítems sobre filas y columnas, con patrones para órdenes habituales y validación aritmética.
4. Declarar éxito de autoextracción sólo cuando los campos mínimos sean válidos y los ítems tengan estado de revisión; cambiar el mensaje actual por resultado por campo y advertencias.

### Fase 2 — hacer que el OCR de PDFs sea real (P0/P1)

1. Para PDF con poco texto útil o sin tabla válida, rasterizar cada página con una librería compatible con el runtime Node/standalone (por ejemplo el mismo stack PDF ya desplegado) a resolución suficiente; después aplicar OCR por página. No enviar el PDF crudo a `sharp`.
2. Conservar por página el texto, confianza y error; no silenciar excepciones. Registrar métricas agregadas seguras: método elegido, duración, páginas, porcentaje de campos válidos y causa de fallback.
3. Preprocesar por perfil, no con un umbral fijo: orientación, escala mínima, contraste/adaptive threshold y preservación de columnas. Probar modelos `spa+eng` cuando haya SKU/códigos alfanuméricos.
4. Reutilizar workers de forma controlada o medir el coste del worker por archivo, manteniendo cola y timeout/cancelación.

### Fase 3 — conciliación confiable (P1)

1. Hacer matching por código de producto primero, luego nombre normalizado, unidad y precio; nunca asociar automáticamente una coincidencia ambigua.
2. Validar por línea: `cantidad × precio − descuento ≈ monto`; y por cabecera: `neto + IVA + exento ± redondeo = total`. Rebajar confianza o requerir revisión si no cuadra.
3. Mantener valor original extraído separado del valor confirmado por operador y auditar toda corrección. El monto total no debe recalcularse silenciosamente desde líneas no confirmadas.

### Fase 4 — evidencia de regresión y aceptación (P1)

Construir fixtures sintéticos y autorizados (no facturas productivas) que cubran: PDF textual de columnas reordenadas como esta muestra, PDF escaneado, JPG/PNG, DTE XML con `UN`, `PAR`, `kg` y `L`, ausencia de unidad, múltiples ítems, decimales, descuentos y match ambiguo. Las pruebas deben afirmar tanto los datos como advertencias, método, confianza calibrada y que nunca se persista una unidad inventada.

## Criterios de aceptación

- Con un DTE XML que tenga `UnmdItem=PAR`, la API, UI y base de datos conservan `PAR` sin conversión silenciosa.
- Con `DOC-33-3064428.pdf`, el sistema extrae o presenta para revisión folio 3064428, fecha 2026-07-14, total 68.425 y la línea de 50 guantes a 1.150; la unidad queda explícitamente como no declarada por el documento.
- Con PDF escaneado, hay rasterización por página y resultado/diagnóstico visible; nunca una caída silenciosa a “manual” sin causa.
- Ninguna línea se vincula automáticamente a una OC cuando código/nombre/unidad son ambiguos o las validaciones aritméticas fallan.
- El endpoint de preextracción aplica el mismo límite y validación binaria que la carga definitiva, con timeout y telemetría no sensible.

## Verificación realizada

Se ejecutó localmente la extracción contra el archivo entregado usando el mismo código de producción:

```text
extractTextFromPdf: 1 página, texto presente
parseInvoiceText:   todos los campos null, items []
extractInvoiceTextOcr: text "", confidence 0
extractInvoiceData: data null, method manual, confidence 0
```

También se revisaron los tests existentes del parser, DTE y extractor PDF. No se ejecutó una suite completa porque el encargo fue de auditoría y no se cambió código de ejecución.
