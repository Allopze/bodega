# Auditoría visual Playwright

Fecha: 2026-06-09  
Carpeta de capturas: [`audit/screenshots/2026-06-09-playwright`](audit/screenshots/2026-06-09-playwright)  
Manifest: [`manifest.json`](audit/screenshots/2026-06-09-playwright/manifest.json)  
Script reproducible: [`scripts/capture-all-routes.ts`](scripts/capture-all-routes.ts)

## Resumen

Se capturaron 31 rutas en 2 viewports:

- Desktop: 1440 x 1000
- Mobile: 390 x 844
- Total: 62 capturas de página, más galerías de revisión.

Galerías:

- [Desktop gallery](audit/screenshots/2026-06-09-playwright/desktop-gallery.png)
- [Mobile gallery](audit/screenshots/2026-06-09-playwright/mobile-gallery.png)

Resultado general: la interfaz tiene una base visual consistente, especialmente en shell, formularios y flujo de detalle. Los principales problemas están en mobile, exportaciones, rutas administrativas incompletas y defaults de faena que esconden trabajo disponible.

## Cobertura

| Ruta | Desktop | Mobile | Observación |
|---|---:|---:|---|
| `/` | [png](audit/screenshots/2026-06-09-playwright/desktop-root.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-root.png) | Redirige a login sin sesión. |
| `/login` | [png](audit/screenshots/2026-06-09-playwright/desktop-login.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-login.png) | OK. |
| `/registro` | [png](audit/screenshots/2026-06-09-playwright/desktop-registro.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-registro.png) | Muestra error de invitación en carga inicial. |
| ruta inexistente sin sesión | [png](audit/screenshots/2026-06-09-playwright/desktop-not-found.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-not-found.png) | Redirige a login. |
| ruta inexistente autenticada | [png](audit/screenshots/2026-06-09-playwright/desktop-app-not-found.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-app-not-found.png) | 404 default de Next, no app shell. |
| `/dashboard` | [png](audit/screenshots/2026-06-09-playwright/desktop-dashboard.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-dashboard.png) | OK. |
| `/solicitudes` | [png](audit/screenshots/2026-06-09-playwright/desktop-solicitudes.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-solicitudes.png) | Mobile comprime tabla. |
| `/solicitudes/nueva` | [png](audit/screenshots/2026-06-09-playwright/desktop-solicitudes-nueva.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-solicitudes-nueva.png) | OK. |
| `/solicitudes/[id]` | [png](audit/screenshots/2026-06-09-playwright/desktop-solicitudes-detalle.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-solicitudes-detalle.png) | OK, aunque queda mucho espacio vacío por full-page. |
| `/aprobaciones` | [png](audit/screenshots/2026-06-09-playwright/desktop-aprobaciones.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-aprobaciones.png) | Empty state claro. |
| `/compras` | [png](audit/screenshots/2026-06-09-playwright/desktop-compras.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-compras.png) | OK. |
| `/compras/nueva` | [png](audit/screenshots/2026-06-09-playwright/desktop-compras-nueva.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-compras-nueva.png) | Default de faena oculta ítems disponibles. |
| `/compras/[id]` | [png](audit/screenshots/2026-06-09-playwright/desktop-compras-detalle.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-compras-detalle.png) | Mobile corta totales/subtotales. |
| `/compras/[id]/print` | [png](audit/screenshots/2026-06-09-playwright/desktop-compras-print.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-compras-print.png) | Muy legible. |
| `/recepcion` | [png](audit/screenshots/2026-06-09-playwright/desktop-recepcion.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-recepcion.png) | OK. |
| `/recepcion/nueva` | [png](audit/screenshots/2026-06-09-playwright/desktop-recepcion-nueva.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-recepcion-nueva.png) | OK. |
| `/recepcion/[id]` | [png](audit/screenshots/2026-06-09-playwright/desktop-recepcion-detalle.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-recepcion-detalle.png) | OK. |
| `/bodega` | [png](audit/screenshots/2026-06-09-playwright/desktop-bodega.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-bodega.png) | Default de faena y tabla mobile problemáticos. |
| `/entregas` | [png](audit/screenshots/2026-06-09-playwright/desktop-entregas.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-entregas.png) | Mobile tabla muy comprimida. |
| `/trazabilidad` | [png](audit/screenshots/2026-06-09-playwright/desktop-trazabilidad.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-trazabilidad.png) | Exporta CSV y tabla se rompe en mobile. |
| `/reportes` | [png](audit/screenshots/2026-06-09-playwright/desktop-reportes.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-reportes.png) | Acciones desbordan en mobile, bloque gris vacío. |
| `/admin` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin.png) | OK. |
| `/admin/auditoria` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-auditoria.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-auditoria.png) | Mobile comprime tabla. |
| `/admin/configuracion` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-configuracion.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-configuracion.png) | OK. |
| `/admin/faenas` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-faenas.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-faenas.png) | Mobile comprime tabla. |
| `/admin/productos` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-productos.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-productos.png) | Mobile muestra columnas cortadas. |
| `/admin/productos/nuevo` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-productos-nuevo.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-productos-nuevo.png) | Redirige al listado. |
| `/admin/productos/[id]` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-productos-detalle.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-productos-detalle.png) | Redirige al listado. |
| `/admin/proveedores` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-proveedores.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-proveedores.png) | Mobile comprime tabla. |
| `/admin/trabajadores` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-trabajadores.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-trabajadores.png) | Mobile comprime tabla. |
| `/admin/usuarios` | [png](audit/screenshots/2026-06-09-playwright/desktop-admin-usuarios.png) | [png](audit/screenshots/2026-06-09-playwright/mobile-admin-usuarios.png) | Search y acciones compiten por ancho. |

## Hallazgos prioritarios

### P0 - Exportación CSV en trazabilidad rompe la regla del proyecto

Evidencia:

- [desktop-trazabilidad.png](audit/screenshots/2026-06-09-playwright/desktop-trazabilidad.png)
- [mobile-trazabilidad.png](audit/screenshots/2026-06-09-playwright/mobile-trazabilidad.png)

En `/trazabilidad` aparece el botón `Exportar CSV`. Esto contradice la regla del repo: todas las exportaciones deben ser XLSX, nunca CSV.

Código relacionado:

- `app/(app)/trazabilidad/page.tsx`: botón `Exportar CSV`.
- `lib/services/trazabilidad-export.ts`: servicio explícitamente CSV.
- `lib/__tests__/trazabilidad-export.test.ts`: tests acoplados a CSV.

Impacto: incumple una regla funcional explícita y puede generar archivos incompatibles con el estándar de exportación definido para la app.

Recomendación: migrar esta exportación a XLSX con `exceljs` o `xlsx`, ajustar label, extensión, content-type y tests.

### P1 - Varias tablas se rompen o pierden columnas en mobile

Evidencia:

- [mobile-trazabilidad.png](audit/screenshots/2026-06-09-playwright/mobile-trazabilidad.png): el código de solicitud se parte verticalmente como `SO / 20 / 00`.
- [mobile-compras-detalle.png](audit/screenshots/2026-06-09-playwright/mobile-compras-detalle.png): subtotal y totales quedan cortados hacia la derecha.
- [mobile-bodega.png](audit/screenshots/2026-06-09-playwright/mobile-bodega.png): tabla de stock muestra una columna parcial en el borde derecho.
- [mobile-admin-productos.png](audit/screenshots/2026-06-09-playwright/mobile-admin-productos.png): columnas finales quedan fuera o truncadas.
- [mobile-admin-usuarios.png](audit/screenshots/2026-06-09-playwright/mobile-admin-usuarios.png): columna `FAEN...` queda fuera del viewport.

Impacto: en mobile se pierde información operativa crítica, como subtotales, estados, acciones o referencias de solicitud. Esto afecta especialmente aprobaciones rápidas y revisión en terreno.

Recomendación: para mobile, convertir tablas densas a filas tipo lista con pares etiqueta/valor, o usar scroll horizontal explícito con affordance visible y columnas clave fijas. No basta con dejar que la tabla se comprima.

### P1 - Defaults de faena ocultan trabajo disponible

Evidencia:

- [desktop-compras-nueva.png](audit/screenshots/2026-06-09-playwright/desktop-compras-nueva.png)
- [mobile-compras-nueva.png](audit/screenshots/2026-06-09-playwright/mobile-compras-nueva.png)
- [desktop-bodega.png](audit/screenshots/2026-06-09-playwright/desktop-bodega.png)
- [mobile-bodega.png](audit/screenshots/2026-06-09-playwright/mobile-bodega.png)

En `/compras/nueva`, el formulario abre con `Faena Cabrero` y dice `No hay ítems aprobados pendientes para esta faena`, aunque hay ítems aprobados en `Faena Mininco`. En `/bodega`, el panel de entrega también parte con `Faena Cabrero`, sin productos, aunque el stock visible está en `Faena Mininco`.

Código relacionado:

- `app/(app)/compras/oc-form.tsx`: usa `initialWorksiteId ?? worksites[0]?.id`.
- `app/(app)/bodega/dispatch-panel.tsx`: usa `initialWorksiteId ?? worksites[0]?.id`.

Impacto: el usuario ve un estado vacío falso y puede pensar que no hay trabajo pendiente o stock disponible.

Recomendación: elegir como default la primera faena con ítems pendientes/stock disponible. Si no hay default útil, mostrar una opción vacía tipo `Selecciona faena` y un resumen de dónde sí hay ítems.

### P1 - Rutas de producto nuevo/detalle no renderizan páginas

Evidencia:

- [desktop-admin-productos-nuevo.png](audit/screenshots/2026-06-09-playwright/desktop-admin-productos-nuevo.png)
- [desktop-admin-productos-detalle.png](audit/screenshots/2026-06-09-playwright/desktop-admin-productos-detalle.png)
- [mobile-admin-productos-nuevo.png](audit/screenshots/2026-06-09-playwright/mobile-admin-productos-nuevo.png)
- [mobile-admin-productos-detalle.png](audit/screenshots/2026-06-09-playwright/mobile-admin-productos-detalle.png)

`/admin/productos/nuevo` y `/admin/productos/[id]` redirigen directamente a `/admin/productos`. Hay `loading.tsx` para nuevo producto y formulario de producto en sheet, pero las rutas como páginas no existen realmente.

Código relacionado:

- `app/(app)/admin/productos/nuevo/page.tsx`: redirige al listado.
- `app/(app)/admin/productos/[id]/page.tsx`: redirige al listado.

Impacto: enlaces directos, refreshes, breadcrumbs, deep links y recuperación de contexto no funcionan como páginas. Si el usuario espera volver a editar un producto por URL, no puede.

Recomendación: decidir uno de dos caminos: implementar páginas reales para crear/editar producto, o eliminar esas rutas/loading states y tratar el sheet como único patrón.

### P1 - 404 autenticado usa la pantalla default de Next

Evidencia:

- [desktop-app-not-found.png](audit/screenshots/2026-06-09-playwright/desktop-app-not-found.png)
- [mobile-app-not-found.png](audit/screenshots/2026-06-09-playwright/mobile-app-not-found.png)

La app autenticada muestra `404 | This page could not be found.` sin shell, sin español, sin navegación de regreso y sin contexto de Chome.

Impacto: rompe la experiencia del producto interno y deja al usuario sin recuperación clara.

Recomendación: conectar `app/(app)/not-found.tsx` o equivalente para que el 404 autenticado use el shell, texto en español y CTA a Dashboard o volver.

## Hallazgos secundarios

### P2 - Reportes tiene acciones que desbordan en mobile y un bloque gris vacío en desktop

Evidencia:

- [desktop-reportes.png](audit/screenshots/2026-06-09-playwright/desktop-reportes.png)
- [mobile-reportes.png](audit/screenshots/2026-06-09-playwright/mobile-reportes.png)

En desktop, el grid de resumen tiene una celda gris vacía en la esquina inferior derecha. En mobile, los botones de exportación quedan en una fila horizontal que se corta, dejando texto truncado (`Exportar Gasto...`).

Recomendación: si la celda vacía es padding visual, quitarla. En mobile, mover exportaciones a un menú `Exportar` o a un stack vertical.

### P2 - Registro muestra error antes de interacción

Evidencia:

- [desktop-registro.png](audit/screenshots/2026-06-09-playwright/desktop-registro.png)
- [mobile-registro.png](audit/screenshots/2026-06-09-playwright/mobile-registro.png)

La página `/registro` muestra `Necesitas una invitación para registrarte.` en la carga inicial cuando no hay token.

Impacto: el usuario llega a una pantalla que parece ya fallida antes de intentar algo. Para un flujo de invitación, es mejor explicar el requisito como estado informativo, no como error.

Recomendación: mostrar una explicación neutral si no hay token: `Para crear tu cuenta necesitas abrir el enlace de invitación enviado por el administrador.` Mantener el error rojo sólo después de una acción inválida.

### P2 - Bodega mezcla una faena sin stock con formularios activos

Evidencia:

- [desktop-bodega.png](audit/screenshots/2026-06-09-playwright/desktop-bodega.png)
- [mobile-bodega.png](audit/screenshots/2026-06-09-playwright/mobile-bodega.png)

La vista muestra `Faena Cabrero` sin stock, luego `Faena Mininco` con stock, pero el formulario de entrega parte en `Faena Cabrero`. Esto obliga al usuario a reconciliar manualmente lo que ve arriba con lo que puede operar abajo.

Recomendación: ordenar primero faenas con stock/alertas, y sincronizar el formulario con la faena útil o seleccionada.

### P2 - OC detalle mobile necesita layout de documento, no tabla comprimida

Evidencia:

- [mobile-compras-detalle.png](audit/screenshots/2026-06-09-playwright/mobile-compras-detalle.png)

Los montos quedan cortados, y el item intenta conservar columnas de desktop. Es una página de revisión de compra, no sólo una tabla.

Recomendación: en mobile usar una lista de líneas de OC: producto, cantidad, precio, subtotal y estado en bloques verticales. Totales como resumen separado.

### P3 - Public 404 sin sesión redirige a login, pero pierde el contexto de error

Evidencia:

- [desktop-not-found.png](audit/screenshots/2026-06-09-playwright/desktop-not-found.png)
- [mobile-not-found.png](audit/screenshots/2026-06-09-playwright/mobile-not-found.png)

La ruta inexistente sin sesión termina en login con `callbackUrl`. Es razonable desde seguridad, pero no distingue entre `necesitas iniciar sesión` y `la ruta no existe`.

Recomendación: aceptable si la política es proteger todo, pero el login podría mostrar un mensaje neutro si viene con callback a una ruta inexistente.

## Lo que funciona bien

- El shell de app es consistente: sidebar desktop, topbar mobile, breadcrumbs y estado activo se entienden rápido.
- Las pantallas de login y formularios principales son limpias, legibles y con buen contraste.
- La vista imprimible de OC está bien resuelta visualmente, especialmente en mobile: estructura clara, totales visibles y acciones arriba.
- Los empty states en aprobaciones y recepción son directos y no recargan la pantalla.
- El sistema de badges y estados mantiene una paleta sobria y útil para una herramienta operativa.

## Recomendaciones de implementación

1. Corregir trazabilidad para exportar XLSX, no CSV. Es el único hallazgo P0 por regla explícita del proyecto.
2. Crear un patrón mobile para tablas densas: listas por fila, scroll horizontal explícito o columnas clave fijas.
3. Ajustar defaults de faena en compras y bodega para elegir una faena con trabajo/stock disponible.
4. Decidir si productos usa rutas reales o sólo sheet. Hoy hay rutas que prometen páginas y no las dan.
5. Brandeear/localizar el 404 autenticado.
6. Compactar exportaciones de reportes en mobile y eliminar la celda gris vacía.
7. Convertir el mensaje inicial de registro sin invitación en estado informativo, no error.

## Notas de ejecución

El script creó una base SQLite temporal en `.tmp/route-screenshots.sqlite`, levantó `next start` en `127.0.0.1:3127`, capturó las rutas y cerró el servidor temporal al finalizar.

Redirecciones observadas:

- `/` sin sesión -> `/login?callbackUrl=%2F`
- ruta inexistente sin sesión -> `/login?callbackUrl=...`
- `/admin/productos/nuevo` -> `/admin/productos`
- `/admin/productos/[id]` -> `/admin/productos`

Respuestas 404 observadas:

- `/app-ruta-inexistente-auditoria`, desktop y mobile. Esperado para capturar la pantalla 404 autenticada.
