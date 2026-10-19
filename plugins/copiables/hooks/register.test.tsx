// Pruebas del mod contra el engine: `claude plugin test <carpeta del mod>`
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const RESPUESTA = '📋 **Versión 1 — corta**\n\n```text\nTexto uno.\n```\n\n📋 **Versión 2**\n\n```text\nTexto dos.\n```'

/** Lo que está debajo del mod: el portapapeles y lo que dibuja el engine. */
function mundo (on: On) {
  const copiados: string[] = []
  on('ui.copy', ($, e) => {
    copiados.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return { copiados }
}

const responder = ($: Engine, answer: string) =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
const copiar = ($: Engine, args: string) => $.command.run({ command: 'copiar', args } as never)
const banda = ($: Engine) =>
  $.ui.mount({
    plugin: 'copiables',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 150 } as never,
    viewport: { columns: 160, rows: 40 },
  })

test('sin textos 📋 la banda es la del engine', async ($, on) => {
  mundo(on)
  await responder($, 'Una respuesta normal.')
  const ui = await banda($)
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /para copiar/ })).toBeUndefined()
})

test('una respuesta con 📋 deja la franja con cada versión, y lo de abajo intacto', async ($, on) => {
  mundo(on)
  await responder($, RESPUESTA)
  const ui = await banda($)
  expect(await ui.find({ type: 'Text', text: /2 textos para copiar/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Versión 1 — corta/ })).toBeDefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
})

test('/copiar 2 copia el segundo texto tal cual', async ($, on) => {
  const m = mundo(on)
  await responder($, RESPUESTA)
  const r = await copiar($, '2')
  expect(m.copiados).toEqual(['Texto dos.'])
  expect((r as { text: string }).text).toMatch(/Copiado: Versión 2/)
})

test('/copiar con un número que no existe no copia nada', async ($, on) => {
  const m = mundo(on)
  await responder($, RESPUESTA)
  const r = await copiar($, '5')
  expect(m.copiados).toEqual([])
  expect((r as { text: string }).text).toMatch(/\/copiar 1 a \/copiar 2/)
})

test('una respuesta nueva sin 📋 vacía la lista', async ($, on) => {
  const m = mundo(on)
  await responder($, RESPUESTA)
  await responder($, 'Otra cosa.')
  const r = await copiar($, '1')
  expect(m.copiados).toEqual([])
  expect((r as { text: string }).text).toMatch(/no tiene textos/)
})
