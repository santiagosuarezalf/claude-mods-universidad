import type { Bloque } from '../types'

// Un renglón con 📋 (el título) y, debajo, un bloque de código; entre los dos solo renglones en blanco.
const PATRON = /^[ \t]*📋[ \t]*(.*?)[ \t]*\n(?:[ \t]*\n)*[ \t]*(`{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*$/gm

/** Saca de una respuesta los textos para copiar, en el orden en que aparecen. */
export function extraerBloques (respuesta: string): Bloque[] {
  const bloques: Bloque[] = []
  for (const m of respuesta.replace(/\r\n/g, '\n').matchAll(PATRON)) {
    const titulo = m[1].replace(/\*\*|__/g, '').replace(/:$/, '').trim() || `Texto ${bloques.length + 1}`
    bloques.push({ titulo, texto: m[3] })
  }
  return bloques
}

/** El comienzo del texto en un solo renglón, para la franja. */
export function adelanto (texto: string, largo = 48): string {
  const plano = texto.replace(/\s+/g, ' ').trim()
  return plano.length > largo ? `${plano.slice(0, largo - 1).trimEnd()}…` : plano
}
