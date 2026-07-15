# Módulo 11: Inspección de Uso y Estado de EPP

> **Documento fuente:** `Anexo 3 Inspeccion de Uso y Estado de EPP.xls`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Registro de
> inspección de elementos de protección personal

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona la **inspección del uso y estado de los Elementos
de Protección Personal (EPP)** de cada trabajador. Evalúa si el
trabajador está usando cada EPP asignado y el estado de conservación de
cada elemento. Es una matriz donde las filas son trabajadores y las
columnas son tipos de EPP.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `InspecciónEPP`

| Campo               | Tipo               | Descripción             |
|---------------------|--------------------|-------------------------|
| `id`                | UUID               | Identificador único     |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo       |
| `realizado_por`     | String(200)        | Nombre del inspector    |
| `cargo`             | String(100)        | Cargo del inspector     |
| `firma_url`         | String             | Firma del inspector     |
| `fecha`             | Date               | Fecha de inspección     |
| `turno`             | String(50)         | Turno inspeccionado     |
| `revisado_por`      | String(200)        | Nombre de quien revisa  |
| `revisor_cargo`     | String(100)        | Cargo del revisor       |
| `revisor_fecha`     | Date               | Fecha de revisión       |
| `revisor_firma_url` | String             | Firma del revisor       |
| `observaciones`     | Text               | Observaciones generales |
| `created_at`        | Timestamp          | Fecha de creación       |

### 2.2 Entidad: `InspecciónEPPTrabajador`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `inspección_id` | FK → InspecciónEPP | Inspección padre |
| `trabajador_nombre` | String(200) | Nombre del trabajador |
| `trabajador_id` | FK → Trabajador (nullable) | Vínculo con registro de trabajador |

### 2.3 Entidad: `EvaluaciónEPP`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `inspección_trabajador_id` | FK → InspecciónEPPTrabajador | Fila de inspección |
| `tipo_epp` | Enum | Ver tipos abajo |
| `usa` | Enum | `si`, `no`, `no_aplica` |
| `estado` | Enum | `bueno`, `regular`, `malo` |
| `observaciones` | Text | Observaciones específicas |

------------------------------------------------------------------------

## 3. Tipos de EPP Evaluados

| N°  | Tipo de EPP                | Evaluación                     |
|-----|----------------------------|--------------------------------|
| 1   | **Zapatos** (de seguridad) | Usa: Si/No/N/A · Estado: B/R/M |
| 2   | **Lentes de Seguridad**    | Usa: Si/No/N/A · Estado: B/R/M |
| 3   | **Casco / Cubre Cuello**   | Usa: Si/No/N/A · Estado: B/R/M |
| 4   | **Guantes**                | Usa: Si/No/N/A · Estado: B/R/M |
| 5   | **Protección Auditiva**    | Usa: Si/No/N/A · Estado: B/R/M |
| 6   | **Ropa de Trabajo**        | Usa: Si/No/N/A · Estado: B/R/M |
| 7   | **Chaleco Reflectante**    | Usa: Si/No/N/A · Estado: B/R/M |
| 8   | **Bloqueador Solar**       | Usa: Si/No · Registro: Si/No   |
| 9   | **Traje de Agua**          | Usa: Si/No/N/A · Estado: B/R/M |
| 10  | **Traje Térmico**          | Usa: Si/No/N/A · Estado: B/R/M |

### Escalas de Evaluación

**Uso:** \| Código \| Significado \| \|——–\|————-\| \| SI \| Usa el EPP
\| \| NO \| No lo usa \| \| N/A \| No aplica para su función \|

**Estado:** \| Código \| Significado \| Color \| \|——–\|————-\|——-\| \|
B \| Bueno \| 🟢 Verde \| \| R \| Regular \| 🟡 Amarillo \| \| M \| Malo
\| 🔴 Rojo \|

> **Nota especial**: Para “Bloqueador Solar” se evalúa el uso y si
> existe **registro** (firma de entrega), no el estado físico.

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Inspección de EPP

- [ ] Matriz interactiva: trabajadores × tipos de EPP
- [ ] Selección rápida de Usa (Si/No/NA) y Estado (B/R/M)
- [ ] Carga de trabajadores desde directorio
- [ ] Filtro por turno
- [ ] Captura de fotos para EPP en mal estado
- [ ] Observaciones por trabajador
- [ ] Doble firma (inspector + revisor)

### 4.2 Gestión de EPP

- [ ] Inventario de EPP entregado por trabajador
- [ ] Registro de entregas de EPP (fecha, tipo, talla, lote)
- [ ] Vida útil estimada por tipo de EPP
- [ ] Alertas de renovación de EPP
- [ ] Historial de inspecciones por trabajador
- [ ] Tracking de no conformidades recurrentes

### 4.3 Dashboard y KPIs

- [ ] % de trabajadores con EPP completo y en buen estado
- [ ] EPP con mayor frecuencia de no uso
- [ ] EPP con mayor frecuencia de mal estado
- [ ] Tendencia mensual de cumplimiento
- [ ] Ranking de centros de trabajo por cumplimiento EPP
- [ ] Trabajadores reincidentes en no uso

### 4.4 Reportes

- [ ] Reporte de inspección individual (matriz por faena)
- [ ] Reporte consolidado por trabajador
- [ ] Estadísticas por tipo de EPP
- [ ] Exportación a PDF/Excel con formato tabular

### 4.5 Alertas

- [ ] Alerta inmediata si trabajador no usa EPP
- [ ] Notificación a supervisor de faena
- [ ] Escalamiento si EPP en estado Malo (reemplazo urgente)
- [ ] Alerta de bloqueador solar sin registro de entrega

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Frecuencia**: Mensual por cada trabajador.
2.  **Responsable**: Jefe de Terreno (JT) o Supervisor de faena.
3.  **Revisado por**: Prevencionista de faena, quien da respuesta a los
    hallazgos.
4.  **No conformidad**: Si se detecta un trabajador sin EPP o con EPP en
    mal estado, se da aviso inmediato al prevencionista de faena.
5.  **Bloqueador solar**: Se verifica que exista registro de entrega (no
    solo el uso).
6.  **EPP N/A**: Algunos EPP no aplican a todos los cargos (ej: traje de
    agua solo para trabajos en exterior con lluvia).
7.  **Reemplazo**: EPP en estado M debe ser reemplazado de inmediato.

------------------------------------------------------------------------

## 6. Integraciones

| Módulo | Relación |
|----|----|
| Cronograma SG-SST | Alimenta avance de “Inspección estado EPP” |
| Seguimiento y Control | EPP en mal estado genera hallazgo |
| Capacitaciones | Capacitación “Uso de EPP” vinculada |
| Gestión de Trabajadores | Registro de entrega de EPP por persona |
| Equipos Móviles | EPP del operador se verifica durante inspección de equipo |
