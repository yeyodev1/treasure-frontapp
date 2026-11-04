<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'

/**
 * Inventario y pedidos (guía 4-nov-2026): un solo acceso con cuatro pestañas
 * fijas. Cada persona ve las que su rol permite; los permisos no cambian.
 */
const route = useRoute()
const userStore = useUserStore()

const tabs = computed(() => {
  const isBar = userStore.role === 'bartender'
  return [
    { to: '/inventario/existencias', label: 'Existencias', icon: 'fa-boxes-stacked', show: true },
    { to: '/inventario/pedido', label: 'Pedido semanal', icon: 'fa-list-check', show: true },
    {
      // El bar solo ve sus solicitudes; compras y recepciones son de Administración y Bodega.
      to: isBar ? '/inventario/compras/solicitudes' : '/inventario/compras',
      match: '/inventario/compras',
      label: isBar ? 'Mis solicitudes' : 'Compras y entregas',
      icon: 'fa-truck-ramp-box',
      show: true,
    },
    { to: '/inventario/conteos', label: 'Conteos', icon: 'fa-clipboard-list', show: !isBar },
  ].filter((t) => t.show)
})

const isOn = (t: { to: string; match?: string }) => route.path.startsWith(t.match ?? t.to)
</script>

<template>
  <div class="hub">
    <nav class="segs hub-tabs" aria-label="Inventario y pedidos">
      <RouterLink
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="segs-item"
        :class="{ 'segs-item--on': isOn(t) }"
        :aria-current="isOn(t) ? 'page' : undefined"
      >
        <i class="fa-solid" :class="t.icon" aria-hidden="true" /> {{ t.label }}
      </RouterLink>
    </nav>
    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </div>
</template>

<style scoped lang="scss">
.hub-tabs {
  margin: 0 auto 0.5rem;
  max-width: 1180px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
