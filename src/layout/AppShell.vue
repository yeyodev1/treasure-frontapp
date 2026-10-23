<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import type { UserRole } from '@/types'
import BrandSeal from '@/components/ui/BrandSeal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { ROLE_HOME } from '@/router'

interface NavItem {
  to: string
  label: string
  icon: string
  roles: UserRole[]
}

interface NavSection {
  label: string
  items: NavItem[]
}

// Menú en tres grupos (guía visual V3): Operar / Controlar / Administrar.
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operar',
    items: [
      { to: '/', label: 'Bar', icon: 'fa-martini-glass-citrus', roles: ['admin', 'direccion', 'bartender'] },
      { to: '/cuentas', label: 'Cuentas', icon: 'fa-file-invoice-dollar', roles: ['admin', 'direccion', 'bartender'] },
    ],
  },
  {
    label: 'Controlar',
    items: [
      { to: '/admin/en-vivo', label: 'En vivo', icon: 'fa-tower-broadcast', roles: ['admin', 'direccion'] },
      { to: '/admin', label: 'Panel', icon: 'fa-chart-line', roles: ['admin', 'direccion'] },
      { to: '/admin/inventario', label: 'Inventario', icon: 'fa-boxes-stacked', roles: ['admin', 'bodega', 'direccion', 'bartender'] },
      { to: '/admin/pagos', label: 'Cobros', icon: 'fa-cash-register', roles: ['admin', 'direccion'] },
    ],
  },
  {
    label: 'Administrar',
    items: [
      { to: '/admin/salidas', label: 'Salidas', icon: 'fa-ship', roles: ['admin', 'direccion'] },
      { to: '/admin/productos', label: 'Catálogo', icon: 'fa-wine-bottle', roles: ['admin', 'bodega'] },
      { to: '/admin/equipo', label: 'Equipo', icon: 'fa-users', roles: ['admin'] },
    ],
  },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administración',
  direccion: 'Dirección de crucero',
  bartender: 'Bartender',
  bodega: 'Bodega',
}

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { muted, toggleMute, play } = useSound()

const drawerOpen = shallowRef(false)

const sections = computed(() =>
  NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => userStore.role && item.roles.includes(userStore.role),
    ),
  })).filter((section) => section.items.length),
)

const pageTitle = computed(() => (route.meta.title as string) ?? '')

const VIEW_AS_OPTIONS = [
  { value: 'admin', label: 'Mi vista (Administración)' },
  { value: 'direccion', label: 'Ver como Dirección' },
  { value: 'bartender', label: 'Ver como Bartender' },
  { value: 'bodega', label: 'Ver como Bodega' },
]

const viewAsModel = computed({
  get: () => userStore.viewAs ?? 'admin',
  set: (value: string) => {
    userStore.setViewAs(value as UserRole)
    const target = ROLE_HOME[(userStore.role ?? 'admin') as UserRole]
    router.push(target)
  },
})

function exitViewAs() {
  viewAsModel.value = 'admin'
}

const initials = computed(() => {
  const name = userStore.user?.name ?? ''
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
})

// Al navegar se cierra el drawer en pantallas pequeñas.
watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
  },
)

function onToggleMute() {
  toggleMute()
  if (!muted.value) play('tap')
}

async function logout() {
  const ok = await confirmStore.ask({
    title: '¿Cerrar sesión?',
    message: 'Tu sesión en esta tablet o dispositivo se cerrará y volverás a la pantalla de ingreso.',
    confirmLabel: 'Salir',
    icon: 'fa-arrow-right-from-bracket',
  })
  if (!ok) return
  userStore.clear()
  router.replace({ name: 'Login' })
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-left">
        <button
          class="menu-btn"
          type="button"
          :aria-label="drawerOpen ? 'Cerrar menú' : 'Abrir menú'"
          @click="drawerOpen = !drawerOpen"
        >
          <i class="fa-solid" :class="drawerOpen ? 'fa-xmark' : 'fa-bars'" aria-hidden="true" />
        </button>
        <div class="brand">
          <BrandSeal :size="40" variant="cream" class="brand-seal" />
          <span class="brand-text">
            <span class="brand-eyebrow">Treasure of Galápagos</span>
            <span class="brand-page">{{ pageTitle }}</span>
          </span>
        </div>
      </div>

      <div class="session">
        <button
          class="icon-btn"
          type="button"
          :aria-label="muted ? 'Activar sonidos' : 'Silenciar sonidos'"
          :title="muted ? 'Activar sonidos' : 'Silenciar sonidos'"
          @click="onToggleMute"
        >
          <i class="fa-solid" :class="muted ? 'fa-volume-xmark' : 'fa-volume-high'" aria-hidden="true" />
        </button>
        <button class="session-out" type="button" @click="logout">
          <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
          <span class="session-out-label">Salir</span>
        </button>
      </div>
    </header>

    <div class="body">
      <Transition name="fade">
        <div v-if="drawerOpen" class="scrim" @click="drawerOpen = false" />
      </Transition>

      <nav class="sidenav" :class="{ 'sidenav--open': drawerOpen }">
        <div class="sidenav-sections">
          <div v-for="section in sections" :key="section.label" class="nav-section">
            <p class="nav-section-label">{{ section.label }}</p>
            <RouterLink
              v-for="item in section.items"
              :key="item.to"
              :to="item.to"
              class="nav-item"
            >
              <span class="nav-indicator" aria-hidden="true" />
              <i class="fa-solid nav-icon" :class="item.icon" aria-hidden="true" />
              <span class="nav-label">{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>

        <div class="sidenav-bottom">
          <div v-if="userStore.isRealAdmin" class="view-as">
            <p class="view-as-label">
              <i class="fa-solid fa-eye" aria-hidden="true" /> Ver la app como
            </p>
            <BaseSelect v-model="viewAsModel" :options="VIEW_AS_OPTIONS" />
          </div>

          <div class="sidenav-user">
            <span class="user-avatar">{{ initials }}</span>
            <span class="user-info">
              <span class="user-name">{{ userStore.user?.name }}</span>
              <span class="user-role">
                {{ userStore.realRole ? ROLE_LABELS[userStore.realRole] : '' }}
              </span>
            </span>
          </div>
        </div>
      </nav>

      <main class="content">
        <!-- Aviso cuando administración está mirando la app como otro rol.
             Vive dentro del contenido para no desplazar el sidebar. -->
        <Transition name="fade">
          <div v-if="userStore.isRealAdmin && userStore.viewAs" class="viewing-as">
            <i class="fa-solid fa-eye" aria-hidden="true" />
            <span>
              Estás viendo la app como
              <strong>{{ ROLE_LABELS[userStore.viewAs] }}</strong>
            </span>
            <button type="button" class="viewing-as-exit" @click="exitViewAs">
              Volver a mi vista
            </button>
          </div>
        </Transition>
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: var(--navy-800);
  border-bottom: 3px solid var(--gold-500);
  color: var(--cream-100);
  box-sizing: border-box;
  height: calc(var(--header-h) + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 0.75rem 0;
  position: sticky;
  top: 0;
  z-index: 30;
}

.shell {
  --header-h: 64px;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.menu-btn {
  @include touch-target;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--cream-100);
  font-size: 1.1rem;
  transition: background 0.15s ease, transform 0.15s ease;

  &:hover {
    background: rgba(247, 243, 233, 0.08);
  }

  &:active {
    transform: scale(0.94);
  }

  @include desktop {
    display: none;
  }
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.brand-seal {
  color: var(--gold-500);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

// La marca completa en pequeño arriba (nunca truncada) y la vista
// actual como título principal: se lee de un vistazo en cualquier pantalla.
.brand-eyebrow {
  font-size: 0.56rem;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--powder-300);
  white-space: nowrap;

  @include tablet {
    font-size: 0.62rem;
  }
}

.brand-page {
  font-family: var(--font-serif);
  font-size: 1.12rem;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @include tablet {
    font-size: 1.2rem;
  }
}

.session {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

.icon-btn {
  @include touch-target;
  min-width: 40px;
  min-height: 40px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--cream-200);
  transition: background 0.15s ease, transform 0.15s ease;

  &:hover {
    background: rgba(247, 243, 233, 0.08);
  }

  &:active {
    transform: scale(0.94);
  }
}

.session-out {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-width: 40px;
  min-height: 40px;
  border: 1px solid rgba(247, 243, 233, 0.3);
  border-radius: var(--radius-sm);
  padding: 0.38rem 0.6rem;
  color: var(--cream-100);
  font-weight: 600;
  font-size: 0.85rem;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: rgba(247, 243, 233, 0.08);
    border-color: var(--gold-500);
  }

  @include tablet {
    padding: 0.38rem 0.8rem;
  }
}

.session-out-label {
  display: none;

  @include tablet {
    display: inline;
  }
}

.body {
  display: flex;
  flex: 1;
  position: relative;
}

.scrim {
  position: fixed;
  inset: 0;
  background: rgba(15, 29, 22, 0.5);
  backdrop-filter: blur(1.5px);
  z-index: 24;

  @include desktop {
    display: none;
  }
}

// Sidebar en todos los dispositivos: drawer deslizante en pantallas
// pequeñas, columna fija en escritorio.
.sidenav {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 250px;
  padding: calc(var(--header-h) + 12px + env(safe-area-inset-top)) 0.8rem 1rem;
  background: var(--surface);
  border-right: 1px solid var(--cream-200);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1rem;
  z-index: 25;
  transform: translateX(-100%);
  transition: transform 0.24s cubic-bezier(0.32, 0.72, 0.25, 1);
  overflow-y: auto;

  &--open {
    transform: translateX(0);
    box-shadow: var(--shadow-lg);
  }

  @include desktop {
    position: sticky;
    top: var(--header-h);
    height: calc(100dvh - var(--header-h));
    transform: none;
    box-shadow: none;
    padding-top: 1.1rem;
  }
}

.sidenav-sections {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.nav-section-label {
  margin: 0 0 0.3rem;
  padding: 0 0.8rem;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-400);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.62rem 0.8rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.93rem;
  color: var(--ink-600);
  transition: background 0.15s ease, color 0.15s ease;

  & + & {
    margin-top: 0.15rem;
  }

  .nav-indicator {
    position: absolute;
    left: 0;
    top: 22%;
    bottom: 22%;
    width: 3px;
    border-radius: 3px;
    background: var(--gold-500);
    opacity: 0;
    transform: scaleY(0.4);
    transition: opacity 0.18s ease, transform 0.18s ease;
  }

  &.router-link-exact-active {
    background: var(--navy-800);
    color: var(--cream-100);

    .nav-icon {
      color: var(--gold-500);
    }

    .nav-indicator {
      opacity: 1;
      transform: scaleY(1);
    }
  }

  &:hover:not(.router-link-exact-active) {
    background: var(--cream-200);
  }
}

.nav-icon {
  width: 1.25rem;
  text-align: center;
  font-size: 0.95rem;
  color: var(--ink-400);
  transition: color 0.15s ease;
}

.viewing-as {
  position: sticky;
  top: calc(var(--header-h) + env(safe-area-inset-top));
  z-index: 23;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem max(16px, env(safe-area-inset-left, 0px));
  background: rgba(192, 138, 62, 0.16);
  border-bottom: 1px solid var(--warning);
  color: var(--navy-900);
  font-size: 0.85rem;

  i {
    color: var(--warning);
  }
}

.viewing-as-exit {
  margin-left: auto;
  font-weight: 700;
  font-size: 0.8rem;
  color: var(--navy-700);
  text-decoration: underline;
  white-space: nowrap;
}

.sidenav-bottom {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.view-as {
  padding: 0 0.2rem;
}

.view-as-label {
  margin: 0 0 0.35rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-400);

  i {
    margin-right: 0.25rem;
    color: var(--gold-500);
  }
}

.sidenav-user {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.6rem;
  border-top: 1px solid var(--cream-200);
}

.user-avatar {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: var(--gold-400);
  font-family: var(--font-serif);
  font-size: 0.95rem;
  flex-shrink: 0;
}

.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.user-name {
  font-weight: 600;
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 0.72rem;
  color: var(--ink-400);
}

.content {
  flex: 1;
  min-width: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
