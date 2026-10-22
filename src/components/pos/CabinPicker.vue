<script setup lang="ts">
import type { Cabin } from '@/types'

defineProps<{ cabins: Cabin[]; selected: number | null }>()
const emit = defineEmits<{ select: [number] }>()
</script>

<template>
  <div class="cabins">
    <button
      v-for="cabin in cabins"
      :key="cabin.number"
      type="button"
      class="cabin"
      :class="{ 'cabin--active': cabin.number === selected }"
      @click="emit('select', cabin.number)"
    >
      <span class="cabin-number">{{ cabin.number }}</span>
      <span class="cabin-guest">{{ cabin.guestName || 'Sin huésped' }}</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.cabins {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;

  @include tablet {
    grid-template-columns: repeat(9, 1fr);
  }
}

.cabin {
  @include touch-target;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.6rem 0.25rem;
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  transition: all 0.12s ease;

  &--active {
    border-color: var(--gold-500);
    background: var(--navy-800);
    color: var(--cream-100);
  }
}

.cabin-number {
  font-size: 1.2rem;
  font-weight: 800;
}

.cabin-guest {
  font-size: 0.65rem;
  color: var(--ink-400);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .cabin--active & {
    color: var(--cream-200);
  }
}
</style>
