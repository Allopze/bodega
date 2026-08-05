# Arquitectura

## Capas

```
app/(app)/facturacion/**            Pantallas (Server Components) + acciones de servidor
        │
        ├── lib/services/billing/queries.ts       modelo de LECTURA (alcance, filtros, agregación)
        ├── lib/services/billing/collections.ts   lectura de cobranza (clasificación por situación)
        ├── lib/services/billing/pending.ts       derivación de pendientes de facturar
        ├── lib/services/billing/proposals.ts     máquina de estados + totales
        ├── lib/services/billing/invoices.ts      ESCRITURA: upsert, vencimiento, estado de pago
        ├── lib/services/billing/sync.ts          corridas de sincronización
        ├── lib/services/billing/reconciliation.ts motor de sugerencias de pago
        ├── lib/services/billing/money.ts         aritmética exacta y monedas
        ├── lib/services/billing/labels.ts        vocabulario visible (texto + tono)
        └── lib/services/billing/providers/       capa de proveedores externos
                ├── types.ts                      contrato por capacidades
                ├── factura-en-linea.ts           envuelve el scraping existente
                ├── chipax.ts                     sin capacidades (contrato no legible)
                └── manual.ts                     carga a mano / XML importado
                        │
                        └── lib/services/dte-portal/**   integración existente, INTACTA
```

Ninguna pantalla habla con un proveedor externo. Ningún archivo fuera de
`providers/` sabe que FacturaEnLínea es scraping. Esa frontera es lo que permite
agregar o cambiar un proveedor sin tocar el módulo.

## Decisiones y por qué

### 1. Se envolvió FacturaEnLínea; no se reescribió

`lib/services/dte-portal/*` sigue exactamente como estaba y sigue sirviendo al
módulo de Compras. `FacturaEnLineaProvider` lo usa por debajo. El sync de compras
existente (`syncDteDocuments`) no se tocó: dos sistemas conviven durante la
transición, cada uno con su tabla.

### 2. Modelo normalizado, no una tabla por proveedor

`billing_invoices` no tiene ninguna columna con forma de FacturaEnLínea ni de
Chipax. Lo específico de cada fuente vive en `billing_external_refs`, que además
permite que **una misma factura tenga varias fuentes** — el caso que hoy
`dte_documents` no puede representar.

### 3. El estado de pago se calcula, no se declara

`payment_status` y `paid_amount` son caché derivada de los pagos **confirmados**.
La fuente de verdad es `recomputeInvoicePaymentStatus`, que se llama después de
cualquier cambio en pagos. Un booleano `paid` habría hecho imposible representar
un pago parcial sin mentir.

### 4. Sugerido ≠ confirmado, en el esquema y no solo en la UI

`billing_invoice_links` y `billing_invoice_payments` llevan
`status`/`verification_status` con `suggested | confirmed | rejected`, y un CHECK
en la base exige autor y fecha para confirmar. Una inferencia no puede
disfrazarse de decisión ni siquiera por un bug de aplicación.

### 5. El dinero se opera en unidades menores enteras

Postgres guarda `numeric(14,2)` (exacto). El riesgo está en JavaScript, así que
toda aritmética pasa por `money.ts`, que convierte a centavos, opera con enteros
y redondea una sola vez. Ninguna suma de dinero usa `+` directamente.

### 6. El alcance por faena se aplica en la consulta, no en la vista

`invoiceScopePredicate` inyecta un `EXISTS` sobre vínculos **confirmados**. Un rol
acotado que llame al servicio directamente recibe cero filas. Las acciones de
escritura repiten la verificación: nunca confían en que la pantalla filtró.

### 7. Una corrida activa por (proveedor, alcance, período)

En vez de un lock aplicativo, un índice único parcial
(`billing_sync_runs_single_active_unique`) hace que la segunda corrida choque
contra la base. Dos disparos simultáneos no compiten: el segundo se salta.

## Flujo de datos

```
Portal FacturaEnLínea (HTML)
   → FacturaEnLineaProvider.listIssuedInvoices()
       → resuelve el RUT del cliente desde el XML (el listado no lo trae)
   → ProviderInvoice (modelo normalizado)
   → syncBillingInvoices()  ── corrida con métricas, dedupe y modo simulación
       → upsertProviderInvoice()  ── identidad tributaria + referencia externa
   → billing_invoices (+ items, external_refs, events)

Persona
   → vincula la factura con cliente / contrato / faena / período  (confirmado)
   → registra gestiones de cobranza
   → confirma pagos            ── único camino a "cobrado"
   → recomputeInvoicePaymentStatus()

Movimientos bancarios (Chipax cuando exista, o carga manual)
   → proposeMatches()          ── evidencia + confianza, NO confirma
   → billing_invoice_payments (suggested)
   → confirmación humana       ── recién acá cambia el saldo
```

## Convenciones seguidas del repositorio

- Módulo registrado en `modules/registry.ts` con su manifest: permisos,
  navegación y grants por rol se derivan de ahí.
- Esquema Drizzle en `db/schema/`, exportado desde `db/schema/index.ts`.
- Server Components por defecto; Client Components solo donde hay interacción.
- Validación con Zod en cada acción; `guardPermission` antes de tocar nada.
- `recordAudit` para la traza transversal; `billing_invoice_events` para la línea
  de tiempo de la factura.
- Toasts vía `@/lib/toast`, primitivas de `components/ui/`.
