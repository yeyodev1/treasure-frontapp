<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'

/** Calendario propio (modelo 'YYYY-MM-DD'), sin input nativo. */
const props = defineProps<{
  placeholder?: string
  clearable?: boolean
}>()

const model = defineModel<string>({ default: '' })

const open = shallowRef(false)
const root = useTemplateRef<HTMLElement>('root')

const today = new Date()
const viewYear = shallowRef(today.getFullYear())
const viewMonth = shallowRef(today.getMonth())

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

const selectedLabel = computed(() => {
  if (!model.value) return ''
  const [y, m, d] = model.value.split('-').map(Number)
  if (!y || !m || !d) return model.value
  return `${d} ${MONTHS[m - 1]!.toLowerCase().slice(0, 3)} ${y}`
})

interface DayCell {
  day: number
  key: string
  isToday: boolean
  isSelected: boolean
}

const cells = computed<Array<DayCell | null>>(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1)
  const offset = (first.getDay() + 6) % 7 // semana inicia en lunes
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()
  const todayKey = toKey(today.getFullYear(), today.getMonth(), today.getDate())

  const result: Array<DayCell | null> = Array.from({ length: offset }, () => null)
  for (let day = 1; day <= daysInMonth; day++) {
    const key = toKey(viewYear.value, viewMonth.value, day)
    result.push({ day, key, isToday: key === todayKey, isSelected: key === model.value })
  }
  return result
})

function toggle() {
  open.value = !open.value
  if (open.value && model.value) {
    const [y, m] = model.value.split('-').map(Number)
    if (y && m) {
      viewYear.value = y
      viewMonth.value = m - 1
    }
  }
}

function shiftMonth(delta: number) {
  const next = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth()
}

function pick(cell: DayCell) {
  model.value = cell.key
  open.value = false
}

function clear() {
  model.value = ''
  open.value = false
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
  <div ref="root" class="picker">
    <button
      type="button"
      class="picker-trigger"
      :aria-expanded="open"
      @click="toggle"
      @keydown.escape="open = false"
    >
      <i class="fa-regular fa-calendar picker-icon" aria-hidden="true" />
      <span class="picker-value" :class="{ 'picker-value--placeholder': !model }">
        {{ selectedLabel || placeholder || 'Elige fecha' }}
      </span>
      <i
        v-if="clearable && model"
        class="fa-solid fa-xmark picker-clear"
        aria-hidden="true"
        @click.stop="clear"
      />
    </button>

    <Transition name="pop">
      <div v-if="open" class="picker-panel">
        <header class="picker-head">
          <button type="button" class="picker-nav" aria-label="Mes anterior" @click="shiftMonth(-1)">
            <i class="fa-solid fa-chevron-left" aria-hidden="true" />
          </button>
          <span class="picker-month">{{ MONTHS[viewMonth] }} {{ viewYear }}</span>
          <button type="button" class="picker-nav" aria-label="Mes siguiente" @click="shiftMonth(1)">
            <i class="fa-solid fa-chevron-right" aria-hidden="true" />
          </button>
        </header>

        <div class="picker-grid picker-grid--labels">
          <span v-for="(w, i) in WEEKDAYS" :key="i" class="picker-weekday">{{ w }}</span>
        </div>

        <div class="picker-grid">
          <template v-for="(cell, i) in cells" :key="i">
            <span v-if="!cell" class="picker-empty" />
            <button
              v-else
              type="button"
              class="picker-day"
              :class="{ 'picker-day--today': cell.isToday, 'picker-day--selected': cell.isSelected }"
              @click="pick(cell)"
            >
              {{ cell.day }}
            </button>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.picker {
  position: relative;
  width: 100%;
}

.picker-trigger {
  @include touch-target;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.85rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: #fff;
  text-align: left;
  font-size: 0.95rem;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;

  &:focus-visible {
    outline: none;
    border-color: var(--gold-500);
    box-shadow: 0 0 0 3px rgba(195, 161, 105, 0.22);
  }
}

.picker-icon {
  color: var(--ink-400);
  font-size: 0.9rem;
}

.picker-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--placeholder {
    color: var(--ink-400);
  }
}

.picker-clear {
  color: var(--ink-400);
  padding: 0.25rem;

  &:hover {
    color: var(--danger);
  }
}

.picker-panel {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  min-width: 272px;
  background: var(--surface);
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  padding: 0.75rem;
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.picker-month {
  font-family: var(--font-serif);
  font-size: 1rem;
}

.picker-nav {
  @include touch-target;
  min-width: 36px;
  min-height: 36px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--ink-600);

  &:hover {
    background: var(--cream-200);
  }
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;

  &--labels {
    margin-bottom: 0.2rem;
  }
}

.picker-weekday {
  text-align: center;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--ink-400);
  text-transform: uppercase;
  padding: 0.2rem 0;
}

.picker-day {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 7px;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    background: var(--cream-200);
  }

  &--today {
    box-shadow: inset 0 0 0 1.5px var(--gold-500);
  }

  &--selected {
    background: var(--navy-800);
    color: var(--cream-100);
  }
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
