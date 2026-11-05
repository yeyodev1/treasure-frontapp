<script setup lang="ts">
import { LOCATION_LABEL } from '@/components/supply/units'
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

const STATUS_LABEL: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Pendiente de aprobación',
  aprobado: 'Confirmado',
  rechazado: 'Devuelto',
}

/**
 * Guía 4 perfiles (4-nov-2026): quien cuenta (Administración, Bodega o la
 * dueña) confirma y el conteo físico pasa a ser la referencia, sin enviarlo a
 * otra persona. Dirección aún lo envía para revisión.
 */
const canConfirm = computed(() => userStore.isOwner || userStore.role === 'admin' || userStore.role === 'bodega')

const editable = computed(() => count.value?.status === 'borrador' || count.value?.status === 'rechazado')
const canApprove = computed(() => userStore.isOwner && count.value?.status === 'enviado')

function diff(line: CountLine): number | null {
  if (line.physical === null || line.physical === undefined || Number.isNaN(line.physical)) return null
  return Math.round((line.physical - line.digitalAtCut) * 100) / 100
}

/** Se cuenta en envases cuando el producto tiene envase (botella de 750 ml…). */
function inContainers(line: CountLine): boolean {
  return (line.containerSize ?? 1) > 1
}

function containerName(line: CountLine, n: number): string {
  const label = line.containerLabel || 'envase'
  return Math.abs(n) === 1 ? label : `${label}s`
}

/** Cantidad en envases ("2 botellas", "1,5 botellas") o en unidad base ("3 u"). */
function amountText(line: CountLine, qty: number): string {
  if (!inContainers(line)) return `${formatNumber(qty)} ${unitShort(line.stockUnit)}`
  const n = Math.round((qty / line.containerSize!) * 100) / 100
  return `${formatNumber(n)} ${containerName(line, n)}`
}

/** Valor del campo: envases cuando aplica. */
function physicalInput(line: CountLine): string {
  if (line.physical === null || line.physical === undefined) return ''
  if (!inContainers(line)) return String(line.physical)
  return String(Math.round((line.physical / line.containerSize!) * 100) / 100).replace('.', ',')
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
  const clean = value.replace(',', '.').trim()
  if (clean === '') {
    line.physical = null
    return
  }
  const n = Number(clean)
  if (Number.isNaN(n)) return
  // En envases: se guarda en unidad base (ml, u…) como siempre.
  line.physical = inContainers(line) ? Math.round(n * line.containerSize! * 100) / 100 : n
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
      toast.success('Conteo guardado. Puedes seguir después; el stock no cambia hasta confirmar.')
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
    title: `¿Enviar ${count.value?.code} para revisión?`,
    message: `${summary.value.counted} producto(s) contados, ${summary.value.withDiff} con diferencia. Ya no se podrá editar mientras se revisa.`,
    confirmLabel: 'Enviar para revisión',
    icon: 'fa-shield-halved',
  })
  if (!ok) return
  busy.value = true
  try {
    count.value = await apiCountAction(props.countId, 'submit')
    play('success')
    toast.success('Conteo enviado para revisión')
    emit('changed')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function confirmCount() {
  if (!(await save(true))) return
  if (!summary.value.counted) {
    toast.error('Cuenta al menos un producto antes de confirmar')
    return
  }
  const ok = await confirmStore.ask({
    title: `¿Confirmar el inventario ${count.value ? `de ${LOCATION_LABEL[count.value.location]}` : ''}?`,
    message: `${summary.value.counted} producto(s) contados, ${summary.value.withDiff} con diferencia. Lo contado pasa a ser la referencia; se conservan los movimientos posteriores al corte. Lo no contado no cambia.`,
    confirmLabel: count.value?.location === 'abordo' ? 'Confirmar inventario del barco' : 'Confirmar inventario',
    icon: 'fa-clipboard-check',
  })
  if (!ok) return
  busy.value = true
  try {
    count.value = await apiCountAction(props.countId, 'confirm')
    play('success')
    toast.success('Inventario confirmado: el informe de diferencias ya está en Diferencias')
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
  <BaseModal
    :title="count ? `Conteo ${count.code}` : 'Conteo'"
    :subtitle="editable ? 'Anota lo que cuentas y guarda cuando quieras. El stock no cambia hasta confirmar. Lo no contado no cuenta como cero.' : undefined"
    size="xl"
    @close="emit('close')"
  >
    <SkeletonList v-if="loading" variant="row" :rows="8" />

    <div v-else-if="count" class="ct">
      <header class="ct-head">
        <span><i class="fa-solid fa-location-dot" aria-hidden="true" /> {{ LOCATION_LABEL[count.location] }}</span>
        <span v-if="count.cruise"><i class="fa-solid fa-ship" aria-hidden="true" /> {{ count.cruise.code || count.cruise.name }}</span>
        <span><i class="fa-regular fa-clock" aria-hidden="true" /> Corte {{ formatDateTime(count.cutAt) }}</span>
        <span class="ct-status" :class="`ct-status--${count.status}`">{{ STATUS_LABEL[count.status] }}</span>
      </header>

      <p v-if="count.status === 'rechazado' && count.reviewNote" class="note">
        <i class="fa-solid fa-comment" aria-hidden="true" /> Observación: {{ count.reviewNote }}
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

      <TransitionGroup tag="ul" name="ct-row" class="ct-list">
        <li
          v-for="line in visibleLines"
          :key="line.product"
          class="ct-row"
          :class="{ counted: line.physical !== null, diff: Boolean(diff(line)) }"
        >
          <div class="ct-name">
            <strong>{{ line.name }}</strong>
            <small>
              Según el sistema al iniciar:
              <span
                :class="{ neg: line.digitalAtCut < 0 }"
                :title="inContainers(line) ? `${formatNumber(line.digitalAtCut)} ${unitShort(line.stockUnit)}` : undefined"
              >{{ amountText(line, line.digitalAtCut) }}</span>
            </small>
          </div>
          <div class="ct-count">
            <label class="ct-physical">
              <span>Cantidad contada{{ inContainers(line) ? ` (${containerName(line, 2)})` : '' }}</span>
              <input
                v-if="editable"
                class="physical"
                type="text"
                inputmode="decimal"
                :value="physicalInput(line)"
                :aria-label="`Cantidad contada de ${line.name}`"
                @input="setPhysical(line, ($event.target as HTMLInputElement).value)"
              />
              <strong v-else>{{ line.physical === null ? '—' : amountText(line, line.physical) }}</strong>
            </label>
            <span v-if="diff(line) !== null" class="ct-diff" :class="{ neg: diff(line)! < 0, pos: diff(line)! > 0 }">
              <template v-if="diff(line) === 0">Sin diferencia</template>
              <template v-else>
                Diferencia: {{ diff(line)! > 0 ? 'sobra' : 'falta' }} {{ amountText(line, Math.abs(diff(line)!)) }}
              </template>
            </span>
          </div>
          <div v-if="diff(line)" class="ct-reason">
            <BaseSelect
              v-if="editable"
              v-model="line.reason"
              :options="REASONS"
              placeholder="Motivo de la diferencia…"
            />
            <span v-else>{{ line.reason }}</span>
          </div>
        </li>
      </TransitionGroup>

    </div>

    <template v-if="count && !loading" #footer>
      <p class="ct-summary num">
        <strong>{{ summary.counted }}</strong> contados ·
        <strong :class="{ warnText: summary.withDiff }">{{ summary.withDiff }}</strong> con diferencia
      </p>
      <div class="ct-actions">
        <template v-if="editable">
          <button type="button" class="btn btn-secondary" :disabled="busy" @click="save()">
            <i class="fa-solid fa-floppy-disk" aria-hidden="true" /> Guardar conteo
          </button>
          <button v-if="canConfirm" type="button" class="btn btn-gold" :disabled="busy" @click="confirmCount">
            <i class="fa-solid fa-clipboard-check" aria-hidden="true" />
            {{ count.location === 'abordo' ? 'Confirmar inventario del barco' : 'Confirmar inventario' }}
          </button>
          <button v-else type="button" class="btn btn-primary" :disabled="busy" @click="submit">
            <i class="fa-solid fa-shield-halved" aria-hidden="true" /> Enviar para revisión
          </button>
        </template>
        <template v-else-if="canApprove">
          <button type="button" class="btn btn-secondary" :disabled="busy" @click="reject">
            <i class="fa-solid fa-rotate-left" aria-hidden="true" /> Devolver para recontar
          </button>
          <button type="button" class="btn btn-primary" :disabled="busy" @click="approve">
            <i class="fa-solid fa-check" aria-hidden="true" /> Aprobar ajuste
          </button>
        </template>
        <p v-else-if="count.status === 'enviado'" class="only-owner">
          <i class="fa-solid fa-lock" aria-hidden="true" /> Pendiente de aprobación de Gerencia.
        </p>
        <p v-else-if="count.status === 'aprobado'" class="done">
          <i class="fa-solid fa-circle-check" aria-hidden="true" />
          Confirmado por {{ count.reviewedBy?.name }} · {{ count.reviewedAt ? formatDateTime(count.reviewedAt) : '' }}
        </p>
      </div>

    </template>
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
  font-size: 0.9rem;
  color: var(--ink-600);

  i {
    color: var(--gold-500);
  }
}

.ct-status {
  margin-left: auto;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: var(--powder-100);

  &--enviado {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }

  &--aprobado {
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }

  &--rechazado {
    background: var(--pill-danger-bg);
    color: var(--pill-danger-ink);
  }
}

.note {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-sm);
  background: rgba(180, 72, 59, 0.08);
  font-size: 0.92rem;
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
  min-height: 48px;
  padding: 0 0.8rem;
  border: 1px solid var(--line-strong);
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
  min-height: 48px;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--ink-600);

  &.on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.ct-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 54dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
}

.ct-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 0.75rem;
  align-items: center;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--rule);
  transition: background 0.2s ease;

  &:last-child {
    border-bottom: none;
  }

  &.counted {
    background: var(--powder-100);
    box-shadow: inset 3px 0 0 var(--navy-600);
  }

  &.diff {
    background: #fbf5ec;
    box-shadow: inset 3px 0 0 var(--warning);
  }
}

.ct-name {
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong {
    font-size: 1.05rem;
    font-weight: 600;
  }

  small {
    color: var(--ink-600);
    font-size: 0.92rem;
  }
}

.ct-count {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
}

.ct-physical {
  display: flex;
  align-items: center;
  gap: 0.4rem;

  span {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--ink-600);
    text-align: right;
  }
}

.ct-diff {
  min-width: 70px;
  color: var(--ink-600);
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 1rem;
}

.ct-reason {
  grid-column: 1 / -1;
}

.physical {
  width: 96px;
  min-height: 48px;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  text-align: right;
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: #fff;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--navy-600);
    box-shadow: var(--focus-ring);
  }
}

.ct-row-enter-active,
.ct-row-leave-active {
  transition: opacity 0.18s ease;
}

.ct-row-enter-from,
.ct-row-leave-to {
  opacity: 0;
}

.neg {
  color: var(--danger-ink);
  font-weight: 700;
}

.pos {
  color: var(--success-ink);
  font-weight: 700;
}

.ct-summary {
  margin: 0 auto 0 0;
  align-self: center;
  font-size: 1rem;
  color: var(--ink-600);

  strong {
    color: var(--ink-900);
  }

  .warnText {
    color: var(--warning-ink);
  }
}

.ct-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;

  .btn {
    flex: 1 1 auto;
  }

  @include tablet {
    .btn {
      flex: 0 0 auto;
    }
  }
}

.ct-hint {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.9rem;
  color: var(--ink-400);
}

.only-owner {
  margin: 0;
  align-self: center;
  color: var(--ink-600);
  font-weight: 600;
  font-size: 0.97rem;
}

.done {
  margin: 0;
  align-self: center;
  color: var(--success-ink);
  font-weight: 600;
}
</style>
