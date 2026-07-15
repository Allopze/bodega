# Módulo 07: Inspección de Carros

> **Documento fuente:** `Anexo 13 Inspeccion Carro.xlsx` **Empresa:**
> Servicios Industriales Chome Ltda. **Tipo:** Checklist de inspección
> de carros de transporte

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona la **inspección de carros** (remolques/acoplados)
utilizados para el transporte de contenedores y carga. Evalúa el estado
de luces, neumáticos, documentación vigente y componentes estructurales
del carro.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `InspecciónCarro`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `fecha` | Date | Fecha de la inspección |
| `código_camión` | String(50) | Código del camión asociado |
| `patente_carro` | String(10) | Patente del carro |
| `supervisor_faena` | String(200) | Nombre del supervisor |
| `supervisor_firma_url` | String | Firma del supervisor |
| `chofer_entrevistado` | String(200) | Nombre del chofer |
| `chofer_firma_url` | String | Firma del chofer |
| `prevencionista` | String(200) | Nombre del prevencionista |
| `prevencionista_firma_url` | String | Firma del prevencionista |
| `medidas_control` | Text | Medidas de control determinadas |
| `resultado_general` | Enum | `aprobado`, `con_observaciones`, `rechazado` |

### 2.2 Entidad: `ItemInspecciónCarro`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `inspección_id` | FK → InspecciónCarro | Inspección padre |
| `categoría` | Enum | `luces`, `neumáticos`, `documentos`, `otros` |
| `descripción` | String(200) | Descripción del ítem |
| `estado` | Enum | `bueno`, `regular`, `malo` |
| `observaciones` | Text | Observaciones |

------------------------------------------------------------------------

## 3. Checklist de Inspección

### 3.1 LUCES (B=Bueno / R=Regular / M=Malo)

| N°  | Ítem                           |
|-----|--------------------------------|
| 1   | Intermitentes                  |
| 2   | Luces de retroceso             |
| 3   | Luz de patente                 |
| 4   | Luz trasera                    |
| 5   | Luz de freno                   |
| 6   | Conexiones eléctricas a camión |
| 7   | Micas en general               |

### 3.2 NEUMÁTICOS

<table style="width:59%;">
<colgroup>
<col style="width: 5%" />
<col style="width: 53%" />
</colgroup>
<thead>
<tr>
<th>N°</th>
<th>Ítem</th>
</tr>
</thead>
<tbody>
<tr>
<td>8</td>
<td>Desgaste profundidad mínima 3mm</td>
</tr>
<tr>
<td>9</td>
<td>Apriete de tuercas</td>
</tr>
<tr>
<td>10</td>
<td>Freno</td>
</tr>
<tr>
<td>11</td>
<td>Llantas
12 Pernos rueda</td>
</tr>
<tr>
<td>13</td>
<td>Cadena de sujeción neumático de repuesto</td>
</tr>
<tr>
<td>14</td>
<td>Neumático de repuesto</td>
</tr>
</tbody>
</table>

### 3.3 DOCUMENTOS

| N°  | Ítem                   |
|-----|------------------------|
| 15  | Permiso de circulación |
| 16  | Revisión técnica       |
| 17  | Seguro obligatorio     |

### 3.4 OTROS (Estructura y Componentes)

| N°  | Ítem                    |
|-----|-------------------------|
| 17  | Sistema de tiro (Muela) |
| 18  | Chasis                  |
| 19  | Lanza                   |
| 20  | Cadenas                 |
| 21  | Plataforma de carga     |
| 22  | Manguera de aire        |

### Escala de Evaluación

| Código | Significado | Color       |
|--------|-------------|-------------|
| **B**  | Bueno       | 🟢 Verde    |
| **R**  | Regular     | 🟡 Amarillo |
| **M**  | Malo        | 🔴 Rojo     |

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Inspección Digital

- [ ] Checklist interactivo por secciones (22 ítems)
- [ ] Evaluación B/R/M con campo de observaciones
- [ ] Identificación por patente y código de camión asociado
- [ ] Captura de fotos para ítems en mal estado
- [ ] Campo de medidas de control
- [ ] Triple firma digital (supervisor, chofer, prevencionista)

### 4.2 Gestión

- [ ] Inventario de carros
- [ ] Historial de inspecciones por carro (patente)
- [ ] Alertas de vencimiento de documentación
- [ ] Comparativo entre inspecciones sucesivas
- [ ] Bloqueo de carro si tiene ítems críticos en estado “Malo”

### 4.3 Reportes

- [ ] Reporte individual por carro
- [ ] Estado de flota de carros por faena
- [ ] Ítems con mayor frecuencia de falla
- [ ] Exportación a PDF

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Frecuencia**: Mensual por cada carro.
2.  **Responsable**: Jefe de terreno o supervisor de faena.
3.  **Triple firma**: Requiere firma de supervisor, chofer y
    prevencionista.
4.  **Medidas de control**: Se deben definir acciones correctivas para
    ítems en estado R o M.
5.  **Documentación**: Permiso circulación, revisión técnica y seguro
    deben estar vigentes.

------------------------------------------------------------------------

## 6. Integraciones

| Módulo                | Relación                                           |
|-----------------------|----------------------------------------------------|
| Cronograma SG-SST     | Alimenta avance de “Inspección de carros”          |
| Seguimiento y Control | Hallazgos R/M al seguimiento general               |
| Equipos Móviles       | Vinculación carro-camión                           |
| Extintores            | No aplica directamente (no tienen extintor propio) |
