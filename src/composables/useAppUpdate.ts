import { shallowRef } from 'vue'
import type { Router } from 'vue-router'

/**
 * Aviso de versión nueva: cada build publica /version.json con su
 * identificador; la app lo consulta cada 30 s, al cambiar de pantalla y al
 * volver a la app (también cuando la tableta la restaura de memoria). Si
 * cambió, pide actualizar (recargar). Lo pendiente de enviar vive en
 * localStorage, así que recargar no pierde nada.
 */
const CHECK_EVERY_MS = 30_000
const SNOOZE_MS = 3 * 60_000
const SEEN_KEY = 'treasure-app-version'

const available = shallowRef(false)
const snoozedUntil = shallowRef(0)
/** Se acaba de aplicar una versión nueva (se confirma con un aviso). */
const justUpdated = shallowRef(false)
let started = false

/** Fecha y hora del build en Galápagos ("8 nov, 10:27"): para saber qué versión se tiene. */
export const builtAtLabel = (() => {
  const d = new Date(new Date(__APP_BUILT__).getTime() - 6 * 3600e3)
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
})()

/** true si en el servidor hay una versión distinta de la que corre. */
async function check(): Promise<boolean> {
  if (available.value) return true
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const { version } = (await res.json()) as { version?: string }
    if (version && version !== __APP_VERSION__) available.value = true
  } catch {
    // Sin conexión: se vuelve a intentar en la próxima consulta.
  }
  return available.value
}

function start(router: Router) {
  if (started || import.meta.env.DEV) return
  started = true
  try {
    const seen = localStorage.getItem(SEEN_KEY)
    if (seen && seen !== __APP_VERSION__) justUpdated.value = true
    localStorage.setItem(SEEN_KEY, __APP_VERSION__)
  } catch {
    // Sin almacenamiento: solo no se confirma la actualización.
  }
  check()
  setInterval(check, CHECK_EVERY_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  window.addEventListener('online', onVisible)
  // La tableta restaura la página de memoria sin recargarla.
  window.addEventListener('pageshow', onVisible)
  router.afterEach(() => {
    check()
  })
  // Una pantalla de la versión anterior ya no existe en el servidor: es
  // señal segura de que hay versión nueva.
  router.onError((err) => {
    const message = String((err as Error)?.message ?? err)
    if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message)) {
      available.value = true
      snoozedUntil.value = 0
    }
  })
}

export function useAppUpdate() {
  return {
    available,
    snoozedUntil,
    justUpdated,
    start,
    /** Buscar a mano: si hay versión nueva, el aviso aparece aunque se haya pospuesto. */
    checkNow: async () => {
      snoozedUntil.value = 0
      return check()
    },
    update: () => window.location.reload(),
    later: () => {
      snoozedUntil.value = Date.now() + SNOOZE_MS
    },
  }
}
