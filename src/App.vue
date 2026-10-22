<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import AppShell from '@/layout/AppShell.vue'
import ToastList from '@/components/ui/ToastList.vue'

const route = useRoute()
const userStore = useUserStore()

// Las vistas públicas (login, cuenta del pasajero) no llevan el shell con navegación.
const showShell = computed(() => !route.meta.public && userStore.isLogged)
</script>

<template>
  <AppShell v-if="showShell">
    <RouterView />
  </AppShell>
  <RouterView v-else />
  <ToastList />
</template>
