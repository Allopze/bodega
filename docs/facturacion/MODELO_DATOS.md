# Modelo de datos

Todas las tablas son **nuevas**. Ninguna tabla existente se modificó, renombró ni
perdió columnas: la implementación es aditiva pura (ver [ROLLBACK.md](ROLLBACK.md)).

Migración: `db/migrations/0136_billing_module.sql`.

## Dominio comercial

### `clients` — clientes
El lado inverso de `suppliers`. Se modela aparte a propósito: un mismo RUT puede
ser proveedor y cliente, pero su semántica, permisos y ciclo de vida no se parecen.

| Columna | Nota |
|---|---|
| `rut` | Normalizado con `cleanRut`. **Único**: es la clave de negocio que permite cruzar una factura sincronizada con el cliente interno. |
| `payment_terms_days` | Plazo por defecto (0–365). Deriva el vencimiento cuando el documento no lo trae. |
| `default_currency` | ISO 4217, validado por CHECK. |
| `owner_user_id` | Responsable comercial / de cobranza. |

### `client_contacts` — contactos
`is_billing` marca a quién se dirigen las gestiones de cobranza.

### `contracts` — contratos
| Columna | Nota |
|---|---|
| `code` | Único, legible (`CTR-2026-0001`). |
| `worksite_id` | Nulo = contrato transversal a varias faenas. |
| `billing_cycle` | `monthly` alimenta la detección de pendientes; `milestone` y `none` no. |
| `payment_terms_days` | **Gana sobre el del cliente** al derivar vencimientos. |
| `period_amount` | Nulo = cobro variable. |

CHECK: fechas ordenadas, moneda válida, plazo en rango, monto no negativo.

## Facturación

### `billing_invoices` — factura normalizada

**Identidad tributaria** (índice único):
`(direction, doc_type, folio, issuer_tax_id, receiver_tax_id)`

El folio no es único global — la misma serie puede ser factura 33 y nota de
crédito 61 — y emisor+receptor cierran el caso de dos empresas con numeración
coincidente. Es lo que hace idempotente la sincronización.

| Columna | Nota |
|---|---|
| `direction` | `sale` \| `purchase`. Cuentas por cobrar y facturas de proveedor nunca se mezclan sin decirlo. |
| `due_date` + `due_date_source` | `provider` (FchVenc del XML) > `contract` > `client`; `manual` **nunca** se sobrescribe. |
| `document_status` | `void` (anulada) excluye la factura de toda agregación válida, sin borrarla. |
| `payment_status`, `paid_amount` | **Caché derivada** de pagos confirmados. No se editan a mano. |
| `collection_status` | Estado interno de gestión. Solo lo mueve una persona. |
| `source`, `source_last_synced_at` | Procedencia y frescura del dato. |
| `net/tax/exempt_amount` | Nulables: el listado del portal solo trae total; se completan desde el XML. |

### `billing_invoice_items` — ítems
Solo existen cuando la fuente los entrega. Una fuente que solo trae totales **no
genera ítems inventados** ni borra los que otra fuente sí aportó.

### `billing_external_refs` — referencias externas
Presencia de la factura en cada proveedor. Dos índices únicos:
- `(provider, external_id)` — un proveedor no repite un documento.
- `(invoice_id, provider)` — un proveedor no aparece dos veces en una factura.

`snapshot` guarda los campos normalizados que ese proveedor reportó; es lo que
permite mostrar **diferencias entre fuentes** sin decidir quién tiene razón.
Nunca guarda credenciales ni el XML completo.

### `billing_invoice_links` — relación con la operación
N-a-N a propósito: una factura puede cubrir varios períodos, faenas o servicios.

| Columna | Nota |
|---|---|
| `status` | `suggested` \| `confirmed` \| `rejected`. |
| `matched_by` | `auto` (motor) o `user` (decisión). |
| `evidence` | Qué coincidió, en texto legible. |
| CHECK `target_present` | Un vínculo tiene que apuntar a algo. |
| CHECK `confirmation_traced` | Confirmado exige autor y fecha. **No hay confirmaciones anónimas.** |

### `billing_bank_transactions` — movimientos bancarios
`account_ref` guarda la cuenta **enmascarada** (`****4321`); el número completo no
entra. `description` es la glosa del banco: dato no confiable, se sanitiza al
mostrar y al exportar. `allocated_amount` es caché de lo imputado por pagos
confirmados.

### `billing_invoice_payments` — pagos
| Columna | Nota |
|---|---|
| `verification_status` | `suggested` no cuenta como cobrado; `confirmed` sí; `rejected` se conserva para no reproponer. |
| `confidence` + `evidence` | Por qué se propuso. |
| `bank_transaction_id` | Nulo en un pago cargado a mano. |
| Único `(invoice_id, bank_transaction_id)` | Un movimiento no se imputa dos veces a la misma factura. |
| CHECK `amount <> 0` | Un pago de cero no informa nada. |
| CHECK `confirmation_traced` | Igual que en los vínculos. |

### `billing_collection_actions` — gestiones de cobranza
Tipo, canal, resultado, compromiso de pago, próxima acción, responsable y autor.
CHECK: un `commitment` sin fecha comprometida no es un compromiso.

### `billing_proposals` / `billing_proposal_items` — propuestas
| Columna | Nota |
|---|---|
| `code` | Único, `PF-2026-0001`. |
| Único parcial `(contract_id, service_period)` | Una sola propuesta viva por contrato y período (excluye `rejected`/`cancelled`). |
| `missing_documents` | Bloquea el paso a `ready`. |
| CHECK `approval_traced` | Aprobada/lista/facturada exige aprobador y fecha. |

Totales calculados desde los ítems con aritmética exacta; el IVA solo sobre la
parte afecta.

### `billing_sync_runs` — corridas
Generaliza `dte_sync_runs` (que se conserva intacto para Compras) agregando
dirección, cursor de reanudación, modo simulación, duplicados, conflictos y un
`correlation_id` para cruzar con los logs.

Índice único parcial `(provider, scope, period_from) WHERE status = 'running'`:
una sola corrida activa por período. Es el control de concurrencia.

### `billing_invoice_events` — línea de tiempo
Complementa `audit_log`. `actor_kind` distingue `provider` (sincronización),
`system` (motor de sugerencias) y `user`. Nunca guarda tokens ni credenciales.

### `billing_duplicate_candidates` — posibles duplicados
Pares de facturas que podrían ser el mismo documento cuando la coincidencia **no**
es exacta. Una exacta se resuelve sola (misma identidad → misma fila); una
probable requiere ojo humano porque fusionar mal pierde información.

## Relaciones que el modelo permite

Una factura puede tener: **1** cliente y **N** contratos/faenas/períodos (vía
`billing_invoice_links`), **N** referencias externas, **N** ítems, **N** pagos,
**N** gestiones de cobranza y **N** eventos. Un pago puede venir de un movimiento
bancario compartido con otras facturas.

## Índices

Cada tabla lleva índices por sus caminos de consulta reales: dirección+fecha de
emisión, vencimiento, estado de pago, estado de cobranza, RUT de emisor y
receptor, responsable, y las claves foráneas usadas en los joins del listado.
