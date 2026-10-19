/** `abre`: el inicio del día de la línea «🪟 Abre: AAAA-MM-DD» de la descripción, o null si no la trae. */
export type Entrega = { titulo: string; cierra: number; abre: number | null }
/** Una entrega con ventana que toca avisar: el día que abre, desde la mitad sin ✅ y el día que cierra. */
export type Ventana = { titulo: string; cierra: number; tipo: 'abrio' | 'sigue' | 'cierra' }
/** Una materia de NOTAS.md: lo que lleva sobre 10 y lo máximo a lo que puede llegar si saca todo lo que falta. */
export type MateriaNota = { materia: string; celdas: (string | null)[]; lleva: number | null; maximo: number }
/**
 * Cuánto falta para la meta, en puntos de corte (cada materia vale 100 puntos: 30 + 30 + 40).
 * `necesita` y `quedan` van ponderados por créditos cuando todas las materias los tienen.
 */
export type Meta = {
  materias: MateriaNota[]
  necesita: number
  quedan: number
  maximo: number
  ponderado: boolean
}
export type Bloque = { titulo: string; inicio: number; fin: number }
/** Un evento con hora de cualquier calendario, con el color con que Google Calendar lo pinta. */
export type Evento = { titulo: string; calendario: string; color: string | null; inicio: number; fin: number }
export type Contexto = {
  semestre: string
  corte: string
  esperado: string | null
  finClases: number | null
  semanas: number | null
}
export type Beca = { promedio: number | null; materias: number; total: number; aproximado: boolean }

declare module 'claude-code' {
  interface PluginState {
    carrera: {
      entregas: Entrega[]
      bloques: Bloque[]
      agenda: Evento[]
      semana: number | null
      contexto: Contexto | null
      beca: Beca | null
      meta: Meta | null
      tick: number
      vista: number
      cargado: boolean
    }
  }
}
