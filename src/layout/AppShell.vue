<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import type { UserRole } from '@/types'
import BrandSeal from '@/components/ui/BrandSeal.vue'

interface NavItem {
  to: string
  label: string
  emoji: string
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Bar', emoji: '🍹', roles: ['admin', 'direccion', 'bartender'] },
  { to: '/cuentas', label: 'Cuentas', emoji: '🧾', roles: ['admin', 'direccion'] },
  { to: '/admin', label: 'Panel', emoji: '📊', roles: ['admin', 'direccion'] },
  { to: '/admin/inventario', label: 'Inventario', emoji: '📦', roles: ['admin', 'bodega', 'direccion'] },
  { to: '/admin/cruceros', label: 'Cruceros', emoji: '🚢', roles: ['admin', 'direccion'] },
  { to: '/admin/productos', label: 'Catálogo', emoji: '🍸', roles: ['admin', 'bodega'] },
  { to: '/admin/pagos', label: 'Cobros', emoji: '💵', roles: ['admin', 'direccion'] },
  { to: '/admin/equipo', label: 'Equipo', emoji: '👥', roles: ['admin'] },
]

const router = useRouter()
const userStore = useUserStore()

const items = computed(() =>
  NAV_ITEMS.filter((item) => userStore.role && item.roles.includes(userStore.role)),
)

function logout() {
  userStore.clear()
  router.replace({ name: 'Login' })
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <BrandSeal :size="30" class="brand-seal" />
        <span class="brand-name">Treasure of Galápagos</span>
      </div>
      <div class="session">
        <span class="session-name">{{ userStore.user?.name }}</span>
        <button class="session-out" type="button" @click="logout">Salir</button>
      </div>
    </header>

    <div class="body">
      <nav class="sidenav">
        <RouterLink v-for="item in items" :key="item.to" :to="item.to" class="nav-item">
          <span class="nav-emoji" aria-hidden="true">{{ item.emoji }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <main class="content">
        <slot />
      </main>
    </div>

    <nav class="tabbar">
      <RouterLink v-for="item in items.slice(0, 5)" :key="item.to" :to="item.to" class="tab-item">
        <span class="nav-emoji" aria-hidden="true">{{ item.emoji }}</span>
        <span class="tab-label">{{ item.label }}</span>
      </RouterLink>
    </nav>
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
  background: var(--navy-800);
  color: var(--cream-100);
  padding: 0.65rem 1rem;
  padding-top: calc(0.65rem + env(safe-area-inset-top));
  position: sticky;
  top: 0;
  z-index: 20;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.brand-seal {
  color: var(--gold-500);
  flex-shrink: 0;
}

.brand-name {
  font-family: var(--font-serif);
  font-size: 1.02rem;
  letter-spacing: 0.03em;
}

.session {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
}

.session-name {
  opacity: 0.85;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @include tablet {
    max-width: none;
  }
}

.session-out {
  border: 1px solid rgba(250, 246, 238, 0.35);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.7rem;
  color: var(--cream-100);
  font-weight: 600;
}

.body {
  display: flex;
  flex: 1;
}

// Sidebar solo en escritorio; en celular/tablet manda la barra inferior.
.sidenav {
  display: none;

  @include desktop {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 210px;
    padding: 1rem 0.75rem;
    background: #fff;
    border-right: 1px solid var(--cream-200);
  }
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  color: var(--ink-600);

  &.router-link-exact-active {
    background: var(--navy-800);
    color: var(--cream-100);
  }

  &:hover:not(.router-link-exact-active) {
    background: var(--cream-200);
  }
}

.content {
  flex: 1;
  min-width: 0;
  padding-bottom: calc(76px + env(safe-area-inset-bottom));

  @include desktop {
    padding-bottom: 0;
  }
}

.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  background: #fff;
  border-top: 1px solid var(--cream-200);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 20;

  @include desktop {
    display: none;
  }
}

.tab-item {
  @include touch-target;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.5rem 0;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--ink-400);

  &.router-link-exact-active {
    color: var(--navy-800);
  }
}

.nav-emoji {
  font-size: 1.2rem;
}
</style>
