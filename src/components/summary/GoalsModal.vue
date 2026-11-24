<script setup lang="ts">
import { onMounted, reactive, shallowRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { apiGoals, apiSaveGoal, type GoalRow } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { todayKey } from '@/utils/format'

/**
 * Metas configurables (solo Gerencia; especificación del 24-nov-2026). Cada
 * cambio rige desde su fecha: los meses y años anteriores no cambian. Una meta
 * vacía hace que su bloque compare contra el período anterior.
 */
const emit = defineEmits<{ close: []; saved: [] }>()
const toast = useToastStore()

const goals = shallowRef<GoalRow[]>([])
const history = shallowRef<Array<{ key: string; value: number | null; from: string; by: string }>>([])
const draft = reactive<Record<string, string>>({})
const from = shallowRef(todayKey())
const loading = shallowRef(true)
const saving = shallowRef(false)

async function load() {
  loading.value = true
  try {
    const data = await apiGoals()
    goals.value = data.goals
    history.value = data.history
    for (const g of data.goals) draft[g.key] = g.value === null ? '' : String(g.value).replace('.', ',')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

const parse = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

async function save() {
  if (saving.value) return
  const changed = goals.value.filter((g) => parse(draft[g.key] ?? '') !== g.value)
  if (!changed.length) {
    emit('close')
    return
  }
  if (changed.some((g) => { const v = parse(draft[g.key] ?? ''); return v !== null && !Number.isFinite(v) })) {
    toast.error('Revisa los valores: solo números')
    return
  }
  saving.value = true
  try {
    for (const g of changed) await apiSaveGoal(g.key, parse(draft[g.key] ?? ''), from.value)
    toast.success(`${changed.length} meta${changed.length === 1 ? '' : 's'} guardada${changed.length === 1 ? '' : 's'} desde el ${from.value.split('-').reverse().join('/')}`)
    emit('saved')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

const labelOf = (key: string) => goals.value.find((g) => g.key === key)?.label ?? key
</script>

<template>
  <BaseModal title="Metas y tarifas" subtitle="Cada cambio rige desde su fecha: las cifras de antes no cambian." @close="emit('close')">
    <p v-if="loading" class="muted">Cargando…</p>
    <form v-else id="goals-form" class="goals" novalidate @submit.prevent="save">
      <div v-for="g in goals" :key="g.key" class="goal">
        <label :for="`goal-${g.key}`">{{ g.label }}</label>
        <div class="suffix">
          <input :id="`goal-${g.key}`" v-model="draft[g.key]" type="text" inputmode="decimal" autocomplete="off" placeholder="Vacía" />
          <span v-if="g.unit">{{ g.unit }}</span>
        </div>
      </div>
      <div class="goal goal--from">
        <label for="goals-from">Rige desde</label>
        <input id="goals-from" v-model="from" type="date" />
      </div>
      <p class="muted">Vacía: el bloque se compara con el período anterior y lo dice («sin meta: comparado con octubre»).</p>
      <details v-if="history.length" class="history">
        <summary>Historial de cambios</summary>
        <ul>
          <li v-for="(h, i) in history" :key="i">{{ labelOf(h.key) }}: <strong>{{ h.value ?? 'vacía' }}</strong> desde {{ h.from }} · {{ h.by }}</li>
        </ul>
      </details>
    </form>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="submit" form="goals-form" class="btn btn-primary" :disabled="saving || loading">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.goals {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.goal {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 1rem;

  label {
    flex: 1 1 220px;
    font-size: 0.95rem;
  }

  input {
    width: 9rem;
    min-height: 44px;
    padding: 0 0.6rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    font-size: 1rem;
    text-align: right;
  }

  &--from {
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
  }
}

.suffix {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;

  span {
    min-width: 2.5rem;
    color: var(--ink-600);
  }
}

.muted {
  margin: 0;
  font-size: 0.88rem;
  color: var(--ink-600);
}

.history {
  font-size: 0.88rem;

  summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 600;
  }

  ul {
    margin: 0;
    padding-left: 1.1rem;
  }
}
</style>
