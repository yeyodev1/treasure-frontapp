<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'

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
const trigger = useTemplateRef<HTMLElement>('trigger')
const list = useTemplateRef<HTMLElement>('list')

const { style: panelStyle, openUp, bind, unbind } = useAnchoredPanel(trigger)

const selected = computed(() => props.options.find((o) => o.value === model.value) ?? null)

function toggle() {
  if (props.disabled) return
  if (open.value) {
    close()
    return
  }
  open.value = true
  bind()
  highlighted.value = props.options.findIndex((o) => o.value === model.value)
}

function close() {
  open.value = false
  unbind()
}

function choose(option: SelectOption) {
  model.value = option.value
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
    e.preventDefault()
    toggle()
    return
  }
  if (!open.value) return
  if (e.key === 'Escape' || e.key === 'Tab') {
    close()
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
  if (!open.value) return
  const target = e.target as Node
  if (trigger.value?.contains(target) || list.value?.contains(target)) return
  close()
}

onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <div class="select" :class="{ 'select--open': open, 'select--disabled': disabled }">
    <button
      ref="trigger"
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

    <!-- El menú va al body con position:fixed: ningún modal lo recorta. -->
    <Teleport to="body">
      <Transition :name="openUp ? 'pop-up' : 'pop'">
        <ul
          v-if="open"
          ref="list"
          class="select-menu"
          :style="panelStyle"
          role="listbox"
        >
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
    </Teleport>
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
  user-select: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;

  .select--open & {
    border-color: var(--gold-500);
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
}

.select-value--placeholder {
  color: var(--ink-400);
}

.select-caret {
  font-size: 0.7rem;
  color: var(--ink-400);
  transition: transform 0.2s ease;

  .select--open & {
    transform: rotate(180deg);
  }
}

.select--disabled .select-trigger {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>

<style lang="scss">
// Sin scoped: el menú vive teleportado en el body.
.select-menu {
  z-index: 90;
  margin: 0;
  padding: 0.3rem;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  user-select: none;
  -webkit-user-select: none;
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

.pop-enter-active,
.pop-leave-active,
.pop-up-enter-active,
.pop-up-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.98);
}

.pop-up-enter-from,
.pop-up-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}
</style>
