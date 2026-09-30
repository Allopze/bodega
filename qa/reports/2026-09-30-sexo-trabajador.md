# QA — Campo «Sexo» en la ficha del trabajador (2026-09-30)

Recorrido de navegador dirigido, no auditoría completa. Entorno: `next dev` en
`:3001` contra `bodega_dev` (migrada a 0343). Sesión QA de
`playwright/.auth/monkeytest.json`, viewport 1440×900.

## Alcance

| Paso | Resultado | Evidencia |
|---|---|---|
| `/admin/trabajadores` → «Nuevo trabajador»: el selector «Sexo» parte en «Sin registrar» | PASS | `01-nuevo-con-sexo.png` |
| Opciones ofrecidas: Sin registrar, Mujer, Hombre, Intersexual, No informa | PASS | salida del script |
| Crear `QA_Sexo Verificacion` con «Mujer» → `workers.sex = 'female'` | PASS | consulta a `bodega_dev` |
| Reabrir la ficha: el selector muestra «Mujer» | PASS | `02-editar-precargado.png` |
| Cambiar a «Hombre» y guardar → `workers.sex = 'male'` | PASS | consulta a `bodega_dev` |
| Auditoría del update: `sexoModificado: true`, sin el valor | PASS | `audit_log` |
| `/prevencion/indicadores` carga sin errores | PASS | `03-indicadores.png` |
| Errores de consola / requests fallidos / 5xx en todo el recorrido | 0 / 0 / 0 | salida del script |

## Lo que no se cubrió (COVERAGE GAP)

- **Desagregación por sexo en el tablero**: `bodega_dev` no tiene casos de
  accidente en 2026, así que la sección no aparece. Las etiquetas («Mujer»,
  «Sin dato») están cubiertas por `canonical-indicators-dashboard.test.tsx`,
  no por el navegador.
- **Copia al incidente**: el formulario de reporte no vincula aún a un
  trabajador (`workerId`), por lo que la copia no se puede ejercitar desde la
  UI. Está cubierta por `prevention-incidents-worker-sex.test.ts` (PGlite).
- **Exportación ARCO** (hoja «Titular», columna «Sexo»): cubierta por
  `prevention-privacy-export.test.ts`, no descargada en el navegador.
- **Importación XLSX**: no lee ni modifica el sexo (ni las tallas); una
  actualización por Excel lo conserva. No se recorrió.

## Datos creados

`workers` → `QA_Sexo Verificacion` (Oficina Central) en `bodega_dev`.
