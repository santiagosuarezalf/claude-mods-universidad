import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Beca, Bloque, Contexto, Entrega } from '../types'
import { beca, clasificar, contexto, fechaLocal, leerEventos, punteros, recortar, restante, usarZona } from './logica'

const entregas = atom({ plugin: 'carrera', key: 'entregas' } as const, [] as Entrega[])
const bloques = atom({ plugin: 'carrera', key: 'bloques' } as const, [] as Bloque[])
const semana = atom({ plugin: 'carrera', key: 'semana' } as const, null as number | null)
const ctx = atom({ plugin: 'carrera', key: 'contexto' } as const, null as Contexto | null)
const notas = atom({ plugin: 'carrera', key: 'beca' } as const, null as Beca | null)
const tick = atom({ plugin: 'carrera', key: 'tick' } as const, 0)
const vista = atom({ plugin: 'carrera', key: 'vista' } as const, 0)

const CALENDARIO = 'claude.ai Google Calendar'
const CADA_CALENDARIO_MS = 10 * 60_000
const CADA_MINUTO_MS = 60_000
const ROTAR_MS = 8000
const HORA = 3600_000

/** La carpeta raíz de la carrera: la del CLAUDE.md que tiene los punteros, de aquí hacia arriba. */
async function raiz ($: EngineInterface) {
  const encontrados = await $.fs.ancestors({ names: ['CLAUDE.md'] })
  const propio = [...encontrados].reverse().find(f => punteros(f.content) !== null)
  return propio ? { dir: propio.dir, md: propio.content } : null
}

/** Punteros, cortes y notas: archivos del Drive, baratos de releer. */
async function leerArchivos ($: EngineInterface) {
  const r = await raiz($)
  if (!r) return
  const p = punteros(r.md)
  if (!p) return
  const ahora = await $.clock.now()
  const mdSemestre = await $.fs.read(`${r.dir}/${p.semestre}/CLAUDE.md`).catch(() => '')
  await update($, ctx, () => contexto(p.semestre, p.corte, mdSemestre, ahora))
  const mdNotas = await $.fs.read(`${r.dir}/${p.semestre}/NOTAS.md`).catch(() => '')
  await update($, notas, () => beca(mdNotas))
}

/** El id del calendario cuyo nombre da la opción `calendario` (se busca una vez y se guarda). */
async function idCalendario ($: EngineInterface, nombre: string) {
  const guardado = await $.store.get('calendario')
  if (guardado && typeof guardado === 'object' && (guardado as { nombre?: unknown }).nombre === nombre) {
    return (guardado as { id: string }).id
  }
  const r = await $.mcp.call(CALENDARIO, 'list_calendars', {})
  if (r.isError) return null
  for (const bloque of r.content) {
    const texto = (bloque as { text?: unknown }).text
    if (typeof texto !== 'string') continue
    try {
      const lista = (JSON.parse(texto) as { calendars?: { id: string; summary?: string }[] }).calendars ?? []
      const cal = lista.find(c => (c.summary ?? '').toLowerCase() === nombre.toLowerCase())
      if (cal) {
        await $.store.set('calendario', { nombre, id: cal.id })
        return cal.id
      }
    } catch { /* no era JSON */ }
  }
  return null
}

/** Lee `list_events` de un tramo; si la respuesta fue muy larga, la recupera del archivo donde quedó. */
async function leerTramo ($: EngineInterface, id: string, desde: string, hasta: string) {
  const resultado = await $.mcp.call(CALENDARIO, 'list_events', {
    calendarId: id,
    startTime: `${desde}T00:00:00`,
    endTime: `${hasta}T23:59:00`,
    orderBy: 'startTime',
    pageSize: 50,
  })
  let eventos = resultado.isError ? [] : leerEventos(resultado)
  let fallo: string | null = null
  // Una respuesta muy larga no llega entera: Claude Code la guarda en un archivo y avisa dónde.
  if (!resultado.isError && eventos.length === 0) {
    for (const c of resultado.content) {
      const ruta = /saved to (\/[^\s]+\.(?:txt|json))/.exec(String((c as { text?: unknown }).text ?? ''))?.[1]
      if (!ruta) continue
      const texto = await $.fs.read(ruta).catch((err: unknown) => { fallo = `${ruta}: ${String(err)}`; return '' })
      eventos = leerEventos({ content: [{ type: 'text', text: texto }] })
      if (eventos.length > 0) break
    }
  }
  return { resultado, eventos, fallo }
}

/** Una semana del calendario configurado, en tramos cortos para no pasar el tope de la respuesta. */
async function leerCalendario ($: EngineInterface, nombre: string) {
  const id = await idCalendario($, nombre)
  if (id === null) return
  const ahora = await $.clock.now()
  const tramos: [number, number][] = [[0, 2], [3, 5], [6, 7]]
  const partes = await Promise.all(tramos.map(([a, b]) =>
    leerTramo($, id, fechaLocal(ahora + a * 24 * HORA), fechaLocal(ahora + b * 24 * HORA))))
  const eventos = partes.flatMap(p => p.eventos)
  const conError = partes.some(p => p.resultado.isError)
  // Diagnóstico: la forma de las últimas respuestas, para depurar cuando no llegan eventos
  await $.store.set('diagnostico', {
    isError: conError,
    tramos: partes.map(p => ({
      isError: p.resultado.isError,
      inicio: p.resultado.content.map(c => String((c as { text?: unknown }).text ?? '').slice(0, 300)),
      eventos: p.eventos.length,
      fallo: p.fallo,
    })),
    eventos: eventos.length,
  } as never)
  if (conError) return
  await $.store.set('eventos', eventos as never)
  await aplicar($, eventos)
}

async function aplicar ($: EngineInterface, eventos: ReturnType<typeof leerEventos>) {
  const c = clasificar(eventos, await $.clock.now())
  await update($, entregas, () => c.entregas)
  await update($, bloques, () => c.bloques)
  await update($, semana, () => c.semana)
}

let iniciado = false
let nombreCal = 'University'
const avisados = new Set<string>()

/**
 * Carga datos y prende los relojes una sola vez. Corre en session.start, y también en el primer
 * prompt o turno: un mod instalado con la sesión ya abierta no recibe session.start.
 */
async function iniciar ($: EngineInterface) {
  if (iniciado) return
  iniciado = true
  const guardados = await $.store.get('eventos')
  if (Array.isArray(guardados)) await aplicar($, guardados as ReturnType<typeof leerEventos>)
  void leerArchivos($).catch(() => undefined)
  void leerCalendario($, nombreCal).catch(() => undefined)

  $.clock.every(CADA_CALENDARIO_MS, () => { void leerCalendario($, nombreCal).catch(() => undefined) })
  $.clock.every(ROTAR_MS, () => { void update($, vista, n => n + 1) })
  $.clock.every(CADA_MINUTO_MS, async () => {
    await update($, tick, n => n + 1)
    // Aviso cuando arranca un bloque ✍️ del calendario
    const ahora = await $.clock.now()
    for (const b of await read($, bloques)) {
      const clave = `${b.titulo}@${b.inicio}`
      if (b.inicio <= ahora && ahora < b.fin && !avisados.has(clave)) {
        avisados.add(clave)
        $.ui.toast(`✍️ Empieza el bloque: ${recortar(b.titulo, 60)} (${restante(b.fin - ahora)})`)
      }
    }
  })
}

const colorPorHoras = (horas: number) => (horas <= 12 ? 'error' : horas <= 48 ? 'warning' : undefined)

export const register: Register = (on, options) => {
  nombreCal = String(options.calendario ?? 'University')
  const meta = Number(options.metaPromedio ?? 9.3)
  usarZona(Number(options.utcOffset ?? -5))
  on('session.start', async ($, e, next) => {
    await iniciar($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    void iniciar($).catch(() => undefined)
    return next(e)
  })

  // Las notas o los punteros pueden cambiar en cualquier turno: se releen al terminar cada uno.
  on('turn.complete', async ($, e, next) => {
    void iniciar($).catch(() => undefined)
    void leerArchivos($).catch(() => undefined)
    return next(e)
  })

  // Pie, junto al modo (como sub-meter): rota cada 8 s entre la próxima entrega, el semestre y el promedio.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    await read($, tick)
    const ahora = await $.clock.now()
    const prox = (await read($, entregas)).find(x => x.cierra > ahora)
    const c = await read($, ctx)
    const n = await read($, semana)
    const b = await read($, notas)
    const { Box, Text } = $.ui.resolve(e)
    const ancho = Math.max(14, Math.min(34, Math.floor((e.viewport?.columns ?? 100) / 4)))

    const piezas: RenderChildren[] = []
    if (prox) {
      const falta = prox.cierra - ahora
      piezas.push(
        <Text>
          <Text dimColor>📌 </Text>
          <Text>{recortar(prox.titulo, ancho)}</Text>
          <Text color={colorPorHoras(falta / HORA)}> · {restante(falta)}</Text>
        </Text>,
      )
    }
    if (c) {
      const corteMal = c.esperado !== null && c.esperado !== c.corte
      const diasFin = c.finClases === null ? null : Math.ceil((c.finClases - ahora) / (24 * HORA))
      const sem = c.semestre.replace(/ SEMESTER$/i, '').replace(/^(\d+)(st|nd|rd|th)$/i, '$1º')
      piezas.push(
        <Text>
          <Text dimColor>🗓️ {sem} sem · </Text>
          <Text color={corteMal ? 'error' : undefined}>{c.corte}</Text>
          {n !== null ? <Text dimColor> · semana {n}{c.semanas ? `/${c.semanas}` : ''}</Text> : null}
          {diasFin !== null && diasFin >= 0 ? <Text dimColor> · fin en {diasFin} d</Text> : null}
        </Text>,
      )
    }
    if (b !== null && b.promedio !== null) {
      piezas.push(
        <Text>
          <Text dimColor>🎓 </Text>
          <Text color={b.promedio >= meta ? 'success' : 'warning'}>
            {b.aproximado ? '≈' : ''}{b.promedio.toFixed(2).replace('.', ',')}
          </Text>
          <Text dimColor> / {String(meta).replace('.', ',')} · {b.materias}/{b.total} materias</Text>
        </Text>,
      )
    }
    if (piezas.length === 0) return next(e)

    const labels = e.props.modes.length > 0 ? await next(e) : null
    const actual = piezas[(await read($, vista)) % piezas.length]
    return (
      <Box flexDirection="row">
        {labels}
        {labels ? <Text dimColor> · </Text> : null}
        {actual}
      </Box>
    )
  })

  // Sobre el prompt, solo cuando hace falta: el corte desactualizado o un bloque ✍️ en curso.
  // Lo que dibujan otros mods ahí (la fila de image-preview, por ejemplo) se deja pasar siempre.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, tick)
    const ahora = await $.clock.now()
    const c = await read($, ctx)
    const corteMal = c !== null && c.esperado !== null && c.esperado !== c.corte
    const enCurso = (await read($, bloques)).find(x => x.inicio <= ahora && ahora < x.fin)
    if (!corteMal && !enCurso) return next(e)

    const otros = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {corteMal && c
          ? <Text color="error">⚠️ Por fecha ya es {c.esperado}: falta actualizar CORTE ACTIVO en el CLAUDE.md raíz.</Text>
          : null}
        {enCurso
          ? (
            <Text>
              <Text color="claude">✍️ {recortar(enCurso.titulo, Math.max(20, e.props.bodyColumns - 24))}</Text>
              <Text dimColor> · quedan {restante(enCurso.fin - ahora)}</Text>
            </Text>
            )
          : null}
        {otros}
      </Box>
    )
  })
}
