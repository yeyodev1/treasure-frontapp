import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Cruise } from '@/types'
import { apiActiveCruise } from '@/services/api'

/** Crucero activo: el que usan el bar, los cobros y el inventario a bordo. */
export const useCruiseStore = defineStore('cruise', () => {
  const active = ref<Cruise | null>(null)

  const cabins = computed(() => active.value?.cabins ?? [])

  async function loadActive(force = false) {
    if (active.value && !force) return
    active.value = await apiActiveCruise()
  }

  function setActive(cruise: Cruise | null) {
    active.value = cruise
  }

  return { active, cabins, loadActive, setActive }
})
