<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

const props = defineProps<{
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
}>()

const model = defineModel<string>({ default: '' })

const open = shallowRef(false)
const highlighted = shallowRef(-1)
const root = useTemplateRef<HTMLElement>('root')
const list = useTemplateRef<HTMLElement>('list')

const selected = computed(() => props.options.find((o) => o.value === model.value) ?? null)

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    highlighted.value = props.options.findIndex((o) => o.value === model.value)
  }
}

function choose(option: SelectOption) {
  model.value = option.value
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
    e.preventDefault()
    toggle()
    return
  }
  if (!open.value) return
  if (e.key === 'Escape') {
    open.value = false
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const delta = e.key === 'ArrowDown' ? 1 : -1
    const count = props.options.length
    highlighted.value = (highlighted.value + delta + count) % count
    scrollToHighlighted()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const option = props.options[highlighted.value]
    if (option) choose(option)
  }
}

function scrollToHighlighted() {
  const el = list.value?.children[highlighted.value] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest' })
}

function onOutside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <div ref="root" class="select" :class="{ 'select--open': open, 'select--disabled': disabled }">
    <button
      type="button"
      class="select-trigger"
      :disabled="disabled"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="select-value" :class="{ 'select-value--placeholder': !selected }">
        {{ selected?.label ?? placeholder ?? 'Elige…' }}
      </span>
      <i class="fa-solid fa-chevron-down select-caret" aria-hidden="true" />
    </button>

    <Transition name="pop">
      <ul v-if="open" ref="list" class="select-menu" role="listbox">
        <li
          v-for="(option, index) in options"
          :key="option.value"
          role="option"
          :aria-selected="option.value === model"
          class="select-option"
          :class="{
            'select-option--active': option.value === model,
            'select-option--highlighted': index === highlighted,
          }"
          @pointerenter="highlighted = index"
          @click="choose(option)"
        >
          <span class="select-option-label">{{ option.label }}</span>
          <span v-if="option.hint" class="select-option-hint">{{ option.hint }}</span>
          <i
            v-if="option.value === model"
            class="fa-solid fa-check select-option-check"
            aria-hidden="true"
          />
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.select {
  position: relative;
  width: 100%;
}

.select-trigger {
  @include touch-target;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0.85rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: #fff;
  text-align: left;
  font-size: 0.95rem;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;

  .select--open & {
    border-color: var(--brass, var(--gold-500));
    box-shadow: 0 0 0 3px rgba(195, 161, 105, 0.18);
  }

  &:focus-visible {
    outline: none;
    border-color: var(--gold-500);
    box-shadow: 0 0 0 3px rgba(195, 161, 105, 0.22);
  }
}

.select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--placeholder {
    color: var(--ink-400);
  }
}

.select-caret {
  font-size: 0.7rem;
  color: var(--ink-400);
  transition: transform 0.2s ease;

  .select--open & {
    transform: rotate(180deg);
  }
}

.select-menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.3rem;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  max-height: 260px;
  overflow-y: auto;
}

.select-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  border-radius: 7px;
  cursor: pointer;
  font-size: 0.92rem;

  &--highlighted {
    background: var(--cream-200);
  }

  &--active {
    color: var(--navy-700);
    font-weight: 600;
  }
}

.select-option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-option-hint {
  font-size: 0.78rem;
  color: var(--ink-400);
  white-space: nowrap;
}

.select-option-check {
  font-size: 0.75rem;
  color: var(--gold-500);
}

.select--disabled .select-trigger {
  opacity: 0.55;
  cursor: not-allowed;
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.98);
}
</style>
