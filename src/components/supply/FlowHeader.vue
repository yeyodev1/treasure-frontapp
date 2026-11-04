<script setup lang="ts">
/** Encabezado de un flujo por pasos: volver, título y pasos numerados. */
defineProps<{
  title: string
  icon: string
  steps?: string[]
  current?: number
  backLabel?: string
}>()

const emit = defineEmits<{ back: []; go: [index: number] }>()
</script>

<template>
  <header class="flow-head">
    <div class="flow-top">
      <button type="button" class="back" @click="emit('back')">
        <i class="fa-solid fa-arrow-left" aria-hidden="true" /> {{ backLabel ?? 'Volver' }}
      </button>
      <h2 class="flow-title">
        <i class="fa-solid" :class="icon" aria-hidden="true" /> {{ title }}
      </h2>
    </div>
    <ol v-if="steps?.length" class="steps">
      <li
        v-for="(step, i) in steps"
        :key="step"
        class="step"
        :class="{ 'step--on': i === current, 'step--done': i < (current ?? 0) }"
      >
        <button type="button" :disabled="i >= (current ?? 0)" @click="emit('go', i)">
          <span class="step-n">
            <i v-if="i < (current ?? 0)" class="fa-solid fa-check" aria-hidden="true" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="step-label">{{ step }}</span>
        </button>
      </li>
    </ol>
  </header>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.flow-head {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-bottom: 1rem;
}

.flow-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}

.back {
  @include touch-target;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1.1rem 0 0.95rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-weight: 600;
  color: var(--navy-800);
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  i {
    transition: transform 0.16s var(--ease-out);
  }

  &:hover {
    border-color: var(--navy-600);

    i {
      transform: translateX(-3px);
    }
  }

  &:active {
    background: var(--powder-100);
  }
}

.flow-title {
  font-size: 1.6rem;
  display: flex;
  align-items: center;
  gap: 0.55rem;

  i {
    color: var(--gold-500);
    font-size: 1.1rem;
  }
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.4rem;
}

.step {
  flex: 1;
  min-width: 0;

  button {
    width: 100%;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--ink-400);
    font-weight: 600;
    font-size: 0.95rem;
    text-align: left;
    transition:
      background 0.2s ease,
      color 0.2s ease,
      border-color 0.2s ease;

    &:disabled {
      cursor: default;
    }
  }

  &--on button {
    border-color: var(--navy-800);
    box-shadow: inset 0 0 0 1px var(--navy-800);
    color: var(--navy-800);
  }

  &--done button {
    color: var(--success-ink);
    border-color: rgba(63, 122, 87, 0.35);
    cursor: pointer;

    &:hover {
      background: var(--pill-ok-bg);
    }
  }
}

.step-n {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--cream-100);
  font-size: 0.92rem;
  transition: background 0.2s ease;

  .step--on & {
    background: var(--navy-800);
    color: #fff;
  }

  .step--done & {
    background: rgba(63, 122, 87, 0.15);
  }
}

.step-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
