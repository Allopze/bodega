# Indicadores material y ambiental

Esta pantalla muestra el conteo canónico de eventos material y ambiental
registrados en el módulo de Incidentes, separados por faena y mes.

## Datos mostrados

- **Incidentes peligrosos:** eventos tipo `dangerous_incident` (sin lesión ni daño).
- **Daño material:** eventos tipo `material_damage` (con daño a la propiedad).
- **Daño ambiental:** eventos tipo `environmental_spill` (derrames y eventos ambientales).

## Cómo usarla

1. Entra a `Indicadores material y ambiental`.
2. Selecciona la faena y el año que quieres revisar.
3. Revisa las tres pestañas disponibles:

### Pestaña «Desglose mensual»

Tabla con el detalle mes a mes de cada tipo de evento, más el total mensual.
Los datos aparecen ordenados de enero a diciembre.

### Pestaña «Gráficos»

Cuatro gráficos interactivos para visualizar los datos:

- **Eventos por tipo · desglose mensual:** barras agrupadas que comparan los
  tres tipos de evento mes a mes.
- **Tendencia mensual de eventos:** líneas que muestran la evolución de cada
  tipo durante el año.
- **Total eventos por faena (anual):** barras apiladas horizontales que
  comparan el acumulado anual entre faenas.
- **Distribución anual acumulada:** gráfico combinado (barras + líneas) que
  muestra daño material como barras y las tendencias de incidentes peligrosos
  y daño ambiental como líneas.

Pasa el mouse sobre las barras o puntos para ver los valores exactos.
Usa la leyenda para mostrar u ocultar series.

### Pestaña «Resumen por faena»

Tabla con el total anual de cada tipo de evento por faena y un total
general de todas las faenas visibles.

## Exportar a Excel

Usa el botón `Exportar Excel` en la esquina superior derecha para descargar
un archivo de Excel con tres hojas:
- **Desglose mensual:** todos los meses de todas las faenas.
- **Resumen anual:** totales por faena.
- **Metadatos:** fecha de generación, usuario y filtros aplicados.

Los datos provienen directamente del registro canónico de incidentes, no de
carga manual.
