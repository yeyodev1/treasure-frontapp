<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { CountLine, StockCount } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiCount, apiCountAction, apiSaveCount } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatNumber, unitShort } from '@/utils/format'

const props = defineProps<{ countId: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const userStore = useUserStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

const count = shallowRef<StockCount | null>(null)
const lines = ref<CountLine[]>([])
const loading = shallowRef(true)
const busy = shallowRef(false)
const query = shallowRef('')
const onlyCounted = shallowRef(false)

const REASONS = ['Rotura', 'Medida', 'Error de registro', 'Consumo interno', 'Pérdida', 'Otro'].map(
  (r) => ({ value: r, label: r }),
)

const editable = computed(() => count.value?.status === 'borrador' || count.value?.status === 'rechazado')
const canApprove = computed(() => userStore.isAdmin && count.value?.status === 'enviado')

function diff(line: CountLine): number | null {
  if (line.physical === null || line.physical === undefined || Number.isNaN(line.physical)) return null
  return Math.round((line.physical - line.digitalAtCut) * 100) / 100
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const visibleLines = computed(() => {
  const q = normalize(query.value.trim())
  return lines.value.filter(
    (l) =>
      (!q || normalize(l.name).includes(q)) &&
      (!onlyCounted.value || l.physical !== null) ,
  )
})

const summary = computed(() => {
  const counted = lines.value.filter((l) => l.physical !== null)
  const withDiff = counted.filter((l) => diff(l))
  return { counted: counted.length, withDiff: withDiff.length }
})

async function load() {
  try {
    count.value = await apiCount(props.countId)
    lines.value = (count.value.lines ?? []).map((l) => ({ ...l }))
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

function setPhysical(line: CountLine, value: string) {
  line.physical = value === '' ? null : Number(value)
}

async function save(silent = false) {
  busy.value = true
  try {
    count.value = await apiSaveCount(
      props.countId,
      lines.value.map((l) => ({ product: l.product, physical: l.physical, reason: l.reason })),
    )
    if (!silent) {
      play('success')
      toast.success('Conteo guardado. El stock no cambia hasta que Paula apruebe.')
    }
    emit('changed')
    return true
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
    return false
  } finally {
    busy.value = false
  }
}

async function submit() {
  if (!(await save(true))) return
  const ok = await confirmStore.ask({
    title: `¿Enviar ${count.value?.code} a Paula?`,
    message: `${summary.value.counted} producto(s) contados, ${summary.value.withDiff} con diferencia. Ya no se podrá editar hasta que Paula lo revise.`,
    confirmLabel: 'Enviar a Paula',
    icon: 'fa-shield-halved',
  })
  if (!ok) return
  busy.value = true
  try {
    count.value = await apiCountAction(props.countId, 'submit')
    play('success')
    toast.success('Conteo enviado a Paula')
    emit('changed')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function approve() {
  const ok = await confirmStore.ask({
    title: `¿Aprobar ajuste de ${count.value?.code}?`,
    message: `Se registra una sola diferencia por producto (${summary.value.withDiff}) y se conservan los movimientos posteriores al corte.`,
    confirmLabel: 'Aprobar ajuste',
    icon: 'fa-check',
  })
  if (!ok) return
  busy.value = true
  try {
    count.value = await apiCountAction(props.countId, 'approve')
    play('cash')
    toast.success('Ajuste aprobado y registrado en la bitácora')
    emit('changed')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function reject() {
  const note = await confirmStore.askReason({
    title: `¿Devolver ${count.value?.code}?`,
    message: 'Quien contó podrá corregirlo y volver a enviarlo.',
    confirmLabel: 'Devolver',
    icon: 'fa-rotate-left',
    reason: { label: 'Qué debe revisarse (obligatorio)', suggestions: ['Recontar licores', 'Falta motivo claro'] },
  })
  if (!note) return
  busy.value = true
  try {
    count.value = await apiCountAction(props.countId, 'reject', note)
    toast.success('Conteo devuelto con observación')
    emit('changed')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :title="count ? `Conteo ${count.code}` : 'Conteo'" @close="emit('close')">
    <SkeletonList v-if="loading" variant="row" :rows="8" />

    <div v-else-if="count" class="ct">
      <header class="ct-head">
        <span><i class="fa-solid fa-location-dot" aria-hidden="true" /> {{ count.location === 'abordo' ? 'A bordo' : 'Bodega' }}</span>
        <span v-if="count.cruise"><i class="fa-solid fa-ship" aria-hidden="true" /> {{ count.cruise.code || count.cruise.name }}</span>
        <span><i class="fa-regular fa-clock" aria-hidden="true" /> Corte {{ formatDateTime(count.cutAt) }}</span>
        <span class="ct-status" :class="`ct-status--${count.status}`">{{ count.status }}</span>
      </header>

      <p v-if="count.status === 'rechazado' && count.reviewNote" class="note">
        <i class="fa-solid fa-comment" aria-hidden="true" /> Paula: {{ count.reviewNote }}
      </p>

      <div class="ct-tools">
        <label class="search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input v-model="query" type="search" placeholder="Buscar producto" aria-label="Buscar producto" />
        </label>
        <button type="button" class="toggle" :class="{ on: onlyCounted }" @click="onlyCounted = !onlyCounted">
          <i class="fa-solid fa-filter" aria-hidden="true" /> Solo contados
        </button>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th class="num">Digital al corte</th>
              <th class="num">Físico</th>
              <th class="num">Diferencia</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in visibleLines" :key="line.product" :class="{ counted: line.physical !== null }">
              <td class="prod">
                {{ line.name }}
                <small>{{ unitShort(line.stockUnit) }}</small>
              </td>
              <td class="num" :class="{ neg: line.digitalAtCut < 0 }">{{ formatNumber(line.digitalAtCut) }}</td>
              <td class="num">
                <input
                  v-if="editable"
                  class="physical"
                  type="number"
                  min="0"
                  inputmode="decimal"
                  :value="line.physical ?? ''"
                  :aria-label="`Cantidad física de ${line.name}`"
                  @input="setPhysical(line, ($event.target as HTMLInputElement).value)"
                />
                <strong v-else>{{ line.physical === null ? '—' : formatNumber(line.physical) }}</strong>
              </td>
              <td class="num">
                <span v-if="diff(line) !== null" :class="{ neg: diff(line)! < 0, pos: diff(line)! > 0 }">
                  {{ diff(line)! > 0 ? '+' : '' }}{{ formatNumber(diff(line)!) }}
                </span>
              </td>
              <td class="reason">
                <BaseSelect
                  v-if="editable && diff(line)"
                  v-model="line.reason"
                  :options="REASONS"
                  placeholder="Motivo…"
                />
                <span v-else>{{ line.reason }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="ct-summary">
        {{ summary.counted }} contados · {{ summary.withDiff }} con diferencia
      </p>

      <div class="ct-actions">
        <button type="button" class="btn btn-primary" :disabled="!editable || busy" @click="save()">
          <i class="fa-solid fa-clipboard-check" aria-hidden="true" /> Guardar conteo
        </button>
        <button type="button" class="btn btn-primary" :disabled="!editable || busy" @click="submit">
          <i class="fa-solid fa-shield-halved" aria-hidden="true" /> Enviar a Paula
        </button>
        <button type="button" class="btn btn-primary" :disabled="!canApprove || busy" @click="approve">
          <i class="fa-solid fa-check" aria-hidden="true" /> Aprobar ajuste
        </button>
      </div>
      <button v-if="canApprove" type="button" class="btn btn-ghost" :disabled="busy" @click="reject">
        <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Devolver para recontar
      </button>
      <p v-if="!userStore.isAdmin" class="only-paula">Solo Paula ve habilitado Aprobar ajuste.</p>
      <p v-if="count.status === 'aprobado'" class="done">
        <i class="fa-solid fa-circle-check" aria-hidden="true" />
        Aprobado por {{ count.reviewedBy?.name }} · {{ count.reviewedAt ? formatDateTime(count.reviewedAt) : '' }}
      </p>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.ct {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.ct-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  font-size: 0.82rem;
  color: var(--ink-600);

  i {
    color: var(--gold-500);
  }
}

.ct-status {
  margin-left: auto;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--powder-100);

  &--enviado {
    background: rgba(185, 128, 47, 0.16);
    color: #8a5d1d;
  }

  &--aprobado {
    background: rgba(63, 122, 87, 0.15);
    color: var(--success);
  }

  &--rechazado {
    background: rgba(180, 72, 59, 0.12);
    color: var(--danger);
  }
}

.note {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-sm);
  background: rgba(180, 72, 59, 0.08);
  font-size: 0.86rem;
}

.ct-tools {
  display: flex;
  gap: 0.5rem;
}

.search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  padding: 0 0.8rem;
  border: 1.5px solid var(--cream-200);
  border-radius: 999px;
  color: var(--ink-400);

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
  }
}

.toggle {
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-600);

  &.on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.table-wrap {
  overflow-x: auto;
  max-height: 46dvh;
  overflow-y: auto;
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;

  th {
    position: sticky;
    top: 0;
    background: var(--surface);
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-400);
    padding: 0.5rem 0.55rem;
    border-bottom: 2px solid var(--cream-200);
    white-space: nowrap;
    z-index: 1;
  }

  td {
    padding: 0.4rem 0.55rem;
    border-bottom: 1px solid var(--cream-200);
  }

  tr.counted td {
    background: var(--powder-100);
  }
}

.num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.prod {
  font-weight: 600;
  min-width: 150px;

  small {
    margin-left: 0.3rem;
    font-weight: 500;
    color: var(--ink-400);
  }
}

.physical {
  width: 92px;
  min-height: 40px;
  padding: 0.35rem 0.5rem;
  border: 1.5px solid var(--cream-200);
  border-radius: 8px;
  text-align: right;
  background: #fff;

  &:focus {
    outline: none;
    border-color: var(--gold-500);
  }
}

.reason {
  min-width: 160px;
}

.neg {
  color: var(--danger);
  font-weight: 700;
}

.pos {
  color: var(--success);
  font-weight: 700;
}

.ct-summary {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-400);
}

.ct-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;

  @include tablet {
    grid-template-columns: repeat(3, 1fr);
  }
}

.only-paula {
  margin: 0;
  color: var(--danger);
  font-weight: 700;
  font-size: 0.85rem;
}

.done {
  margin: 0;
  color: var(--success);
  font-weight: 600;
}
</style>
