// Lógica pura del mod: leer el calendario, la tabla de cortes y las notas. Sin `$`, para poder probarla.
import type { Beca, Bloque, Contexto, Entrega, MateriaNota, Meta, Ventana } from '../types'

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

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "lun 16 nov": el día local de un instante, como se dice en los avisos. */
export function fechaCorta (ms: number) {
  const f = fechaLocal(ms)
  const d = new Date(`${f}T12:00:00Z`)
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`
}

/** Días de calendario entre hoy y el día de `ms` (0 = hoy, 1 = mañana), en hora local. */
export const diasHasta = (ms: number, ahora: number) =>
  Math.round((Date.parse(`${fechaLocal(ms)}T12:00:00Z`) - Date.parse(`${fechaLocal(ahora)}T12:00:00Z`)) / 86400_000)

/** Inicio del día (00:00, hora local) de una fecha "AAAA-MM-DD". */
const inicioDelDia = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`) - desfaseHoras * 3600_000

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

/** Una barra de `largo` celdas para `fraccion` (0 a 1): la parte llena y la vacía, por separado para colorearlas. */
export function barra (fraccion: number, largo = 20) {
  const llenas = Math.round(Math.min(1, Math.max(0, fraccion)) * largo)
  return { llena: '━'.repeat(llenas), vacia: '─'.repeat(largo - llenas) }
}

export const recortar = (texto: string, max: number) =>
  texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`

type FechaCal = { date?: string; dateTime?: string }
export type EventoCal = {
  summary?: string
  description?: string
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
      const abreTxt = /🪟\s*Abre:\s*(\d{4}-\d{2}-\d{2})/.exec(ev.description ?? '')?.[1]
      const abre = abreTxt ? inicioDelDia(abreTxt) : null
      if (cierra > ahora) entregas.push({ titulo, cierra, abre })
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

/**
 * Las entregas con ventana («🪟 Abre:») que toca avisar ahora, de la que cierra primero a la última:
 * - `cierra`: hoy es el último día;
 * - `abrio`: hoy es el día que abre;
 * - `sigue`: ya pasó la mitad de la ventana y sigue sin ✅ (las marcadas ✅ ni llegan acá).
 * Antes de la mitad, y antes de que abra, no se avisa.
 */
export function ventanas (entregas: readonly Entrega[], ahora: number): Ventana[] {
  const hoy = fechaLocal(ahora)
  const lista: Ventana[] = []
  for (const e of entregas) {
    if (e.abre === null || e.abre > ahora || e.cierra <= ahora) continue
    const tipo = fechaLocal(e.cierra) === hoy ? 'cierra'
      : fechaLocal(e.abre) === hoy ? 'abrio'
        : ahora >= e.abre + (e.cierra - e.abre) / 2 ? 'sigue'
          : null
    if (tipo) lista.push({ titulo: e.titulo, cierra: e.cierra, tipo })
  }
  return lista.sort((a, b) => a.cierra - b.cierra)
}

const EVALUACION = /\b(parcial|sustentaci[oó]n|examen)/i

/**
 * Parciales, sustentaciones y exámenes sin ✅ de los próximos `dias` días (hoy incluido), del más cercano
 * al último. Van aparte de las ventanas: por convención no traen «🪟 Abre:».
 */
export function evaluaciones (entregas: readonly Entrega[], ahora: number, dias = 7): Entrega[] {
  return entregas
    .filter(e => e.abre === null && e.cierra > ahora && EVALUACION.test(e.titulo) && diasHasta(e.cierra, ahora) <= dias)
    .sort((a, b) => a.cierra - b.cierra)
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

type FilaNotas = { materia: string; creditos: number | null; celdas: (string | null)[] }

/**
 * Las filas de la tabla de NOTAS.md:
 * | Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |
 * Cada celda es un número (sobre lo que vale el corte), «x/y» (lo obtenido sobre lo evaluado hasta
 * ahora) o vacía (todavía sin nota).
 */
function filasNotas (md: string): FilaNotas[] | null {
  const filas = md.split('\n').filter(f => f.trim().startsWith('|'))
  const cabecera = filas.findIndex(f => /Materia/i.test(f) && /Cr[ée]ditos/i.test(f))
  if (cabecera < 0) return null
  const lista: FilaNotas[] = []
  for (const fila of filas.slice(cabecera + 2)) {
    const celdas = fila.split('|').slice(1, -1).map(c => c.trim())
    if (celdas.length < 5 || !celdas[0]) continue
    const c = numero(celdas[1] ?? '')
    lista.push({
      materia: celdas[0],
      creditos: c !== null && c > 0 ? c : null,
      celdas: celdas.slice(2, 5).map(x => (x === '' ? null : x)),
    })
  }
  return lista
}

/** Lo que dice una celda: lo obtenido y sobre cuánto se evaluó (null si está vacía o no se entiende). */
function leerCelda (celda: string | null, corte: number): { obtenido: number; evaluado: number } | null {
  if (celda === null) return null
  const partes = celda.split('/')
  const x = numero(partes[0] ?? '')
  if (x === null || Number.isNaN(x)) return null
  const sobre = partes.length > 1 ? numero(partes[1] ?? '') : (PUNTOS_CORTE[corte] ?? null)
  if (sobre === null || Number.isNaN(sobre) || sobre <= 0) return null
  return { obtenido: x, evaluado: sobre }
}

/** Puntos de una materia: lo obtenido, lo evaluado y lo que todavía se puede ganar (sobre 100). */
function puntos (f: FilaNotas) {
  let obtenido = 0
  let evaluado = 0
  f.celdas.forEach((celda, i) => {
    const l = leerCelda(celda, i)
    if (!l) return
    obtenido += l.obtenido
    evaluado += l.evaluado
  })
  return { obtenido, evaluado, quedan: Math.max(0, 100 - evaluado) }
}

/**
 * Promedio parcial desde la tabla de NOTAS.md: cada materia, lo obtenido sobre lo evaluado, en escala 0–10.
 * Ponderado por créditos si todas las materias con nota los tienen; si no, simple y marcado como aproximado.
 */
export function beca (md: string): Beca | null {
  const filas = filasNotas(md)
  if (filas === null) return null
  const materias: { nota: number; creditos: number | null }[] = []
  for (const f of filas) {
    const p = puntos(f)
    if (p.evaluado > 0) materias.push({ nota: (p.obtenido / p.evaluado) * 10, creditos: f.creditos })
  }
  const total = filas.length
  if (materias.length === 0) return { promedio: null, materias: 0, total, aproximado: false }

  const conCreditos = materias.every(m => m.creditos !== null)
  const peso = (m: { creditos: number | null }) => (conCreditos ? (m.creditos as number) : 1)
  const suma = materias.reduce((s, m) => s + m.nota * peso(m), 0)
  const pesos = materias.reduce((s, m) => s + peso(m), 0)
  return { promedio: suma / pesos, materias: materias.length, total, aproximado: !conCreditos }
}

/**
 * Cuánto falta para que el promedio final del semestre llegue a `meta`: la nota final de cada materia es
 * la suma de sus tres cortes (sobre 100) dividida entre 10. Ponderado por créditos solo si todas los tienen.
 */
export function cuantoFalta (md: string, meta: number): Meta | null {
  const filas = filasNotas(md)
  if (filas === null || filas.length === 0) return null
  const ponderado = filas.every(f => f.creditos !== null)
  const peso = (f: FilaNotas) => (ponderado ? (f.creditos as number) : 1)

  let obtenido = 0
  let quedan = 0
  let pesos = 0
  const materias: MateriaNota[] = filas.map(f => {
    const p = puntos(f)
    obtenido += p.obtenido * peso(f)
    quedan += p.quedan * peso(f)
    pesos += peso(f)
    return {
      materia: f.materia,
      celdas: f.celdas,
      lleva: p.evaluado > 0 ? (p.obtenido / p.evaluado) * 10 : null,
      maximo: (p.obtenido + p.quedan) / 10,
    }
  })
  return {
    materias,
    necesita: Math.max(0, meta * 10 * pesos - obtenido),
    quedan,
    maximo: (obtenido + quedan) / (10 * pesos),
    ponderado,
  }
}

/** 9.3 → «9,30»: con coma decimal, como se escriben las notas. */
export const coma = (x: number, decimales = 2) => x.toFixed(decimales).replace('.', ',')

/** La meta como se escribe: 9.3 → «9,3». */
const metaTxt = (meta: number) => String(meta).replace('.', ',')

/** La frase del pie: cuánto falta para la meta de promedio, o si ya está asegurada o ya no se alcanza. */
export function fraseMeta (m: Meta, meta: number) {
  if (m.necesita <= 0) return `🎯 El ${metaTxt(meta)} ya está asegurado`
  if (m.necesita > m.quedan + 1e-9) return `🎯 El ${metaTxt(meta)} ya no se alcanza · máximo posible ${coma(m.maximo)}`
  const pct = Math.ceil((m.necesita / m.quedan) * 100)
  const cuanto = m.ponderado
    ? `el ${pct} % de lo que queda`
    : `${Math.ceil(m.necesita)} de los ${Math.round(m.quedan)} puntos que quedan (${pct} %)`
  return `🎯 Para ${metaTxt(meta)}: necesitas ${cuanto} · máximo posible ${coma(m.maximo)}`
}

/** La salida de /notas: una tabla por materia y, debajo, cuánto falta para la meta. */
export function tablaNotas (m: Meta, b: Beca | null, meta: number) {
  const ANCHO = 28
  const col = (t: string, n: number) => t.padStart(n)
  const celda = (c: string | null) => c ?? '—'
  const orden = [...m.materias].sort((x, y) => (y.lleva ?? -1) - (x.lleva ?? -1))
  const lineas: string[] = []

  const prom = b?.promedio != null
    ? `promedio actual ${b.aproximado ? '≈ ' : ''}${coma(b.promedio)} (con ${b.materias} de ${b.total} materias)`
    : 'todavía sin notas'
  lineas.push(`🎓 Beca — meta ${metaTxt(meta)} · ${prom}`, '')
  lineas.push(`${'Materia'.padEnd(ANCHO)}${col('C-I', 6)}${col('C-II', 6)}${col('C-III', 7)}${col('Lleva', 8)}${col('Máx. posible', 14)}`)
  for (const x of orden) {
    const [c1, c2, c3] = x.celdas
    const aviso = x.maximo < meta ? `  ⚠️ ya no llega a ${metaTxt(meta)} sola` : ''
    lineas.push(
      `${recortar(x.materia, ANCHO - 2).padEnd(ANCHO)}${col(celda(c1 ?? null), 6)}${col(celda(c2 ?? null), 6)}${col(celda(c3 ?? null), 7)}` +
      `${col(x.lleva === null ? '—' : coma(x.lleva), 8)}${col(coma(x.maximo), 14)}${aviso}`,
    )
  }
  lineas.push('', fraseMeta(m, meta).replace(' · máximo posible', '.\n   Máximo posible si sacas todo perfecto:') + '.')
  if (!m.ponderado) lineas.push('   ≈ Sin ponderar: faltan los créditos de cada materia en NOTAS.md.')
  return lineas.join('\n')
}
