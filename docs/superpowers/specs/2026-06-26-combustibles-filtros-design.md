# Diseno: filtros de combustibles

## Contexto

El bloque actual de filtros en `app/(app)/combustibles/fuel-filters.tsx` muestra todos los controles en una superficie gris con wrapping libre. En pantallas anchas queda una segunda fila casi vacia, el boton `Limpiar` pierde jerarquia y los selectores largos no aprovechan el patron buscable ya disponible en `components/ui/select.tsx`.

La direccion aprobada es la opcion 1 del companion visual: una barra tecnica sobria en grilla, con todos los filtros visibles, esquinas cuadradas, borde fino y acciones claras.

## Objetivos

- Reducir espacio muerto sin ocultar filtros.
- Mantener una estetica operacional coherente con los tokens globales: blanco, lineas finas, esquinas cuadradas y controles compactos.
- Reusar primitives existentes en vez de crear controles nuevos.
- Hacer que listas largas sean buscables: vehiculo, faena y proveedor.
- Mantener el flujo actual de URL: cada cambio actualiza query params y borra `page`.

## No objetivos

- No crear drawer, chips editables ni boton global `Aplicar`.
- No cambiar la semantica server-side de los filtros.
- No tocar exportaciones ni formato de datos.
- No redisenar la tabla de cargas ni el shell de la pagina.

## UX propuesta

El componente renderiza un contenedor rectangular blanco con `border` y padding compacto. La primera linea funciona como cabecera:

- Izquierda: titulo corto `Filtros de combustible`.
- Derecha: contador de filtros activos, visible solo cuando hay filtros activos, y boton `Limpiar`.

Debajo va una grilla de controles alineados por label:

1. Mes
2. Desde
3. Hasta
4. Servicio
5. Vehiculo
6. Faena
7. Proveedor
8. Producto
9. Estado

En desktop, la grilla usa columnas responsivas para evitar una segunda fila desbalanceada. En mobile, cada control ocupa el ancho completo y conserva su label.

## Componentes y arquitectura

El cambio queda localizado en `FuelFilters`.

- `Input` se mantiene para `Mes` mientras el proyecto no tenga un picker mensual compartido.
- `DatePicker` reemplaza los inputs nativos de fecha para igualar el patron visual del resto del sistema.
- `Select searchable` se usa en `Vehiculo`, `Faena` y `Proveedor`.
- `Select` normal se mantiene para `Servicio`, `Producto` y `Estado`, porque tienen pocas opciones.
- `Button` se usa para `Limpiar`.

El componente puede agregar helpers internos pequenos:

- `setFilter(key, value)` conserva el comportamiento actual.
- `clearFilters()` navega a `/combustibles`.
- `activeFilterCount` cuenta filtros con valor real en `currentFilters`.

## Datos y estado

La fuente de verdad sigue siendo `currentFilters`, derivada de la URL por la pagina server. No se introduce estado local persistente.

Cada control sigue llamando `setFilter()` al cambiar:

- Valores vacios eliminan el query param.
- Valores presentes escriben el query param correspondiente.
- Cada cambio elimina `page`.

La prioridad entre `month`, `startDate` y `endDate` no cambia en esta fase. Si hoy pueden coexistir, la UI los sigue mostrando como filtros independientes para no alterar resultados sin una decision de producto adicional.

## Accesibilidad

- Cada control mantiene label visible.
- Los triggers reciben `id` cuando aplique para asociacion con label.
- El contador de filtros activos es informativo y no reemplaza ningun estado necesario.
- El boton `Limpiar` conserva texto visible.
- Los selects buscables reutilizan el comportamiento accesible del primitive compartido.

## Estados

- Sin filtros activos: no se muestra contador o se muestra texto neutro solo si hace falta para estabilidad visual.
- Con filtros activos: se muestra `N activos`.
- Sin opciones para vehiculo, faena o proveedor: el selector mantiene la opcion `Todos/Todas`; no se bloquea el resto de filtros.
- Mobile: la cabecera puede apilar titulo y acciones, pero el boton `Limpiar` debe seguir visible cerca del contador.

## Testing

Verificacion minima:

- `npx eslint app/(app)/combustibles/fuel-filters.tsx`
- Prueba manual en navegador:
  - cambiar cada filtro actualiza la URL esperada;
  - cambiar un filtro elimina `page`;
  - `Limpiar` vuelve a `/combustibles`;
  - buscar dentro de Vehiculo/Faena/Proveedor filtra opciones;
  - desktop no deja el boton `Limpiar` abandonado en una fila vacia;
  - mobile no solapa labels, controles ni acciones.

## Alcance de implementacion

Implementar como una refactorizacion visual local de `FuelFilters`. Solo tocar componentes compartidos si aparece un bug real al usar `Select searchable` o `DatePicker`; no cambiar primitives por preferencia estetica durante esta tarea.
