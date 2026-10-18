export type Entrega = { titulo: string; cierra: number }
export type Bloque = { titulo: string; inicio: number; fin: number }
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
      semana: number | null
      contexto: Contexto | null
      beca: Beca | null
      tick: number
      vista: number
      cargado: boolean
    }
  }
}
