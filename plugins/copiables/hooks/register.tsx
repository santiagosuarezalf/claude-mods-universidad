import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Bloque } from '../types'
import { adelanto, extraerBloques } from './bloques'

const bloques = atom({ plugin: 'copiables', key: 'bloques' } as const, [] as Bloque[])

export const register: Register = (on, options) => {
  // Una opción sin configurar puede llegar vacía: entonces vale el valor por defecto.
  const color = String(options.color || 'yellow')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'copiar',
      description: 'Copia al portapapeles el texto 📋 número N de la última respuesta (/copiar 2)',
    })
    return next(e)
  })

  // Cada respuesta de la conversación principal cambia la lista; una sin textos 📋 la vacía, como /copy.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      const nuevos = extraerBloques(e.answer)
      await update($, bloques, () => nuevos)
    }
    return next(e)
  })

  on('command.run', { command: 'copiar' }, async ($, e) => {
    const lista = await read($, bloques)
    if (lista.length === 0) return { text: 'La última respuesta no tiene textos 📋 para copiar.' }

    const pedido = e.args.trim()
    const n = pedido === '' && lista.length === 1 ? 1 : Number.parseInt(pedido, 10)
    if (!Number.isInteger(n) || n < 1 || n > lista.length) {
      const cuales = lista.length === 1 ? '/copiar 1' : `/copiar 1 a /copiar ${lista.length}`
      return { text: `Escribe el número del texto: ${cuales}.` }
    }

    const elegido = lista[n - 1]
    const r = await $.ui.copy({ text: elegido.texto })
    if (!r.isCopied) return { text: `No se pudo copiar (${r.reason}). Prueba con /copy.` }
    return { text: `✓ Copiado: ${elegido.titulo} (${elegido.texto.length} caracteres). Pégalo con ⌘V.` }
  })

  // Encima de lo que haya sobre el prompt (la nota de inglés, el renglón ✍️), que sigue debajo intacto.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const lista = await read($, bloques)
    if (lista.length === 0) return next(e)

    const otros = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const atajo = lista.length === 1 ? '/copiar' : lista.map((_, i) => `/copiar ${i + 1}`).join(' · ')
    return (
      <Box flexDirection="column">
        <Text color={color} bold>
          📋 {lista.length === 1 ? '1 texto para copiar' : `${lista.length} textos para copiar`}
        </Text>
        {lista.map((b, i) => (
          <Text key={`b${i}`} color={color}>
            {'  '}{i + 1} · {b.titulo}{'  '}
            <Text color={color} italic>«{adelanto(b.texto)}»</Text>
          </Text>
        ))}
        <Text dimColor>{'  '}{atajo}   (o /copy y eliges)</Text>
        {otros}
      </Box>
    )
  })
}
