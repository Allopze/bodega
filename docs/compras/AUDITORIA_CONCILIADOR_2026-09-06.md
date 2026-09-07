# Auditoría del conciliador de compras CHOME

**Fecha:** 2026-09-06
**Alcance:** conciliación Solicitud → OC → Recepción → Factura de proveedor, con Odoo 19 Community y ERPNext como referencias de ingeniería.
**Encargo:** `chome_conciliador_odoo_erpnext_pack/PROMPT_AGENTE_CHOME.md`, sección "AUDITORÍA PREVIA OBLIGATORIA".
**Estado:** documento de diagnóstico. **No se modificó código.**

**Fuentes de referencia:** 29 archivos upstream descargados y verificados (`verify_sources.py`: 29/29 correctos, 0 faltantes, 0 vacíos) en `chome_conciliador_odoo_erpnext_pack/REFERENCIAS/`.

**Evidencia empírica usada:** los 667 XML DTE reales de `docs/facturas_apro_treck_kupfer/` y la base `bodega_dev` (1.098 filas en `dte_documents`).

---

## 1. Diagnóstico

**El conciliador de CHOME está considerablemente más maduro de lo que asume el prompt del pack.** El prompt fue escrito sobre la hipótesis de un sistema que representa la conciliación como `invoice.purchaseOrderId` y poco más. La realidad es otra: existe un motor de conciliación por línea, con evidencia estructurada, `fingerprint` de idempotencia, estados derivados persistidos, detección de once clases de excepción, cotejo contra recepción a nivel de línea y bloqueos transaccionales reales.

Varias de las recomendaciones centrales del pack **ya están implementadas**, y algunas decisiones de CHOME son deliberadamente **más conservadoras** que las de Odoo y ERPNext —notablemente, la negativa a hacer fuzzy matching de descripciones sin confirmación humana.

Las brechas reales existen, pero son más angostas y más específicas de lo que el pack sugiere. Las tres que importan:

1. **El modelo no admite una factura contra varias OC**, ni una línea de factura repartida entre varias líneas de OC. Es una restricción estructural del esquema, no una omisión del algoritmo.
2. **El vínculo entre línea de factura y línea de OC es cualitativo, no cuantitativo.** No existe "cantidad asignada" ni "monto asignado": se asume que la línea completa de la factura pertenece a la línea de OC enlazada.
3. **No existe modelo de notas de crédito ni de reversa**, y el esquema lo impide activamente (`purchase_order_invoices.amount` tiene `CHECK >= 0`).

Y un hallazgo que contradice el diseño propuesto por el propio pack:

> El pack ordena el matching determinístico poniendo **"referencia explícita de OC dentro del XML DTE" como prioridad 1**. En los datos de CHOME esa es la señal **más débil**: 43 referencias citables de 654 en los XML reales (6,6%), y 26 de 194 en `bodega_dev` (13%). Un motor construido sobre ese orden de prioridades se apoyaría en una señal ausente el 90% de las veces.

---

## 2. Mapa del flujo actual

Los 18 puntos exigidos por el encargo.

### 2.1 Modelos y tablas

| Tabla | Archivo | Rol en la conciliación |
|---|---|---|
| `purchase_orders` | `db/schema/purchasing.ts:20` | OC. Incluye `invoice_reconciliation_status`, `_fingerprint`, `_updated_at`. |
| `purchase_order_items` | `db/schema/purchasing.ts:78` | Líneas de OC. Contadores `quantity_office_received` y `quantity_received`. |
| `purchase_order_invoices` | `db/schema/purchasing.ts:163` | Factura de OC. `purchase_order_id` **NOT NULL**. |
| `purchase_order_invoice_items` | `db/schema/purchasing.ts:195` | Línea de factura ↔ línea de OC. |
| `purchase_order_invoice_reconciliation_reviews` | `db/schema/purchasing.ts:217` | Aceptación humana de una excepción, con `evidence` jsonb y `fingerprint`. |
| `receipts` / `receipt_items` | `db/schema/receiving.ts:11,33` | Recepción. `receipt_items.purchase_order_item_id` **NOT NULL**. |
| `dte_documents` | `db/schema/dte.ts:94` | DTE sincronizado del portal. `referenced_order_codes`, `purchase_order_invoice_id`. |
| `dte_document_items` | `db/schema/purchase-invoice-matching.ts:9` | Líneas del XML, evidencia cruda estructurada. |
| `supplier_product_aliases` | `db/schema/purchase-invoice-matching.ts:34` | Alias proveedor↔producto, **solo desde confirmación humana**. |

### 2.2 Relaciones

```
purchase_requests
  └─ purchase_request_items
       └─ purchase_order_items ── purchase_orders
            ├─ receipt_items ── receipts            (recepción, NOT NULL al ítem de OC)
            └─ purchase_order_invoice_items ── purchase_order_invoices
                                                     ↑
                                            dte_documents.purchase_order_invoice_id
                                                     │  (índice único parcial: 1:1)
                                            dte_document_items
```

Cardinalidades reales hoy: OC 1—N facturas; factura N—1 OC (**no N—N**); línea de factura N—1 línea de OC (**no N—N**); DTE 1—1 factura de OC, forzado por `dte_documents_purchase_invoice_single_unique`.

### 2.3 Servicios

`lib/services/purchasing-module/` — 31 archivos. Núcleo:

- `invoice-reconciliation.ts` (~21 KB) — motor puro. `reconcileInvoiceEvidence()` produce la evidencia completa.
- `invoice-reconciliation-service.ts` (~17 KB) — persistencia transaccional, backfill, aceptación de excepción.
- `dte-candidates.ts` (~16 KB) — `assessDteCandidates()`, ranking de documentos candidatos para una OC.
- `dte-parser.ts` (~13 KB) — parseo del XML DTE, incluida la referencia `TpoDocRef` 801.
- `invoice-item-matching.ts` — cruce línea de documento ↔ línea de OC.
- `invoice-receipt-suggestions.ts` — sugerencia de recepciones asociadas.
- `invoice-extractor.ts`, `invoice-ocr.ts`, `invoice-text-parser.ts`, `pdf-text-extractor.ts` — extracción desde PDF cuando no hay XML.
- `invoices.ts` (~31 KB) — creación/borrado de facturas de OC, con los guardas transaccionales.

`lib/services/dte-portal/` — 29 archivos. Sincronización, descarga de XML/PDF, `reconciliation.ts` (cotejo masivo DTE↔factura de OC y cargas de combustible).

### 2.4 Endpoints

Tres rutas REST: `app/api/purchase-orders/dtes/[id]/pdf/`, `invoices/extract/`, `invoices/[id]/`. El resto del flujo son **Server Actions**: `app/(app)/compras/actions/dte-use-invoice.ts`, `dte-analyze-lines.ts`, `dte-download-xml.ts`, `invoice-reconciliation.ts`, más `app/(app)/compras/invoice-actions.ts`.

### 2.5 Jobs

`app/api/cron/dte-portal-sync/` (sincronización del portal) y `dte-sync-health/` (salud). No hay job de conciliación automática: la conciliación se recalcula transaccionalmente al escribir, y existe `backfillPurchaseOrderInvoiceReconciliations()` para recomputar en masa.

### 2.6 UI

`app/(app)/compras/[id]/` — `invoices-section.tsx` (candidatos DTE y facturas adjuntas), `invoice-reconciliation-card.tsx` (tarjeta de conciliación), `invoice-receipt-association-dialog.tsx`, `dte-xml-detail.tsx`, `oc-progress-table.tsx`. Listado de DTE sin usar en `app/(app)/compras/dte/page.tsx`.

### 2.7 Cómo se obtienen las facturas

Dos vías. **(a) Portal DTE** — scraping autenticado de `clientes.dtefacturaenlinea.cl`, Bandeja de Entrada (`PNC_PanelCorreo.php`), documentado en `docs/facturacion/FACTURAENLINEA.md`. **(b) Carga manual** de PDF, con extracción por texto y OCR de respaldo.

### 2.8 Qué se conserva del XML DTE

`dte_documents` guarda cabecera y `xml_path`; `dte_document_items` guarda las líneas (código, nombre, unidad, cantidad, precio unitario, descuento, monto); `referenced_order_codes` guarda los códigos de OC citados en `<Referencia>` con `TpoDocRef` 801, normalizados. El archivo XML original se conserva en disco. **No se extraen** impuestos adicionales, flete, ni el bloque de referencias completo (solo el tipo 801).

### 2.9 Cómo se generan las OC

`purchase-orders-create.ts`, correlativo `OC-AAAA-NNNN` vía `lib/code-sequences.ts`, desde solicitudes de compra. Estados: `draft`, `sent`, `partially_office_received`, `office_received`, `partially_received`, `received`, `closed`, `cancelled`.

### 2.10 Recepción

Doble etapa modelada explícitamente: `locationType` ∈ {`office`, `faena`}, con contadores separados `quantityOfficeReceived` y `quantityReceived` en la línea de OC. `receipt_items` registra además `quantityRejected`, `quantityDamaged` y `quantityDifference`. El `CHECK purchase_order_items_numeric_integrity` acota ambos contadores por `quantity`: **la sobre-recepción es estructuralmente imposible**.

### 2.11 Lógica actual de asociación

Dirección **OC-primero**: desde el detalle de una OC se listan documentos DTE candidatos.

`dteInvoiceRejection()` (`dte-candidates.ts:78`) es el predicado duro: tipo de DTE facturable, documento no usado por otra operación, RUT emisor = proveedor de la OC, fecha de emisión ≥ creación de la OC.

`assessDteCandidates()` filtra por RUT y fecha, y ordena por: (1) `referencesOrder` — cita exacta del código de OC, override absoluto; (2) `confidence` derivada del cruce de líneas; (3) conflictos; (4) proporción de líneas calzadas; (5) cantidades exactas; (6) diferencia de monto; (7) fecha.

`attachDteAsInvoice()` materializa el vínculo: vuelve a leer XML, PDF, proveedor, monto y líneas **en servidor**; el cliente solo elige ids.

### 2.12 Lógica de estados

`reconcileInvoiceEvidence()` deriva y persiste en `purchase_orders.invoice_reconciliation_status`: `no_invoices`, `partially_invoiced`, `awaiting_receipt`, `matched`, `needs_review`, `accepted_exception`. Se acompaña de dimensiones independientes: `money`, `coverage`, `lines`, `receipt`.

El `fingerprint` (SHA-256 sobre el contrato canónico) invalida la caché y ata la aceptación humana a un estado concreto de los datos: si cambian, la excepción aceptada deja de aplicar. Se excluyen del fingerprint el precio de catálogo y los datos de identidad del proveedor, porque son contexto y no evidencia documental.

### 2.13 Tests

21 archivos de test en el área. Densidad en el núcleo: `dte-parser.test.ts` 22 casos, `dte-candidates.test.ts` 21, `invoice-reconciliation.test.ts` 17, `invoice-item-matching.test.ts` 6.

### 2.14 Migraciones

256 migraciones en total; 23 tocan las tablas del conciliador. La regla de `AGENTS.md` prohíbe editar el journal a mano.

### 2.15 Duplicados de lógica en otros módulos

**Sí existe superposición.** `lib/services/dte-portal/reconciliation.ts` implementa un cotejo masivo DTE↔`purchase_order_invoices` (y↔`fuel_loads`) por folio+RUT y monto, con su propia tolerancia `AUTO_MATCH_AMOUNT_TOLERANCE_CLP = 1`, independiente de `CLP_RECONCILIATION_TOLERANCE = 1` del motor de compras y de `AMOUNT_TOLERANCE_CLP = 1` de los candidatos. **Tres constantes con el mismo valor, tres definiciones, ningún punto de configuración.** Además, el módulo de facturación (`lib/services/billing/`) mantiene un modelo paralelo (`billing_invoices`) que no propaga la referencia de OC.

### 2.16 Deuda técnica identificada

- Las tres tolerancias duplicadas del punto anterior.
- `sha256()` reimplementado a mano dentro de `invoice-reconciliation.ts` (~50 líneas) para poder correr en el cliente.
- `invoices.ts` con ~31 KB en un solo archivo.
- `referenced_order_codes` como cadena separada por comas en vez de tabla o array.
- Ninguna métrica de observabilidad del matching.

### 2.17 Bugs reproducibles

No se encontró ningún bug de corrección en el motor. Los guardas transaccionales están bien puestos: `FOR UPDATE` sobre la OC (`invoices.ts:176`) y sobre el DTE (`invoices.ts:625`), y `INVOICE_ALLOWED_STATUSES` bloquea adjuntar a una OC anulada.

Sí hay dos **defectos de diseño observables**, ambos con evidencia en datos reales:

- **D-1 — La referencia de OC parcial se pierde en silencio.** Un `FolioRef` con el año solo (`2026`) pasa el filtro de ≥3 caracteres de `normalizeOrderCodeRef()` (`dte-parser.ts:261`) y se persiste, pero nunca calza con `20260001` por comparación exacta. No produce un vínculo errado, pero es indistinguible en la UI de un proveedor que no citó nada. Reportado por el usuario como caso frecuente.
- **D-2 — El corte de 3 caracteres descarta referencias resolubles.** 46 de los 667 XML reales citan solo el correlativo (`26`, `17`, `14`, `19`, `23`), que se corresponde con correlativos de OC existentes. Se descartan enteros.

### 2.18 Calidad de la señal de referencia (medición)

Sobre los 667 XML reales:

| Qué cita el proveedor en `FolioRef` de una `<Referencia>` 801 | Casos |
|---|---|
| Correlativo propio del proveedor (`438`, `4235`, `585.`) | 565 |
| Descartado por el corte de <3 caracteres (`26`, `94`, `17`) | 46 |
| Canónico `AAAA-NNNN` | 43 |
| Sin referencia 801 | 13 |

Sobre las 194 filas con referencia no vacía en `bodega_dev`: 26 canónicas, 73 solo dígitos (69 de ellas de 3 dígitos), y **95 de texto libre** — `CHOLGUAN`, `CABRERO`, `BIODIVERSA`, `SANTAFE`, `NACIMIENTO`, `ALEXISMORALES`, `PATRICIOPANES`: el proveedor usa el campo para el destino o el contacto.

---

## 3. Lo aprendido de Odoo 19

Fuente: `REFERENCIAS/Odoo/addons/purchase/models/`.

1. **Métodos de match nombrados y jerarquizados.** `_match_purchase_orders()` devuelve una etiqueta explícita: `total_match`, `subset_total_match`, `po_match`, `subset_match`, `no_match`. El método es parte del resultado, no solo un booleano.
2. **La ambigüedad aborta.** En `_find_matching_subset_po_lines()` (subset-sum, 0-1 knapsack), en cuanto aparece una segunda solución se devuelve lista vacía: *"we can't know for sure which is the correct one, so we don't return any solution"*. Igual en el fallback por proveedor+monto: solo resuelve si `len(matching_purchase_orders) == 1`.
3. **Timeout explícito e instrumentado.** El algoritmo combinatorio recibe `timeout` (10 s por defecto), levanta `TimeoutError` y lo registra en el log.
4. **La confianza de la fuente cambia el algoritmo.** OCR y EDI toman ramas distintas: al OCR se le permite el match por subconjunto de totales; al EDI se le exige cruce línea a línea por precio unitario.
5. **Política de control por producto.** `product.purchase_method` ∈ {`purchase` (por cantidad ordenada), `receive` (por cantidad recibida)}. Los servicios caen por defecto en `purchase`. Es el interruptor 2-way/3-way y **no está hardcodeado**.
6. **Búsqueda por dos campos de referencia.** Primero por `name` de la OC; si falla, por `partner_ref` — el número que el proveedor le puso a la orden.
7. **Tolerancia única y absoluta:** `TOLERANCE = 0.02`.

## 4. Lo aprendido de ERPNext

Fuente: `REFERENCIAS/ERPNext/erpnext/`.

1. **Porcentajes derivados como eje del estado.** `per_received` y `per_billed` son campos calculados; los estados salen de expresiones sobre ellos (`controllers/status_updater.py:79-99`):

   | Estado | Regla |
   |---|---|
   | `To Receive and Bill` | `per_received < 100 and per_billed < 100` |
   | `To Bill` | `per_received >= 100 and per_billed < 100` |
   | `To Receive` | `per_received < 100 and per_billed == 100` |
   | `Completed` | `per_received >= 100 and per_billed == 100` |

2. **Allowance porcentual con jerarquía de configuración.** `get_allowance_for()` resuelve la tolerancia por ítem y, si no hay, cae al ajuste global. Tolerancias **separadas para cantidad y para monto**.
3. **Bypass por rol, no por flag.** `role_allowed_to_over_bill` y `role_allowed_to_over_deliver_receive`: si el usuario tiene el rol, se registra una advertencia; si no, es error duro. Excederse es una decisión con dueño identificable.
4. **El error dice cuánto sobra.** Se calculan `max_allowed` y `reduce_by` y se entregan al usuario.
5. **Trazabilidad a nivel de línea de factura**, con campos de referencia a la línea de OC y a la de recepción, y `billed_amt` acumulado por línea.

---

## 5. Tabla comparativa

| Dimensión | CHOME hoy | Odoo 19 | ERPNext |
|---|---|---|---|
| Dirección del matching | OC → documentos candidatos | Factura → OC | Factura creada desde OC/recepción |
| Referencia explícita | `TpoDocRef` 801, comparación exacta | `name` y `partner_ref` de la OC | Enlace directo por documento |
| Prioridad de la referencia | Override absoluto en el orden | Primera puerta del algoritmo | N/A (el vínculo es explícito) |
| Match por subconjunto de líneas | No | Sí, subset-sum con timeout | No |
| Ambigüedad | Deja sin enlazar (`ambiguous`) | Aborta y no devuelve solución | N/A |
| Método de match | No se registra | Etiqueta explícita en el retorno | N/A |
| Score de confianza | `high/medium/low/unassessed`, **calculado en render** | No hay score; hay método | No hay |
| Fuzzy de descripciones | **No**, solo alias confirmados por humano | Sí, por precio unitario y cantidad | No |
| Tolerancia | 3 constantes absolutas de 1 CLP, hardcodeadas | Una constante absoluta `0.02` | Porcentual, por ítem + global |
| Bypass de tolerancia | No existe | No existe | Por rol, con advertencia |
| 2-way vs 3-way | Siempre coteja recepción; `quantity_over_received` no bloquea | `purchase_method` por producto | Configurable por ítem |
| Sobre-recepción | Imposible por `CHECK` | Permitida con aviso | Permitida dentro del allowance |
| Sobre-facturación | Detectada (`quantity_over`), no bloqueada | Detectada por saldos | Bloqueada salvo rol |
| Factura ↔ varias OC | **No representable** | Sí | Sí |
| Línea factura ↔ varias líneas OC | **No representable** | Sí | Sí |
| Cantidad/monto asignado | **No existe** | `qty_invoiced` por línea | `billed_amt` por línea |
| Estados derivados | 6 estados persistidos con fingerprint | `invoice_status` | `per_billed`/`per_received` → estado |
| Notas de crédito | **No modeladas**; `CHECK amount >= 0` | Sí | Sí |
| Moneda | **Ausente**; CLP implícito | Multi-moneda | Multi-moneda |
| Impuestos/flete | Solo total; sin desglose | Desglosado | Desglosado |
| Idempotencia | `fingerprint` + `version` | Recompute | Recompute |
| Concurrencia | `FOR UPDATE` sobre OC y DTE | ORM + locks | ORM + locks |
| Auditoría de decisiones | Revisiones humanas con `evidence` | Chatter | Version log |
| Observabilidad del matching | **Ninguna** | Log de timeout | — |

---

## 6. Brechas reales, priorizadas

### B-1 — Una factura no puede cubrir varias OC

- **Comportamiento actual:** `purchase_order_invoices.purchase_order_id` es `NOT NULL`. Una factura pertenece a exactamente una OC.
- **Odoo:** una factura enlaza líneas de varias OC; `_match_purchase_orders()` devuelve explícitamente líneas "could be from multiple purchase orders".
- **ERPNext:** cada línea de factura referencia su propia OC.
- **Recomendación:** mover el vínculo desde la cabecera a una tabla de asignación por línea.
- **Impacto:** alto — está en el objetivo funcional del encargo. **Complejidad:** alta. **Riesgo:** alto (toca la tabla más caliente del módulo). **Migración:** sí. **UI:** sí. **Tests:** casos 6, 24 y 34 de la lista del encargo.

### B-2 — El vínculo por línea no lleva cantidad ni monto asignado

- **Comportamiento actual:** `purchase_order_invoice_items.purchase_order_item_id` enlaza, pero no cuantifica. La cantidad facturada se deriva sumando la cantidad completa de la línea de factura, asumiendo que toda ella pertenece a esa línea de OC.
- **Odoo/ERPNext:** ambos acumulan cantidad y monto por línea (`qty_invoiced`, `billed_amt`).
- **Recomendación:** `allocatedQty` y `allocatedNetAmount` en la asignación; la suma de asignaciones debe ser validable.
- **Impacto:** alto. **Complejidad:** media. **Riesgo:** medio. **Migración:** sí (determinística para el caso 1:1 actual). **UI:** sí. **Tests:** 22, 23, 30, 31.

### B-3 — Notas de crédito no modeladas

- **Comportamiento actual:** el tipo DTE 61 se sincroniza pero no puede registrarse como factura de OC, y `CHECK purchase_order_invoices_amount_non_negative` impide un monto negativo.
- **Recomendación:** asignaciones negativas sobre la asignación original, preservando la historia. No borrar nunca.
- **Impacto:** alto (tributario). **Complejidad:** media. **Riesgo:** medio. **Migración:** sí. **UI:** sí. **Tests:** 18, 32.

### B-4 — Tolerancias hardcodeadas y triplicadas

- **Comportamiento actual:** `CLP_RECONCILIATION_TOLERANCE = 1`, `AMOUNT_TOLERANCE_CLP = 1`, `AUTO_MATCH_AMOUNT_TOLERANCE_CLP = 1`. Absolutas, en CLP, sin override.
- **Odoo:** una constante. **ERPNext:** porcentual, por ítem con fallback global, separada para cantidad y monto, y **bypass por rol**.
- **Recomendación:** unificar en `system_settings`, con porcentaje además de absoluto, y registrar siempre qué tolerancia permitió aceptar una discrepancia. El bypass por rol calza con el RBAC existente.
- **Impacto:** medio. **Complejidad:** baja. **Riesgo:** bajo. **Migración:** no. **UI:** sí (Administración). **Tests:** 9, 10, 11.

### B-5 — Sin método de match ni score persistidos

- **Comportamiento actual:** `assessDteCandidates()` calcula `confidence` en el render y la descarta. No hay `matchMethod`.
- **Odoo:** etiqueta explícita de método en el retorno.
- **Recomendación:** persistir método y score en la asignación, junto a la evidencia. Sin esto no hay observabilidad ni reproducibilidad de decisiones pasadas.
- **Impacto:** medio. **Complejidad:** baja. **Riesgo:** bajo. **Migración:** no. **UI:** menor. **Tests:** 1, 2, 35, 36.

### B-6 — Referencia de OC inválida o parcial no es una excepción declarada

- **Comportamiento actual:** defectos D-1 y D-2 del §2.17. La referencia parcial se pierde en silencio; el operador no distingue "no citó" de "citó mal".
- **Recomendación:** clasificar la referencia (completa / parcial / ilegible / ajena) y exponerla. Para el correlativo suelto, resolver acotando por año y proveedor **solo si es único**, siguiendo el principio de Odoo. Para el año suelto, no resolver nunca: marcarlo.
- **Impacto:** medio-alto (es la queja concreta del usuario). **Complejidad:** baja. **Riesgo:** bajo. **Migración:** no (se deriva de lo ya guardado). **UI:** sí. **Tests:** 25.

### B-7 — Sin política de facturación por ordenado vs. recibido

- **Comportamiento actual:** siempre se coteja contra recepción; `quantity_over_received` se emite pero **no bloquea** (se excluye de `hardIssues` y produce `awaiting_receipt`). No hay forma de decir "este servicio se factura contra lo ordenado".
- **Odoo:** `purchase_method` por producto, servicios en `purchase`. **ERPNext:** configurable.
- **Recomendación:** política explícita por producto/servicio. CHOME ya distingue servicios (`lib/products/service-items.ts`).
- **Impacto:** medio. **Complejidad:** media. **Riesgo:** bajo. **Migración:** sí (columna con default). **UI:** sí. **Tests:** 13, 14, 30, 31.

### B-8 — Moneda, impuestos y flete ausentes

- **Comportamiento actual:** ni la OC ni la factura tienen moneda. `purchase_order_invoices.amount` es un total único, sin neto/IVA/flete. Una diferencia de total causada por flete no puede explicarse.
- **Impacto:** medio. **Complejidad:** media. **Riesgo:** medio. **Migración:** sí. **UI:** sí. **Tests:** 28, 29.

### B-9 — Ambigüedad entre varias OC no se detecta

- **Comportamiento actual:** el flujo es OC-primero, así que nunca se pregunta "¿a cuál de estas OC pertenece esta factura?". `dte-portal/reconciliation.ts` sí lo hace en masa, pero solo 1:1 por folio+RUT y monto.
- **Odoo:** el fallback por proveedor+monto exige candidato único.
- **Recomendación:** al agregar la dirección documento→OC, importar el principio de Odoo: dos candidatos equivalentes ⇒ ninguna decisión.
- **Impacto:** medio. **Complejidad:** media. **Riesgo:** medio. **Migración:** no. **UI:** sí. **Tests:** 7, 26, 27.

### B-10 — Sin observabilidad del matching

- **Comportamiento actual:** ninguna métrica de % auto-conciliado, causas de excepción, confianza promedio ni tiempo de matching.
- **Impacto:** bajo-medio. **Complejidad:** baja. **Riesgo:** bajo. **Migración:** no. **UI:** opcional.

---

## 7. Premisas del pack que no calzan

El encargo pide explícitamente documentar esto en vez de forzarlo.

| Premisa del pack | Realidad |
|---|---|
| "La primera etapa debe ser determinística" | Ya lo es. No hay LLM en ninguna ruta del conciliador. |
| "Referencia explícita de OC como prioridad 1" | **Falso para CHOME.** Es la señal más débil: 6,6% de citas útiles en los XML reales. |
| "Diseña un componente DTE→referencias→OC candidata" | Ya existe: `dte-parser.ts` → `referenced_order_codes` → `assessDteCandidates()`. |
| "No representes la conciliación con `invoice.purchaseOrderId`" | Correcto como crítica, pero el sistema ya tiene enlace por línea; falta cuantificarlo (B-2), no crearlo. |
| "3-way matching: CHOME debe evolucionar hacia OC↕Recepción↕Factura" | **Ya está construido.** `receipt_items.purchase_order_item_id` es NOT NULL y el motor lo usa vía `supplierReceivedQuantity` y `quantity_over_received`. |
| "Define una estrategia de detección de duplicados" | Ya existe: `dte_documents_unique_key` (tipoDte, folio, rutEmisor, codEmp) + `raw_hash`, y unicidad de folio por OC. |
| "Considera concurrencia; evita pseudo-locks en memoria" | Ya cumplido: `FOR UPDATE` sobre OC y DTE, e índice único parcial de corrida activa en el sync. |
| "Toda operación automática debe ser idempotente" | Ya cumplido vía `fingerprint` + `version`. |
| "Fuzzy matching cuando las reglas anteriores sean insuficientes" | CHOME lo rechaza a propósito y aprende solo de confirmación humana (`supplier_product_aliases`). **Recomiendo mantener la decisión de CHOME**: es más defendible ante una auditoría tributaria. |
| "Evita almacenar estados derivados" | CHOME los almacena, pero con `fingerprint` que los invalida. Es una excepción justificada, no deuda. |
| Lista de 40 tests obligatorios | Varios ya cubiertos por los 21 archivos existentes. Hay que mapear antes de escribir de nuevo. |

---

## 8. Qué no conviene hacer

1. **No reescribir el motor.** `reconcileInvoiceEvidence()` es correcto, está testeado y su contrato de evidencia es bueno. Las brechas son de **modelo de datos**, no de algoritmo.
2. **No adoptar el orden de prioridades del pack** sin corregir el peso de la referencia explícita.
3. **No introducir fuzzy matching de descripciones.** Contradice una decisión deliberada y bien fundada de CHOME.
4. **No relajar el `CHECK` de sobre-recepción** para parecerse a ERPNext. La invariante estructural es más fuerte que un allowance.

---

## 9. Secuencia propuesta

Por dependencias, no por valor percibido:

1. **B-6** — clasificación y visibilidad de la referencia de OC. Sin migración, sin dependencias, resuelve una queja concreta y actual.
2. **B-4** — unificar las tres tolerancias en configuración. Desbloquea B-7 y quita deuda.
3. **B-1 + B-2** — modelo de asignación por línea con cantidad y monto. El cambio estructural del que cuelga todo lo demás.
4. **B-3 + B-8** — notas de crédito, moneda y desglose tributario. Requieren (3).
5. **B-5 + B-9** — método y score persistidos, y guarda de ambigüedad en la dirección documento→OC.
6. **B-7** — política de facturación por ordenado vs. recibido.
7. **B-10** — observabilidad.
8. **Backfill** histórico, clasificado como determinístico / inferido / requiere revisión / imposible de reconstruir.

Cada una necesita su propio ciclo de diseño y aprobación antes de tocar código.

---

## 10. Estado de implementación

Actualizado tras el tercer ciclo (2026-09-07).

### Cerradas

| Brecha | Qué se hizo |
|---|---|
| **B-6** — referencia parcial invisible (D-1) | Clasificación `exact` / `correlative` / `year` / `foreign` / `none` derivada de lo ya guardado, con badge propio para la cita del correlativo y para el año suelto. El ranking no cambió: una cita parcial no identifica una orden y no puede ascender. |
| **B-6b** — correlativo suelto descartado (D-2) | Piso de `normalizeOrderCodeRef` de 3 a 2 caracteres. Verificado sobre los 667 XML reales: recupera exactamente las 46 referencias que se perdían. Incluye `scripts/reparse-dte-order-refs.ts` con su servicio de compose y su paso en `deploy-prod.sh`. |
| **B-5** — sin método ni evidencia del vínculo | `purchase_order_invoices.link_method` y `link_order_reference` congelan cómo se vinculó cada factura y qué había citado el proveedor. Migración `0256`. Verificado end-to-end contra el portal real. |
| **B-9** — ambigüedad entre varias OC | **Ya estaba resuelto; la auditoría lo calificó mal.** `dte-portal/reconciliation.ts` descarta el par ante folio+RUT duplicado, excluye OC anuladas o borradas y trata 33/34 del mismo folio como ambiguos. |
| **B-4** — tolerancias triplicadas | Un solo origen (`money-tolerance.ts`) y **configurable** desde Administración → Parámetros operativos (`ops.compras.clp_tolerance`, 0 a 100.000). El motor la recibe como parámetro y sigue siendo puro; el badge "calza con el saldo" usa el mismo número que el veredicto. El vínculo automático DTE↔factura **no** la sigue: se queda en el peso de redondeo, fijado por test. |
| **B-7** — política ordenado vs. recibido | `invoiceControl` por línea. Se resuelve desde `products.is_service` en vez de una columna nueva que nadie mantendría: un servicio se factura al ejecutarse y no entra a bodega, donde antes quedaba en `awaiting_receipt` para siempre. Una línea sin producto catalogado cae en `received`, la exigente. |
| **B-10** — observabilidad | El reporte `dte-conciliacion` gana las columnas "Vinculación" y "Referencia del proveedor", más una hoja "Calidad de la referencia" que cuenta en cuántas facturas el proveedor escribió algo utilizable. Las etiquetas viven en `order-reference.ts`, compartidas con el badge para que ambas superficies no bauticen distinto lo mismo. |
| **B-3** — notas de crédito | `document_kind` (`invoice` / `credit_note`) con monto negativo, misma convención que `billing_invoices`. Migración `0257`. El tipo 61 ya puede colgarse de una OC y **resta**. |

### No se construyeron, y por qué

Las dos siguientes se midieron antes de tocar código y la medición dijo que no.

| Brecha | Medición | Decisión |
|---|---|---|
| **B-1** — una factura contra varias OC | **0 de 654** XML reales citan más de una OC. En `bodega_dev`, el único documento con dos referencias cita `756,757`, que no son códigos nuestros sino la numeración interna del proveedor. | **No construir.** Reestructurar la tabla más caliente del módulo a N:N por un caso que no ocurre es exactamente la complejidad sin caso de uso que el propio encargo pide evitar. Si aparece, la evidencia queda: se reabre con datos. |
| **B-8** — moneda | Los tipos de DTE recibidos son 33, 52, 34, 61, 39 y 87. **Ningún documento de exportación** (110/111/112), así que no hay operación en moneda extranjera. | **No construir la parte de moneda.** El desglose de impuestos y flete queda pendiente sin medición propia. |

### Pendiente

| Brecha | Qué falta |
|---|---|
| **B-2** — asignación con cantidad y monto por línea | El vínculo línea-factura ↔ línea-OC sigue siendo cualitativo. Con B-1 descartada su motivo se reduce a repartir **una** línea de factura entre varias líneas de la **misma** OC, que no se midió. Conviene medirlo antes de construirlo, igual que B-1 y B-8. |
| **B-8** (impuestos y flete) | `purchase_order_invoices.amount` sigue siendo un total único: una diferencia causada por flete no puede explicarse. |

---

## 11. Verificación de esta auditoría

- Fuentes de referencia: `python3 verify_sources.py` → 29/29 correctos, 0 faltantes, 0 vacíos.
- Medición de referencias 801: script ad hoc sobre los 667 XML de `docs/facturas_apro_treck_kupfer/`.
- Medición en base: consultas de solo lectura sobre `bodega_dev` (`dte_documents`, `purchase_orders`).
- Tras los ciclos de implementación del §10: suite completa verde — **6.424 tests non-pglite** (625 archivos) y **1.358 pglite** (114 archivos), sin fallos. `tsc --noEmit` y `eslint` limpios; `db:generate` reporta "No schema changes" tras las migraciones `0256` y `0257`.
- **B-4 y B-3 verificados en la aplicación** (`bodega_dev`, sesión QA, portal real): se guardó una tolerancia de $250 en Administración → Parámetros operativos y la tarjeta de conciliación pasó a declarar "Tolerancia monetaria: $250"; se adjuntó la **nota de crédito real folio 209021** a `OC-2026-0013`, que quedó como `document_kind = credit_note` con `amount = -19.278` y dejó la OC en "TOTAL FACTURADO −$19.278 / SALDO POR FACTURAR $41.650". Ambas se revirtieron después y el ajuste se borró; la OC volvió a 0 facturas.
- Esa verificación destapó un defecto que los tests no veían: la tarjeta traía "Tolerancia monetaria: $1" escrito a mano y habría mentido sobre la regla aplicada. Corregido para leerla de la evidencia, con test.
- **Verificación en la aplicación** (`localhost:3001`, sesión QA, `bodega_dev` con la migración 0256 aplicada): se sembraron cuatro DTE sobre `OC-2026-0026`, uno por clase de referencia, y se comprobó en el navegador que cada uno dibuja lo suyo — `2026` → "REFERENCIA INCOMPLETA", `26` → "Cita el N° de esta OC", `20260026` → "CITA ESTA OC", `4477` → sin badge. Sin errores de consola. Los datos sembrados se eliminaron después.
- **`reparse-dte-order-refs.ts` verificado contra un XML real** (`factura_3443242.xml`, que cita `17`) con la fila guardada como cadena vacía por el normalizador viejo: la primera corrida la actualizó a `17`, la segunda reportó 0 actualizados. Idempotente.
- **B-5 verificado end-to-end contra el portal real.** Con las credenciales `DTE_PORTAL_*` de `.env.local` (`DTE_SETTINGS_MODE=compat`), se adjuntaron dos DTE reales a `OC-2026-0026` desde la interfaz, bajando su PDF de FacturaEnLínea:

  | DTE | `referenced_order_codes` | `link_method` | `link_order_reference` |
  |---|---|---|---|
  | folio 3721185 | `20260026` | `dte_candidate` | `exact` |
  | folio 3731571 | `2026` (fijado para la prueba) | `dte_candidate` | `year` |

  Ambas facturas se eliminaron después por la misma interfaz —lo que de paso ejercitó la ruta de desvinculación—, se restauró el valor original del segundo DTE (`792`) y la OC volvió a `no_invoices`. Sin residuos en `storage/` ni errores de consola.
