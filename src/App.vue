<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import AppShell from '@/layout/AppShell.vue'
import ToastList from '@/components/ui/ToastList.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import UpdatePrompt from '@/components/ui/UpdatePrompt.vue'

const route = useRoute()
const userStore = useUserStore()

// Las vistas públicas (login, cuenta del pasajero) no llevan el shell con navegación.
const showShell = computed(() => !route.meta.public && userStore.isLogged)
/** Copia de prueba (16-nov-2026): que nadie la confunda con la app real. */
const isTest = import.meta.env.VITE_PRUEBA === '1'
</script>

<template>
  <p v-if="isTest" class="test-banner" role="note">
    SISTEMA DE PRUEBA · lo que hagas aquí no cambia el barco real
  </p>
  <AppShell v-if="showShell">
    <RouterView v-slot="{ Component }">
      <Transition name="view" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </AppShell>
  <RouterView v-else />
  <ToastList />
  <ConfirmDialog />
  <UpdatePrompt />
</template>

<style scoped>
.test-banner {
  position: sticky;
  inset-block-start: 0;
  z-index: 1000;
  margin: 0;
  padding: 0.35rem 1rem;
  background: #b42318;
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  text-align: center;
}
</style>
