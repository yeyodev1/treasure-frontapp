<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import type { UserRole } from '@/types'
import BrandSeal from '@/components/ui/BrandSeal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { REGISTROS_URL, ROLE_HOME } from '@/router'

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
      { to: '/', label: 'Bar', icon: 'fa-martini-glass-citrus', roles: ['duena', 'direccion', 'bartender'] },
      { to: '/cuentas', label: 'Cuentas', icon: 'fa-file-invoice-dollar', roles: ['duena', 'direccion', 'bartender'] },
      { to: '/abastecimiento', label: 'Abastecimiento', icon: 'fa-dolly', roles: ['duena', 'admin', 'direccion', 'bartender', 'bodega'] },
      { to: '/bodega', label: 'Bodega', icon: 'fa-warehouse', roles: ['duena', 'admin', 'bodega', 'direccion'] },
    ],
  },
  {
    label: 'Controlar',
    items: [
      { to: '/admin/en-vivo', label: 'En vivo', icon: 'fa-tower-broadcast', roles: ['duena', 'admin', 'direccion'] },
      { to: '/admin', label: 'Resumen del negocio', icon: 'fa-chart-line', roles: ['duena'] },
      { to: '/admin/inventario', label: 'Inventario', icon: 'fa-boxes-stacked', roles: ['duena', 'admin', 'bodega', 'direccion'] },
      { to: '/admin/pagos', label: 'Cobros', icon: 'fa-cash-register', roles: ['duena', 'admin', 'direccion'] },
    ],
  },
  {
    label: 'Administrar',
    items: [
      { to: '/admin/salidas', label: 'Cruceros', icon: 'fa-ship', roles: ['duena', 'admin', 'direccion'] },
      { to: '/admin/productos', label: 'Catálogo', icon: 'fa-wine-bottle', roles: ['duena', 'admin', 'bodega'] },
      { to: '/admin/equipo', label: 'Equipo', icon: 'fa-users', roles: ['duena'] },
    ],
  },
]

const ROLE_LABELS: Record<UserRole, string> = {
  duena: 'Gerencia',
  admin: 'Administración',
  direccion: 'Dirección de crucero',
  bartender: 'Bartender',
  bodega: 'Bodega',
  capitan: 'Capitán',
  tripulante: 'Tripulación',
  designada: 'Persona Designada',
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

// Tableta y celular: las secciones van siempre arriba, a la vista (la
// tripulación no encontraba el menú escondido tras el botón de tres rayas).
const topItems = computed(() => sections.value.flatMap((section) => section.items))
const topnav = useTemplateRef<HTMLElement>('topnav')

function revealActiveTab() {
  nextTick(() => {
    const active = topnav.value?.querySelector<HTMLElement>('.topnav-item.router-link-exact-active')
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  })
}

const pageTitle = computed(() => (route.meta.title as string) ?? '')

/** En el bar el menú lateral se recoge a íconos: la tableta necesita el ancho. */
const railMode = computed(() => route.name === 'Bar')

const VIEW_AS_OPTIONS = [
  { value: 'duena', label: 'Mi vista (Gerencia)' },
  { value: 'admin', label: 'Ver como Administración' },
  { value: 'direccion', label: 'Ver como Dirección de crucero' },
  { value: 'bartender', label: 'Ver como Bartender' },
  { value: 'bodega', label: 'Ver como Bodega' },
]

const viewAsModel = computed({
  get: () => userStore.viewAs ?? 'duena',
  set: (value: string) => {
    userStore.setViewAs(value as UserRole)
    const target = ROLE_HOME[(userStore.role ?? 'duena') as UserRole]
    router.push(target)
  },
})

function exitViewAs() {
  viewAsModel.value = 'duena'
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
    revealActiveTab()
  },
  { immediate: true },
)

function onToggleMute() {
  toggleMute()
  if (!muted.value) play('tap')
}

async function logout() {
  const ok = await confirmStore.ask({
    title: '¿Cerrar sesión?',
    message: 'Tu sesión en esta tableta o dispositivo se cerrará y volverás a la pantalla de ingreso.',
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
    <div class="masthead">
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
          <BrandSeal :size="44" class="brand-seal" />
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

    <nav v-if="topItems.length" ref="topnav" class="topnav" aria-label="Secciones">
      <RouterLink
        v-for="item in topItems"
        :key="item.to"
        :to="item.to"
        class="topnav-item"
      >
        <i class="fa-solid" :class="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
    </div>

    <div class="body">
      <Transition name="fade">
        <div v-if="drawerOpen" class="scrim" @click="drawerOpen = false" />
      </Transition>

      <nav class="sidenav" :class="{ 'sidenav--open': drawerOpen, 'sidenav--rail': railMode && !drawerOpen }">
        <div class="sidenav-sections">
          <div v-for="section in sections" :key="section.label" class="nav-section">
            <p class="nav-section-label">{{ section.label }}</p>
            <RouterLink
              v-for="item in section.items"
              :key="item.to"
              :to="item.to"
              class="nav-item"
              :title="railMode ? item.label : undefined"
            >
              <span class="nav-indicator" aria-hidden="true" />
              <i class="fa-solid nav-icon" :class="item.icon" aria-hidden="true" />
              <span class="nav-label">{{ item.label }}</span>
            </RouterLink>
          </div>
          <div v-if="userStore.isRealAdmin" class="nav-section nav-section--extra">
            <p class="nav-section-label">Barco</p>
            <a :href="REGISTROS_URL" class="nav-item" target="_blank" rel="noopener">
              <span class="nav-indicator" aria-hidden="true" />
              <i class="fa-solid nav-icon fa-clipboard-check" aria-hidden="true" />
              <span class="nav-label">Registros ISM</span>
              <i class="fa-solid fa-arrow-up-right-from-square nav-external" aria-hidden="true" />
            </a>
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
  // Portada del menú: azul empolvado con las algas a línea.
  background: var(--powder-300);
  border-bottom: 1px solid rgba(27, 43, 37, 0.22);
  color: var(--ink-900);
  box-sizing: border-box;
  height: calc(var(--bar-h) + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 0.75rem 0;
  position: relative;
  isolation: isolate;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: url('/brand/algas.png') center 40% / 320px auto repeat;
    opacity: 0.3;
    // Despeja el sello y el título: las algas aparecen hacia la derecha.
    mask-image: linear-gradient(to right, transparent 120px, #000 340px);
    pointer-events: none;
    z-index: -1;
  }
}

.shell {
  --bar-h: 64px;
  --nav-h: 66px;
  // Alto total de lo fijo arriba: barra + secciones (solo la barra en escritorio).
  --header-h: calc(var(--bar-h) + var(--nav-h));

  @include desktop {
    --header-h: var(--bar-h);
  }
}

.masthead {
  position: sticky;
  top: 0;
  z-index: 30;
}

// Secciones siempre visibles en tableta y celular; en escritorio está el sidebar.
.topnav {
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
  height: var(--nav-h);
  padding: 0.35rem 0.5rem;
  background: var(--surface);
  border-bottom: 1px solid var(--cream-200);
  box-shadow: 0 2px 8px rgba(27, 49, 66, 0.06);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }

  @include desktop {
    display: none;
  }
}

// Pestañas con ícono arriba y nombre abajo: en tableta entran todas a la vista.
.topnav-item {
  flex: 1 0 auto;
  min-width: 76px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.22rem;
  padding: 0 0.55rem;
  border-radius: 12px;
  color: var(--ink-600);
  font-weight: 600;
  font-size: 0.8rem;
  line-height: 1.1;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;

  i {
    font-size: 1.12rem;
    color: var(--navy-600);
    transition: color 0.15s ease;
  }

  &:active {
    transform: scale(0.96);
  }

  &:hover:not(.router-link-exact-active) {
    background: var(--powder-100);
  }

  &.router-link-exact-active {
    background: var(--navy-800);
    color: #fff;

    i {
      color: var(--powder-300);
    }
  }
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
  color: var(--ink-900);
  font-size: 1.1rem;
  transition: background 0.15s ease, transform 0.15s ease;

  &:hover {
    background: rgba(27, 43, 37, 0.08);
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
  color: var(--navy-700);
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
  color: var(--ink-900);
  transition: background 0.15s ease, transform 0.15s ease;

  &:hover {
    background: rgba(27, 43, 37, 0.08);
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
  border: 1px solid rgba(27, 43, 37, 0.35);
  border-radius: var(--radius-sm);
  padding: 0.38rem 0.6rem;
  color: var(--ink-900);
  font-weight: 600;
  font-size: 0.85rem;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: rgba(27, 43, 37, 0.08);
    border-color: var(--navy-700);
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

// Menú recogido (solo íconos) en la pantalla del bar, desde tableta horizontal.
.sidenav--rail {
  @include desktop {
    width: 76px;
    padding-left: 0.55rem;
    padding-right: 0.55rem;
    transition: width 0.22s ease;

    .nav-section-label,
    .nav-label,
    .view-as,
    .viewing-as,
    .nav-section--extra,
    .user-name,
    .user-role {
      display: none;
    }

    .nav-item {
      justify-content: center;
      padding-left: 0;
      padding-right: 0;
    }
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

.nav-external {
  margin-left: auto;
  font-size: 0.7rem;
  opacity: 0.6;
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
