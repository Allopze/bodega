# Chipax

## Estado: IMPLEMENTADO contra el contrato real y verificado en vivo.

La integración es de **solo lectura**. `BILLING_CHIPAX_ENABLED` indica que el
proveedor está disponible; `BILLING_CHIPAX_SYNC_ENABLED` controla únicamente la
automatización y puede permanecer apagado para uso manual.

## Dónde está el contrato

El documento OpenAPI **no** está en `/v2/swagger.json` —eso devuelve 404— sino
**embebido en el bundle de Swagger UI**:

```
GET https://api.chipax.com/v2/swagger-docs/swagger-ui-init.js
    → options.swaggerDoc   (OpenAPI 3.0.1, «Chipax API v2.0», 28 operaciones)
```

El `swagger-initializer.js` del mismo directorio apunta al *petstore* de ejemplo,
lo que hacía parecer que el contrato no estaba publicado.

## Autenticación y autorización

| Elemento | Valor verificado |
|---|---|
| Servidor (`servers`) | `https://api.chipax.com/v2/` |
| Login | `POST /login` con `{app_id, secret_key}` |
| Respuesta | `{message, token, tokenExpiration, nombre}` — `token` es un JWT HS256 |
| Seguridad | `apiKey` en cabecera **`Authorization`**, valor **`JWT <token>`** |
| Límite de tasa | **60 solicitudes por minuto** (`x-ratelimit-limit`) |

**El prefijo es `JWT`, no `Bearer`.** Con `Bearer` la API responde 401. Y como el
middleware de autenticación corre **antes** del enrutado, una cabecera equivocada
devuelve 401 incluso en rutas inexistentes: el prefijo correcto **no se puede
deducir probando**, hay que leerlo del contrato. Ese fue el bloqueo durante toda
la exploración a ciegas.

## Operaciones implementadas

### `GET /dtes` — facturas de venta

Parámetros usados: `fechaInicial`, `fechaFinal` (`YYYY-MM-DD`), `page`.

> **Discrepancia contrato ↔ realidad.** El contrato declara que devuelve un array
> plano; la API real devuelve `{items, paginationAttributes: {count, totalPages,
> currentPage}}`. Manda la respuesta real, y el adaptador **tolera ambas formas**
> para no romperse si lo corrigen.

Campos que se usan: `id`, `tipo`, `folio`, `rut`, `razonSocial`, `fechaEmision`,
**`fechaVencimiento`**, `montoNeto`, `montoExento`, `iva`, `montoTotal`.

Verificado en vivo: **3.105 documentos**, 63 páginas de 50. Junio 2026 devuelve
**46 DTE**, coherente con los 43–48/mes que reporta FacturaEnLínea.

El **emisor** no viene en la respuesta —para Chipax es implícito, es la cuenta—
así que se toma de `BILLING_COMPANY_TAX_ID` (o `DTE_PORTAL_RUT_EMP`, la misma
empresa). Sin ese valor el adaptador **se niega a mapear** en vez de inventar un
emisor.

`documentStatus` queda en `unknown`: Chipax no informa el estado en el SII, y
dejarlo así evita pisar el que sí entrega FacturaEnLínea.

### `GET /flujo-caja/cartolas` — movimientos bancarios

Parámetros usados: `startDate`, `endDate` (`YYYY-MM-DD`), `page`.
Respuesta: `{docs, pages, total}`.

Campos: `id`, `fecha`, `abono`, `cargo`, `descripcion`,
`comentario_transferencia`, `cuenta_corriente_id`.

El monto normalizado es `abono − cargo`: entra positivo, sale negativo. La
cartola **no identifica la contraparte**, así que `counterpartyTaxId` y
`counterpartyName` quedan nulos y la conciliación se apoya en monto, fecha y
folio en la glosa. `accountRef` guarda `cc:<id>` — un identificador interno de
cuenta, no un número bancario, así que no hay nada que enmascarar.

Verificado en vivo: **186 movimientos en 3 días**.

Esto es lo que **desbloquea el motor de conciliación**, que hasta ahora no tenía
fuente de movimientos en producción.

## Capacidades declaradas

| Capacidad | Estado | Motivo |
|---|:--:|---|
| `canListIssuedInvoices` | ✅ | `/dtes`, verificado |
| `canListBankTransactions` | ✅ | `/flujo-caja/cartolas`, verificado |
| `canListReceivedInvoices` | ❌ | `/compras` existe en el contrato pero **no se verificó su forma**, y las facturas de proveedor ya las cubre FacturaEnLínea |
| `canCreateInvoices` · `canCreateExpenses` | ❌ | La integración es de **solo lectura**. `POST /gastos`, `POST /notas-venta` y `POST /clientes` existen y **no se usan** |

Una capacidad se activa **después** de verificar su operación, nunca antes.

## Automatización y períodos

El endpoint protegido `/api/cron/chipax-sync` ejecuta una corrida con un único
`correlationId` para estos cuatro alcances, en este orden:

1. ventas del mes actual;
2. cartolas del mes actual;
3. ventas del mes anterior;
4. cartolas del mes anterior.

Las cartolas cubren los mismos dos períodos que las ventas: pedir sólo el mes en
curso dejaba fuera para siempre los movimientos del último día del mes anterior
—y los que el banco publica con días de retraso—, porque ninguna corrida
posterior vuelve a ese rango de fechas. Reingestar el mes anterior es
idempotente: la identidad es `(provider, external_id)`.

El scheduler interno lo llama una vez al día a las **09:00
`America/Santiago`**. Una corrida completa elimina el cursor durable; una
corrida parcial o interrumpida conserva el cursor en
`system_settings` (`billing.sync_cursor.chipax.<alcance>.<YYYY-MM>`), y
`billing_sync_runs.cursor` deja la evidencia de la página retomable. Repetir
una página es seguro porque la identidad `(provider, external_id)` es
idempotente. El endpoint devuelve `503` degradado para resultados parciales y
`409` si existe una corrida activa.

## Configuración

```bash
CHIPAX_APP_ID=                 # credencial de aplicación
CHIPAX_SECRET_KEY=             # secreto de aplicación
CHIPAX_API_BASE_URL=           # vacío → https://api.chipax.com/v2
CHIPAX_REQUEST_TIMEOUT_MS=30000
BILLING_CHIPAX_ENABLED=true    # feature flag del proveedor
BILLING_CHIPAX_SYNC_ENABLED=false # automatización diaria a las 09:00 Chile
BILLING_COMPANY_TAX_ID=        # vacío → usa DTE_PORTAL_RUT_EMP
```

Guardar `CHIPAX_APP_ID` y `CHIPAX_SECRET_KEY` en un gestor de secretos. Nunca en
el repositorio, nunca con prefijo `NEXT_PUBLIC_`.

### Administración desde la plataforma

Los dos flags y las dos credenciales también se administran sin desplegar, desde
**Facturación › Sincronización › tarjeta Chipax › «Credenciales»** (permiso
`billing:manage_sync`). Se guardan en `system_settings` bajo
`billing.chipax.app_id`, `billing.chipax.secret_key`, `billing.chipax.enabled` y
`billing.chipax.sync_enabled`.

| Regla | Detalle |
|---|---|
| Precedencia | Lo guardado gana; el entorno es el respaldo. Sin filas persistidas, el comportamiento es idéntico al de antes. |
| Cifrado | Mismo sobre AES-256-GCM del portal DTE (`settings-crypto.ts`), con la key física como AAD. Sin keyring la operación **falla**: no se persiste texto plano. |
| Vacío conserva | Un campo de secreto en blanco mantiene el valor guardado. Para volver al `.env` está «Restaurar la del servidor», que borra las cuatro filas. |
| Auditoría | Queda un registro `billing_chipax_settings` con qué cambió, nunca con el valor. |

`CHIPAX_API_BASE_URL`, `CHIPAX_OPENAPI_URL`, `CHIPAX_REQUEST_TIMEOUT_MS` y
`BILLING_COMPANY_TAX_ID` **no** se administran desde la UI: son decisiones de
despliegue, no de operación.

Por eso `readChipaxConfig()` vive en `lib/services/billing/chipax-settings.ts` y
es asíncrona (consulta la BD). `readChipaxEnvConfig()`, en `config.ts`, sigue
leyendo sólo el entorno y es el respaldo cuando Postgres no responde.

> Desapareció `CHIPAX_CONTRACT_VERIFIED`. Existía como freno mientras el contrato
> no se podía leer; ahora se leyó y las operaciones están implementadas contra
> él, así que un segundo interruptor solo sería ruido.

## Manejo del token y de los límites

- El token vive **solo en memoria** de la instancia del proveedor, se reutiliza
  mientras siga vigente (con margen de 60 s sobre `tokenExpiration`) y **nunca**
  se persiste ni se registra.
- Ante `401` se renueva **una** vez y se repite **una** consulta idempotente. Un
  segundo `401` detiene el flujo.
- Las solicitudes se espacian ~1,1 s para no acercarse al límite de 60/min.
- Las respuestas se validan en runtime: identificadores, fechas, montos,
  tamaño de página y total de páginas. Un contrato inválido queda como
  `INVALID_RESPONSE`, no como una falla de red.
- Ante `429` se hace **un solo** reintento, respetando `Retry-After` con un
  máximo de 30 segundos. Un segundo `429` termina como `RATE_LIMITED`.
- El spacing existente mantiene el límite operativo documentado de **60
  solicitudes por minuto**; el cron no escribe pagos ni confirma movimientos
  en Chipax.

## Fuente del límite operativo

El límite y el uso de la API están documentados por Chipax en
[Cómo y para qué utilizar la API de Chipax](https://ayuda.chipax.com/es/articles/5423394-como-y-para-que-utilizar-la-api-de-chipax).

## Lo que sigue en manos de una persona

Que Chipax entregue movimientos bancarios **no** significa que los pagos se
confirmen solos. El motor solo **sugiere**, con evidencia y confianza; convertir
una sugerencia en cobro sigue exigiendo `billing:confirm_payments`. Ver
[README.md](README.md) y [SINCRONIZACION.md](SINCRONIZACION.md).

## Matriz de responsabilidades

| Capacidad | FacturaEnLínea | Chipax | Chome |
|---|---|---|---|
| Factura emitida | Fuente (estado SII) | Fuente (montos, vencimiento) | Registro normalizado |
| Factura recibida | Fuente (Compras) | No activado | Relación con OC |
| Estado tributario | **Fuente única** | No informa | — |
| Vencimiento | XML (`FchVenc`) | `fechaVencimiento` | Puede fijarlo a mano |
| Movimiento bancario | No disponible | **Fuente única** | Sugerencias |
| Pago confirmado | — | — | **Solo una persona** |
| Cliente, contrato, faena | No corresponde | No corresponde | **Fuente única** |
| Emisión tributaria | Sistema existente (manual) | No se usa | No implementar |
