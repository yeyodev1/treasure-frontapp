<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import RequisitionCard from '@/components/supply/RequisitionCard.vue'
import RequisitionCreate from '@/components/supply/RequisitionCreate.vue'
import RequisitionReceive from '@/components/supply/RequisitionReceive.vue'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import {
  apiCancelRequisition,
  apiCounts,
  apiRequisitions,
  apiResolveRequisition,
  apiReviewRequisition,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import type { Requisition, RequisitionStatus } from '@/types'

type Tab = 'mios' | 'aprobar' | 'recibir' | 'revisiones' | 'historial'

const userStore = useUserStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()
const { play } = useSound()

const isBar = computed(() => userStore.role === 'bartender')
const canReview = computed(() => userStore.isDirector)
const canReceive = computed(() => userStore.isWarehouse)

const TAB_LABEL: Record<Tab, string> = {
  mios: 'Mis solicitudes',
  aprobar: 'Por aprobar',
  recibir: 'Por recibir',
  revisiones: 'Revisiones',
  historial: 'Historial',
}

const TAB_ICON: Record<Tab, string> = {
  mios: 'fa-list-check',
  aprobar: 'fa-stamp',
  recibir: 'fa-truck-ramp-box',
  revisiones: 'fa-magnifying-glass-chart',
  historial: 'fa-clock-rotate-left',
}

const tabs = computed<Tab[]>(() => {
  if (isBar.value) return ['mios']
  const list: Tab[] = []
  if (canReview.value) list.push('aprobar')
  if (canReceive.value) list.push('recibir', 'revisiones')
  list.push('mios', 'historial')
  return list
})

function initialTab(): Tab {
  const asked = route.query.tab as Tab | undefined
  if (asked && tabs.value.includes(asked)) return asked
  return tabs.value[0] ?? 'mios'
}

const tab = shallowRef<Tab>(initialTab())
const mode = shallowRef<'list' | 'create' | 'receive'>(route.query.nuevo ? 'create' : 'list')
const receiving = shallowRef<Requisition | null>(null)
const rows = shallowRef<Requisition[]>([])
const hasMore = shallowRef(false)
const loading = shallowRef(true)
const loadingMore = shallowRef(false)
const busyId = shallowRef<string | null>(null)
const badges = shallowRef<Partial<Record<Tab, number>>>({})
const historyFilter = shallowRef<RequisitionStatus | ''>('')

function paramsFor(t: Tab) {
  switch (t) {
    case 'mios':
      return { mine: true }
    case 'aprobar':
      return { status: ['solicitado'] as RequisitionStatus[], kind: 'abastecimiento' as const }
    case 'recibir':
      return { status: ['aprobado', 'recibido_parcial'] as RequisitionStatus[], kind: 'abastecimiento' as const }
    case 'revisiones':
      return { status: ['solicitado'] as RequisitionStatus[], kind: 'revision' as const }
    default:
      return historyFilter.value ? { status: [historyFilter.value] } : {}
  }
}

async function load() {
  loading.value = true
  try {
    const data = await apiRequisitions(paramsFor(tab.value))
    rows.value = data.requisitions
    hasMore.value = data.hasMore
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  const last = rows.value[rows.value.length - 1]
  if (!last || loadingMore.value) return
  loadingMore.value = true
  try {
    const data = await apiRequisitions({ ...paramsFor(tab.value), before: last.createdAt })
    rows.value = [...rows.value, ...data.requisitions]
    hasMore.value = data.hasMore
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loadingMore.value = false
  }
}

async function loadBadges() {
  const wanted = tabs.value.filter((t): t is 'aprobar' | 'recibir' | 'revisiones' =>
    ['aprobar', 'recibir', 'revisiones'].includes(t),
  )
  try {
    const results = await Promise.all(wanted.map((t) => apiRequisitions(paramsFor(t))))
    const next: Partial<Record<Tab, number>> = {}
    wanted.forEach((t, i) => {
      next[t] = results[i]!.requisitions.length
    })
    badges.value = next
  } catch {
    // Los contadores son una ayuda: si fallan, la lista sigue funcionando.
  }
}

function refresh() {
  void load()
  void loadBadges()
}

watch(tab, (t) => {
  router.replace({ query: { ...route.query, tab: t, nuevo: undefined } })
  void load()
})
watch(historyFilter, () => void load())

onMounted(refresh)

function openCreate() {
  mode.value = 'create'
  play('tap')
}

function onCreated() {
  mode.value = 'list'
  tab.value = isBar.value ? 'mios' : tab.value
  refresh()
}

function openReceive(r: Requisition) {
  receiving.value = r
  mode.value = 'receive'
  play('tap')
}

function onReceived() {
  mode.value = 'list'
  receiving.value = null
  refresh()
}

function replaceRow(updated: Requisition) {
  rows.value = rows.value.filter((r) => r._id !== updated._id || tab.value === 'historial' || tab.value === 'mios')
  rows.value = rows.value.map((r) => (r._id === updated._id ? updated : r))
}

async function approve(r: Requisition) {
  const ok = await confirmStore.ask({
    title: `¿Aprobar ${r.code}?`,
    message:
      'Aprobar no suma stock. El stock sube cuando bodega la reciba y la suba al barco.',
    confirmLabel: 'Aprobar',
    icon: 'fa-thumbs-up',
  })
  if (!ok) return
  busyId.value = r._id
  try {
    const updated = await apiReviewRequisition(r._id, 'aprobar')
    play('success')
    toast.success(`Solicitud ${updated.code} aprobada. Ya aparece en Compras y entregas para subirla al barco.`)
    replaceRow(updated)
    void loadBadges()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busyId.value = null
  }
}

async function reject(r: Requisition) {
  const note = await confirmStore.askReason({
    title: `¿Rechazar ${r.code}?`,
    message: 'El bar verá el motivo en Mis solicitudes.',
    confirmLabel: 'Rechazar',
    danger: true,
    icon: 'fa-ban',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['Hay stock a bordo', 'Se pide para el próximo crucero', 'Cantidad excesiva'],
    },
  })
  if (!note) return
  busyId.value = r._id
  try {
    const updated = await apiReviewRequisition(r._id, 'rechazar', note)
    play('success')
    toast.success(`Solicitud ${updated.code} rechazada`)
    replaceRow(updated)
    void loadBadges()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busyId.value = null
  }
}

/** Quien pidió cancela su solicitud mientras sigue pendiente de aprobación. */
function canCancel(r: Requisition) {
  if (r.status !== 'solicitado') return false
  const id = typeof r.requestedBy === 'string' ? r.requestedBy : r.requestedBy?._id
  return Boolean(id) && id === userStore.user?.id
}

async function cancelOwn(r: Requisition) {
  const reason = await confirmStore.askReason({
    title: `¿Cancelar ${r.code}?`,
    message: 'La solicitud deja de estar pendiente y no llega a aprobación. Queda en el historial con el motivo.',
    confirmLabel: 'Cancelar solicitud',
    cancelLabel: 'Volver',
    danger: true,
    icon: 'fa-ban',
    reason: {
      label: 'Motivo (obligatorio)',
      suggestions: ['Ya no hace falta', 'Me equivoqué de producto o cantidad', 'Ya llegó en la carga'],
    },
  })
  if (!reason) return
  busyId.value = r._id
  try {
    const updated = await apiCancelRequisition(r._id, reason)
    play('success')
    toast.success(`Solicitud ${updated.code} cancelada`)
    replaceRow(updated)
    void loadBadges()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busyId.value = null
  }
}

async function resolve(r: Requisition) {
  let suggestions: string[] = []
  try {
    const counts = await apiCounts()
    suggestions = counts
      .filter((c) => c.status === 'aprobado')
      .slice(0, 3)
      .map((c) => `Conteo ${c.code} aprobado`)
  } catch {
    // Sin sugerencias: se escribe la nota.
  }
  const note = await confirmStore.askReason({
    title: `¿Marcar ${r.code} como atendida?`,
    message: `${r.lines.map((l) => l.name).join(', ')}. Cuenta qué se hizo: el bar lo verá.`,
    confirmLabel: 'Marcar atendida',
    icon: 'fa-clipboard-check',
    reason: {
      label: 'Qué se hizo (obligatorio)',
      placeholder: 'Ej. conteo CT-004 aprobado',
      suggestions: [...suggestions, 'Revisado: el stock estaba bien'],
    },
  })
  if (!note) return
  busyId.value = r._id
  try {
    const updated = await apiResolveRequisition(r._id, note)
    play('success')
    toast.success(`${updated.code} atendida`)
    replaceRow(updated)
    void loadBadges()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busyId.value = null
  }
}

const HISTORY_FILTERS: Array<{ value: RequisitionStatus | ''; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'solicitado', label: 'Solicitada' },
  { value: 'aprobado', label: 'Aprobada' },
  { value: 'rechazado', label: 'Rechazada' },
  { value: 'recibido_parcial', label: 'Recibida parcial' },
  { value: 'recibido', label: 'Recibida' },
  { value: 'atendido', label: 'Atendida' },
  { value: 'cancelado', label: 'Cancelada' },
]

const emptyText = computed(
  () =>
    ({
      mios: 'Aún no has enviado solicitudes. Usa Solicitar producto cuando falte algo en el bar.',
      aprobar: 'No hay solicitudes por aprobar.',
      recibir: 'No hay solicitudes aprobadas por recibir.',
      revisiones: 'No hay revisiones de inventario pendientes.',
      historial: 'Sin solicitudes con ese estado.',
    })[tab.value],
)
</script>

<template>
  <div class="page">
    <Transition name="view" mode="out-in">
      <RequisitionCreate v-if="mode === 'create'" key="create" @back="mode = 'list'" @saved="onCreated" />

      <RequisitionReceive
        v-else-if="mode === 'receive' && receiving"
        key="receive"
        :requisition="receiving"
        back-label="Solicitudes del bar"
        @back="mode = 'list'"
        @saved="onReceived"
      />

      <div v-else key="list" class="wrap">
        <header class="page-head">
          <div class="page-head-text">
            <h1 class="page-title">Solicitudes del bar</h1>
            <p class="page-lead">
              El bar solicita, Dirección de crucero aprueba y bodega lo entrega a bordo. El stock cambia
              solo cuando se recibe.
            </p>
          </div>
          <div v-if="!isBar" class="page-actions">
            <button type="button" class="btn btn-secondary" @click="openCreate">
              <i class="fa-solid fa-hand-holding-droplet" aria-hidden="true" /> Solicitar producto
            </button>
          </div>
        </header>

        <!-- En el bar, solicitar es el trabajo de esta pantalla: va arriba y grande.
             Para quien aprueba o entrega, lo primero es su cola. -->
        <button v-if="isBar" type="button" class="cta" @click="openCreate">
          <i class="fa-solid fa-hand-holding-droplet cta-icon" aria-hidden="true" />
          <span class="cta-text">
            <strong>Solicitar producto</strong>
            <small>Producto, cantidad y unidad (envase o ml). También revisión de inventario.</small>
          </span>
          <span class="cta-go">Solicitar <i class="fa-solid fa-arrow-right" aria-hidden="true" /></span>
        </button>

        <section class="list" :aria-label="TAB_LABEL[tab]">
          <div v-if="tabs.length > 1" class="segs" role="tablist" aria-label="Solicitudes">
            <button
              v-for="t in tabs"
              :key="t"
              type="button"
              role="tab"
              class="segs-item"
              :class="{ 'segs-item--on': tab === t }"
              :aria-selected="tab === t"
              @click="tab = t"
            >
              <i class="fa-solid" :class="TAB_ICON[t]" aria-hidden="true" />
              {{ TAB_LABEL[t] }}
              <span v-if="badges[t]" class="segs-count segs-count--alert num">{{ badges[t] }}</span>
            </button>
          </div>
          <h2 v-else class="section-title">{{ TAB_LABEL[tab] }}</h2>

          <div v-if="tab === 'historial'" class="segs filters" aria-label="Filtrar por estado">
            <button
              v-for="f in HISTORY_FILTERS"
              :key="f.value"
              type="button"
              class="segs-item segs-item--sm"
              :class="{ 'segs-item--on': historyFilter === f.value }"
              @click="historyFilter = f.value"
            >
              {{ f.label }}
            </button>
          </div>

          <SkeletonList v-if="loading" variant="card" :rows="3" />
          <div v-else-if="!rows.length" class="vacio">
            <i class="fa-solid fa-inbox" aria-hidden="true" />
            <p>{{ emptyText }}</p>
          </div>
          <TransitionGroup v-else tag="div" name="list" class="cards">
            <RequisitionCard v-for="r in rows" :key="r._id" :requisition="r">
              <template v-if="tab === 'aprobar' && canReview && r.status === 'solicitado'">
                <button type="button" class="btn btn-primary" :disabled="busyId === r._id" @click="approve(r)">
                  <i class="fa-solid fa-thumbs-up" aria-hidden="true" /> Aprobar
                </button>
                <button type="button" class="btn btn-secondary reject" :disabled="busyId === r._id" @click="reject(r)">
                  <i class="fa-solid fa-ban" aria-hidden="true" /> Rechazar
                </button>
              </template>
              <template v-else-if="canReceive && r.kind === 'abastecimiento' && ['aprobado', 'recibido_parcial'].includes(r.status)">
                <button type="button" class="btn btn-primary" @click="openReceive(r)">
                  <i class="fa-solid fa-truck-ramp-box" aria-hidden="true" /> Recibir
                </button>
              </template>
              <template v-else-if="canReceive && r.kind === 'revision' && r.status === 'solicitado'">
                <button type="button" class="btn btn-primary" :disabled="busyId === r._id" @click="resolve(r)">
                  <i class="fa-solid fa-clipboard-check" aria-hidden="true" /> Marcar atendida
                </button>
                <RouterLink class="btn btn-secondary" :to="'/inventario/conteos'">
                  <i class="fa-solid fa-clipboard-list" aria-hidden="true" /> Abrir conteo físico
                </RouterLink>
              </template>
              <template v-else-if="tab === 'mios' && canCancel(r)">
                <button type="button" class="btn btn-secondary reject" :disabled="busyId === r._id" @click="cancelOwn(r)">
                  <i class="fa-solid fa-ban" aria-hidden="true" /> Cancelar solicitud
                </button>
              </template>
            </RequisitionCard>
          </TransitionGroup>

          <div v-if="hasMore && !loading" class="more">
            <button type="button" class="btn btn-secondary" :disabled="loadingMore" @click="loadMore">
              <BaseSpinner v-if="loadingMore" />
              <template v-else><i class="fa-solid fa-angles-down" aria-hidden="true" /> Ver más</template>
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.wrap {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 900px;
}

.wrap > .page-head {
  margin-bottom: 0;
}

// Acción principal: una franja ancha y clara, imposible de pasar por alto.
.cta {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-height: 88px;
  padding: 1rem 1.1rem;
  border-radius: var(--radius);
  background: var(--navy-800);
  color: #fff;
  text-align: left;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  transition:
    background-color 0.16s ease,
    transform 0.12s var(--ease-out);

  // Las algas del menú como acento, solo a la derecha.
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: url('/brand/algas.png') right -40px center / 300px auto no-repeat;
    opacity: 0.12;
    filter: invert(1);
    z-index: -1;
    pointer-events: none;
  }

  &:hover {
    background: var(--navy-700);

    .cta-go i {
      transform: translateX(3px);
    }
  }

  &:active {
    transform: scale(0.99);
  }
}

.cta-icon {
  flex: none;
  width: 2rem;
  text-align: center;
  font-size: 1.6rem;
  color: var(--powder-300);
}

.cta-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;

  strong {
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: 1.4rem;
    line-height: 1.2;
  }

  small {
    color: var(--powder-200);
    font-size: 0.95rem;
    line-height: 1.35;
  }
}

.cta-go {
  flex: none;
  display: none;
  align-items: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0 1.1rem;
  border-radius: var(--radius-sm);
  background: var(--gold-500);
  color: #fff;
  font-weight: 600;

  i {
    transition: transform 0.16s var(--ease-out);
  }

  @include tablet {
    display: inline-flex;
  }
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 0.5rem;
}

.filters .segs-item--sm {
  min-height: 44px;
  padding: 0.4rem 0.9rem;
  font-size: 0.92rem;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.reject {
  color: var(--danger-ink);

  &:hover:not(:disabled) {
    border-color: var(--danger);
    background: var(--pill-danger-bg);
  }
}

.more {
  display: flex;
}
</style>
