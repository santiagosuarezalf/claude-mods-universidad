import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Beca, Bloque, Contexto, Entrega, Evento, Meta } from '../types'
import { barra, enCurso as eventosEnCurso, horaLocal, iconoCalendario, leerAgenda, proximo,
  beca, clasificar, coma, contexto, cuantoFalta, diasHasta, evaluaciones, fechaCorta, fechaLocal, fraseMeta, leerEventos, punteros, recortar, restante,
  tablaNotas, usarZona, ventanas,
} from './logica'

const entregas = atom({ plugin: 'carrera', key: 'entregas' } as const, [] as Entrega[])
const bloques = atom({ plugin: 'carrera', key: 'bloques' } as const, [] as Bloque[])
/** Los eventos con hora de todos los calendarios (gcal-extended), para la barra del evento en curso. */
const agenda = atom({ plugin: 'carrera', key: 'agenda' } as const, [] as Evento[])
const semana = atom({ plugin: 'carrera', key: 'semana' } as const, null as number | null)
const ctx = atom({ plugin: 'carrera', key: 'contexto' } as const, null as Contexto | null)
const notas = atom({ plugin: 'carrera', key: 'beca' } as const, null as Beca | null)
const falta = atom({ plugin: 'carrera', key: 'meta' } as const, null as Meta | null)
const tick = atom({ plugin: 'carrera', key: 'tick' } as const, 0)
const vista = atom({ plugin: 'carrera', key: 'vista' } as const, 0)
const cargado = atom({ plugin: 'carrera', key: 'cargado' } as const, false)

const CALENDARIO = 'claude.ai Google Calendar'
/** El conector propio, que lee todos los calendarios con sus colores. */
const AGENDA = 'gcal-extended'
/** Eventos en curso que se muestran a la vez con su barra. */
const MAX_EN_CURSO = 2
const CADA_CALENDARIO_MS = 10 * 60_000
const CADA_MINUTO_MS = 60_000
const ROTAR_MS = 5000
const REINTENTO_MS = 60_000
const ESPERA_INICIAL_MS = 5000
/**
 * Columnas del pie que no son del renglón de carrera: la etiqueta del modo a la izquierda
 * («⏸ plan mode on · », 17) y sub-meter a la derecha (con «week», ~32), más holgura.
 */
const RESERVA = 60
/** Columnas que necesita la pieza del pie para leerse junto a la pista del engine; con menos, baja un renglón. */
const MIN_PIEZA = 40
const HORA = 3600_000
/**
 * Ventanas («🪟 Abre:» en la descripción) que se muestran a la vez sobre el prompt; las demás se cuentan.
 * En la terminal van con 📬: el 🪟 es de Unicode 13 y muchas fuentes de terminal no lo traen.
 */
const MAX_VENTANAS = 3
const NARANJA = '#ff8700'
/** Parciales, sustentaciones y exámenes: otro color, para no confundirlos con las entregas 📬. */
const VIOLETA = '#af87ff'
/** Días hacia adelante en que se avisa un parcial, sustentación o examen. */
const DIAS_EVALUACION = 7

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
  await update($, falta, () => cuantoFalta(mdNotas, metaPromedio))
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
  // Si el conector tarda, Claude Code pasa la llamada a segundo plano y devuelve solo ese aviso.
  const colgado = resultado.content.some(c =>
    /moved to the background|is still running/.test(String((c as { text?: unknown }).text ?? '')))
  return { resultado, eventos, fallo, colgado }
}

/**
 * Dos semanas del calendario configurado, en tramos cortos para no pasar el tope de la respuesta:
 * así las ventanas «🪟» de hasta 14 días se avisan desde el día que abren.
 */
async function leerCalendario ($: EngineInterface, nombre: string) {
  const id = await idCalendario($, nombre)
  if (id === null) return
  const ahora = await $.clock.now()
  const tramos: [number, number][] = [[0, 2], [3, 5], [6, 8], [9, 11], [12, 14]]
  const partes = await Promise.all(tramos.map(([a, b]) =>
    leerTramo($, id, fechaLocal(ahora + a * 24 * HORA), fechaLocal(ahora + b * 24 * HORA))))
  const eventos = partes.flatMap(p => p.eventos)
  const conError = partes.some(p => p.resultado.isError || p.colgado)
  // Diagnóstico: la forma de las últimas respuestas, para depurar cuando no llegan eventos
  await $.store.set('diagnostico', {
    cuando: new Date(ahora).toISOString(),
    isError: conError,
    tramos: partes.map(p => ({
      isError: p.resultado.isError,
      colgado: p.colgado,
      inicio: p.resultado.content.map(c => String((c as { text?: unknown }).text ?? '').slice(0, 300)),
      eventos: p.eventos.length,
      fallo: p.fallo,
    })),
    eventos: eventos.length,
  } as never)
  // Ante un fallo se conservan los eventos guardados y se reintenta en un minuto, no en diez.
  if (conError) {
    $.clock.after(REINTENTO_MS, () => { void leerCalendario($, nombre).catch(() => undefined) })
    return
  }
  await $.store.set('eventos', eventos as never)
  await $.store.set('ultimaLectura', new Date(ahora).toISOString() as never)
  await update($, cargado, () => true)
  await aplicar($, eventos)
}

/** Los eventos con hora de las próximas horas en todos los calendarios. Si el conector falla, se deja lo que había. */
async function leerTodos ($: EngineInterface) {
  const r = await $.mcp.call(AGENDA, 'list_timed_events', { hoursBack: 12, hoursAhead: 12 })
  if (r.isError) return
  await update($, agenda, () => leerAgenda(r))
}

async function aplicar ($: EngineInterface, eventos: ReturnType<typeof leerEventos>) {
  const c = clasificar(eventos, await $.clock.now())
  await update($, entregas, () => c.entregas)
  await update($, bloques, () => c.bloques)
  await update($, semana, () => c.semana)
  await avisarCierres($)
}

/** Una notificación por sesión para cada ventana «🪟» que cierra hoy sin ✅. */
async function avisarCierres ($: EngineInterface) {
  const ahora = await $.clock.now()
  for (const v of ventanas(await read($, entregas), ahora)) {
    const clave = `cierra:${v.titulo}@${v.cierra}`
    if (v.tipo !== 'cierra' || avisados.has(clave)) continue
    avisados.add(clave)
    $.ui.toast(`🔴 HOY cierra ${recortar(v.titulo, 60)} (23:59) · sin ✅`)
  }
}

let iniciado = false
let nombreCal = 'University'
let metaPromedio = 9.3
const avisados = new Set<string>()

/**
 * Carga datos y prende los relojes una sola vez. Corre en session.start, y también en el primer
 * prompt o turno: un mod instalado con la sesión ya abierta no recibe session.start.
 */
async function iniciar ($: EngineInterface) {
  if (iniciado) return
  iniciado = true
  const guardados = await $.store.get('eventos')
  if (Array.isArray(guardados) && guardados.length > 0) {
    await update($, cargado, () => true)
    await aplicar($, guardados as ReturnType<typeof leerEventos>)
  }
  void leerArchivos($).catch(() => undefined)
  // La primera lectura espera a que el conector termine de conectar al abrir la sesión.
  $.clock.after(ESPERA_INICIAL_MS, () => { void leerCalendario($, nombreCal).catch(() => undefined) })

  $.clock.every(CADA_CALENDARIO_MS, () => { void leerCalendario($, nombreCal).catch(() => undefined) })
  $.clock.after(ESPERA_INICIAL_MS, () => { void leerTodos($).catch(() => undefined) })
  $.clock.every(CADA_CALENDARIO_MS, () => { void leerTodos($).catch(() => undefined) })
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
    await avisarCierres($)
  })
}

const colorPorHoras = (horas: number) => (horas <= 12 ? 'error' : horas <= 48 ? 'warning' : undefined)

export const register: Register = (on, options) => {
  nombreCal = String(options.calendario ?? 'University')
  const meta = Number(options.metaPromedio ?? 9.3)
  metaPromedio = meta
  usarZona(Number(options.utcOffset ?? -5))
  on('session.start', async ($, e, next) => {
    await iniciar($)
    await $.command.register({ name: 'notas', description: 'Notas del semestre por materia y cuánto falta para la meta de promedio' })
    return next(e)
  })

  // /notas: la tabla por materia con lo que lleva, lo máximo posible y cuánto falta para la meta.
  on('command.run', { command: 'notas' }, async $ => {
    await leerArchivos($).catch(() => undefined)
    const m = await read($, falta)
    const b = await read($, notas)
    return { text: m === null ? 'No encontré la tabla de NOTAS.md del semestre activo.' : tablaNotas(m, b, meta) }
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

  // En el pie, en la misma línea de «plan mode on»: rota cada 5 s entre próxima entrega, semestre y promedio.
  // Ocupa siempre el mismo ancho, así sub-meter (a la derecha) no se corre ni salta de renglón.
  // Si los letreros del engine no le dejan sitio en esa línea, la pieza baja a un renglón propio.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    await read($, tick)
    const ahora = await $.clock.now()
    const prox = (await read($, entregas)).find(x => x.cierra > ahora)
    const c = await read($, ctx)
    const n = await read($, semana)
    const b = await read($, notas)
    const yaCargo = await read($, cargado)

    const linea = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    // Ancho fijo: así lo de la derecha (sub-meter, avisos del engine) no se corre cuando cambia.
    const columnas = Math.max(30, (e.viewport?.columns ?? 100) - RESERVA)
    // Lo que queda para el título de la entrega, descontando «📌 Próxima entrega: » y « · cierra en 1d 7h»
    const ancho = Math.max(16, columnas - 38)

    const entrega = prox
      ? (
        <Text>
          <Text dimColor>📌 Próxima entrega: </Text>
          <Text>{recortar(prox.titulo.replace(/^entrega\s+(de\s+)?/i, ''), ancho)}</Text>
          <Text dimColor> · cierra en </Text>
          <Text color={colorPorHoras((prox.cierra - ahora) / HORA)}>{restante(prox.cierra - ahora)}</Text>
        </Text>
        )
      : yaCargo ? null : <Text dimColor>📌 cargando calendario…</Text>

    let semestre = null
    if (c) {
      const corteMal = c.esperado !== null && c.esperado !== c.corte
      const diasFin = c.finClases === null ? null : Math.ceil((c.finClases - ahora) / (24 * HORA))
      const sem = c.semestre.replace(/ SEMESTER$/i, '').replace(/^(\d+)(st|nd|rd|th)$/i, '$1º')
      semestre = (
        <Text>
          <Text dimColor>🗓️ {sem} semestre · </Text>
          <Text color={corteMal ? 'error' : undefined}>{c.corte}</Text>
          {n !== null ? <Text dimColor> · semana {n}{c.semanas ? ` de ${c.semanas}` : ''}</Text> : null}
          {diasFin !== null && diasFin >= 0
            ? <Text dimColor> · {diasFin === 1 ? 'falta 1 día' : `faltan ${diasFin} días`}</Text>
            : null}
        </Text>
      )
    }

    const promedio = b !== null && b.promedio !== null
      ? (
        <Text>
          <Text dimColor>🎓 Promedio {b.aproximado ? 'aprox. ' : ''}</Text>
          <Text color={b.promedio >= meta ? 'success' : 'warning'}>{coma(b.promedio)}</Text>
          <Text dimColor> · meta de beca {coma(meta, 1)}</Text>
          {b.promedio >= meta
            ? <Text color="success"> (por encima ✓)</Text>
            : <Text dimColor> (faltan {coma(meta - b.promedio)})</Text>}
          <Text dimColor> · calculado con {b.materias} de {b.total} materias</Text>
        </Text>
        )
      : null

    const m = await read($, falta)
    const objetivo = m !== null && b !== null && b.promedio !== null
      ? <Text dimColor>{fraseMeta(m, meta)}</Text>
      : null

    const piezas = [entrega, semestre, promedio, objetivo].filter(x => x !== null)
    // Nunca vacío: si todavía no hay nada que mostrar, se dice que está cargando.
    const pieza = piezas.length > 0
      ? piezas[(await read($, vista)) % piezas.length]
      : <Text dimColor>📌 cargando…</Text>
    // La pista del engine (p. ej. «esc to interrupt») se conserva delante, si la hay.
    const conPista = e.props.hint.replace(/·/g, '').trim() !== ''
    // Con letreros largos (« · » incluido) no quedaría sitio: la pista entera arriba y la pieza debajo.
    if (conPista && e.props.hint.trim().length + 3 + MIN_PIEZA > columnas) {
      return (
        <Box flexDirection="column">
          <Box flexShrink={0}>{linea}</Box>
          <Box width={columnas}>
            <Text wrap="truncate-end">{pieza}</Text>
          </Box>
        </Box>
      )
    }
    if (!conPista) {
      return (
        <Box flexDirection="row" width={columnas}>
          <Text wrap="truncate-end">{pieza}</Text>
        </Box>
      )
    }
    // El engine no acepta su línea bajo un Box con `width`: el ancho fijo va solo en la caja de la pieza,
    // con lo que deja la pista, y así el total sigue siendo `columnas`.
    return (
      <Box flexDirection="row">
        <Box flexShrink={0}>{linea}</Box>
        <Text dimColor> · </Text>
        <Box width={columnas - e.props.hint.trim().length - 3}>
          <Text wrap="truncate-end">{pieza}</Text>
        </Box>
      </Box>
    )
  })

  // Sobre el prompt, solo cuando hace falta: el corte desactualizado, las ventanas «🪟» que toca avisar
  // (las 3 que cierran primero), los parciales/sustentaciones/exámenes de la semana (📖, en violeta)
  // y el bloque ✍️ en curso.
  // Lo que dibujan otros mods ahí (la English note de ingles, la fila de image-preview) va primero,
  // encima de estos avisos: así el orden no depende de qué mod cargó antes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, tick)
    const ahora = await $.clock.now()
    const c = await read($, ctx)
    const corteMal = c !== null && c.esperado !== null && c.esperado !== c.corte
    const enCurso = (await read($, bloques)).find(x => x.inicio <= ahora && ahora < x.fin)
    const abiertas = ventanas(await read($, entregas), ahora)
    const examenes = evaluaciones(await read($, entregas), ahora, DIAS_EVALUACION)
    const todos = await read($, agenda)
    const actuales = eventosEnCurso(todos, ahora).slice(0, MAX_EN_CURSO)
    // Sin nada en curso, el que sigue (en las próximas 12 h que se leen)
    const siguiente = actuales.length === 0 ? proximo(todos, ahora) : null
    const derechos = actuales.length + (siguiente ? 1 : 0)
    if (!corteMal && !enCurso && abiertas.length === 0 && examenes.length === 0 && derechos === 0) return next(e)

    const otros = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    // Con espacio, entregas a la izquierda y evaluaciones a la derecha, en los mismos renglones;
    // en una terminal angosta, una lista debajo de la otra como antes.
    const dosColumnas = e.props.bodyColumns >= 110 && examenes.length + derechos > 0
    const mitad = Math.floor((e.props.bodyColumns - 2) / 2)
    const ancho = Math.max(20, e.props.bodyColumns - 40)
    // En dos columnas cada título cabe en su mitad, descontando lo que va antes y después de él.
    const anchoVentana = dosColumnas ? Math.max(16, mitad - 34) : ancho
    const anchoExamen = dosColumnas ? Math.max(16, mitad - 26) : ancho
    const renglonVentana = (v: (typeof abiertas)[number]) => {
      const titulo = recortar(v.titulo, anchoVentana)
      if (v.tipo === 'cierra') return <Text color="error">🔴 HOY cierra {titulo} (23:59) · sin ✅</Text>
      if (v.tipo === 'abrio') {
        const dias = diasHasta(v.cierra, ahora)
        return (
          <Text color="warning">
            📬 Abrió hoy: {titulo} · cierra {fechaCorta(v.cierra)} (en {dias} {dias === 1 ? 'día' : 'días'})
          </Text>
        )
      }
      return <Text color={NARANJA}>📬 {titulo} sigue sin ✅ · cierra en {restante(v.cierra - ahora)}</Text>
    }
    const renglonExamen = (x: (typeof examenes)[number]) => {
      const titulo = recortar(x.titulo, anchoExamen)
      const dias = diasHasta(x.cierra, ahora)
      if (dias === 0) return <Text bold color={VIOLETA}>📖 HOY: {titulo}</Text>
      if (dias === 1) return <Text color={VIOLETA}>📖 Mañana: {titulo}</Text>
      return <Text color={VIOLETA}>📖 {titulo} · {fechaCorta(x.cierra)} (en {dias} días)</Text>
    }
    // Cuánto del bloque ✍️ ya pasó, como la barra del sub-meter.
    const progreso = enCurso
      ? barra((ahora - enCurso.inicio) / (enCurso.fin - enCurso.inicio))
      : barra(0)
    // El evento en curso de cualquier calendario, con la barra del color de su calendario.
    const renglonActual = (x: Evento) => {
      const color = x.color ?? 'claude'
      const b = barra((ahora - x.inicio) / (x.fin - x.inicio), 14)
      return (
        <Text>
          <Text color={color}>{iconoCalendario(x.calendario)} {recortar(x.titulo, dosColumnas ? Math.max(14, mitad - 52) : ancho)}  {b.llena}</Text>
          <Text dimColor>{b.vacia}  {restante(ahora - x.inicio)} de {restante(x.fin - x.inicio)} · quedan {restante(x.fin - ahora)}</Text>
        </Text>
      )
    }
    const listaVentanas = [
      ...abiertas.slice(0, MAX_VENTANAS).map(renglonVentana),
      abiertas.length > MAX_VENTANAS
        ? <Text dimColor>   … y {abiertas.length - MAX_VENTANAS} más abiertas</Text>
        : null,
    ]
    const listaExamenes = [
      ...examenes.slice(0, MAX_VENTANAS).map(renglonExamen),
      examenes.length > MAX_VENTANAS
        ? <Text dimColor>… y {examenes.length - MAX_VENTANAS} evaluaciones más</Text>
        : null,
      ...actuales.map(renglonActual),
      siguiente
        ? (
          <Text>
            <Text dimColor>⏭️ Próximo: </Text>
            <Text color={siguiente.color ?? 'claude'}>
              {iconoCalendario(siguiente.calendario)} {recortar(siguiente.titulo, dosColumnas ? Math.max(14, mitad - 40) : ancho)}
            </Text>
            <Text dimColor> · {horaLocal(siguiente.inicio)} (en {restante(siguiente.inicio - ahora)})</Text>
          </Text>
          )
        : null,
    ]
    return (
      <Box flexDirection="column">
        {otros}
        {corteMal && c
          ? <Text color="error">⚠️ Por fecha ya es {c.esperado}: falta actualizar CORTE ACTIVO en el CLAUDE.md raíz.</Text>
          : null}
        {dosColumnas
          ? (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexDirection="column" width={mitad}>{listaVentanas}</Box>
              <Box flexDirection="column" width={mitad} alignItems="flex-end">{listaExamenes}</Box>
            </Box>
            )
          : null}
        {dosColumnas ? null : listaVentanas}
        {dosColumnas ? null : listaExamenes}
        {enCurso
          ? (
            <Text>
              <Text color="claude">✍️ {recortar(enCurso.titulo, Math.max(20, e.props.bodyColumns - 70))}  </Text>
              <Text color="claude">{progreso.llena}</Text>
              <Text dimColor>{progreso.vacia}</Text>
              <Text dimColor>
                {'  '}{restante(ahora - enCurso.inicio)} de {restante(enCurso.fin - enCurso.inicio)} · quedan {restante(enCurso.fin - ahora)}
              </Text>
            </Text>
            )
          : null}
      </Box>
    )
  })
}
