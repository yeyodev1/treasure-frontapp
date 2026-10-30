import { shallowRef } from 'vue'
import type { Router } from 'vue-router'

/**
 * Aviso de versión nueva: cada build publica /version.json con su
 * identificador; la app lo consulta cada minuto y al volver a primer plano.
 * Si cambió, ofrece actualizar (recargar). Lo pendiente de enviar vive en
 * localStorage, así que recargar no pierde nada.
 */
const CHECK_EVERY_MS = 60_000
const SNOOZE_MS = 10 * 60_000

const available = shallowRef(false)
const snoozedUntil = shallowRef(0)
let started = false

async function check() {
  if (available.value) return
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const { version } = (await res.json()) as { version?: string }
    if (version && version !== __APP_VERSION__) available.value = true
  } catch {
    // Sin conexión: se vuelve a intentar en la próxima consulta.
  }
}

function start(router: Router) {
  if (started || import.meta.env.DEV) return
  started = true
  check()
  setInterval(check, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
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
    start,
    update: () => window.location.reload(),
    later: () => {
      snoozedUntil.value = Date.now() + SNOOZE_MS
    },
  }
}
