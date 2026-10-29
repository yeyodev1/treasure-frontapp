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

app.mount('#app')
