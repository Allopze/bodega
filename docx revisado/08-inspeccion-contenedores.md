# Módulo 08: Inspección de Contenedores

> **Documento fuente:** `Anexo 14 Inspeccion Contenedores (1).xlsx`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Checklist de
> inspección de contenedores metálicos

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona la **inspección de contenedores metálicos**
utilizados en operaciones industriales. Evalúa el estado estructural,
accesorios de seguridad, puertas, sellos y componentes del contenedor,
con un diagrama visual para marcar accesorios que requieren reparación.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `InspecciónContenedor`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `fecha` | Date | Fecha de la inspección |
| `número_contenedor` | String(50) | Número de identificación del contenedor |
| `área` | String(200) | Área/zona donde se encuentra el contenedor |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo |
| `jefe_terreno` | String(200) | Nombre del jefe de terreno |
| `jefe_terreno_firma_url` | String | Firma del jefe de terreno |
| `prevencionista` | String(200) | Nombre del prevencionista |
| `prevencionista_firma_url` | String | Firma del prevencionista |
| `observaciones` | Text | Observaciones generales |
| `medidas_control` | Text | Medidas de control |
| `resultado_general` | Enum | `conforme`, `con_observaciones`, `no_conforme` |

### 2.2 Entidad: `ItemInspecciónContenedor`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `inspección_id` | FK → InspecciónContenedor | Inspección padre |
| `número` | Integer | Número del ítem |
| `descripción` | String(200) | Nombre del componente |
| `estado` | Enum | `bueno`, `regular`, `malo`, `no_aplica`, `no_tiene` |
| `requiere_reparación` | Boolean | Si requiere reparación |
| `observaciones` | Text | Observaciones |

------------------------------------------------------------------------

## 3. Checklist de Inspección (15 ítems)

| N°  | Componente a Observar        | Evaluación  |
|-----|------------------------------|-------------|
| 1   | Soportes de levante          | B/R/M/NA/NT |
| 2   | Cadenas de fijación          | B/R/M/NA/NT |
| 3   | Puerta lateral o volteo      | B/R/M/NA/NT |
| 4   | Puerta escotilla             | B/R/M/NA/NT |
| 5   | Seguro de puertas            | B/R/M/NA/NT |
| 6   | Sellos de puertas herméticos | B/R/M/NA/NT |
| 7   | Visagra puertas              | B/R/M/NA/NT |
| 8   | Letreros                     | B/R/M/NA/NT |
| 9   | Aletas de seguridad          | B/R/M/NA/NT |
| 10  | Rodillos                     | B/R/M/NA/NT |
| 11  | Escalas accesos              | B/R/M/NA/NT |
| 12  | Estructura apoya barrotes    | B/R/M/NA/NT |
| 13  | Estado de vigas              | B/R/M/NA/NT |
|     |                              |             |
| 14  | Estado general               | B/R/M/NA/NT |

### Escala de Evaluación

| Código | Significado | Color       |
|--------|-------------|-------------|
| **B**  | Bueno       | 🟢 Verde    |
| **R**  | Regular     | 🟡 Amarillo |
| **M**  | Malo        | 🔴 Rojo     |
| **NA** | No Aplica   | ⚪ Gris     |
| **NT** | No Tiene    | ⬜ Blanco   |

------------------------------------------------------------------------

## 4. Diagrama Visual de Accesorios a Reparar

El documento original incluye una sección visual para **marcar sobre un
diagrama del contenedor** los accesorios que requieren reparación. En la
versión SaaS se puede implementar:

- Diagrama interactivo del contenedor con zonas clicables
- Marcado visual de puntos que necesitan reparación
- Asociación de fotos a cada zona marcada

------------------------------------------------------------------------

## 5. Funcionalidades del Módulo SaaS

### 5.1 Inspección Digital

- [ ] Checklist de 15 ítems con evaluación B/R/M/NA/NT
- [ ] Diagrama interactivo del contenedor para marcar accesorios
- [ ] Captura de fotos por componente
- [ ] Identificación por número de contenedor
- [ ] Campo de observaciones y medidas de control
- [ ] Doble firma (jefe de terreno + prevencionista)

### 5.2 Gestión de Contenedores

- [ ] Inventario de contenedores por centro de trabajo
- [ ] Historial de inspecciones por contenedor
- [ ] Estado actual de cada contenedor (operativo, en reparación, fuera
  de servicio)
- [ ] Generación de OT para reparaciones
- [ ] Tracking de reparaciones y mantenciones

### 5.3 Reportes

- [ ] Reporte individual por contenedor
- [ ] Dashboard de estado de contenedores por faena
- [ ] Componentes con mayor frecuencia de falla
- [ ] Exportación a PDF con diagrama y fotos

------------------------------------------------------------------------

## 6. Reglas de Negocio

1.  **Frecuencia**: Mensual por cada contenedor.
2.  **Responsable**: Jefe de terreno o supervisor de faena.
3.  **Comunicación**: Informar al administrador de contrato el estado de
    contenedores, gestionar reparación/mantención estructural.
4.  **Doble revisión**: Prevencionista y JT inspeccionan juntos.
5.  **Ítems críticos**: Soportes de levante y cadenas de fijación en
    estado M = contenedor fuera de servicio.
6.  **NT (No Tiene)**: Si un componente no existe, se marca NT y se
    evalúa si es necesario instalarlo.

------------------------------------------------------------------------

## 7. Integraciones

| Módulo | Relación |
|----|----|
| Cronograma SG-SST | Alimenta avance de “Inspección de contenedores metálicos” |
| Seguimiento y Control | Hallazgos R/M al seguimiento general |
| Mantención | Generación de OT para reparaciones estructurales |
