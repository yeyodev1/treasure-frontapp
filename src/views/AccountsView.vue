<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { apiCruiseAccounts, apiCruises, apiOrders, apiReviewHeld } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatMoney } from '@/utils/format'
import AccountModal from '@/components/accounts/AccountModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { AccountStatus, Cabin, CabinAccountRow, Cruise, Order } from '@/types'

/**
 * Cuentas por cabina. Revisión y pagos se hacen durante el viaje o después:
 * Dirección elige la salida (en curso o finalizada con saldo). El bar ve
 * consumos, sin cobros ni costos.
 */
const cruiseStore = useCruiseStore()
const toast = useToastStore()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { play } = useSound()
const { active } = storeToRefs(cruiseStore)

const cruises = shallowRef<Cruise[]>([])
const selectedId = shallowRef('')
const rows = shallowRef<CabinAccountRow[]>([])
const held = shallowRef<Order[]>([])
const loading = shallowRef(true)
const target = shallowRef<Cabin | null>(null)
const reviewing = shallowRef('')

const isBar = computed(() => userStore.role === 'bartender')
const cruise = computed(() => cruises.value.find((c) => c._id === selectedId.value) ?? active.value ?? null)

const STATUS: Record<AccountStatus, { label: string; icon: string }> = {
  abierta: { label: 'Abierta', icon: 'fa-folder-open' },
  en_revision: { label: 'En revisión', icon: 'fa-hourglass-half' },
  aprobada: { label: 'Aprobada', icon: 'fa-shield-halved' },
  cobrada: { label: 'Pagada', icon: 'fa-circle-check' },
}

const cruiseOptions = computed(() =>
  cruises.value.map((c) => ({
    value: c._id,
    label: `${c.code ? `Salida ${c.code}` : c.name}${c.status === 'abordo' ? ' · en curso' : c.status === 'cerrado' ? ' · finalizada' : ' · programada'}`,
  })),
)

const totals = computed(() => ({
  open: rows.value.reduce((s, r) => s + r.due, 0),
  review: rows.value.filter((r) => r.status === 'en_revision').length,
  approved: rows.value.filter((r) => r.status === 'aprobada').length,
}))

async function loadRows() {
  if (!cruise.value) return
  try {
    rows.value = await apiCruiseAccounts(cruise.value._id)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

async function loadHeld() {
  if (!userStore.isDirector) return
  try {
    held.value = (await apiOrders({ status: 'retenida', limit: 100 })).orders
  } catch {
    held.value = []
  }
}

onMounted(async () => {
  try {
    await cruiseStore.loadActive(true)
    if (!isBar.value) {
      const list = await apiCruises()
      // En curso primero, luego finalizadas recientes y programadas próximas.
      cruises.value = [
        ...list.filter((c) => c.status === 'abordo'),
        ...list.filter((c) => c.status === 'cerrado').reverse().slice(0, 12),
        ...list.filter((c) => c.status === 'planificado').slice(0, 3),
      ]
    }
    selectedId.value = active.value?._id ?? cruises.value[0]?._id ?? ''
    await Promise.all([loadRows(), loadHeld()])
  } finally {
    loading.value = false
  }
})

async function changeCruise(id: string) {
  selectedId.value = id
  loading.value = true
  await loadRows()
  loading.value = false
}

function open(row: CabinAccountRow) {
  const cabin = cruise.value?.cabins.find((c) => c.number === row.cabinNumber)
  if (cabin) target.value = cabin
}

async function onChanged() {
  await Promise.all([loadRows(), cruiseStore.loadActive(true)])
}

function heldCruise(order: Order) {
  const c = cruises.value.find((x) => x._id === order.cruise)
  return c ? (c.code ? `Salida ${c.code}` : c.name) : 'Salida anterior'
}

/** Envío tardío: aceptar lo carga en su salida original; rechazar lo descarta con motivo. */
async function reviewHeld(order: Order, decision: 'aceptar' | 'rechazar') {
  const item = order.items[0]!
  const reason = await confirmStore.askReason({
    title: decision === 'aceptar' ? `¿Aceptar ${item.qty} ${item.name} en cabina ${order.cabinNumber}?` : `¿Rechazar ${item.name}?`,
    message:
      decision === 'aceptar'
        ? `Se carga en ${heldCruise(order)} (su salida original) y descuenta el stock a bordo. Nunca pasa al viaje nuevo.`
        : 'No se carga ni descuenta nada. Queda registrado con el motivo.',
    confirmLabel: decision === 'aceptar' ? 'Aceptar' : 'Rechazar',
    danger: decision === 'rechazar',
    icon: decision === 'aceptar' ? 'fa-check' : 'fa-ban',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: decision === 'aceptar' ? ['Se sirvió antes del cierre'] : ['No se sirvió', 'Registro duplicado'],
    },
  })
  if (!reason) return
  reviewing.value = order._id
  try {
    await apiReviewHeld(order._id, decision, reason)
    play('success')
    toast.success(decision === 'aceptar' ? 'Consumo aceptado en su salida original' : 'Consumo rechazado')
    await Promise.all([loadHeld(), loadRows()])
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    reviewing.value = ''
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">Cuentas por cabina</h1>
        <p v-if="cruise && isBar" class="subtitle">
          {{ cruise.code ? `Salida ${cruise.code}` : cruise.name }}
          <template v-if="cruise.routeFrom"> · {{ cruise.routeFrom }} → {{ cruise.routeTo }}</template>
        </p>
        <div v-else-if="cruiseOptions.length" class="cruise-pick">
          <BaseSelect :model-value="selectedId" :options="cruiseOptions" aria-label="Salida" @update:model-value="changeCruise" />
        </div>
      </div>
      <div v-if="!loading && rows.length" class="summary">
        <span v-if="!isBar"><strong>{{ formatMoney(totals.open) }}</strong> por cobrar</span>
        <span v-else><strong>{{ formatMoney(totals.open) }}</strong> en consumos abiertos</span>
        <span v-if="totals.review" class="chip chip--review">{{ totals.review }} en revisión</span>
        <span v-if="totals.approved" class="chip chip--ok">{{ totals.approved }} aprobadas</span>
      </div>
    </header>

    <Transition name="fade">
      <section v-if="held.length" class="held">
        <h2><i class="fa-solid fa-hourglass-half" aria-hidden="true" /> Consumos enviados tarde, pendientes de revisión</h2>
        <p class="muted">Llegaron con la salida ya finalizada. Revísalos: se cargan siempre en su salida original.</p>
        <div v-for="order in held" :key="order._id" class="held-row">
          <span>
            <strong>{{ heldCruise(order) }} · cabina {{ order.cabinNumber }}</strong>
            {{ order.items[0]?.qty }} × {{ order.items[0]?.name }}
            <small>tocado {{ formatDateTime(order.clientAt ?? order.createdAt) }} · {{ typeof order.createdBy === 'object' ? order.createdBy.name : '' }}</small>
          </span>
          <span class="held-actions">
            <button type="button" class="btn btn-ghost" :disabled="reviewing === order._id" @click="reviewHeld(order, 'rechazar')">Rechazar</button>
            <button type="button" class="btn btn-primary" :disabled="reviewing === order._id" @click="reviewHeld(order, 'aceptar')">Aceptar</button>
          </span>
        </div>
      </section>
    </Transition>

    <SkeletonList v-if="loading" variant="card" :rows="9" />

    <p v-else-if="!cruise" class="empty">No hay salida activa ni programada.</p>

    <div v-else class="accounts">
      <button
        v-for="row in rows"
        :key="row.cabinNumber"
        type="button"
        class="account"
        :class="[`account--${row.status}`, { 'account--idle': !row.orders && row.status !== 'cobrada' }]"
        @click="open(row)"
      >
        <header class="account-head">
          <span class="account-chip">{{ row.cabinNumber }}</span>
          <span class="account-guest">{{ row.guestName || 'Sin pasajeros' }}</span>
          <span class="account-status">
            <i class="fa-solid" :class="STATUS[row.status].icon" aria-hidden="true" />
            {{ STATUS[row.status].label }}
          </span>
        </header>

        <!-- Pagada: conserva importes (Consumos · Pagado · Por cobrar) -->
        <template v-if="row.paidOrders && !isBar">
          <p class="account-total">{{ formatMoney(row.consumed) }}</p>
          <p class="account-sums">
            <span>Consumos {{ formatMoney(row.consumed) }}</span>
            <span>Pagado {{ formatMoney(row.paid) }}</span>
            <span :class="{ 'account-pending': row.due > 0 }">Por cobrar {{ formatMoney(row.due) }}</span>
          </p>
          <p class="account-meta">
            <span><i class="fa-solid fa-magnifying-glass" aria-hidden="true" /> Ver detalle</span>
            <span v-if="row.pendingDeliveries" class="account-pending">
              <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
              {{ row.pendingDeliveries }} por entregar
            </span>
          </p>
        </template>
        <template v-else-if="row.orders || row.paidOrders">
          <p class="account-total">{{ formatMoney(isBar ? row.consumed : row.total) }}</p>
          <p class="account-meta">
            <span><i class="fa-solid fa-receipt" aria-hidden="true" /> {{ row.orders + row.paidOrders }} consumo(s)</span>
            <span v-if="row.pendingDeliveries" class="account-pending">
              <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
              {{ row.pendingDeliveries }} por entregar
            </span>
          </p>
        </template>
        <p v-else class="account-idle-text">
          <i class="fa-regular fa-moon" aria-hidden="true" /> Sin consumos
        </p>
      </button>
    </div>

    <AccountModal
      v-if="target && cruise"
      :cruise-id="cruise._id"
      :cabin="target"
      @close="target = null"
      @changed="onChanged"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.cruise-pick {
  min-width: 280px;
  margin-top: 0.4rem;
}

.held {
  margin-bottom: 1.2rem;
  padding: 1rem 1.1rem;
  border-radius: var(--radius);
  background: rgba(185, 128, 47, 0.08);
  border: 1px solid rgba(185, 128, 47, 0.35);

  h2 {
    font-size: 1rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    color: #7a5419;
  }

  .muted {
    margin: 0.3rem 0 0.7rem;
    font-size: 0.86rem;
    color: var(--ink-600);
  }
}

.held-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0;
  border-top: 1px dashed rgba(185, 128, 47, 0.35);

  small {
    display: block;
    color: var(--ink-400);
  }
}

.held-actions {
  display: flex;
  gap: 0.5rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.subtitle {
  margin: 0;
  color: var(--ink-400);
  font-weight: 600;
}

.summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  font-size: 0.9rem;
  color: var(--ink-600);
}

.chip {
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;

  &--review {
    background: rgba(185, 128, 47, 0.16);
    color: #8a5d1d;
  }

  &--ok {
    background: rgba(63, 122, 87, 0.14);
    color: var(--success);
  }
}

.empty {
  color: var(--ink-400);
}

.accounts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.75rem;
}

.account {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 1rem;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;

  &:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  &--en_revision {
    border-color: rgba(185, 128, 47, 0.6);
  }

  &--aprobada {
    border-color: rgba(63, 122, 87, 0.6);
  }

  &--idle {
    background: transparent;
    box-shadow: none;
    border-style: dashed;
  }
}

.account-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.account-chip {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;

  .account--idle & {
    background: var(--cream-200);
    color: var(--ink-400);
  }
}

.account-guest {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-status {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--ink-400);

  .account--en_revision & {
    color: #8a5d1d;
  }

  .account--aprobada & {
    color: var(--success);
  }

  .account--cobrada & {
    color: var(--navy-700);
  }
}

.account-total {
  margin: 0.45rem 0 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;
}

.account-meta {
  margin: 0;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: var(--ink-400);

  i {
    color: var(--gold-500);
  }
}

.account-pending {
  color: var(--warning);
  font-weight: 600;
}

.account-sums {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.7rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-600);
  font-variant-numeric: tabular-nums;
}

.account-idle-text {
  margin: 0.7rem 0 0.2rem;
  font-size: 0.85rem;
  color: var(--ink-400);
}
</style>
