// Pruebas del pie, contra el engine: `claude plugin test plugins/carrera`
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const AHORA = Date.parse('2026-10-18T15:00:00-05:00') // un domingo a las 3 p. m., UTC−5
const RAIZ = '/carrera'
const CLAUDE_RAIZ = '> **SEMESTRE ACTIVO: `2nd SEMESTER`**\n> **CORTE ACTIVO: `CORTE II`**\n'
const CLAUDE_SEMESTRE = '16 semanas de clase\n| CORTE I | 28 jul – 5 sep |\n| CORTE II | 7 sep – 24 oct |\n| CORTE III | 26 oct – 21 nov |\n'
const NOTAS = '| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |\n|---|---|---|---|---|\n| DPOO | | | 27 | |\n'
const EVENTOS = [
  { summary: '✍️ Hacer: ajedrez funcional', start: { dateTime: '2026-10-18T13:00:00-05:00' }, end: { dateTime: '2026-10-18T18:00:00-05:00' } },
  { summary: 'Semana 11', start: { date: '2026-10-12T00:00:00Z' }, end: { date: '2026-10-19T00:00:00Z' }, transparency: 'transparent' },
  { summary: 'Entrega proyecto ajedrez', start: { date: '2026-10-19T00:00:00Z' }, end: { date: '2026-10-20T00:00:00Z' } },
]

/** Lo que está debajo del mod: reloj, store con eventos guardados, archivos de la carrera y el engine. */
function mundo (on: On) {
  const clock = mock.clock(on, { now: AHORA })
  const store: Record<string, unknown> = { eventos: EVENTOS }
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.ancestors', () => ({ value: [{ dir: RAIZ, name: 'CLAUDE.md', content: CLAUDE_RAIZ }] }) as never)
  on('fs.read', ($, e) => {
    const archivos: Record<string, string> = {
      [`${RAIZ}/2nd SEMESTER/CLAUDE.md`]: CLAUDE_SEMESTRE,
      [`${RAIZ}/2nd SEMESTER/NOTAS.md`]: NOTAS,
    }
    const ruta = (e as { path: string }).path
    return (ruta in archivos ? { value: archivos[ruta] } : { deny: 'no existe' }) as never
  })
  on('mcp.call', () => ({ value: { isError: true, content: [] } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return 'hint' in e.props ? <Text>{e.props.hint}</Text> : <Box key="engine" />
  })
  return { clock, store }
}

const abrir = ($: Engine) => $.session.start({ cwd: RAIZ, surface: 'terminal', isInteractive: true })
// Un terminal de 160 columnas, más o menos el ancho de la pantalla de Santiago.
const pie = ($: Engine, hint = '') =>
  $.ui.mount({
    plugin: 'carrera',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint },
    viewport: { columns: 160, rows: 40 },
  })

/** El texto plano de todo lo que dibujó el pie. */
async function texto (ui: Awaited<ReturnType<typeof pie>>) {
  return (await ui.find({ type: 'Box' }))?.text ?? ''
}

test('el pie muestra una cosa a la vez y rota cada 5 s entre 📌, 🗓️, 🎓 y 🎯', async ($, on) => {
  const m = mundo(on)
  await abrir($)
  await m.clock.advance(100)
  const vistos: string[] = []
  for (let i = 0; i < 4; i++) {
    const ui = await pie($)
    vistos.push(await texto(ui))
    await ui.unmount()
    await m.clock.advance(5000)
  }
  expect(vistos.some(t => t.includes('📌') && t.includes('Próxima entrega: proyecto ajedrez · cierra en'))).toBe(true)
  expect(vistos.some(t => t.endsWith('🗓️ 2º semestre · CORTE II · semana 11 de 16 · faltan 35 días'))).toBe(true)
  expect(vistos.some(t => t.includes('🎓 Promedio aprox. 9,00 · meta de beca 9,3 (faltan 0,30) · calculado con 1 de 1 materias'))).toBe(true)
  // Una sola cosa por vez
  expect(vistos.some(t => t.startsWith('🎯 Para 9,3: necesitas'))).toBe(true)
  for (const t of vistos) expect([t.includes('📌'), t.includes('🗓️'), t.includes('🎓'), t.includes('🎯')].filter(Boolean).length).toBe(1)
})

test('el pie ocupa un solo renglón y un ancho fijo', async ($, on) => {
  mundo(on)
  await abrir($)
  const ui = await pie($)
  const raiz = await ui.drawn() as unknown as { type: string; props: { flexDirection?: string; width?: number } }
  expect(raiz.props.flexDirection).toBe('row')
  expect(typeof raiz.props.width).toBe('number')
})

test('si hay una pista del engine, la conserva delante', async ($, on) => {
  mundo(on)
  await abrir($)
  const ui = await pie($, 'esc to interrupt')
  expect(await texto(ui)).toContain('esc to interrupt')
  // El engine rechaza su línea bajo un Box con `width` («engine node under a Box with prop "width"»)
  const raiz = await ui.drawn() as unknown as { props: { width?: number } }
  expect(raiz.props.width).toBeUndefined()
})

test('con letreros largos del engine, la pieza baja a un renglón propio y no se esconde', async ($, on) => {
  const m = mundo(on)
  await abrir($)
  await m.clock.advance(100)
  const letreros = 'esc to interrupt · ctrl+t to hide tasks · Update available! Run: claude update · Context left until auto-compact: 9%'
  const ui = await pie($, letreros)
  const raiz = await ui.drawn() as unknown as { props: { flexDirection?: string } }
  expect(raiz.props.flexDirection).toBe('column')
  const t = await texto(ui)
  expect(t).toContain(letreros)
  expect(['📌', '🗓️', '🎓', '🎯'].some(x => t.includes(x))).toBe(true)
})

test('en la banda sobre el prompt, lo de otros mods va encima del bloque ✍️', async ($, on) => {
  const m = mundo(on)
  await abrir($)
  await m.clock.advance(100)
  const ui = await $.ui.mount({
    plugin: 'carrera',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 150 } as never,
    viewport: { columns: 160, rows: 40 },
  })
  const raiz = await ui.find({ type: 'Box' })
  const hijos = (raiz?.children ?? []) as { type?: string; props?: { key?: string } }[]
  expect(hijos[0]?.props?.key).toBe('engine')
  expect(raiz?.text).toContain('✍️ ajedrez funcional')
})

/** Monta la banda sobre el prompt de carrera, en un terminal de 160 columnas. */
const bandaCarrera = ($: Engine) =>
  $.ui.mount({
    plugin: 'carrera',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 150 } as never,
    viewport: { columns: 160, rows: 40 },
  })

test('las ventanas «🪟» salen en la banda: máximo 3, la que cierra primero arriba, y el resto contado', async ($, on) => {
  const m = mundo(on)
  // Cinco entregas abiertas que ya pasaron la mitad de su ventana (hoy es dom 18 oct)
  m.store.eventos = [
    ...EVENTOS,
    ...[19, 20, 21, 22, 23].map(d => ({
      summary: `Taller ${d}`,
      description: '🪟 Abre: 2026-10-10',
      start: { date: `2026-10-${d}` },
      end: { date: `2026-10-${d + 1}` },
    })),
  ]
  await abrir($)
  await m.clock.advance(100)
  const ui = await bandaCarrera($)
  const texto = (await ui.find({ type: 'Box' }))?.text ?? ''
  expect(texto).toContain('📬 Taller 19 sigue sin ✅')
  expect(texto).toContain('📬 Taller 21 sigue sin ✅')
  expect(texto).not.toContain('Taller 22')
  expect(texto).toContain('… y 2 más abiertas')
  expect(texto.indexOf('Taller 19')).toBeLessThan(texto.indexOf('Taller 20'))
  // El ✍️ sigue debajo de las ventanas
  expect(texto.indexOf('… y 2 más')).toBeLessThan(texto.indexOf('✍️'))
})

test('el día que abre y el día que cierra', async ($, on) => {
  const m = mundo(on)
  m.store.eventos = [
    { summary: 'Quiz U3', description: '🪟 Abre: 2026-10-18', start: { date: '2026-10-25' }, end: { date: '2026-10-26' } },
    { summary: 'Taller final', description: '🪟 Abre: 2026-10-12', start: { date: '2026-10-18' }, end: { date: '2026-10-19' } },
  ]
  await abrir($)
  await m.clock.advance(100)
  const texto = (await (await bandaCarrera($)).find({ type: 'Box' }))?.text ?? ''
  expect(texto).toContain('🔴 HOY cierra Taller final (23:59) · sin ✅')
  expect(texto).toContain('📬 Abrió hoy: Quiz U3 · cierra dom 25 oct (en 7 días)')
})

test('/notas responde con la tabla por materia y cuánto falta', async ($, on) => {
  mundo(on)
  await abrir($)
  const r = await $.command.run({ command: 'notas' } as never) as { text?: string }
  expect(r.text).toContain('🎓 Beca — meta 9,3')
  expect(r.text).toContain('DPOO')
  expect(r.text).toContain('🎯 Para 9,3')
})

test('parciales, sustentaciones y exámenes salen en la banda con 📖, aparte de las entregas 📬', async ($, on) => {
  const m = mundo(on)
  m.store.eventos = [
    { summary: 'PARCIAL Corte II — Teoría de la Computación (AVA, 18:00–20:00)', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } },
    { summary: 'Sustentación proyecto', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
    { summary: 'Examen hoy', start: { date: '2026-10-18' }, end: { date: '2026-10-19' } },
    { summary: '✅ Parcial ya presentado', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } },
    { summary: 'Taller final', description: '🪟 Abre: 2026-10-12', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } },
  ]
  await abrir($)
  await m.clock.advance(100)
  const texto = (await (await bandaCarrera($)).find({ type: 'Box' }))?.text ?? ''
  expect(texto).toContain('📖 HOY: Examen hoy')
  expect(texto).toContain('📖 Mañana: PARCIAL Corte II — Teoría de la Computación')
  expect(texto).toContain('📖 Sustentación proyecto · jue 22 oct (en 4 días)')
  expect(texto).not.toContain('ya presentado')
  // Las entregas 📬 van primero, los 📖 después
  expect(texto.indexOf('📬 Taller final')).toBeLessThan(texto.indexOf('📖'))
})

type Nodo = { type?: string; text?: string; props?: { flexDirection?: string; alignItems?: string }; children?: unknown[] }
/** La caja en fila (las dos columnas) dentro del árbol dibujado, si la hay. */
function filaDeDos (n: unknown): Nodo | undefined {
  if (!n || typeof n !== 'object') return undefined
  const nodo = n as Nodo
  if (nodo.type === 'Box' && nodo.props?.flexDirection === 'row') return nodo
  for (const h of nodo.children ?? []) {
    const f = filaDeDos(h)
    if (f) return f
  }
  return undefined
}

test('con entregas y evaluaciones, van en dos columnas: 📬 a la izquierda y 📖 a la derecha', async ($, on) => {
  const m = mundo(on)
  m.store.eventos = [
    { summary: 'PARCIAL Corte II — Teoría', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } },
    { summary: 'Taller final', description: '🪟 Abre: 2026-10-12', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } },
  ]
  await abrir($)
  await m.clock.advance(100)
  const ui = await bandaCarrera($)
  const fila = filaDeDos(await ui.find({ type: 'Box' }))
  expect(fila).toBeDefined()
  const [izq, der] = (fila?.children ?? []) as Nodo[]
  const plano = (n: unknown): string =>
    typeof n === 'string' ? n : ((n as Nodo)?.children ?? []).map(plano).join('')
  expect(plano(izq)).toContain('📬 Taller final')
  expect(plano(der)).toContain('📖 Mañana: PARCIAL Corte II')
  expect(der?.props?.alignItems).toBe('flex-end')
})

test('en una terminal angosta siguen una debajo de la otra', async ($, on) => {
  const m = mundo(on)
  m.store.eventos = [
    { summary: 'PARCIAL Corte II — Teoría', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } },
    { summary: 'Taller final', description: '🪟 Abre: 2026-10-12', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } },
  ]
  await abrir($)
  await m.clock.advance(100)
  const ui = await $.ui.mount({
    plugin: 'carrera',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 90 } as never,
    viewport: { columns: 100, rows: 40 },
  })
  expect(filaDeDos(await ui.find({ type: 'Box' }))).toBeUndefined()
  const texto = (await ui.find({ type: 'Box' }))?.text ?? ''
  expect(texto.indexOf('📬 Taller final')).toBeLessThan(texto.indexOf('📖'))
})

test('el bloque ✍️ en curso lleva una barra de lo que ya pasó, con el tiempo hecho y el total', async ($, on) => {
  const m = mundo(on)
  await abrir($)
  await m.clock.advance(100)
  const texto = (await (await bandaCarrera($)).find({ type: 'Box' }))?.text ?? ''
  expect(texto).toContain('✍️ ajedrez funcional')
  expect(texto).toMatch(/━*─+/)
  expect(texto).toMatch(/de 5h 0m · quedan/)
})
