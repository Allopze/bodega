# Chipax

## Estado: NO implementado. Arquitectura lista, contrato no legible.

## Qué se verificó (2026-08-04, en vivo)

```
GET  https://api.chipax.com/v2/swagger-docs/            → 200  Swagger UI estático
GET  .../swagger-docs/swagger-initializer.js            → url: "https://petstore.swagger.io/v2/swagger.json"
GET  https://api.chipax.com/v2/swagger.json             → 401  {"message":"Unauthorized"}
GET  https://api.chipax.com/v2/api-docs                 → 401
GET  https://api.chipax.com/v2/openapi.json             → 401
GET  https://api.chipax.com/v2/docs.json                → 401
POST https://api.chipax.com/v2/login   (cuerpo vacío)   → 400  {"error":"Parámetros inválidos."}
```

Dos hechos:

1. El Swagger UI publicado **no está configurado**: su initializer apunta al
   petstore de ejemplo, no al contrato de Chipax.
2. El documento OpenAPI real **está detrás de autenticación** (401). El endpoint
   de login existe y valida parámetros, pero sin credenciales no se puede leer.

## Por qué no se implementó igual

Escribir rutas, nombres de filtros, forma de paginación o esquemas de respuesta
sin leer el contrato sería **inventarlos**. En una integración financiera eso
produce exactamente el fallo que hay que evitar: código que parece funcionar,
falla silenciosamente contra la API real, y cuyo error se descubre cuando las
cifras no cuadran.

Por eso `ChipaxProvider` declara **todas sus capacidades en `false`** y su
`healthCheck` reporta el bloqueo en vez de fingir salud. Cualquier intento de
usarlo falla ruidosamente en el backend (`assertUsable`), no devuelve listas
vacías que la UI mostraría como "no hay facturas".

## Qué está listo

- `lib/services/billing/providers/chipax.ts` — adaptador con capacidades,
  configuración y diagnóstico.
- `lib/services/billing/config.ts::readChipaxConfig` — flags y variables.
- Variables documentadas en `.env.example`, sin valores.
- Modelo de datos preparado: `billing_bank_transactions` y `billing_external_refs`
  ya aceptan `provider = 'chipax'`.
- El motor de conciliación ya consume movimientos bancarios de cualquier fuente.
- Pruebas: `providers.test.ts` verifica que Chipax no declare capacidades ni se
  considere configurado; `sync-integration.test.ts` demuestra que dos fuentes
  distintas describen la misma factura sin duplicarla.

## Qué falta para activarlo

1. **Credenciales de API** en `CHIPAX_LOGIN_PAYLOAD_JSON` (gestor de secretos,
   nunca el repositorio). Chipax las entrega según su documentación de ayuda.
2. **Leer el contrato vigente** con esas credenciales y registrar, por operación:
   servidor (bloque `servers`), esquema de seguridad, método, ruta, parámetros
   requeridos, cuerpo, respuesta y mecanismo de paginación.
3. **Implementar** `listIssuedInvoices` y/o `listBankTransactions` con tipos
   derivados del contrato, y activar **solo** esas capacidades.
4. Poner `CHIPAX_API_BASE_URL` con el valor del bloque `servers` (no asumirlo).
5. Encender `BILLING_CHIPAX_ENABLED=true` **y** `CHIPAX_CONTRACT_VERIFIED=true`.
   Son dos interruptores distintos a propósito: tener la credencial no autoriza a
   adivinar rutas.

## Reglas para cuando se active

- **Solo lectura.** `canCreateInvoices` y `canCreateExpenses` no se activan sin
  una decisión de negocio explícita y documentada.
- El token vive **solo en el backend**, en memoria o almacenamiento temporal
  seguro. Nunca en el cliente, nunca en un log.
- Ante `401`: reautenticar **una** vez y repetir **una** consulta idempotente. Un
  segundo `401` detiene el flujo.
- Funcionamiento **en paralelo** con FacturaEnLínea durante un período controlado:
  ambas fuentes describen la misma factura y la pantalla de detalle muestra las
  diferencias. Recién con esa comparación tiene sentido evaluar una migración.
- Las cuentas bancarias se guardan **enmascaradas**; el número completo no entra
  a la base.

## Matriz de responsabilidades proyectada

| Capacidad | FacturaEnLínea | Chipax | Chome |
|---|---|---|---|
| Factura emitida | Fuente actual | Verificación | Registro normalizado |
| Factura recibida | Fuente actual (Compras) | Verificación financiera | Relación con OC |
| Neto / IVA / exento | XML del documento | Verificación | — |
| Estado tributario | Fuente única | — | — |
| Pago bancario | No disponible | **Fuente** | Conciliación y confirmación |
| Movimiento bancario | No disponible | **Fuente** | Sugerencias |
| Cliente, contrato, faena | No corresponde | No corresponde | **Fuente única** |
| Estado de cobranza | No corresponde | No corresponde | **Fuente única** |
| Emisión tributaria | Sistema existente (manual) | No asumir | No implementar |
