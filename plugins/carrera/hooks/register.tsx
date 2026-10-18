import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Beca, Bloque, Contexto, Entrega } from '../types'
import { beca, clasificar, contexto, fechaLocal, leerEventos, punteros, recortar, restante, usarZona } from './logica'

const entregas = atom({ plugin: 'carrera', key: 'entregas' } as const, [] as Entrega[])
const bloques = atom({ plugin: 'carrera', key: 'bloques' } as const, [] as Bloque[])
const semana = atom({ plugin: 'carrera', key: 'semana' } as const, null as number | null)
const ctx = atom({ plugin: 'carrera', key: 'contexto' } as const, null as Contexto | null)
const notas = atom({ plugin: 'carrera', key: 'beca' } as const, null as Beca | null)
const tick = atom({ plugin: 'carrera', key: 'tick' } as const, 0)

const CALENDARIO = 'claude.ai Google Calendar'
const CADA_CALENDARIO_MS = 10 * 60_000
const CADA_MINUTO_MS = 60_000
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

/** Dos semanas del calendario configurado, directo del conector de Google Calendar. */
async function leerCalendario ($: EngineInterface, nombre: string) {
  const id = await idCalendario($, nombre)
  if (id === null) return
  const ahora = await $.clock.now()
  const hoy = fechaLocal(ahora)
  const hasta = fechaLocal(ahora + 14 * 24 * HORA)
  const resultado = await $.mcp.call(CALENDARIO, 'list_events', {
    calendarId: id,
    startTime: `${hoy}T00:00:00`,
    endTime: `${hasta}T23:59:00`,
    orderBy: 'startTime',
    pageSize: 150,
  })
  if (resultado.isError) return
  const eventos = leerEventos(resultado)
  await $.store.set('eventos', eventos as never)
  await aplicar($, eventos)
}

async function aplicar ($: EngineInterface, eventos: ReturnType<typeof leerEventos>) {
  const c = clasificar(eventos, await $.clock.now())
  await update($, entregas, () => c.entregas)
  await update($, bloques, () => c.bloques)
  await update($, semana, () => c.semana)
}

const colorPorHoras = (horas: number) => (horas <= 12 ? 'error' : horas <= 48 ? 'warning' : undefined)

export const register: Register = (on, options) => {
  const avisados = new Set<string>()
  const nombreCal = String(options.calendario ?? 'University')
  const meta = Number(options.metaPromedio ?? 9.3)
  usarZona(Number(options.utcOffset ?? -5))

  on('session.start', async ($, e, next) => {
    const guardados = await $.store.get('eventos')
    if (Array.isArray(guardados)) await aplicar($, guardados as ReturnType<typeof leerEventos>)
    void leerArchivos($).catch(() => undefined)
    void leerCalendario($, nombreCal).catch(() => undefined)

    $.clock.every(CADA_CALENDARIO_MS, () => { void leerCalendario($, nombreCal).catch(() => undefined) })
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
    return next(e)
  })

  // Las notas o los punteros pueden cambiar en cualquier turno: se releen al terminar cada uno.
  on('turn.complete', async ($, e, next) => {
    void leerArchivos($).catch(() => undefined)
    return next(e)
  })

  // (1) Pie, junto al modo: la próxima entrega y cuánto falta.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    await read($, tick)
    const ahora = await $.clock.now()
    const prox = (await read($, entregas)).find(x => x.cierra > ahora)
    if (!prox) return next(e)

    const labels = e.props.modes.length > 0 ? await next(e) : null
    const { Box, Text } = $.ui.resolve(e)
    const falta = prox.cierra - ahora
    const ancho = Math.max(14, Math.min(34, Math.floor((e.viewport?.columns ?? 100) / 4)))

    return (
      <Box flexDirection="row">
        {labels}
        {labels ? <Text dimColor> · </Text> : null}
        <Text dimColor>📌 </Text>
        <Text>{recortar(prox.titulo, ancho)}</Text>
        <Text color={colorPorHoras(falta / HORA)}> · {restante(falta)}</Text>
      </Box>
    )
  })

  // (2) (3) (5) Banda sobre el prompt: semestre, corte, semana, beca y el bloque ✍️ en curso.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, ctx)
    if (e.props.hasSurvey || c === null) return next(e)

    await read($, tick)
    const ahora = await $.clock.now()
    const n = await read($, semana)
    const b = await read($, notas)
    const enCurso = (await read($, bloques)).find(x => x.inicio <= ahora && ahora < x.fin)
    const { Box, Text } = $.ui.resolve(e)

    const corteMal = c.esperado !== null && c.esperado !== c.corte
    const diasFin = c.finClases === null ? null : Math.ceil((c.finClases - ahora) / (24 * HORA))
    const sem = c.semestre.replace(/ SEMESTER$/i, '').replace(/^(\d+)(st|nd|rd|th)$/i, '$1º')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Text dimColor>{sem} sem · </Text>
          <Text color={corteMal ? 'error' : undefined}>{c.corte}</Text>
          {n !== null ? <Text dimColor> · semana {n}{c.semanas ? `/${c.semanas}` : ''}</Text> : null}
          {diasFin !== null && diasFin >= 0
            ? <Text dimColor> · fin de clases en {diasFin} d</Text>
            : null}
          {b !== null && b.promedio !== null
            ? (
              <Text>
                <Text dimColor>   🎓 </Text>
                <Text color={b.promedio >= meta ? 'success' : 'warning'}>
                  {b.aproximado ? '≈' : ''}{b.promedio.toFixed(2).replace('.', ',')}
                </Text>
                <Text dimColor> / {String(meta).replace('.', ',')} · {b.materias}/{b.total} materias</Text>
              </Text>
              )
            : null}
        </Box>
        {corteMal
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
      </Box>
    )
  })
}
