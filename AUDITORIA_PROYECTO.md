# Auditoria integral del proyecto Chome Solicitudes y Bodega

## Tabla de contenidos

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Descripcion del proyecto auditado](#2-descripcion-del-proyecto-auditado)
3. [Mapa de estructura del repositorio](#3-mapa-de-estructura-del-repositorio)
4. [Auditoria UI/UX](#4-auditoria-uiux)
5. [Auditoria de logica de negocio](#5-auditoria-de-logica-de-negocio)
6. [Bugs potenciales o confirmados](#6-bugs-potenciales-o-confirmados)
7. [Malas practicas detectadas](#7-malas-practicas-detectadas)
8. [Auditoria de accesibilidad](#8-auditoria-de-accesibilidad)
9. [Auditoria de rendimiento](#9-auditoria-de-rendimiento)
10. [Auditoria de seguridad basica](#10-auditoria-de-seguridad-basica)
11. [Auditoria de testing](#11-auditoria-de-testing)
12. [Oportunidades de mejora tecnica](#12-oportunidades-de-mejora-tecnica)
13. [Funciones faltantes recomendadas](#13-funciones-faltantes-recomendadas)
14. [Roadmap recomendado](#14-roadmap-recomendado)
15. [Lista priorizada de acciones](#15-lista-priorizada-de-acciones)

---

## 1. Resumen ejecutivo

El proyecto es una aplicacion interna para gestionar solicitudes de compra por faena, aprobaciones, ordenes de compra, facturas anexas, recepcion, trazabilidad, reportes, usuarios, roles, proveedores, productos, bodegas y trabajadores. El README confirma el flujo operativo principal: configurar maestros, crear solicitud, aprobar, generar OC, anexar factura, registrar recepcion y revisar trazabilidad/reportes.

La madurez es superior a un prototipo: usa Next.js 16 App Router, Server Actions, RBAC, Drizzle con SQLite, auditoria, maquina de estados para items, tests unitarios y E2E. El estado general de calidad es bueno para un sistema interno en etapa MVP avanzada o pre-produccion, con deuda concreta en accesibilidad, escalabilidad de consultas, validacion robusta de payloads manipulables y algunos bordes de seguridad.

Riesgos principales:

- Codigos correlativos generados por `count() + 1`, con riesgo de colision en concurrencia.
- Varias pantallas cargan todos los registros y filtran por permisos en memoria, lo que escala mal y aumenta superficie de fuga accidental si se reutilizan datos sin filtrar.
- Algunas interacciones no son accesibles por teclado o son visualmente engañosas.
- `npm audit --omit=dev` reporta vulnerabilidades transitivas moderadas/bajas en `next-auth` beta via `@auth/core`/`nodemailer`.
- La validacion de algunos formularios depende de JSON oculto serializado desde el cliente, con tipado runtime insuficiente en compras y recepcion.

Oportunidades principales:

- Consolidar servicios y validaciones Zod para cada Server Action critica.
- Empujar filtros RBAC a consultas SQL y agregar paginacion/indices.
- Mejorar accesibilidad de tablas, notificaciones, selects y formularios.
- Agregar pruebas de integracion para concurrencia, seguridad y server actions.
- Definir `PRODUCT.md` y `DESIGN.md`; no existen en la raiz ni en carpetas de contexto detectadas.

**Evaluacion general:** 7.2/10

---

## 2. Descripcion del proyecto auditado

El software resuelve un flujo interno de abastecimiento para una organizacion con faenas. El usuario final probable incluye solicitantes de faena, jefa Chome, secretaria, prevencionista, administradores y personal de bodega. El problema central es coordinar pedidos operativos, aprobaciones, compras, facturas, recepciones y trazabilidad evitando planillas dispersas.

Flujo general:

1. Administrador configura faenas, centros de costo, proveedores, productos, bodegas, usuarios y roles.
2. Solicitante crea una solicitud con items catalogados o libres.
3. Roles autorizados aprueban, rechazan o devuelven items.
4. Compras genera OC con items aprobados.
5. La OC se emite, se marca enviada y luego se recibe.
6. Se anexan y concilian facturas.
7. Reportes y trazabilidad muestran avance operativo.

| Area | Tecnologia / Herramienta detectada | Observaciones |
|---|---|---|
| Frontend | Next.js 16.2.7 App Router, React 19.2.4, Server Components y Client Components | Rutas en `app/(app)`, `app/(auth)`, `app/(print)` y APIs en `app/api`. Next docs locales revisadas en `node_modules/next/dist/docs/01-app/index.md` y `03-architecture/accessibility.md`. |
| Backend | Server Actions, Route Handlers, NextAuth v5 beta | Acciones en `app/**/actions.ts`; APIs en `app/api/auth`, `app/api/notifications`, `app/api/reportes/export`, `app/api/invoice-attachments/[id]`. |
| Base de datos | SQLite con `better-sqlite3`, Drizzle ORM y migraciones | Conexion en `db/index.ts`; schemas en `db/schema/*`; migracion inicial en `db/migrations/0000_reflective_mimic.sql`. |
| Autenticacion | `next-auth@5.0.0-beta.31`, Credentials, bcryptjs | Auth en `lib/auth/auth.ts`, RBAC en `lib/auth/rbac.ts` y permisos en `lib/auth/can.ts`. |
| Estilos/UI | Tailwind CSS 4, tokens OKLCH, Radix UI, Phosphor Icons, Sonner | Tokens en `app/globals.css`; componentes base en `components/ui`. |
| Testing | Vitest, Playwright | `npm test`: 85 tests pasan. `npm run test:e2e`: 3 tests pasan. `npx tsc --noEmit`: sin errores. |
| Build/Deploy | Next build/start, Playwright webServer, Drizzle scripts | `package.json` contiene scripts de build, migracion, seed, test y E2E. `next.config.ts` esta vacio. |

---

## 3. Mapa de estructura del repositorio

```text
/
  app/
    (app)/
      dashboard/
      solicitudes/
      aprobaciones/
      compras/
      recepcion/
      bodega/
      entregas/
      trazabilidad/
      reportes/
      admin/
    (auth)/
      login/
      registro/
    (print)/
    api/
  components/
    admin/
    invoices/
    layout/
    providers/
    states/
    ui/
  db/
    schema/
    migrations/
    seed.ts
  lib/
    actions/
    auth/
    email/
    reports/
    services/
    validation/
    __tests__/
  e2e/
  public/
  storage/
```

| Carpeta | Que contiene | Organizacion | Problemas detectados | Mejoras recomendadas |
|---|---|---|---|---|
| `app/(app)` | Superficie autenticada: dashboard, solicitudes, aprobaciones, compras, recepcion, bodega, reportes, admin | Buena separacion por modulo y uso de `loading.tsx` en muchas rutas | Varias paginas hacen consultas amplias y filtran en memoria: `dashboard/page.tsx:253-304`, `reportes/page.tsx:29-84`, `bodega/page.tsx:84-148` | Crear capa de queries por modulo con filtros RBAC en SQL, paginacion y DTOs |
| `app/(auth)` | Login, registro e invitaciones | Flujo bootstrap + invitacion claro | `login-form.tsx:15,42` usa `callbackUrl` del query sin normalizacion local explicita | Validar que `callbackUrl` sea path interno antes de `router.push` |
| `app/api` | Auth, notificaciones, exportaciones, descarga de facturas | APIs pequeñas y focalizadas | Exportacion admite `tipo` desconocido y cae a reporte default en `lib/reports/export.ts:67-78`; adjuntos confian en MIME de cliente | Whitelist explicita de reportes y validacion de magic bytes para archivos |
| `components/ui` | Sistema base de botones, campos, inputs, tablas, dialogos, select, skeleton, etc. | Bastante consistente, con foco global y tokens | Algunos controles son de 32px o 36px, bajo 44px tactil; `Field` no ata errores con `aria-describedby` | Elevar tamanos tactiles en mobile y mejorar asociaciones ARIA |
| `components/layout` | App shell, sidebar, top bar, notificaciones | Buen shell con skip link y sidebar responsive | Notificaciones renderizan filas clicables como `div` sin teclado en `notification-bell.tsx:170-177` | Usar `button`/`Link` para cada notificacion |
| `lib/services` | Logica de negocio central: estados, compras, recepcion, bodega, entregas, notificaciones | Es una fortaleza del proyecto; la maquina de estados esta aislada | Algunos servicios generan codigos con conteo global y no hay control de concurrencia | Crear secuencias/tabla de counters transaccional o ids legibles derivados de timestamp + secuencia |
| `lib/validation` | Schemas Zod para maestros y operaciones | Buen punto de partida | Compras y recepcion no tienen schemas Zod completos para `itemsJson`; usan casts | Agregar `purchaseOrderSchema`, `receiptSchema`, `dispatchSchema`, `invoiceAttachmentSchema` |
| `db/schema` | Tablas Drizzle para usuarios, faenas, productos, solicitudes, compras, recepcion, bodega, auditoria | Modelado claro y relaciones declaradas | Faltan constraints compuestos en tablas pivote y stock, por ejemplo `warehouse_stock` no declara unicidad `(warehouseId, productId)` en schema | Agregar constraints/indices compuestos y migraciones |
| `e2e` | Playwright para flujo completo | Muy valioso; corre contra SQLite efimero | Actualmente solo Chromium desktop | Agregar mobile/responsive y roles/permisos negativos |
| Raiz | README, TESTING, configs, package, AGENTS | Documentacion operativa buena | No hay `PRODUCT.md` ni `DESIGN.md`; `.env.local` existe pero esta ignorado por `.gitignore:43` | Documentar producto/diseno y agregar `.env.example` seguro |

---

## 4. Auditoria UI/UX

| Hallazgo | Impacto | Evidencia en el codigo | Recomendacion |
|---|---|---|---|
| Dashboard muestra tarjetas con `cursor-pointer` pero no tienen `onClick`, `Link` ni accion real | Alto | `app/(app)/dashboard/page.tsx:183-189` | Convertir cada tarjeta en `Link` a su modulo correspondiente o retirar affordance de clic. Ejemplo: pendientes de aprobacion a `/aprobaciones`, items sin OC a `/compras/nueva`. |
| Accion de ver solicitud aparece solo en hover y queda invisible para teclado | Alto | `app/(app)/solicitudes/request-list.tsx:131-135` usa `opacity-0 group-hover:opacity-100` | Agregar `focus:opacity-100 focus-visible:opacity-100` o dejar visible permanentemente. |
| Notificaciones son filas `div` clicables, no botones ni links | Alto | `components/layout/notification-bell.tsx:162-177` | Renderizar como `button` si solo marca leida o como `Link` si navega. Soportar Enter/Espacio y `aria-current`/estado leida. |
| Formularios importantes no muestran errores por campo en todos los controles | Medio | `OcForm` muestra toast/error general en `app/(app)/compras/oc-form.tsx:408-412`; `createOrderAction` devuelve mayormente `message`, no `fieldErrors` | Devolver `fieldErrors` con Zod y pasarlos a `Field`. Evitar que el usuario adivine que campo fallo. |
| Muchos `Field` no asocian label con control | Medio | `app/(app)/compras/oc-form.tsx:207-220`, `229-247`; `Field` necesita `htmlFor` en `components/ui/field.tsx:34-43` | Pasar `htmlFor` a cada `Field` y `id` al control. Para Radix Select, usar `aria-labelledby` si el label externo no se enlaza por `htmlFor`. |
| Product picker es un combobox manual sin roles ARIA | Medio | `app/(app)/solicitudes/request-form.tsx:544-589` | Usar Radix Combobox/Popover o implementar `role="combobox"`, `aria-expanded`, `aria-controls`, `role="listbox"` y opciones con `role="option"`. |
| Touch targets pequenos en header, sidebar y tablas | Medio | `TopBar` usa `h-8 w-8` en `components/layout/top-bar.tsx:31-70`; DataTable search `h-8` en `components/admin/data-table.tsx:121-130`; request action `w-7 h-7` en `request-list.tsx:131-135` | Mantener compactos en desktop, pero elevar a 44px en mobile o agregar padding tactil mediante clases responsive. |
| Hay estados vacios y loading, pero no siempre se usan los componentes compartidos | Bajo | `components/ui/empty-state.tsx`, `components/ui/skeleton.tsx`; `OcForm` usa empty state manual en `oc-form.tsx:280-288` | Estandarizar todos los estados vacios con `EmptyState`, y loading con skeletons de la misma geometria. |
| Diseño usa tokens OKLCH y foco global consistente | Positivo | `app/globals.css:1-159` | Mantener este sistema y reducir hardcodes sueltos como `bg-blue-50`, `text-blue-600` en `dashboard/page.tsx:151-164`. |

### Problemas criticos de UI/UX

1. Tarjetas del dashboard con apariencia clicable sin accion real.
2. Acciones de tabla ocultas al teclado.
3. Notificaciones no accesibles por teclado.
4. Formularios de compra y solicitud dependen demasiado de errores generales.
5. Combobox de productos sin semantica accesible.

---

## 5. Auditoria de logica de negocio

| Problema logico | Riesgo | Evidencia | Solucion recomendada |
|---|---|---|---|
| Generacion de codigos con `count() + 1` | Alto | Solicitudes: `app/(app)/solicitudes/actions.ts:88-91` y `256-258`; OC: `lib/services/purchasing.ts:47-48`; recepciones: `lib/services/receiving.ts:60-61`; entregas: `lib/services/deliveries.ts:34-37` | Usar tabla de secuencias por prefijo/anio dentro de transaccion, o constraint + retry controlado. |
| Payload de OC se castea sin schema runtime | Alto | `app/(app)/compras/actions.ts:38-63` convierte `itemsRaw as RawItem[]`; validaciones manuales en `78-94` | Crear `createOrderSchema` con Zod para header e items. Validar `Number.isFinite`, limites, strings y consistencia antes de tocar DB. |
| `Infinity`, `NaN` encubierto o tipos manipulados pueden pasar validaciones manuales parciales | Medio | `isNaN(item.unitPrice)` en `compras/actions.ts:78-83`; descuentos no verifican `Number.isFinite` | Reemplazar `isNaN` por `Number.isFinite` y coercion controlada con Zod. |
| Auditoria se registra fuera del cliente transaccional en algunas transacciones | Medio | `duplicateRequest` llama `recordAudit(...)` sin `tx` dentro de transaccion en `solicitudes/actions.ts:271-279`; `cancelRequest` igual en `346-362` | Pasar `tx` a `recordAudit`/`recordStatusChange` siempre que se este dentro de `db.transaction`. |
| Guard para no desactivar ultimo administrador no filtra administradores activos | Alto | `app/(app)/admin/usuarios/actions.ts:246-256` consulta roles de administradores pero no une/filtra `users.isActive` | Contar solo admins activos distintos del usuario objetivo. Agregar test. |
| Estado padre de solicitud no se recalcula despues de entrega desde bodega | Medio | `deliverItemTx` actualiza item en `lib/services/item-state.ts:630-675`, pero no llama `rollupRequestStatus`; `receiveItemTx` si lo hace en `:613` | Llamar `rollupRequestStatus(item.requestId, tx)` al final de `deliverItemTx` si el estado padre debe reflejar entrega. |
| Recepcion directa a faena no captura receptor, guia obligatoria ni evidencia de conformidad | Medio | `ReceiptForm` fija `locationType="faena"` en `app/(app)/recepcion/receipt-form.tsx:69-72`; guia opcional en `:75-81`; README dice que recepcion cierra seguimiento operativo | Definir regla explicita: si recepcion cierra entrega, exigir receptor/respaldo; si no, separar recepcion de entrega. |
| Stock reservado existe en schema pero no hay flujo de reserva | Medio | `db/schema/warehouse.ts:25-27`; disponible se calcula como `quantity - reservedQty` en `bodega/page.tsx:213-214` | Implementar reserva al crear despacho/OC interna o eliminar `reservedQty` hasta que exista la regla. |
| Reporte default ante tipo desconocido | Bajo | `lib/reports/export.ts:67-78` cae a `gastoPorFaena` por `default` | Validar `tipo` en route y devolver 400 para valores desconocidos. |

---

## 6. Bugs potenciales o confirmados

| Bug | Severidad | Donde ocurre | Por que ocurre | Como corregirlo |
|---|---|---|---|---|
| Se puede desactivar el ultimo administrador activo si existe otro administrador inactivo | Alto | `app/(app)/admin/usuarios/actions.ts:246-256` | La consulta obtiene usuarios con rol administrador, pero no filtra `users.isActive = true` | Unir con `users`, contar admins activos y excluir el usuario objetivo. Cubrir con test unitario/integracion. |
| Colisiones de codigos `SOL`, `OC`, `REC`, `ENT` bajo concurrencia | Alto | `solicitudes/actions.ts:88-91`, `lib/services/purchasing.ts:47-48`, `receiving.ts:60-61`, `deliveries.ts:34-37` | Dos requests simultaneos pueden leer el mismo conteo antes de insertar | Secuencia transaccional por prefijo/anio, retry por constraint unico o idempotency key. |
| Dashboard sugiere navegacion inexistente | Medio | `app/(app)/dashboard/page.tsx:183-189` | `cursor-pointer` y hover visual sin accion | Convertir tarjetas en links reales o eliminar cursor/hover accionable. |
| Link de detalle de solicitud invisible al navegar por teclado | Medio | `app/(app)/solicitudes/request-list.tsx:131-135` | La opacidad depende solo de `group-hover` | Agregar `focus-visible:opacity-100` o dejar visible. |
| Notificaciones no navegables por teclado | Medio | `components/layout/notification-bell.tsx:170-177` | Se usa `div onClick` sin `role`, `tabIndex` ni handler de teclado | Usar `Link`/`button` semanticamente correcto. |
| Posible redirect no validado despues de login | Medio | `app/(auth)/login/login-form.tsx:15,42` | `callbackUrl` viene de query string y se pasa a `router.push` | Aceptar solo paths internos que empiecen con `/` y no con `//`; fallback a `/dashboard`. |
| Auditoria parcial si falla una transaccion de duplicacion/cancelacion | Medio | `app/(app)/solicitudes/actions.ts:271-279`, `346-362` | `recordAudit` usa DB global por default dentro de una transaccion | Pasar `tx` explicitamente. |
| El selector de producto puede perder interaccion por `setTimeout` en blur | Bajo | `app/(app)/solicitudes/request-form.tsx:551` | Cierre diferido manual del popover | Reemplazar por componente de combobox/popover controlado con eventos accesibles. |
| `createOrderAction` acepta items JSON manipulados sin schema fuerte | Medio | `app/(app)/compras/actions.ts:38-63` | Cast runtime a `RawItem[]` | Validar JSON con Zod y rechazar tipos no esperados. |
| `ReceiptForm` inicializa todas las cantidades pendientes por defecto | Bajo | `app/(app)/recepcion/receipt-form.tsx:45-47` | El formulario asume recepcion total salvo que el usuario cambie valores | Mostrar accion explicita "recibir todo" o iniciar en 0 cuando haya recepciones parciales frecuentes. |

---

## 7. Malas practicas detectadas

| Mala practica | Impacto | Evidencia | Mejora recomendada |
|---|---|---|---|
| Filtrar permisos en memoria despues de cargar todos los registros | Alto | `dashboard/page.tsx:253-304`, `reportes/page.tsx:29-84`, `lib/reports/export.ts:81-104` | Construir consultas filtradas por faenas permitidas desde el inicio. |
| Validaciones manuales dispersas en Server Actions | Medio | `compras/actions.ts`, `recepcion/actions.ts`, `bodega/actions.ts` | Schemas Zod por accion y helpers de parseo reutilizables. |
| Mezcla de mutaciones en Server Actions y servicios | Medio | `app/(app)/solicitudes/actions.ts:63-146` muta directamente; compras delega mas en `lib/services/purchasing.ts` | Mover persistencia de solicitudes a `lib/services/requests.ts`. |
| Hardcodes de color fuera de tokens | Bajo | `dashboard/page.tsx:151-164` usa `bg-blue-50`, `text-blue-600`, `bg-emerald-50` | Llevar a tokens en `globals.css` o clases semanticas. |
| Controles interactivos pequenos para mobile | Medio | `top-bar.tsx:31-70`, `request-list.tsx:131-135`, `data-table.tsx:121-130` | Crear variantes `compactDesktop` y mobile tactil. |
| `next.config.ts` vacio | Bajo | `next.config.ts:1-5` | Definir headers de seguridad, configuracion de imagenes si aplica y politicas de build. |
| No hay `.env.example` aunque README habla de variables | Medio | Solo existe `.env.local`; README enumera SMTP y auth manualmente | Crear `.env.example` sin secretos. |
| Importaciones no usadas | Bajo | `npm run lint`: warnings en `components/layout/sidebar.tsx:9` y `:14` | Eliminar `SignOut` y `Avatar` no usados. |
| Ausencia de documentacion de producto/diseno | Bajo | `node load-context.mjs` reporto `hasProduct:false`, `hasDesign:false` | Crear `PRODUCT.md` y `DESIGN.md` para alinear decisiones futuras. |

---

## 8. Auditoria de accesibilidad

| Problema de accesibilidad | Impacto | Evidencia | Recomendacion |
|---|---|---|---|
| Fila de notificacion clicable no es elemento interactivo | Alto | `components/layout/notification-bell.tsx:170-177` | Cambiar a `button` o `Link`, con foco visible y teclado. |
| Link de accion invisible con tabulacion | Alto | `app/(app)/solicitudes/request-list.tsx:131-135` | Agregar estilos `focus-visible` que cambien opacidad o hacer la accion siempre visible. |
| Product picker sin semantica de combobox | Medio | `app/(app)/solicitudes/request-form.tsx:544-589` | Implementar ARIA combobox o usar componente accesible basado en Radix. |
| Labels no asociados en varios campos | Medio | `app/(app)/compras/oc-form.tsx:207-264`, `receipt-form.tsx:75-84`, `components/ui/field.tsx:34-43` | Pasar `htmlFor`/`id` o `aria-labelledby`; agregar `aria-describedby` para helper/error. |
| Errores de formulario no siempre quedan vinculados al input | Medio | `Input` solo setea `aria-invalid` en `components/ui/input.tsx:29-33`; `Field` renderiza error en `field.tsx:47-52` sin id | Generar ids de error/helper y pasarlos como `aria-describedby`. |
| Botones/links de 28-32px dificultan uso tactil | Medio | `TopBar` h-8/w-8; `RequestList` w-7/h-7; `DataTable` h-8 | Subir minimo tactil a 44px en mobile o ampliar hit area. |
| Tarjetas visualmente clicables sin rol ni accion | Medio | `dashboard/page.tsx:183-189` | Si son navegables, usar `Link`; si son informativas, quitar `cursor-pointer`. |
| Uso positivo: `lang="es-CL"` y metadata descriptiva | Positivo | `app/layout.tsx:22-33` | Mantener titulos por pagina, ya que Next Route Announcer usa `document.title`/`h1`. |
| Uso positivo: skip link y foco global | Positivo | `components/layout/app-shell.tsx:27-34`; `app/globals.css:145-153` | Conservar como patron base. |

---

## 9. Auditoria de rendimiento

| Problema de rendimiento | Impacto | Evidencia | Solucion sugerida |
|---|---|---|---|
| Consultas completas y filtrado en memoria en dashboard | Alto | `app/(app)/dashboard/page.tsx:253-304` | Crear agregaciones SQL por faena visible y counts por estado. |
| Reportes cargan todo y luego filtran | Alto | `app/(app)/reportes/page.tsx:29-84`; `lib/reports/export.ts:81-309` | Query builders por reporte con `WHERE worksite_id IN (...)`, paginacion o streaming para exportaciones grandes. |
| Bodega carga todos los movimientos y despues recorta a 50 | Medio | `app/(app)/bodega/page.tsx:91-95` | Aplicar `limit(50)` en SQL. |
| `DataTable` es client-side para busqueda, sort y paginacion | Medio | `components/admin/data-table.tsx:63-101` | Mantener para maestros pequenos; para solicitudes/OC grandes, server-side pagination. |
| Polling de notificaciones por usuario cada 60s | Bajo | `components/layout/notification-bell.tsx:37-45` | OK para bajo volumen; si crece, usar SSE/WebSocket o backoff al estar oculto. |
| Skeleton con shimmer infinito | Bajo | `components/ui/skeleton.tsx:8-13` | Ya existe `prefers-reduced-motion` global; mantener y evitar skeletons en listas enormes. |
| `next.config.ts` sin optimizaciones/headers | Bajo | `next.config.ts` vacio | Agregar headers de cache y seguridad; revisar standalone/output si despliegue lo requiere. |

---

## 10. Auditoria de seguridad basica

| Riesgo de seguridad | Severidad | Evidencia | Recomendacion |
|---|---|---|---|
| Vulnerabilidad transitiva en dependencias de produccion | Medio | `npm audit --omit=dev`: `next-auth` beta depende de `@auth/core` y `nodemailer` vulnerable; 3 vulnerabilidades, 1 moderada | Evaluar upgrade de `next-auth`/`@auth/core` cuando exista ruta compatible. No aplicar `audit fix --force` sin revisar porque propone cambio mayor. |
| Posible open redirect por `callbackUrl` | Medio | `app/(auth)/login/login-form.tsx:15,42` | Validar callback local: aceptar solo `/ruta` y rechazar `//`, URLs absolutas o protocolos. |
| Tokens de invitacion pueden mostrarse en UI si SMTP falla | Medio | `app/(app)/admin/usuarios/actions.ts:71-77` devuelve el enlace completo | Mostrar enlace solo detras de accion "copiar enlace" visible para admin, o registrar evento seguro; evitar exponerlo en toast persistente. |
| Validacion de archivos por MIME declarado por cliente | Medio | `lib/actions/invoice-attachments.ts:19-25`, `54-62` | Validar magic bytes de PDF/imagenes y, si se sirven inline en futuro, forzar descarga y CSP. |
| No hay headers de seguridad configurados | Medio | `next.config.ts` vacio | Agregar `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`. |
| `.env.local` contiene secretos locales | Bajo | Variables detectadas: `AUTH_SECRET`, `DATABASE_URL`, SMTP y seed admin; `.gitignore:43` ignora `.env*` | Mantener ignorado. Agregar `.env.example` sin valores reales. |
| Password admin por seed puede tener default conocido | Medio | README y `TESTING.md` mencionan password seed; `db/seed.ts` indica fallback `chome2026` en logs | Exigir `SEED_ADMIN_PASSWORD` en entornos no dev y fallar si falta. |
| Descarga de adjuntos arma path desde `storageName` de DB | Bajo | `app/api/invoice-attachments/[id]/route.ts:17-18` | Actualmente `storageName` nace sanitizado en upload; agregar guard `path.resolve(...).startsWith(STORAGE_DIR)` por defensa en profundidad. |
| Control de permisos general bien implementado | Positivo | `proxy.ts:11-23`, `lib/auth/can.ts:65-77`, checks por accion | Mantener checks server-side aunque la UI oculte acciones. |

---

## 11. Auditoria de testing

Comandos ejecutados durante la auditoria:

- `npm test`: 6 archivos, 85 tests, todos pasan.
- `npm run lint`: pasa con 2 warnings por imports sin uso en `components/layout/sidebar.tsx`.
- `npx tsc --noEmit`: pasa sin errores.
- `npm run test:e2e`: 3 tests Playwright pasan en Chromium.
- `npm audit --omit=dev`: falla por vulnerabilidades transitivas descritas en seguridad.

| Area | Estado actual | Riesgo | Recomendacion |
|---|---|---|---|
| Tests unitarios | Buenos para logica pura: permisos, RBAC, estados, totales, postergacion, report export en `lib/__tests__` | Bajo/Medio | Agregar tests para generacion concurrente de codigos, ultimo admin activo, validaciones Zod de compras/recepcion. |
| Tests de integracion | Parciales; server actions se prueban en parte con mocks (`postponeItemAction`) | Medio | Crear tests de acciones criticas contra SQLite temporal: crear solicitud, duplicar, cancelar, crear OC, recibir. |
| Tests end-to-end | Buen flujo Playwright en `e2e/purchase-flow.spec.ts`; 3 pruebas pasan | Medio | Agregar proyectos mobile, permisos negativos por rol y casos de error visibles. |
| Tests de UI | No se detectan tests de componentes ni accesibilidad automatizada | Medio | Agregar Playwright + axe o checks manuales codificados para teclado/foco. |
| Tests de logica critica | Maquina de estados y totales estan cubiertos | Bajo/Medio | Cubrir `deliverItemTx` rollup, secuencias, stock negativo concurrente y recepcion parcial. |

---

## 12. Oportunidades de mejora tecnica

| Mejora | Prioridad | Beneficio | Esfuerzo estimado |
|---|---|---|---|
| Implementar secuencias transaccionales para codigos `SOL/OC/REC/ENT` | Alta | Evita colisiones y errores operativos bajo concurrencia | Medio |
| Crear schemas Zod para compras, recepcion, bodega y facturas | Alta | Reduce bugs por payload manipulado y mejora errores por campo | Medio |
| Mover queries RBAC a repositorios/servicios filtrados por SQL | Alta | Mejora performance y reduce riesgo de exposicion accidental | Alto |
| Arreglar accesibilidad de notificaciones, tablas y combobox | Alta | Mejora uso real con teclado y cumplimiento WCAG basico | Medio |
| Agregar headers de seguridad en `next.config.ts` | Alta | Endurece superficie web | Bajo |
| Agregar `.env.example` | Media | Mejora onboarding sin exponer secretos | Bajo |
| Centralizar solicitudes en `lib/services/requests.ts` | Media | Alinea arquitectura con compras/recepcion/bodega | Medio |
| Agregar indices/constraints compuestos | Alta | Mejora integridad y rendimiento | Medio |
| Server-side pagination para tablas grandes | Media | Evita degradacion cuando crezcan solicitudes/OC/productos | Alto |
| Crear `PRODUCT.md` y `DESIGN.md` | Baja | Alinea futuras decisiones de UX/copy/diseno | Bajo |
| Agregar axe en Playwright | Media | Detecta regresiones de accesibilidad | Bajo |

---

## 13. Funciones faltantes recomendadas

| # | Funcion sugerida | Por que deberia existir | Valor para el usuario | Prioridad |
|---|---|---|---|---|
| 1 | Secuencia robusta y configurable de folios | Resuelve colisiones de `count()+1`; tocar `lib/id.ts`, servicios de solicitudes/compras/recepcion/entregas, DB | Folios confiables para auditoria y documentos | Alta |
| 2 | Bandeja de tareas accionable desde dashboard | Las tarjetas ya parecen clicables pero no navegan; tocar `dashboard/page.tsx`, rutas destino | Menos friccion para ir directo a pendientes | Alta |
| 3 | Busqueda avanzada y filtros persistentes por modulo | Tablas tienen busqueda simple local; tocar `DataTable`, pages de solicitudes/compras/recepcion/reportes | Encontrar solicitudes/OC por estado, faena, proveedor, fecha | Alta |
| 4 | Historial visual completo por item/solicitud | Existe `statusHistory` y audit log, pero no una vista rica por entidad; tocar `lib/audit.ts`, paginas detalle | Trazabilidad comprensible sin ir al log global | Alta |
| 5 | Flujo formal de cotizaciones antes de OC | Schema `quotations` existe en `db/schema/purchasing.ts:53-65`, pero no se ve UI | Comparar proveedores y justificar compras | Media |
| 6 | Recepcion con evidencia: receptor, fotos/documentos, observaciones obligatorias segun caso | Recepcion directa cierra flujo sin evidencia fuerte; tocar `ReceiptForm`, schema receiving, storage | Reduce disputas con proveedor/faena | Alta |
| 7 | Gestion real de stock minimo y alertas de reposicion | `minStock` existe pero no hay configuracion activa; tocar bodega/admin productos/reportes/notificaciones | Evita quiebres de stock | Media |
| 8 | Reservas de stock para solicitudes aprobadas | `reservedQty` existe pero no se actualiza; tocar warehouse service, compras/bodega | Evita prometer stock que luego se despacha a otra faena | Alta |
| 9 | Aprobacion por reglas configurables | README dice aprobacion simple; tocar DB roles/reglas, approval service | Adaptar flujo a montos, EPP, faena o categoria | Media |
| 10 | Exportacion Excel enriquecida y programada | Existe export CSV/XLSX basica; tocar `lib/reports/export.ts`, API reportes | Reportes listos para gerencia/contabilidad | Media |
| 11 | Importadores de maestros desde ERP/planillas | README lo lista pendiente; tocar admin productos/proveedores/faenas, APIs | Reduce carga manual y errores de catalogo | Media |
| 12 | Panel de conciliacion contable de facturas | Facturas tienen estados pero no modulo dedicado; tocar `components/invoices`, reportes, schema | Control financiero mas claro | Alta |
| 13 | Notificaciones con preferencias por usuario | Hay notificaciones y polling; tocar notifications service, usuario settings | Evita ruido y mejora adopcion | Baja |
| 14 | Auditoria exportable con filtros | Hay `admin/auditoria`, pero conviene export/filtros; tocar audit page/API | Cumplimiento y revision interna | Media |
| 15 | Modo mobile optimizado para aprobaciones rapidas | La app es responsive, pero tablas/controles siguen densos; tocar aprobaciones, solicitudes, DataTable | Decisiones desde terreno/celular | Media |

Detalle de complejidad e impactos:

| Funcion | Problema que resuelve | Modulos probables | Requiere | Complejidad |
|---|---|---|---|---|
| Folios robustos | Colisiones por concurrencia | `lib/id.ts`, `lib/services/*`, migraciones | Backend + DB | Media |
| Dashboard accionable | Affordance falsa | `app/(app)/dashboard/page.tsx` | Frontend | Baja |
| Filtros persistentes | Busqueda limitada | `components/admin/data-table.tsx`, paginas modulo | Frontend + Backend | Alta |
| Historial por entidad | Auditoria dificil de leer | `db/schema/audit.ts`, paginas detalle | Frontend + Backend | Media |
| Cotizaciones | Justificacion de proveedor | Compras, schema `quotations` | Frontend + Backend + storage | Media |
| Evidencia recepcion | Falta respaldo operativo | Recepcion, storage, facturas | Frontend + Backend + DB | Media |
| Stock minimo | Reposicion reactiva | Bodega, productos, notificaciones | Frontend + Backend + DB | Media |
| Reservas | Sobreventa interna de stock | Warehouse service, solicitudes | Backend + DB | Alta |
| Reglas aprobacion | Flujo no configurable | Aprobaciones, roles, productos | Backend + DB + Frontend | Alta |
| Excel avanzado | Reportes basicos | `lib/reports/export.ts` | Backend | Media |
| Importadores | Carga manual | Admin maestros, APIs | Integraciones externas | Alta |
| Conciliacion contable | Seguimiento financiero parcial | Facturas, reportes | Frontend + Backend + DB | Alta |
| Preferencias notificaciones | Ruido operativo | Notifications, usuarios | Frontend + Backend + DB | Media |
| Auditoria exportable | Revision manual limitada | Admin auditoria, API export | Backend + Frontend | Baja |
| Mobile aprobaciones | Uso en terreno | Aprobaciones/DataTable | Frontend | Media |

---

## 14. Roadmap recomendado

### Fase 1: Correcciones criticas

| Fase | Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|---|
| 1 | Corregir guard del ultimo administrador activo | Alta | Alto | Bajo |
| 1 | Implementar secuencias/retry para folios | Alta | Alto | Medio |
| 1 | Validar `callbackUrl` local en login | Alta | Medio | Bajo |
| 1 | Arreglar notificaciones y acciones hover-only para teclado | Alta | Alto | Medio |
| 1 | Agregar headers basicos de seguridad | Alta | Medio | Bajo |
| 1 | Reemplazar validacion manual de OC por schema Zod | Alta | Alto | Medio |

### Fase 2: Mejoras de calidad

| Fase | Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|---|
| 2 | Mover queries con permisos a SQL/servicios | Alta | Alto | Alto |
| 2 | Agregar constraints/indices compuestos en DB | Alta | Alto | Medio |
| 2 | Centralizar solicitudes en servicio dedicado | Media | Medio | Medio |
| 2 | Mejorar formularios con `fieldErrors` y `aria-describedby` | Media | Alto | Medio |
| 2 | Agregar tests de integracion para acciones criticas | Media | Alto | Medio |
| 2 | Agregar `.env.example`, `PRODUCT.md` y `DESIGN.md` | Media | Medio | Bajo |

### Fase 3: Nuevas funcionalidades

| Fase | Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|---|
| 3 | Dashboard accionable con links y filtros por rol | Alta | Alto | Bajo |
| 3 | Reservas de stock y alertas de minimo | Alta | Alto | Alto |
| 3 | Cotizaciones comparativas por OC | Media | Alto | Media |
| 3 | Recepcion con evidencia y receptor | Alta | Alto | Media |
| 3 | Conciliacion contable dedicada | Media | Alto | Alta |
| 3 | Importadores de maestros | Media | Alto | Alta |

---

## 15. Lista priorizada de acciones

1. Corregir `toggleUserActive` para contar solo administradores activos antes de permitir desactivacion.
2. Sustituir `count()+1` por secuencias transaccionales para `SOL`, `OC`, `REC` y `ENT`.
3. Validar `callbackUrl` en `LoginForm` antes de llamar a `router.push`.
4. Convertir filas de notificaciones en `button` o `Link` accesibles.
5. Hacer visibles por foco las acciones de tabla actualmente ocultas por hover.
6. Convertir tarjetas del dashboard en enlaces reales o eliminar la apariencia clicable.
7. Crear schemas Zod para `createOrderAction`, `registerReceiptAction`, `dispatchAction` y ajustes de stock.
8. Pasar `tx` a `recordAudit` y `recordStatusChange` en duplicacion y cancelacion de solicitudes.
9. Agregar headers de seguridad en `next.config.ts`.
10. Empujar filtros por faena/permiso a SQL en dashboard, reportes y exportaciones.
11. Agregar indices/constraints compuestos para pivotes y stock por bodega/producto.
12. Asociar labels, helpers y errores con `htmlFor`, `aria-labelledby` y `aria-describedby`.
13. Reemplazar el product picker manual por un combobox accesible.
14. Agregar tests de integracion para ultimo admin, folios concurrentes, OC manipulada y recepcion parcial.
15. Resolver warnings de lint en `components/layout/sidebar.tsx`.
16. Revisar ruta de upgrade para `next-auth`/`@auth/core` por vulnerabilidad transitiva de `nodemailer`.
17. Crear `.env.example` sin secretos y documentar variables obligatorias.
18. Crear `PRODUCT.md` y `DESIGN.md` para guiar futuras decisiones de producto y UI.
19. Agregar Playwright mobile y pruebas de teclado para flujos principales.
20. Implementar reservas de stock o retirar `reservedQty` de la UI hasta que tenga comportamiento real.
