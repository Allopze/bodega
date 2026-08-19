# Capa de proveedores

## El contrato

`lib/services/billing/providers/types.ts` define un proveedor por **capacidades**,
no por métodos obligatorios. Un proveedor declara qué sabe hacer y el resto del
sistema pregunta antes de pedirlo.

```ts
interface BillingProviderCapabilities {
  canListIssuedInvoices    // facturas emitidas (ventas)
  canListReceivedInvoices  // facturas recibidas (compras)
  canRetrieveXml
  canRetrievePdf
  canListPayments
  canListBankTransactions
  canListClients
  canCreateInvoices        // la plataforma nunca lo usa
  canCreateExpenses        // requiere autorización expresa
}
```

Los métodos de datos son **opcionales** en la interfaz. Una capacidad en `true`
sin su método es un bug de programación, no una condición de runtime: lo detecta
`assertCapability` y lo verifica una prueba (`providers.test.ts`).

## Estado real de cada proveedor

| Proveedor | Emitidas | Recibidas | XML | Pagos | Banco | Estado |
|---|:--:|:--:|:--:|:--:|:--:|---|
| FacturaEnLínea | ✅ | ✅ | ✅ | ❌ | ❌ | Operativo |
| Chipax | ✅ | ❌ | ❌ | ❌ | ✅ | Operativo, solo lectura — ver [CHIPAX.md](CHIPAX.md) |
| Carga manual | — | — | ✅ | — | — | Siempre disponible |

FacturaEnLínea no declara pagos ni movimientos bancarios porque el portal es un
emisor de DTE, no un banco. Ningún proveedor declara capacidad de escritura.

## Requisitos que cumple la capa

| Requisito | Dónde |
|---|---|
| Autenticación solo en backend | Los adaptadores viven en `lib/`; ninguna credencial llega al cliente. |
| Credenciales en almacenamiento seguro | `system_settings` + variables de entorno. Ver la salvedad en [FACTURAENLINEA.md](FACTURAENLINEA.md). |
| Timeout explícito | `requestTimeoutMs` (120 s en el portal; la bandeja tarda ~80 s en meses grandes). |
| Reintentos limitados en lectura | Un documento que falla no aborta la corrida; se cuenta y se reporta. |
| Ningún reintento ciego en escritura | No hay escrituras externas. |
| Errores redactados | `redact()` filtra credenciales antes de loguear o mostrar. |
| Idempotencia | Identidad tributaria + `(provider, external_id)`. |
| Paginación | `ProviderPage.nextCursor`; tope de 50 páginas por corrida y límites runtime por respuesta. |
| Sincronización incremental | Acotada por período, con piso histórico configurable. |
| Reanudable | Cursor durable en `system_settings` por proveedor/alcance/período; `billing_sync_runs.cursor` conserva la evidencia. |
| Métricas | `billing_sync_runs` con desglose completo. |
| Separación por empresa | `accountRef` (CodEmp del portal) en cada documento y referencia. |
| Estado de salud | `healthCheck()` sin secretos, visible en `/facturacion/sincronizacion`. |
| Pruebas con respuestas simuladas | `sync-integration.test.ts` usa un proveedor falso. |
| Feature flags | `BILLING_SALES_SYNC_ENABLED`, `BILLING_CHIPAX_ENABLED`, `BILLING_CHIPAX_SYNC_ENABLED`. Los dos de Chipax se pueden sobrescribir desde la UI (ver [CHIPAX.md](CHIPAX.md)). |
| Protección de archivos | XML de compras, enriquecimiento de ventas y caché limitados a 10 MiB; guardado condicional y limpieza de perdedores. |

## Cómo agregar un proveedor

1. Agregar su id al tipo `BillingProviderId` en `db/schema/billing.ts` y a la
   constante `PROVIDER_SQL` (los CHECK de la base lo validan). Generar migración.
2. Crear `lib/services/billing/providers/<nombre>.ts` implementando
   `BillingProvider`. Declarar **solo** las capacidades verificadas contra el
   contrato real del proveedor.
3. Registrarlo en `providers/index.ts` (`BILLING_PROVIDER_IDS` +
   `getBillingProvider`) y, si necesita flag, en `isProviderEnabled`.
4. Agregar su configuración a `lib/services/billing/config.ts` y documentar las
   variables en `.env.example` **sin valores**.
5. Extender `providers.test.ts`: la prueba de coherencia capacidad↔método corre
   sobre todos los proveedores registrados automáticamente.

Lo que **no** hay que hacer: tocar `queries.ts`, las pantallas o el esquema de
facturas. Si un proveedor nuevo obliga a cambiar eso, la normalización está mal.
