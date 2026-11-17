import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user'
import '@fortawesome/fontawesome-free/css/all.min.css'
import '@/styles/global.scss'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

const userStore = useUserStore(pinia)

// Destino real aunque la navegación siga pendiente cuando llega el 401.
let pendingPath: string | null = null
router.beforeEach((to) => {
  pendingPath = to.fullPath
})
router.afterEach(() => {
  pendingPath = null
})

// httpBase emite este evento al recibir un 401: la sesión caducó.
window.addEventListener('auth:token-expired', () => {
  if (!userStore.isLogged) return
  userStore.clear()
  const target = pendingPath ?? router.currentRoute.value.fullPath
  if (!router.currentRoute.value.meta.public) {
    router.replace({ name: 'Login', query: { next: target, expired: '1' } })
  }
})

// Sesión deslizante: al usar la app y al volver a la tablet.
router.afterEach(() => void userStore.refreshIfNeeded())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void userStore.refreshIfNeeded()
})

// Versión nueva publicada (16-nov-2026): la tableta con la app abierta no se
// enteraba. Se revisa cada 5 min y al volver a la app; se recarga al cambiar
// de pantalla (nunca a mitad de un formulario) o de inmediato en la entrada.
const loadedBuild =
  document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? ''
let newBuild = false
async function checkBuild() {
  if (!loadedBuild || newBuild) return
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text()
    newBuild = html.includes('/assets/index-') && !html.includes(loadedBuild)
  } catch {
    // Sin señal: se revisa la próxima vez.
  }
  if (newBuild && router.currentRoute.value.name === 'Login') window.location.reload()
}
setInterval(() => void checkBuild(), 5 * 60_000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkBuild()
})
router.beforeEach((to, from) => {
  if (!newBuild || !from.matched.length) return
  window.location.assign(to.fullPath)
  return false
})
// Tras publicar, una pantalla vieja pide archivos que ya no existen: se recarga.
window.addEventListener('vite:preloadError', () => window.location.reload())

app.mount('#app')
