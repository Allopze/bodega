# Deduplicación

## El objetivo

Que dos fuentes que describen **la misma factura** produzcan **una sola factura
interna con dos referencias externas** — no dos facturas.

## Estrategia por capas

### 1. Identidad tributaria (coincidencia exacta)

Índice único: `(direction, doc_type, folio, issuer_tax_id, receiver_tax_id)`.

Es la clave del documento tributario, no de la fuente. Cualquier proveedor que
reporte ese mismo documento cae sobre la misma fila. Resuelve el caso mayoritario
sin intervención humana y sin heurística.

Por qué esos cinco campos:
- El **folio no es único global**: la serie 12715 puede ser factura 33 y nota de
  crédito 61 a la vez.
- Emisor + receptor cierran el caso de dos empresas con numeración coincidente.
- La dirección separa una venta de una compra con el mismo folio.

**Consecuencia:** un documento sin RUT de contraparte no se puede identificar, y
por eso **no se inserta**. Se cuenta como conflicto y se reporta. Inventar un RUT
para poder insertar habría creado un duplicado invisible.

### 2. Referencia externa por proveedor

`billing_external_refs` con dos índices únicos:
- `(provider, external_id)` — un proveedor no repite el mismo documento.
- `(invoice_id, provider)` — un proveedor no aparece dos veces en una factura.

El `external_id` de FacturaEnLínea es una **clave natural determinista**
(`fel:sale:433:33:1234:78023530-6`) porque el portal no entrega un id propio para
las ventas. Determinista significa que la misma fila produce siempre el mismo id:
eso es lo que hace idempotente la sincronización.

### 3. Hash de contenido

`payload_hash` = SHA-256 de los campos tributarios normalizados (dirección, tipo,
folio, RUTs, fechas, moneda, montos, estado).

Sirve para dos cosas distintas que conviene no confundir:
- **detectar que la fuente cambió** y decidir si toca actualizar;
- **comparar qué dice cada fuente** sobre el mismo documento.

**No es la identidad del documento.** Un cambio de estado cambia el hash sin
cambiar de documento. El hash deliberadamente no incluye la URL del PDF ni los
ítems: eso provocaría falsos "cambió".

### 4. Candidatos a duplicado (coincidencia no exacta)

`billing_duplicate_candidates` guarda pares que **podrían** ser el mismo documento
cuando la identidad no coincide exactamente:

| Clasificación | Cuándo |
|---|---|
| `probable` | Mismo emisor, receptor, monto y fecha, distinto folio o tipo. |
| `possible` | Coinciden monto y fecha pero no la contraparte. |
| `conflict` | Misma identidad pero montos incompatibles entre fuentes. |

**Una coincidencia probable no se fusiona sola.** Fusionar mal pierde
información, y perder información es peor que tener dos filas visibles. La
resolución (`merged` / `dismissed`) queda con autor y fecha, y `merged_into_id`
apunta a la superviviente para poder deshacer.

### Herramientas de revisión — `/facturacion/duplicados`

`detectDuplicateCandidates()` agrupa por contraparte y moneda antes de comparar
(sin eso la comparación sería cuadrática sobre todo el universo) y registra los
pares sospechosos. Es idempotente: un par ya registrado, en cualquier estado, no
se vuelve a crear.

La pantalla muestra **ambas facturas lado a lado** — folio, fecha, total,
cobrado y fuente — para que la decisión se tome mirando los documentos.

**Fusionar exige elegir cuál sobrevive.** No hay un botón que decida por
antigüedad ni por fuente: la más antigua no es necesariamente la correcta. Al
fusionar:

- las **referencias externas** de la descartada pasan a la superviviente (salvo
  las de un proveedor que la superviviente ya tenga, que el índice único
  rechazaría);
- los **vínculos operacionales** y los **pagos** se trasladan;
- los **ítems** solo se trasladan si la superviviente no tiene;
- la descartada queda **`void`** con una nota que explica la fusión: sale de toda
  agregación **sin perder su historia**;
- ambas facturas reciben un evento (`invoice.merged_from` / `invoice.merged_into`).

**Se niega a fusionar** si ambas tienen pagos confirmados: sumarlos podría
inventar un cobro que no existió, y esa decisión no la puede tomar el sistema.
Primero hay que revertir los pagos de la que se va a descartar.

## Precedencia de datos entre fuentes

Cuando dos fuentes discrepan, el módulo **no elige en silencio**: la pantalla de
detalle muestra ambas versiones (`computeSourceDifferences`) y aplica esta
precedencia solo para el valor guardado:

| Campo | Precedencia |
|---|---|
| Neto / IVA / exento | XML del documento > listado del proveedor |
| Estado tributario | El proveedor que lo informa; `unknown` nunca pisa un estado conocido |
| Vencimiento | `manual` > `provider` (FchVenc) > contrato > cliente |
| Cliente, contrato, faena, período | **Solo interno.** Ninguna fuente externa los toca. |
| Estado de cobranza, responsable, notas | **Solo interno.** |

Regla transversal: **una sincronización nunca sobrescribe un dato confirmado por
una persona**. Está probado en `sync-integration.test.ts`.

## Idempotencia probada

`sync-integration.test.ts` demuestra, contra Postgres real:

- dos corridas con los mismos datos no crean duplicados;
- un cambio de estado actualiza sin duplicar;
- una fila repetida dentro de la misma respuesta se cuenta como duplicado y se
  inserta una sola vez;
- dos proveedores distintos sobre el mismo documento → 1 factura, 2 referencias;
- un vencimiento fijado a mano sobrevive a la sincronización siguiente;
- los datos internos (responsable, notas, estado de cobranza) no se tocan.
