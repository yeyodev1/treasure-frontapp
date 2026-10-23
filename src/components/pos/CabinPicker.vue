<script setup lang="ts">
import type { Cabin } from '@/types'

defineProps<{ cabins: Cabin[]; selected: number | null }>()
const emit = defineEmits<{ select: [number]; empty: [number] }>()
</script>

<template>
  <div class="cabins">
    <button
      v-for="cabin in cabins"
      :key="cabin.number"
      type="button"
      class="cabin"
      :class="{
        'cabin--active': cabin.number === selected,
        'cabin--empty': !cabin.passengers.length,
      }"
      :aria-pressed="cabin.number === selected"
      :title="cabin.passengers.length ? cabin.guestName : 'Cabina sin pasajeros'"
      @click="cabin.passengers.length ? emit('select', cabin.number) : emit('empty', cabin.number)"
    >
      <span class="cabin-number">{{ cabin.number }}</span>
      <span class="cabin-guest">
        <template v-if="cabin.passengers.length">
          {{ cabin.guestName }}
          <span v-if="cabin.passengers.length > 1" class="cabin-more">
            +{{ cabin.passengers.length - 1 }}
          </span>
        </template>
        <template v-else>Vacía</template>
      </span>
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.cabins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 0.5rem;
}

.cabin {
  @include touch-target;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.55rem 0.35rem;
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  transition: all 0.14s ease;

  &:active {
    transform: scale(0.97);
  }

  &--active {
    border-color: var(--gold-500);
    background: var(--navy-800);
    color: #fff;
    box-shadow: 0 0 0 3px rgba(159, 107, 60, 0.2);
  }

  &--empty {
    background: transparent;
    border-style: dashed;
    color: var(--ink-400);
  }
}

.cabin-number {
  font-size: 1.2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cabin-guest {
  font-size: 0.68rem;
  color: var(--ink-400);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .cabin--active & {
    color: var(--powder-300);
  }
}

.cabin-more {
  font-weight: 700;
}
</style>
