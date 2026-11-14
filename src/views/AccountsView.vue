<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { apiAgencyCourtesies, apiCobroBar, apiCruiseAccounts, apiCruises, apiOrders, apiReviewHeld } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatMoney, TIMEZONE } from '@/utils/format'
import AccountModal from '@/components/accounts/AccountModal.vue'
import GroupCollectModal from '@/components/accounts/GroupCollectModal.vue'
import AgencyCourtesiesModal from '@/components/accounts/AgencyCourtesiesModal.vue'
import CruiseFinishModal from '@/components/cruises/CruiseFinishModal.vue'
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
const route = useRoute()
const router = useRouter()

const cruises = shallowRef<Cruise[]>([])
const selectedId = shallowRef('')
const rows = shallowRef<CabinAccountRow[]>([])
const held = shallowRef<Order[]>([])
const loading = shallowRef(true)
const target = shallowRef<Cabin | null>(null)
const reviewing = shallowRef('')
const showGroup = shallowRef(false)
/** Cabina que entra ya marcada al cobrar cabinas juntas ("otra cabina paga"). */
const groupPreselect = shallowRef<number | null>(null)
const showAgency = shallowRef(false)
/** Cortesías de agencia del crucero (se le facturan a la agencia). */
const agencyTotal = shallowRef(0)

const isBar = computed(() => userStore.role === 'bartender')
const cruise = computed(() => cruises.value.find((c) => c._id === selectedId.value) ?? active.value ?? null)

/**
 * Estado que se muestra: "en revisión" es heredado (el bar ya no envía a
 * revisión, los aprobadores aprueban directo) y se ve como abierta.
 */
type ShownStatus = Exclude<AccountStatus, 'en_revision'>
const shown = (status: AccountStatus): ShownStatus => (status === 'en_revision' ? 'abierta' : status)

const STATUS: Record<ShownStatus, { label: string; icon: string }> = {
  abierta: { label: 'Abierta', icon: 'fa-folder-open' },
  aprobada: { label: 'Aprobada', icon: 'fa-shield-halved' },
  cobrada: { label: 'Pagada', icon: 'fa-circle-check' },
}

type Filter = 'todas' | 'aprobada' | 'cobrada'
const filter = shallowRef<Filter>('todas')

/** Cabina con movimiento: consumos abiertos, pagados o cuenta ya pagada. */
const hasActivity = (r: CabinAccountRow) => Boolean(r.orders || r.paidOrders || r.status === 'cobrada')
const activeRows = computed(() => rows.value.filter(hasActivity))
const idleRows = computed(() => rows.value.filter((r) => !hasActivity(r)))
const visibleRows = computed(() =>
  filter.value === 'todas' ? activeRows.value : activeRows.value.filter((r) => r.status === filter.value),
)

/** Filtros (pedido 31-oct-2026): Todas · Aprobadas · Pagadas, con conteo de las mismas filas. */
const filters = computed(() => {
  const count = (s: AccountStatus) => activeRows.value.filter((r) => r.status === s).length
  return [
    { key: 'todas' as Filter, label: 'Todas', count: activeRows.value.length },
    { key: 'aprobada' as Filter, label: 'Aprobadas', count: count('aprobada') },
    { key: 'cobrada' as Filter, label: 'Pagadas', count: count('cobrada') },
  ]
})

/** Lo siguiente que toca en cada cuenta, según el rol. */
function nextStep(row: CabinAccountRow): { text: string; tone: 'act' | 'wait' | 'done' } {
  if (row.status === 'cobrada') return { text: 'Ver cuenta pagada', tone: 'done' }
  // Crucero unido: la cuenta sigue abierta en el otro crucero y se cobra allá.
  if (row.continuesTo) return { text: `Se cobra en ${row.continuesTo}`, tone: 'wait' }
  if (isBar.value) {
    if (row.status === 'aprobada') return { text: 'Aprobada, lista para cobrar', tone: 'wait' }
    return { text: 'Ver consumos', tone: 'act' }
  }
  if (row.status === 'aprobada') return { text: `Cobrar ${formatMoney(row.due)}`, tone: 'act' }
  return { text: row.orders ? 'Revisar y aprobar' : 'Ver cuenta', tone: 'act' }
}

/** Parte cobrada de lo consumido (pagos parciales). */
function paidShare(row: CabinAccountRow) {
  return row.consumed > 0 ? Math.min(100, (row.paid / row.consumed) * 100) : 0
}

/** "14 nov" en hora de Galápagos. */
const shortDay = (d: string) =>
  new Date(d).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', timeZone: TIMEZONE }).replace('.', '')

// Con las fechas se encuentra el crucero (pedido del cliente, 14-nov-2026).
const cruiseOptions = computed(() =>
  cruises.value.map((c) => ({
    value: c._id,
    label: `${shortDay(c.startDate)}${c.endDate ? ` → ${shortDay(c.endDate)}` : ''} · ${c.code || c.name}${c.status === 'abordo' ? ' · en curso' : c.status === 'cerrado' ? ' · finalizado' : ' · programado'}`,
  })),
)

const totals = computed(() => {
  const withDue = rows.value.filter((r) => r.due > 0)
  const approved = rows.value.filter((r) => r.status === 'aprobada')
  return {
    open: withDue.reduce((s, r) => s + r.due, 0),
    openCabins: withDue.length,
    consumed: rows.value.reduce((s, r) => s + r.consumed, 0),
    paid: rows.value.reduce((s, r) => s + r.paid, 0),
    ready: approved.reduce((s, r) => s + r.due, 0),
    readyCabins: approved.length,
    // Por aprobar: cuentas abiertas con consumos sin cobrar.
    toApprove: rows.value.filter((r) => shown(r.status) === 'abierta' && r.orders > 0).length,
  }
})

async function loadRows() {
  if (!cruise.value) return
  try {
    rows.value = await apiCruiseAccounts(cruise.value._id)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
  if (userStore.isDirector) {
    try {
      agencyTotal.value = (await apiAgencyCourtesies(cruise.value._id)).total
    } catch {
      agencyTotal.value = 0
    }
  }
}

/**
 * Finalizar el crucero desde Cuentas (pedido 3-nov-2026). No se finaliza
 * solo al quedar todo pagado: el bar puede seguir sirviendo y el cierre
 * revisa las tabletas; con todo pagado se ofrece de forma destacada.
 */
const finishTarget = shallowRef<Cruise | null>(null)
const canFinish = computed(() => !isBar.value && userStore.isDirector && cruise.value?.status === 'abordo')
const allSettled = computed(() => activeRows.value.length > 0 && totals.value.open === 0)

/** Excel «Cobro bar» del crucero elegido (pedido del cliente, 14-nov-2026). */
const downloading = shallowRef(false)
async function downloadCobroBar() {
  if (!cruise.value || downloading.value) return
  downloading.value = true
  try {
    const { blob, fileName } = await apiCobroBar(cruise.value._id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    downloading.value = false
  }
}

async function loadCruises() {
  const list = await apiCruises()
  // En curso primero, luego finalizadas recientes y programadas próximas.
  const byStart = (a: Cruise, b: Cruise) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  cruises.value = [
    ...list.filter((c) => c.status === 'abordo'),
    ...list.filter((c) => c.status === 'planificado').sort(byStart).slice(0, 3),
    ...list.filter((c) => c.status === 'cerrado').sort((a, b) => byStart(b, a)).slice(0, 20),
  ]
}

async function onFinished() {
  finishTarget.value = null
  await Promise.all([loadCruises(), cruiseStore.loadActive(true)])
  await loadRows()
}

/** Cabinas aprobadas con saldo: con dos o más se pueden cobrar juntas. */
const groupable = computed(() => rows.value.filter((r) => r.status === 'aprobada' && r.due > 0).length)

async function onGroupCollected() {
  showGroup.value = false
  groupPreselect.value = null
  await onChanged()
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
    if (!isBar.value) await loadCruises()
    selectedId.value = active.value?._id ?? cruises.value[0]?._id ?? ''
    await Promise.all([loadRows(), loadHeld()])
    openFromQuery()
  } finally {
    loading.value = false
  }
})

/** "Ir a cuenta" desde el Bar llega con ?cabina=N: abre esa cuenta del crucero en curso. */
function openFromQuery() {
  const n = Number(route.query.cabina)
  if (!n || !cruise.value) return
  const cabin = cruise.value.cabins.find((c) => c.number === n)
  if (cabin) target.value = cabin
  void router.replace({ query: {} })
}

/** Desde la cuenta de una cabina: otra cabina le paga (cobro de cabinas juntas). */
function groupWith(cabinNumber: number) {
  target.value = null
  groupPreselect.value = cabinNumber
  showGroup.value = true
}

async function changeCruise(id: string) {
  selectedId.value = id
  filter.value = 'todas'
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
  return c ? (c.code ? `Crucero ${c.code}` : c.name) : 'Crucero anterior'
}

/** Envío tardío: aceptar lo carga en su salida original; rechazar lo descarta con motivo. */
async function reviewHeld(order: Order, decision: 'aceptar' | 'rechazar') {
  const item = order.items[0]!
  const reason = await confirmStore.askReason({
    title: decision === 'aceptar' ? `¿Aceptar ${item.qty} ${item.name} en cabina ${order.cabinNumber}?` : `¿Rechazar ${item.name}?`,
    message:
      decision === 'aceptar'
        ? `Se carga en ${heldCruise(order)} (su crucero original) y descuenta el stock a bordo. Nunca pasa al crucero nuevo.`
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
    toast.success(decision === 'aceptar' ? 'Consumo aceptado en su crucero original' : 'Consumo rechazado')
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
  <div class="page accounts-page">
    <header class="head">
      <div class="head-title">
        <h1 class="page-title">Cuentas por cabina</h1>
        <p v-if="cruise" class="subtitle">
          {{ cruise.code ? `Crucero ${cruise.code}` : cruise.name }}
          <template v-if="cruise.routeFrom"> · {{ cruise.routeFrom }} → {{ cruise.routeTo }}</template>
        </p>
      </div>
      <div v-if="!isBar && cruiseOptions.length" class="cruise-pick">
        <BaseSelect :model-value="selectedId" :options="cruiseOptions" aria-label="Crucero" @update:model-value="changeCruise" />
        <button v-if="cruise" type="button" class="btn btn-secondary cobro-bar" :disabled="downloading" @click="downloadCobroBar">
          <i class="fa-solid" :class="downloading ? 'fa-spinner fa-spin' : 'fa-file-excel'" aria-hidden="true" />
          {{ downloading ? 'Generando…' : 'Descargar cobro bar (Excel)' }}
        </button>
      </div>
    </header>

    <Transition name="fade">
      <section v-if="held.length" class="held" aria-labelledby="held-title">
        <div class="held-head">
          <h2 id="held-title">
            <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
            Consumos enviados tarde · {{ held.length }}
          </h2>
          <p>Llegaron con el crucero ya finalizado. Se cargan siempre en su crucero original.</p>
        </div>
        <TransitionGroup name="fade" tag="ul" class="held-list">
          <li v-for="order in held" :key="order._id" class="held-row">
            <div class="held-text">
              <strong>{{ order.items[0]?.qty }} × {{ order.items[0]?.name }}</strong>
              <span>
                {{ heldCruise(order) }} · cabina {{ order.cabinNumber }} · tocado
                {{ formatDateTime(order.clientAt ?? order.createdAt) }}{{
                  typeof order.createdBy === 'object' ? ` · ${order.createdBy.name}` : ''
                }}
              </span>
            </div>
            <div class="held-actions">
              <button type="button" class="btn btn-ghost" :disabled="reviewing === order._id" @click="reviewHeld(order, 'rechazar')">
                Rechazar
              </button>
              <button type="button" class="btn btn-primary" :disabled="reviewing === order._id" @click="reviewHeld(order, 'aceptar')">
                Aceptar
              </button>
            </div>
          </li>
        </TransitionGroup>
      </section>
    </Transition>

    <div v-if="loading" class="loading">
      <SkeletonList variant="card" :rows="6" />
    </div>

    <p v-else-if="!cruise" class="empty">No hay crucero en curso ni programado.</p>

    <template v-else>
      <!-- Saldo del crucero: la cifra que responde «¿cuánto falta cobrar?» -->
      <section class="ledger" aria-label="Saldo del crucero">
        <div class="ledger-main">
          <span class="ledger-label">{{ isBar ? 'Consumos abiertos' : 'Por cobrar en este crucero' }}</span>
          <strong class="ledger-value" :class="{ 'ledger-value--zero': totals.open === 0 }">{{ formatMoney(totals.open) }}</strong>
          <span class="ledger-sub">
            <template v-if="totals.openCabins">{{ totals.openCabins }} {{ totals.openCabins === 1 ? 'cabina' : 'cabinas' }} con saldo</template>
            <template v-else>Ninguna cabina con saldo</template>
            <template v-if="!isBar && totals.paid > 0"> · {{ formatMoney(totals.paid) }} ya cobrado</template>
          </span>
        </div>
        <div v-if="!isBar" class="ledger-side">
          <div class="ledger-cell">
            <span class="ledger-label">Listas para cobrar</span>
            <strong>{{ totals.readyCabins ? formatMoney(totals.ready) : '—' }}</strong>
            <span class="ledger-sub">{{ totals.readyCabins }} {{ totals.readyCabins === 1 ? 'cuenta aprobada' : 'cuentas aprobadas' }}</span>
          </div>
          <div class="ledger-cell">
            <span class="ledger-label">Por aprobar</span>
            <strong>{{ totals.toApprove }}</strong>
            <span class="ledger-sub">{{ totals.toApprove === 1 ? 'cuenta con consumos' : 'cuentas con consumos' }}</span>
          </div>
        </div>
      </section>

      <!-- Todo pagado: finalizar el crucero desde aquí -->
      <Transition name="fade">
        <section v-if="canFinish && allSettled" class="finish-ready" aria-labelledby="finish-ready-title">
          <i class="fa-solid fa-circle-check finish-ready-icon" aria-hidden="true" />
          <div class="finish-ready-text">
            <strong id="finish-ready-title">Todas las cuentas están pagadas</strong>
            <span>Si el viaje terminó, finaliza el crucero. No se borra nada: queda en Finalizados y el siguiente empieza en cero.</span>
          </div>
          <button type="button" class="btn btn-primary" @click="finishTarget = cruise">
            <i class="fa-solid fa-flag-checkered" aria-hidden="true" /> Finalizar crucero
          </button>
        </section>
      </Transition>

      <!-- Dirección: cobrar varias cabinas a un pagador, la cuenta de la agencia y el fin del crucero -->
      <div v-if="!isBar && userStore.isDirector" class="actions-row" :class="{ 'actions-row--three': canFinish && !allSettled }">
        <button type="button" class="action" :disabled="groupable < 2" @click="groupPreselect = null; showGroup = true">
          <i class="fa-solid fa-people-group" aria-hidden="true" />
          <span>
            <strong>Cobrar cabinas juntas</strong>
            <small>{{ groupable < 2 ? 'Necesitas dos o más cuentas aprobadas' : 'Una persona paga varias cabinas' }}</small>
          </span>
        </button>
        <button type="button" class="action action--agency" @click="showAgency = true">
          <i class="fa-solid fa-handshake" aria-hidden="true" />
          <span>
            <strong>Cortesías de agencia · {{ formatMoney(agencyTotal) }}</strong>
            <small>Se facturan a la agencia al final del crucero</small>
          </span>
        </button>
        <button v-if="canFinish && !allSettled" type="button" class="action" @click="finishTarget = cruise">
          <i class="fa-solid fa-flag-checkered" aria-hidden="true" />
          <span>
            <strong>Finalizar crucero</strong>
            <small>
              {{ totals.openCabins ? `${totals.openCabins} ${totals.openCabins === 1 ? 'cabina' : 'cabinas'} con saldo: se puede cobrar después` : 'Cierra el viaje; nada se borra' }}
            </small>
          </span>
        </button>
      </div>

      <!-- Filtro por estado: conteos de las mismas cuentas que se listan -->
      <div v-if="activeRows.length" class="filters" role="tablist" aria-label="Filtrar cuentas por estado">
        <button
          v-for="f in filters"
          :key="f.key"
          type="button"
          role="tab"
          class="filter"
          :class="{ 'filter--on': filter === f.key, 'filter--empty': !f.count }"
          :aria-selected="filter === f.key"
          @click="filter = f.key"
        >
          {{ f.label }} <span class="filter-count">{{ f.count }}</span>
        </button>
      </div>

      <TransitionGroup v-if="visibleRows.length" name="cards" tag="div" class="accounts">
        <button
          v-for="row in visibleRows"
          :key="row.cabinNumber"
          type="button"
          class="account"
          :class="`account--${shown(row.status)}`"
          @click="open(row)"
        >
          <span class="account-top">
            <span class="account-cabin">
              <small>Cabina</small>
              <span class="account-number">{{ row.cabinNumber }}</span>
            </span>
            <span class="pill" :class="`pill--${shown(row.status)}`">
              <i class="fa-solid" :class="STATUS[shown(row.status)].icon" aria-hidden="true" />
              {{ STATUS[shown(row.status)].label }}
            </span>
          </span>
          <span class="account-guest">{{ row.guestName || 'Sin pasajeros' }}</span>
          <span v-if="row.continuesTo" class="account-guest">
            <i class="fa-solid fa-link" aria-hidden="true" /> Sigue en {{ row.continuesTo }}
          </span>

          <span class="account-figure">
            <template v-if="isBar">
              <strong>{{ formatMoney(row.consumed) }}</strong>
              <small>{{ row.orders + row.paidOrders }} {{ row.orders + row.paidOrders === 1 ? 'consumo' : 'consumos' }}</small>
            </template>
            <template v-else-if="row.status === 'cobrada'">
              <strong class="is-settled">{{ formatMoney(row.consumed) }}</strong>
              <small>cobrado completo</small>
            </template>
            <template v-else>
              <strong>{{ formatMoney(row.due) }}</strong>
              <small>por cobrar</small>
            </template>
          </span>

          <!-- Pago parcial: cuánto de lo consumido ya se cobró -->
          <span v-if="!isBar && row.paid > 0 && row.status !== 'cobrada'" class="account-progress">
            <span class="track" aria-hidden="true"><span class="fill" :style="{ width: `${paidShare(row)}%` }" /></span>
            <span class="progress-text">Cobrado {{ formatMoney(row.paid) }} de {{ formatMoney(row.consumed) }}</span>
          </span>
          <span v-else-if="!isBar" class="account-progress account-progress--plain">
            {{ row.orders + row.paidOrders }} {{ row.orders + row.paidOrders === 1 ? 'consumo' : 'consumos' }}
          </span>

          <span v-if="row.pendingDeliveries" class="account-warn">
            <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
            {{ row.pendingDeliveries }} por entregar
          </span>

          <span class="account-next" :class="`account-next--${nextStep(row).tone}`">
            {{ nextStep(row).text }}
            <i class="fa-solid fa-arrow-right" aria-hidden="true" />
          </span>
        </button>
      </TransitionGroup>
      <p v-else-if="activeRows.length" class="empty-filter">
        Ninguna cuenta {{ filters.find((f) => f.key === filter)?.label.toLowerCase() }} en este crucero.
        <button type="button" class="link" @click="filter = 'todas'">Ver todas</button>
      </p>
      <p v-else class="empty-filter">Todavía no hay consumos en este crucero.</p>

      <!-- Cabinas sin consumos: se abren igual (QR y pagador) -->
      <section v-if="idleRows.length && filter === 'todas'" class="idle" aria-labelledby="idle-title">
        <h2 id="idle-title" class="idle-title">Sin consumos</h2>
        <div class="idle-list">
          <button v-for="row in idleRows" :key="row.cabinNumber" type="button" class="idle-cabin" @click="open(row)">
            <span class="idle-number">{{ row.cabinNumber }}</span>
            <span class="idle-guest">{{ row.guestName || 'Sin pasajeros' }}</span>
          </button>
        </div>
      </section>
    </template>

    <AccountModal
      v-if="target && cruise"
      :cruise-id="cruise._id"
      :cabin="target"
      @close="target = null"
      @changed="onChanged"
      @group-with="groupWith"
    />
    <GroupCollectModal
      v-if="showGroup && cruise"
      :cruise="cruise"
      :rows="rows"
      :preselect="groupPreselect"
      @close="showGroup = false; groupPreselect = null"
      @collected="onGroupCollected"
    />
    <AgencyCourtesiesModal v-if="showAgency && cruise" :cruise="cruise" @close="showAgency = false" />
    <CruiseFinishModal v-if="finishTarget" :cruise="finishTarget" @close="finishTarget = null" @finished="onFinished" />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

/*
 * Cuentas: tinta y azul profundo en lo operativo; el color solo marca estado
 * (pastillas pálidas) y la acción de cobrar (caramelo). Sin sombras en reposo:
 * las tarjetas se separan por un borde de 1 px sobre el fondo empolvado.
 */
.accounts-page {
  --line: #dbe4eb;
  --line-strong: #c3d1dc;
  --muted: #55636d;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;

  .page-title {
    margin-bottom: 0.2rem;
  }
}

.subtitle {
  margin: 0;
  font-size: 1rem;
  color: var(--muted);
}

.cruise-pick {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  @include tablet {
    flex: 0 1 320px;
    min-width: 260px;
  }
}

// Saldo del crucero
.ledger {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);

  @include tablet {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr);
  }
}

.ledger-main,
.ledger-cell {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 1rem 1.25rem;
  min-width: 0;
}

.ledger-side {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--line);

  @include tablet {
    border-top: 0;
    border-left: 1px solid var(--line);
  }

  .ledger-cell + .ledger-cell {
    border-left: 1px solid var(--line);
  }

  strong {
    font-size: 1.375rem;
    font-weight: 600;
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;
  }
}

.ledger-label {
  font-size: 0.875rem;
  color: var(--muted);
}

.ledger-value {
  font-size: 2rem;
  line-height: 1.1;
  font-weight: 600;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;

  &--zero {
    color: var(--muted);
  }
}

.ledger-sub {
  font-size: 0.875rem;
  color: var(--muted);
}

// Filtros por estado
.actions-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  margin-bottom: 1rem;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

// Con "Finalizar crucero": en tableta va abajo a lo ancho; en escritorio, tres columnas.
.actions-row--three {
  @include tablet {
    > .action:nth-child(3) {
      grid-column: 1 / -1;
    }
  }

  @include desktop {
    grid-template-columns: repeat(3, minmax(0, 1fr));

    > .action:nth-child(3) {
      grid-column: auto;
    }
  }
}

// Todo pagado: el siguiente paso es finalizar el crucero.
.finish-ready {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-bottom: 1rem;
  padding: 0.9rem 1rem;
  border: 1.5px solid var(--success);
  border-radius: var(--radius-sm);
  background: var(--surface);

  .btn {
    margin-left: auto;
  }
}

.finish-ready-icon {
  font-size: 1.5rem;
  color: var(--success);
}

.finish-ready-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1 1 260px;
  min-width: 0;

  strong {
    font-size: 1.0625rem;
    color: var(--ink-900);
  }

  span {
    font-size: 0.9375rem;
    color: var(--ink-600);
  }
}

.action {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 60px;
  padding: 0.6rem 0.9rem;
  border: 1.5px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  > i {
    font-size: 1.2rem;
    color: var(--navy-700);
  }

  span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  small {
    color: var(--ink-400);
    font-size: 0.8rem;
  }

  &:hover:not(:disabled) {
    border-color: var(--navy-600);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.5;
  }

  &--agency > i {
    color: var(--pill-warn-ink);
  }
}

.filters {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  scrollbar-width: none;
  margin: 0 -1rem;
  padding: 0 1rem;

  @include tablet {
    flex-wrap: wrap;
    margin: 0;
    padding: 0;
  }
}

.filter {
  @include touch-target;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 1rem;
  font-weight: 500;
  color: var(--ink-900);
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.12s ease;

  &:hover:not(.filter--on) {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.97);
  }

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }

  &--empty:not(.filter--on) {
    color: var(--muted);
  }
}

.filter-count {
  min-width: 1.5rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--powder-100);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.5rem;
  text-align: center;
  color: var(--navy-900);
  font-variant-numeric: tabular-nums;
  transition: background 0.18s ease;

  .filter--on & {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
  }
}

// Tarjetas de cuenta
.accounts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(216px, 1fr));
  }
}

.account {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
  padding: 1rem 1.125rem 0.875rem;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  transition:
    border-color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.985);
  }

  &:focus-visible {
    outline: 2px solid var(--navy-700);
    outline-offset: 2px;
  }
}

.account-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.account-cabin {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;

  small {
    font-size: 0.875rem;
    color: var(--muted);
  }
}

.account-number {
  font-family: var(--font-serif);
  font-size: 2rem;
  line-height: 1;
  color: var(--navy-800);
}

.pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  background: #eef2f5;
  color: #3c4a54;

  i {
    font-size: 0.75rem;
  }

  &--aprobada {
    background: #e2efe6;
    color: #255a3b;
  }

  &--cobrada {
    background: var(--powder-200);
    color: var(--navy-900);
  }
}

.account-guest {
  font-size: 1rem;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-figure {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 0.45rem;
  margin-top: 0.35rem;

  strong {
    font-size: 1.625rem;
    font-weight: 600;
    color: var(--ink-900);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;

    &.is-settled {
      color: var(--muted);
    }
  }

  small {
    font-size: 0.875rem;
    color: var(--muted);
  }
}

.account-progress {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.875rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.track {
  display: block;
  height: 6px;
  border-radius: 999px;
  background: var(--powder-100);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--navy-700);
  transition: width 0.3s ease;
}

.account-warn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #8a5d1d;
}

.account-next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.75rem;
  min-height: 2.5rem;
  border-top: 1px solid var(--line);
  font-size: 1rem;
  font-weight: 500;
  color: var(--navy-800);

  i {
    font-size: 0.8rem;
    transition: transform 0.18s ease;
  }

  .account:hover & i {
    transform: translateX(3px);
  }

  &--wait,
  &--done {
    color: var(--muted);
    font-weight: 400;
  }

  .account--aprobada &--act {
    color: var(--gold-500);
  }
}

.empty,
.empty-filter {
  margin: 0;
  padding: 1rem 1.25rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  font-size: 1rem;
  color: var(--muted);
}

.link {
  min-height: 44px;
  margin-left: 0.25rem;
  font-weight: 500;
  color: var(--navy-800);
  text-decoration: underline;
  text-underline-offset: 3px;
}

// Cabinas sin consumos
.idle {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.idle-title {
  font-size: 1.125rem;
  color: var(--ink-900);
}

.idle-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.idle-cabin {
  @include touch-target;
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0 1rem 0 0.4rem;
  border-radius: 999px;
  border: 1px dashed var(--line-strong);
  font-size: 1rem;
  color: var(--muted);
  transition:
    border-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    border-color: var(--navy-600);
    color: var(--ink-900);
  }
}

.idle-number {
  width: 2.25rem;
  height: 2.25rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--powder-100);
  font-family: var(--font-serif);
  font-size: 1.125rem;
  color: var(--navy-800);
}

// Consumos enviados tarde
.held {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.25rem 0.5rem;
  border-radius: var(--radius);
  background: #fbf5ec;
  border: 1px solid #ead7b8;
}

.held-head {
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.125rem;
    color: #6f4a16;
  }

  p {
    margin: 0.25rem 0 0.5rem;
    font-size: 0.9375rem;
    color: #5c4a33;
  }
}

.held-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.held-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem 1rem;
  padding: 0.75rem 0;
  border-top: 1px solid #ead7b8;
}

.held-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;

  strong {
    font-weight: 500;
    font-size: 1rem;
  }

  span {
    font-size: 0.875rem;
    color: #5c4a33;
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

.cards-enter-active,
.cards-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.cards-enter-from,
.cards-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.cards-leave-active {
  position: absolute;
  visibility: hidden;
}

.cards-move {
  transition: transform 0.24s ease;
}
</style>
