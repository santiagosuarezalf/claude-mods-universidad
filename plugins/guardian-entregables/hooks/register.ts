import type { EngineInterface, Register } from 'claude-code'

import { codigos, revisar } from './reglas'

/** companeros.md del semestre activo, buscado desde el CLAUDE.md raíz que tiene el puntero. */
async function conocidos ($: EngineInterface, ruta: string, propio: string) {
  const encontrados = await $.fs.ancestors({ names: ['CLAUDE.md'], of: ruta })
  const raiz = [...encontrados].reverse().find(f => /SEMESTRE ACTIVO: `/.test(f.content))
  const semestre = raiz ? /SEMESTRE ACTIVO: `([^`]+)`/.exec(raiz.content)?.[1] : undefined
  if (!raiz || !semestre) return null
  const md = await $.fs.read(`${raiz.dir}/${semestre}/companeros.md`).catch(() => '')
  return codigos(md, propio)
}

export const register: Register = (on, options) => {
  const propio = String(options.codigo ?? '').trim()

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!e.file_path.includes('/Entregables/')) return next(e)
    if (await $.fs.exists(e.file_path)) return next(e) // reescribir una entrega existente no cambia su nombre
    const lista = await conocidos($, e.file_path, propio)
    if (lista === null) return next(e) // fuera de la carpeta de la carrera
    const motivo = revisar(e.file_path, lista, propio)
    return motivo === null ? next(e) : { deny: `guardian-entregables: ${motivo}` }
  }).catch(($, e, next) => next(e)) // si el guardián falla, no estorba
}
