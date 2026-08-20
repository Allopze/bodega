import sharp from "sharp"

/**
 * Rectificación de la foto de un formulario a un rectángulo canónico.
 *
 * La detección de marcas necesita saber dónde cae cada casilla, y eso sólo
 * tiene sentido sobre una imagen sin perspectiva. Una foto de mano —la del
 * ejemplar N° 03101 llegó en ángulo, con el papel curvado y rasgado— no sirve
 * cruda: media celda de desplazamiento produce lecturas plausibles y
 * equivocadas.
 *
 * Se implementa a mano y no con una dependencia nueva porque `sharp` sólo hace
 * transformaciones afines (`.affine()`), que no corrigen perspectiva: los
 * cuatro lados de una hoja fotografiada en ángulo no quedan paralelos. La
 * homografía son ~40 líneas de álgebra y el remuestreo otras 20, contra sumar
 * OpenCV al bundle.
 *
 * Limitación conocida: corrige **perspectiva plana**. El papel curvado es una
 * superficie alabeada y una homografía no la endereza del todo; queda error
 * residual hacia los bordes. Si la medición muestra que ahí se pierde, el
 * remedio barato es pedir la foto con el papel apoyado y plano, no un modelo
 * de deformación.
 */

export interface Point { x: number; y: number }
export interface Quad { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point }

export interface RectifiedImage {
  /** Escala de grises, un byte por píxel. */
  data: Uint8Array
  width: number
  height: number
}

/**
 * Resuelve `A·x = b` por eliminación gaussiana con pivoteo parcial.
 * Sin pivoteo, un cuadrilátero casi rectangular genera un pivote diminuto y la
 * homografía sale con error grande justo en el caso más común.
 */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]!])

  for (let column = 0; column < size; column++) {
    let pivot = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-10) return null
    ;[augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!]

    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = augmented[row]![column]! / augmented[column]![column]!
      for (let k = column; k <= size; k++) augmented[row]![k]! -= factor * augmented[column]![k]!
    }
  }
  return augmented.map((row, index) => row[size]! / row[index]!)
}

/**
 * Homografía que lleva el rectángulo canónico (0,0)-(1,1) al cuadrilátero de
 * la foto. Es la dirección **inversa** a propósito: el remuestreo recorre los
 * píxeles de salida y pregunta de dónde vienen, que es lo que evita agujeros.
 */
export function homographyFromUnitSquare(quad: Quad): number[] | null {
  const targets = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  const sources: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

  const matrix: number[][] = []
  const vector: number[] = []
  for (let index = 0; index < 4; index++) {
    const { x: u, y: v } = sources[index]!
    const { x, y } = targets[index]!
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x])
    vector.push(x)
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y])
    vector.push(y)
  }
  const solution = solve(matrix, vector)
  return solution ? [...solution, 1] : null
}

/** Aplica la homografía a un punto del cuadrado unitario. */
export function applyHomography(h: number[], u: number, v: number): Point {
  const denominator = h[6]! * u + h[7]! * v + h[8]!
  return {
    x: (h[0]! * u + h[1]! * v + h[2]!) / denominator,
    y: (h[3]! * u + h[4]! * v + h[5]!) / denominator,
  }
}

/**
 * Detecta las cuatro esquinas de la hoja: la **región clara más grande**.
 *
 * La primera versión buscaba la caja de tinta y asumía que el formulario
 * dominaba el encuadre. Sobre la foto real del N° 03101 devolvió la imagen
 * entera —hay escritorio, otros papeles y un adaptador USB con tinta propia—,
 * y con el cuadrilátero mal toda la lectura posterior es ruido con forma de
 * dato. La hoja, en cambio, es lo más claro y lo más grande: eso sí distingue
 * el formulario del fondo.
 *
 * Las esquinas se toman por extremos de `x+y` y `x−y` sobre la región, no por
 * la caja envolvente: una hoja fotografiada en ángulo tiene esquinas que no
 * coinciden con su bounding box, y usar la caja mete el fondo dentro del área
 * rectificada.
 *
 * Devuelve `null` si no hay una región plausible. Es preferible avisar que
 * inventar un cuadrilátero y leer 25 filas de basura.
 */
export function detectFormQuad(image: RectifiedImage, brightThreshold = 150): Quad | null {
  const { data, width, height } = image
  const total = width * height

  // Componentes conexas de píxeles claros, por union-find sobre 4-vecindad.
  const parent = new Int32Array(total).fill(-1)
  const find = (index: number): number => {
    let root = index
    while (parent[root]! !== root) root = parent[root]!
    while (parent[index]! !== root) { const next = parent[index]!; parent[index] = root; index = next }
    return root
  }
  const union = (a: number, b: number) => {
    const rootA = find(a), rootB = find(b)
    if (rootA !== rootB) parent[rootA] = rootB
  }

  for (let index = 0; index < total; index++) {
    if (data[index]! >= brightThreshold) parent[index] = index
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (parent[index]! < 0) continue
      if (x + 1 < width && parent[index + 1]! >= 0) union(index, index + 1)
      if (y + 1 < height && parent[index + width]! >= 0) union(index, index + width)
    }
  }

  const size = new Map<number, number>()
  for (let index = 0; index < total; index++) {
    if (parent[index]! < 0) continue
    const root = find(index)
    size.set(root, (size.get(root) ?? 0) + 1)
  }
  let best = -1
  let bestSize = 0
  for (const [root, count] of size) {
    if (count > bestSize) { best = root; bestSize = count }
  }
  // Una hoja que ocupa menos del 15% del encuadre no da para leer 25 filas.
  if (best < 0 || bestSize < total * 0.15) return null

  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity
  let topLeft: Point = { x: 0, y: 0 }, bottomRight: Point = { x: 0, y: 0 }
  let topRight: Point = { x: 0, y: 0 }, bottomLeft: Point = { x: 0, y: 0 }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (parent[index]! < 0 || find(index) !== best) continue
      const sum = x + y, diff = x - y
      if (sum < minSum) { minSum = sum; topLeft = { x, y } }
      if (sum > maxSum) { maxSum = sum; bottomRight = { x, y } }
      if (diff > maxDiff) { maxDiff = diff; topRight = { x, y } }
      if (diff < minDiff) { minDiff = diff; bottomLeft = { x, y } }
    }
  }

  const spanX = Math.max(topRight.x, bottomRight.x) - Math.min(topLeft.x, bottomLeft.x)
  const spanY = Math.max(bottomLeft.y, bottomRight.y) - Math.min(topLeft.y, topRight.y)
  if (spanX < width * 0.25 || spanY < height * 0.25) return null

  return { topLeft, topRight, bottomRight, bottomLeft }
}

/** Carga la imagen en escala de grises, normalizada y acotada en tamaño. */
export async function loadGrayscale(buffer: Buffer, maxWidth = 1800): Promise<RectifiedImage> {
  const { data, info } = await sharp(buffer)
    .autoOrient()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), width: info.width, height: info.height }
}

/**
 * Remuestrea el cuadrilátero a un rectángulo canónico por mapeo inverso:
 * recorre los píxeles de salida y toma el vecino más cercano en la entrada.
 * El vecino más cercano basta porque después sólo se mide densidad de tinta
 * por celda, no se lee texto — interpolar suavizaría justo lo que interesa.
 */
export function warpToRectangle(
  image: RectifiedImage,
  quad: Quad,
  outputWidth: number,
  outputHeight: number,
): RectifiedImage | null {
  const h = homographyFromUnitSquare(quad)
  if (!h) return null

  const output = new Uint8Array(outputWidth * outputHeight).fill(255)
  for (let y = 0; y < outputHeight; y++) {
    const v = (y + 0.5) / outputHeight
    for (let x = 0; x < outputWidth; x++) {
      const u = (x + 0.5) / outputWidth
      const source = applyHomography(h, u, v)
      const sx = Math.round(source.x)
      const sy = Math.round(source.y)
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue
      output[y * outputWidth + x] = image.data[sy * image.width + sx]!
    }
  }
  return { data: output, width: outputWidth, height: outputHeight }
}

