# Chipax

## Estado: autenticación VERIFICADA e implementada. Operaciones de datos, no.

## Lo que sí quedó verificado (2026-08-05, contra la API real)

```
POST https://api.chipax.com/v2/login   {}                      → 400  {"error":"Parámetros inválidos."}
POST https://api.chipax.com/v2/login   {usuario, clave}        → 400  {"error":"Parámetros inválidos."}   ← control
POST https://api.chipax.com/v2/login   {app_id, secret_key}    → 401  {"error":"Credenciales inválidas"}
```

**El 401 frente al 400 del control es la prueba.** Con `{app_id, secret_key}` el
servidor aceptó el esquema del cuerpo y solo rechazó los *valores*; con otros
nombres de campo ni siquiera llega a evaluarlos. Eso deja fijado, sin adivinar:

| Elemento | Valor verificado |
|---|---|
| Método y ruta | `POST /login` |
| URL base | `https://api.chipax.com/v2` |
| Cuerpo | `{ "app_id": …, "secret_key": … }` — exactamente esos dos campos |

`login()` está implementado con esa forma exacta en
`lib/services/billing/providers/chipax.ts`.

## Lo que sigue sin verificar

```
GET  https://api.chipax.com/v2/swagger.json   → 401
GET  https://api.chipax.com/v2/api-docs       → 401
GET  https://api.chipax.com/v2/openapi.json   → 401
GET  .../swagger-docs/swagger-initializer.js  → url: "https://petstore.swagger.io/v2/swagger.json"
```

El Swagger UI publicado **no está configurado** (apunta al petstore de ejemplo) y
el documento OpenAPI real está detrás de autenticación. Por lo tanto no se conoce:

- **La forma de la respuesta exitosa del login**: qué campo trae el token.
- **El esquema de seguridad**: nombre y formato de la cabecera de autorización.
- **Ninguna ruta de datos**: DTE de venta y compra, cartolas, gastos, clientes,
  con sus filtros y su paginación.

Por eso el proveedor **no declara ninguna capacidad de datos** y
`assertUsable()` falla ruidosamente si algo intenta pedirle facturas.

## El descubridor: "Probar conexión"

Con credenciales cargadas, el botón **Probar conexión** de
`/facturacion/sincronizacion` ejecuta el login real y reporta **los nombres de
los campos de la respuesta, nunca sus valores**:

> *Autenticación correcta. La respuesta trae los campos: token, expiresIn.*

Ese es exactamente el dato que falta para identificar dónde viene el token y
completar el esquema de seguridad — sin exponerlo en pantalla, en logs ni en la
auditoría. Es el siguiente paso concreto para desbloquear el resto.

## Configuración

```bash
CHIPAX_APP_ID=                 # credencial de aplicación
CHIPAX_SECRET_KEY=             # secreto de aplicación
CHIPAX_API_BASE_URL=           # vacío → https://api.chipax.com/v2 (verificado)
CHIPAX_OPENAPI_URL=https://api.chipax.com/v2/swagger-docs/
CHIPAX_REQUEST_TIMEOUT_MS=30000

BILLING_CHIPAX_ENABLED=false   # feature flag del proveedor
CHIPAX_CONTRACT_VERIFIED=false # ← interruptor DISTINTO, ver abajo
```

Guardar `CHIPAX_APP_ID` y `CHIPAX_SECRET_KEY` en un gestor de secretos. Nunca en
el repositorio, nunca con prefijo `NEXT_PUBLIC_`.

### Por qué son dos interruptores y no uno

`BILLING_CHIPAX_ENABLED` habilita el proveedor. `CHIPAX_CONTRACT_VERIFIED`
declara que alguien **leyó el contrato de datos** y completó las operaciones de
lectura en el adaptador.

Están separados a propósito: **autenticarse no autoriza a adivinar rutas**. Hoy
lo primero funciona y lo segundo no, y el módulo tiene que poder distinguirlo.

## Pasos para activarlo del todo

1. Cargar `CHIPAX_APP_ID` y `CHIPAX_SECRET_KEY`.
2. **Probar conexión** desde el centro de sincronización → anotar los campos que
   devuelve la respuesta.
3. Con el token en mano, leer el contrato OpenAPI (`GET /v2/swagger.json` con la
   cabecera de autorización correspondiente) y registrar, por operación: método,
   ruta, parámetros requeridos, cuerpo, respuesta y mecanismo de paginación.
4. Implementar `listIssuedInvoices` y/o `listBankTransactions` con tipos
   derivados del contrato, y activar **solo** esas capacidades en
   `CHIPAX_CAPABILITIES`.
5. `BILLING_CHIPAX_ENABLED=true` **y** `CHIPAX_CONTRACT_VERIFIED=true`.

## Reglas que siguen vigentes al activarlo

- **Solo lectura.** `canCreateInvoices` y `canCreateExpenses` no se activan sin
  una decisión de negocio explícita y documentada.
- El token vive **solo en el backend**. Hoy `login()` ni siquiera lo devuelve:
  mientras no haya operaciones de datos, exponerlo solo agrega superficie de fuga.
- Ante `401`: reautenticar **una** vez y repetir **una** consulta idempotente. Un
  segundo `401` detiene el flujo.
- **Funcionamiento en paralelo** con FacturaEnLínea durante un período
  controlado: ambas fuentes describen la misma factura y la pantalla de detalle
  muestra las diferencias. Recién con esa comparación tiene sentido evaluar una
  migración.
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
