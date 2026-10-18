// Lógica pura del mod: leer el calendario, la tabla de cortes y las notas. Sin `$`, para poder probarla.
import type { Beca, Bloque, Contexto, Entrega } from '../types'

let desfaseHoras = -5 // UTC−5 por defecto; el mod lo ajusta con la opción `utcOffset`

/** Fija el desfase respecto a UTC (en horas) que usan las fechas locales. */
export const usarZona = (horas: number) => { desfaseHoras = horas }
const MESES: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
}
const PUNTOS_CORTE = [30, 30, 40]

/** "2026-10-18": la fecha local de un instante. */
export const fechaLocal = (ms: number) => new Date(ms + desfaseHoras * 3600_000).toISOString().slice(0, 10)

/** Fin del día (23:59:59, hora local) de una fecha "AAAA-MM-DD". */
const finDelDia = (fecha: string) => Date.parse(`${fecha}T23:59:59Z`) - desfaseHoras * 3600_000

const sumarDias = (fecha: string, dias: number) =>
  new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * 86400_000).toISOString().slice(0, 10)

/** "45m", "3h 5m", "2d 4h". */
export function restante (ms: number) {
  const minutos = Math.max(1, Math.round(ms / 60000))
  if (minutos < 60) return `${minutos}m`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas}h ${minutos % 60}m`
  return `${Math.floor(horas / 24)}d ${horas % 24}h`
}

export const recortar = (texto: string, max: number) =>
  texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`

type FechaCal = { date?: string; dateTime?: string }
export type EventoCal = {
  summary?: string
  status?: string
  transparency?: string
  availability?: string
  start?: FechaCal
  end?: FechaCal
}

/** Los eventos de la respuesta de `list_events`, venga como texto JSON o estructurada. */
export function leerEventos (resultado: { content?: readonly unknown[]; structuredContent?: unknown }): EventoCal[] {
  const candidatos: unknown[] = [resultado.structuredContent]
  for (const bloque of resultado.content ?? []) {
    const texto = (bloque as { text?: unknown }).text
    if (typeof texto === 'string') {
      try { candidatos.push(JSON.parse(texto)) } catch { /* no era JSON */ }
    }
  }
  // La respuesta puede traer la lista en el texto y en la parte estructurada: gana la más completa.
  let mejor: EventoCal[] = []
  for (const c of candidatos) {
    const eventos = (c as { events?: unknown } | undefined)?.events
    if (Array.isArray(eventos) && eventos.length > mejor.length) mejor = eventos as EventoCal[]
  }
  return mejor
}

/**
 * Separa lo que le sirve al mod:
 * - entregas: eventos de día completo que no están marcados ✅/❌ ni son informativos (Semana N, libres);
 * - bloques: eventos con hora que empiezan por ✍️;
 * - semana: el número del evento «Semana N» que cubre hoy.
 */
export function clasificar (eventos: readonly EventoCal[], ahora: number) {
  const hoy = fechaLocal(ahora)
  const entregas: Entrega[] = []
  const bloques: Bloque[] = []
  let semana: number | null = null

  for (const ev of eventos) {
    const titulo = (ev.summary ?? '').trim()
    if (!titulo || ev.status === 'cancelled') continue

    const inicioDia = ev.start?.date?.slice(0, 10)
    if (inicioDia) {
      const finExclusivo = ev.end?.date?.slice(0, 10) ?? sumarDias(inicioDia, 1)
      const n = /^Semana (\d+)\b/.exec(titulo)
      if (n) {
        if (inicioDia <= hoy && hoy < finExclusivo) semana = Number(n[1])
        continue
      }
      const informativo = ev.transparency === 'transparent' || ev.availability === 'AVAILABILITY_FREE'
      if (informativo || /^(✅|❌)/.test(titulo)) continue
      const cierra = finDelDia(sumarDias(finExclusivo, -1))
      if (cierra > ahora) entregas.push({ titulo, cierra })
      continue
    }

    if (titulo.startsWith('✍️') && ev.start?.dateTime && ev.end?.dateTime) {
      const inicio = Date.parse(ev.start.dateTime)
      const fin = Date.parse(ev.end.dateTime)
      if (fin > ahora) bloques.push({ titulo: titulo.replace(/^✍️\s*(Hacer:\s*)?/, ''), inicio, fin })
    }
  }

  entregas.sort((a, b) => a.cierra - b.cierra)
  bloques.sort((a, b) => a.inicio - b.inicio)
  return { entregas, bloques, semana }
}

/** Lo que dicen los punteros del CLAUDE.md raíz. */
export function punteros (md: string) {
  const semestre = /SEMESTRE ACTIVO: `([^`]+)`/.exec(md)?.[1]
  const corte = /CORTE ACTIVO: `([^`]+)`/.exec(md)?.[1]
  return semestre && corte ? { semestre, corte } : null
}

const aFecha = (texto: string, anio: string) => {
  const [dia, mes] = texto.trim().split(/\s+/)
  const m = MESES[mes ?? '']
  return m && dia ? `${anio}-${m}-${dia.padStart(2, '0')}` : null
}

/** Contexto del semestre a partir de la tabla «Límites de corte» del CLAUDE.md del semestre. */
export function contexto (semestre: string, corte: string, mdSemestre: string, ahora: number): Contexto {
  const hoy = fechaLocal(ahora)
  const anio = hoy.slice(0, 4)
  let esperado: string | null = null
  let ultimoFin: string | null = null
  for (const fila of mdSemestre.split('\n')) {
    const m = /^\|\s*(CORTE I{1,3})\s*\|\s*([^|–]+)–([^|]+)\|/.exec(fila)
    if (!m) continue
    const [, nombre = '', desde = '', hastaTxt = ''] = m
    const ini = aFecha(desde, anio)
    const fin = aFecha(hastaTxt, anio)
    if (!ini || !fin) continue
    if (ini <= hoy) esperado = nombre
    ultimoFin = fin
  }
  const semanas = /(\d+) semanas de clase/.exec(mdSemestre)
  return {
    semestre,
    corte,
    esperado,
    finClases: ultimoFin ? finDelDia(ultimoFin) : null,
    semanas: semanas ? Number(semanas[1]) : null,
  }
}

const numero = (texto: string) => {
  const limpio = texto.replace(/\*/g, '').replace(',', '.').trim()
  return limpio === '' ? null : Number(limpio)
}

/**
 * Promedio parcial desde la tabla de NOTAS.md:
 * | Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |
 * Cada celda es un número (sobre lo que vale el corte) o «x/y» (lo obtenido sobre lo evaluado hasta ahora).
 */
export function beca (md: string): Beca | null {
  const filas = md.split('\n').filter(f => f.trim().startsWith('|'))
  const cabecera = filas.findIndex(f => /Materia/i.test(f) && /Cr[ée]ditos/i.test(f))
  if (cabecera < 0) return null

  let total = 0
  const materias: { nota: number; creditos: number | null }[] = []
  for (const fila of filas.slice(cabecera + 2)) {
    const celdas = fila.split('|').slice(1, -1).map(c => c.trim())
    if (celdas.length < 5 || !celdas[0]) continue
    const creditos = celdas[1] ?? ''
    total += 1
    let obtenido = 0
    let posible = 0
    celdas.slice(2, 5).forEach((celda, i) => {
      const partes = celda.split('/')
      const x = numero(partes[0] ?? '')
      if (x === null || Number.isNaN(x)) return
      const sobre = partes.length > 1 ? numero(partes[1] ?? '') : (PUNTOS_CORTE[i] ?? null)
      if (sobre === null || Number.isNaN(sobre) || sobre <= 0) return
      obtenido += x
      posible += sobre
    })
    if (posible > 0) {
      const c = numero(creditos)
      materias.push({ nota: (obtenido / posible) * 10, creditos: c !== null && c > 0 ? c : null })
    }
  }
  if (materias.length === 0) return { promedio: null, materias: 0, total, aproximado: false }

  const conCreditos = materias.every(m => m.creditos !== null)
  const peso = (m: { creditos: number | null }) => (conCreditos ? (m.creditos as number) : 1)
  const suma = materias.reduce((s, m) => s + m.nota * peso(m), 0)
  const pesos = materias.reduce((s, m) => s + peso(m), 0)
  return { promedio: suma / pesos, materias: materias.length, total, aproximado: !conCreditos }
}
