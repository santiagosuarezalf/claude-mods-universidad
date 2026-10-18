// Reglas de la convención de entregables (CLAUDE.md raíz → «File Naming Convention»). Sin `$`, para probarlas.

/** Formatos de entrega final: lo que se sube al AVA o se manda al profe. */
const FINALES = /\.(pdf|docx|pptx|xlsx)$/i
/** Archivos de trabajo que viven en Entregables sin ser la entrega (repartos para el grupo, léemes). */
const EXENTOS = /^(Reparto|LÉEME|LEEME|README)\b/i

/**
 * Revisa la ruta de un archivo nuevo. Devuelve el motivo para frenarlo, o null si cumple.
 * Solo mira entregas finales; borradores, código y carpetas de proyecto pasan.
 */
export function revisar (ruta: string, codigosConocidos: ReadonlySet<string>, propio: string): string | null {
  const partes = ruta.split('/')
  const i = partes.lastIndexOf('Entregables')
  if (i < 0) return null
  const nombre = partes[partes.length - 1] ?? ''
  if (!FINALES.test(nombre) || EXENTOS.test(nombre)) return null

  const dentro = partes.slice(i + 1, -1) // carpetas entre Entregables/ y el archivo
  if (dentro.length === 0) {
    return `«${nombre}» quedaría suelto en Entregables/. Va dentro de la carpeta del corte: Entregables/<CORTE N>/.`
  }
  // Las entregas finales van directo en Entregables/CORTE N/ (o en la carpeta del proyecto recurrente)
  const enCorte = /^CORTE I{1,3}$/.test(dentro[dentro.length - 1] ?? '')
  if (!enCorte) return null

  if (!propio) return null // sin código configurado no hay convención de nombre que revisar
  if (!nombre.includes(propio)) {
    return `«${nombre}» no sigue la convención: «Trabajo - ${propio}.ext» (individual) o «Trabajo - ${propio}, ID2, ID3.ext» (grupal).`
  }
  const desconocidos = (nombre.match(/\b\d{8}\b/g) ?? []).filter(c => !codigosConocidos.has(c))
  if (desconocidos.length > 0) {
    return `«${nombre}» trae ${desconocidos.length === 1 ? 'un código que no está' : 'códigos que no están'} en companeros.md (${desconocidos.join(', ')}). Nunca se adivinan: pedírselos al usuario.`
  }
  return null
}

/** Los códigos de 8 dígitos que aparecen en companeros.md, salvo los de filas tachadas (retirados). */
export function codigos (md: string, propio: string): Set<string> {
  const vistos = new Set<string>(propio ? [propio] : [])
  for (const linea of md.split('\n')) {
    if (/^\|\s*~~/.test(linea)) continue
    for (const c of linea.match(/\b\d{8}\b/g) ?? []) vistos.add(c)
  }
  return vistos
}
