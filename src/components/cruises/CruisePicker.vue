<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Cruise, CruiseStatus } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import { TIMEZONE } from '@/utils/format'

/**
 * Elegir crucero (pedido del cliente, 17-nov-2026): el que está en curso
 * primero y resaltado, luego los próximos y los finalizados (el más reciente
 * arriba). Con muchos, se busca por código o fecha.
 */
const props = defineProps<{ cruises: Cruise[]; title?: string }>()
const model = defineModel<string>({ default: '' })

const open = shallowRef(false)
const query = shallowRef('')

const STATUS: Record<CruiseStatus, string> = { abordo: 'En curso', planificado: 'Programado', cerrado: 'Finalizado' }

const day = (d: string) =>
  new Date(d).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', timeZone: TIMEZONE }).replace('.', '')
const dates = (c: Cruise) => `${day(c.startDate)}${c.endDate ? ` → ${day(c.endDate)}` : ''}`
const code = (c: Cruise) => c.code || c.name
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const selected = computed(() => props.cruises.find((c) => c._id === model.value) ?? null)

const groups = computed(() => {
  const q = norm(query.value.trim())
  const list = q ? props.cruises.filter((c) => norm(`${code(c)} ${c.name} ${dates(c)}`).includes(q)) : props.cruises
  const byStart = (a: Cruise, b: Cruise) => a.startDate.localeCompare(b.startDate)
  return [
    { key: 'abordo', label: 'En curso', items: list.filter((c) => c.status === 'abordo') },
    { key: 'planificado', label: 'Próximos', items: list.filter((c) => c.status === 'planificado').sort(byStart) },
    { key: 'cerrado', label: 'Finalizados', items: list.filter((c) => c.status === 'cerrado').sort((a, b) => byStart(b, a)) },
  ].filter((g) => g.items.length)
})

function show() {
  query.value = ''
  open.value = true
}

function choose(c: Cruise) {
  model.value = c._id
  open.value = false
}
</script>

<template>
  <button type="button" class="picker" :aria-label="`Crucero: ${selected ? code(selected) : 'elegir'}`" @click="show">
    <template v-if="selected">
      <strong class="picker-code">{{ code(selected) }}</strong>
      <span class="picker-dates">{{ dates(selected) }}</span>
      <span class="chip" :class="`chip--${selected.status}`">{{ STATUS[selected.status] }}</span>
    </template>
    <span v-else class="picker-dates">Elegir crucero…</span>
    <span class="picker-change">Cambiar <i class="fa-solid fa-chevron-down" aria-hidden="true" /></span>
  </button>

  <BaseModal v-if="open" :title="title ?? 'Elegir crucero'" subtitle="Toca el crucero que quieres ver." @close="open = false">
    <div class="pick">
      <div v-if="cruises.length > 6" class="pick-search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="Buscar por código o fecha: C-003, 14 nov…" aria-label="Buscar crucero" />
      </div>
      <p v-if="!groups.length" class="pick-empty">Ningún crucero coincide con «{{ query }}».</p>
      <section v-for="g in groups" :key="g.key" class="pick-group" :aria-label="g.label">
        <h3 class="pick-label">{{ g.label }}</h3>
        <button
          v-for="c in g.items"
          :key="c._id"
          type="button"
          class="pick-row"
          :class="{ 'pick-row--on': c._id === model, 'pick-row--live': c.status === 'abordo' }"
          :aria-pressed="c._id === model"
          @click="choose(c)"
        >
          <strong class="picker-code">{{ code(c) }}</strong>
          <span class="picker-dates">{{ dates(c) }}</span>
          <span class="chip" :class="`chip--${c.status}`">{{ STATUS[c.status] }}</span>
          <i v-if="c._id === model" class="fa-solid fa-circle-check pick-check" aria-hidden="true" />
        </button>
      </section>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.picker,
.pick-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  width: 100%;
  min-height: 56px;
  padding: 0.55rem 0.9rem;
  text-align: left;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-900);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &:hover {
    border-color: var(--navy-600);
  }
}

.picker-code {
  font-family: var(--font-serif);
  font-size: 1.35rem;
  line-height: 1.1;
}

.picker-dates {
  font-size: 1rem;
  font-weight: 600;
  color: var(--ink-600);
}

.picker-change {
  margin-left: auto;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--navy-700);
}

.chip {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 700;
  background: var(--cream-100);
  color: var(--ink-600);

  &--abordo {
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }

  &--planificado {
    background: var(--powder-100);
    color: var(--navy-800);
  }
}

.pick {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pick-search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 52px;
  padding: 0 0.9rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--ink-400);

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1rem;
    color: var(--ink-900);
  }

  &:focus-within {
    border-color: var(--navy-600);
    box-shadow: var(--focus-ring);
  }
}

.pick-empty {
  margin: 0;
  color: var(--ink-600);
}

.pick-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.pick-label {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--ink-600);
}

.pick-row {
  &--live {
    border-color: var(--success);
    box-shadow: inset 4px 0 0 var(--success);
  }

  &--on {
    border-color: var(--navy-800);
    background: var(--powder-100);
  }
}

.pick-check {
  margin-left: auto;
  font-size: 1.2rem;
  color: var(--navy-800);
}
</style>
