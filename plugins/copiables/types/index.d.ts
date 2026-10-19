/** Un texto para copiar: el título que va después del 📋 y lo que hay dentro del bloque. */
export type Bloque = { titulo: string; texto: string }

declare module 'claude-code' {
  interface PluginState {
    copiables: {
      bloques: Bloque[]
    }
  }
}
