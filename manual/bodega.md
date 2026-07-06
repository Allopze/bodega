# Bodega

La seccion `Bodega` sirve para revisar stock, movimientos y ajustes de
inventario.

## Que veras al entrar

- Indicadores de `Faenas con stock`, `Productos activos`, `Bajo minimo` y
  movimientos.
- Seccion `Stock por faena`.
- Seccion `Kardex`.
- Paneles laterales para devoluciones, conteo fisico y ajustes, si tu rol los
  permite.

## Como usarla

1. Abre `Bodega`.
2. Revisa el resumen superior para entender el estado general.
3. Revisa `Stock por faena` para ver existencias por producto.
4. Revisa `Kardex` para ver el historial de movimientos.
5. Si no hay stock, usa `Ver recepciones` para revisar ingresos pendientes.

## Acciones principales

### Registrar una devolucion

1. Usa el panel `Devolver a stock`.
2. Selecciona `Faena`.
3. Selecciona `Producto`.
4. Ingresa `Cantidad a devolver`.
5. Escribe el `Motivo`.
6. Pulsa `Registrar devolución`.

### Hacer un ajuste de stock

1. Usa el panel `Ajuste de inventario`.
2. Selecciona `Faena` y `Producto`.
3. Elige `Dirección`: `Egreso (- disminuir)` o `Ingreso (+ aumentar)`.
4. Ingresa cantidad y motivo.
5. Pulsa `Registrar ajuste`.

### Inventario fisico

1. Usa el panel `Conteo fisico`.
2. Selecciona la faena.
3. Revisa la cantidad que muestra el sistema por producto.
4. Escribe la cantidad contada.
5. Pulsa `Cerrar conteo`.

El cierre registra ajustes automaticos por diferencia.

## Exportaciones

Si tu rol lo permite, puedes exportar el stock o el kardex.

- Usa `Exportar stock` para bajar el listado de existencias.
- Usa `Exportar kardex` para revisar la historia de movimientos.

## Consejo practico

Antes de hacer un ajuste, revisa si el problema viene de una recepcion, una
entrega o una devolucion mal registrada. Eso evita corregir dos veces.
