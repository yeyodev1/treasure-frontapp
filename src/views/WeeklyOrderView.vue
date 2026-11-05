<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import ProductPicker from '@/components/supply/ProductPicker.vue'
import OrderFulfillment from '@/components/inventory/OrderFulfillment.vue'
import { useRoute, useRouter } from 'vue-router'
import { useCatalogStore } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useSound } from '@/composables/useSound'
import {
  apiApproveWeeklyOrder,
  apiCancelWeeklyOrder,
  apiSaveWeeklyOrder,
  apiSendWeeklyOrder,
  apiWeeklyOrder,
  apiWeeklyOrderCurrent,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime } from '@/utils/format'
import { ACTIVE_LOCATIONS, containerText, LOCATION_LABEL, stockText } from '@/components/supply/units'
import type { Product, WeeklyOrder, WeeklyOrderCurrent, WeeklyOrderLine } from '@/types'

/**
 * Pedido semanal (guía Inventario y pedidos, 4-nov-2026). El miércoles a las
 * 15h00 el sistema prepara la propuesta; el bar corrige y pulsa "Enviar a
 * revisión"; la directora agrega, quita o cambia y pulsa "Aprobar y enviar
 * pedido". Aprobar no mueve stock: después cada responsable confirma su
 * parte en el mismo pedido (OrderFulfillment). Antes de aprobar, cada cambio
 * se guarda solo (y queda en la tableta si no hay señal); después de aprobar,
 * los cambios de la directora se guardan como revisión.
 * `?id=` abre un pedido exacto (los avisos enlazan al pedido que nombran).
 */
const route = useRoute()
const router = useRouter()
const catalog = useCatalogStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const userStore = useUserStore()
const { play } = useSound()

interface Edit {
  qty: number
  observation: string
}

const current = shallowRef<WeeklyOrderCurrent | null>(null)
const order = shallowRef<WeeklyOrder | null>(null)
const loading = shallowRef(true)
const busy = shallowRef(false)
const picking = shallowRef(false)
/** Lo que se ve y se edita, por producto (envases enteros). */
const edits = ref<Record<string, Edit>>({})
const added = ref<WeeklyOrderLine[]>([])
const removed = ref<Set<string>>(new Set())
/** Línea con "Hay otra cantidad" abierto. */
const noting = shallowRef<string | null>(null)
/** Línea con el detalle abierto (otras bodegas y cómo se calculó). */
const detail = shallowRef<string | null>(null)
const search = shallowRef('')
const showHistory = shallowRef(false)

type SyncState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
const sync = shallowRef<SyncState>('idle')
const syncMessage = shallowRef('')
let timer: ReturnType<typeof setTimeout> | null = null
/** Sube con cada cambio: si cambió mientras se guardaba, se vuelve a guardar. */
let changeRev = 0

const isBar = computed(() => userStore.role === 'bartender')
const isLead = computed(() => userStore.isDirector)
const approved = computed(() => order.value?.status === 'aprobado')
const editable = computed(() => {
  const s = order.value?.status
  if (s === 'bar') return isBar.value || isLead.value
  if (s === 'directora' || s === 'aprobado') return isLead.value
  return false
})
const draftKey = computed(() => (order.value ? `pedido-semanal:${order.value._id}` : ''))

function resetLocal(o: WeeklyOrder) {
  edits.value = Object.fromEntries(o.lines.map((l) => [l.product, { qty: l.qty, observation: l.observation }]))
  added.value = []
  removed.value = new Set()
}

/** Borrador que no llegó al servidor (sin señal o se salió de la pantalla). */
function restoreDraft(o: WeeklyOrder) {
  const raw = localStorage.getItem(`pedido-semanal:${o._id}`)
  if (!raw) return
  try {
    const draft = JSON.parse(raw) as { version: number; lines: Array<{ productId: string; qty: number; observation: string }> }
    if (draft.version !== o.version || !editable.value || approved.value) {
      localStorage.removeItem(`pedido-semanal:${o._id}`)
      if (draft.version !== o.version) toast.push('El pedido cambió en otro equipo: tu borrador sin enviar no se aplicó.', 'info')
      return
    }
    const known = new Set(o.lines.map((l) => l.product))
    removed.value = new Set([...known].filter((id) => !draft.lines.some((l) => l.productId === id)))
    for (const l of draft.lines) {
      edits.value[l.productId] = { qty: l.qty, observation: l.observation }
      if (!known.has(l.productId)) {
        const p = catalog.physical.find((x) => x._id === l.productId)
        if (p) added.value.push(addedLine(p))
      }
    }
    sync.value = 'pending'
    scheduleSave()
  } catch {
    localStorage.removeItem(`pedido-semanal:${o._id}`)
  }
}

async function load(id?: string) {
  loading.value = true
  try {
    await catalog.load(true)
    if (!current.value || !id) current.value = await apiWeeklyOrderCurrent()
    order.value = id ? await apiWeeklyOrder(id) : current.value.order
    if (order.value) {
      resetLocal(order.value)
      restoreDraft(order.value)
    }
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(() => load(typeof route.query.id === 'string' ? route.query.id : undefined))

/** Abrir otro pedido deja su ID en la dirección (se puede compartir y recargar). */
function openOrder(id?: string) {
  void router.replace({ query: id && id !== current.value?.order?._id ? { id } : {} })
  void load(id)
}
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

function addedLine(p: Product): WeeklyOrderLine {
  return {
    product: p._id,
    name: p.name,
    stockUnit: p.stockUnit,
    containerSize: p.containerSize || 1,
    containerLabel: p.containerLabel,
    atCut: { quito: p.quitoStock ?? 0, puerto: p.puertoStock ?? 0, abordo: p.onboardStock ?? 0, bodega: p.warehouseStock ?? 0 },
    target: p.stockTarget ?? 0,
    incoming: 0,
    consumption: 0,
    suggested: null,
    basis: 'agregado',
    qty: 0,
    barQty: null,
    approvedQty: null,
    observation: '',
    editedByName: '',
    editedAt: null,
    delivered: 0,
    inTransit: 0,
    pending: 0,
    contributions: [],
  }
}

const lines = computed(() => [
  ...(order.value?.lines ?? []).filter((l) => !removed.value.has(l.product)),
  ...added.value,
])

/** Primero lo que hay que revisar, luego lo que se pide; búsqueda por nombre. */
const RANK: Record<WeeklyOrderLine['basis'], number> = { revisar: 0, objetivo: 1, consumo: 1, agregado: 1 }
const shownLines = computed(() => {
  const q = search.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return lines.value
    .filter((l) => !q || l.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const qa = (edits.value[a.l.product]?.qty ?? 0) > 0 ? 0 : 1
      const qb = (edits.value[b.l.product]?.qty ?? 0) > 0 ? 0 : 1
      return RANK[a.l.basis] - RANK[b.l.basis] || (approved.value ? 0 : qa - qb) || a.i - b.i
    })
    .map((x) => x.l)
})

function payload() {
  return lines.value.map((l) => ({
    productId: l.product,
    qty: edits.value[l.product]?.qty ?? 0,
    observation: (edits.value[l.product]?.observation ?? '').trim(),
  }))
}

const invalid = computed(() => lines.value.find((l) => {
  const q = edits.value[l.product]?.qty
  return q === undefined || !Number.isInteger(q) || q < 0
}))

/** Ya entregado o enviado: no se puede pedir menos. */
function covered(l: WeeklyOrderLine): number {
  return l.delivered + l.inTransit
}

/** Aprobado: no se pide menos de lo ya entregado o enviado. */
function belowBought(l: WeeklyOrderLine): boolean {
  return approved.value && (edits.value[l.product]?.qty ?? 0) < covered(l)
}

const changedSinceSave = computed(() => {
  if (!order.value) return false
  if (added.value.length || removed.value.size) return true
  return order.value.lines.some(
    (l) => edits.value[l.product]?.qty !== l.qty || (edits.value[l.product]?.observation ?? '') !== l.observation,
  )
})

function touch() {
  changeRev += 1
  if (approved.value || !order.value) return
  localStorage.setItem(draftKey.value, JSON.stringify({ version: order.value.version, lines: payload() }))
  sync.value = 'pending'
  scheduleSave()
}

function scheduleSave() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void save(), 1200)
}

async function save(): Promise<boolean> {
  const o = order.value
  if (!o || !editable.value) return false
  if (invalid.value) {
    sync.value = 'error'
    syncMessage.value = `Revisa la cantidad de ${invalid.value.name}: envases enteros, de 0 en adelante.`
    return false
  }
  const rev = changeRev
  sync.value = 'saving'
  try {
    const saved = await apiSaveWeeklyOrder(o._id, o.version, payload())
    order.value = saved
    if (rev === changeRev) {
      resetLocal(saved)
      localStorage.removeItem(draftKey.value)
      sync.value = 'saved'
    } else {
      // Hubo otro cambio mientras se guardaba: se guarda sobre la versión nueva.
      localStorage.setItem(draftKey.value, JSON.stringify({ version: saved.version, lines: payload() }))
      added.value = added.value.filter((l) => !saved.lines.some((s) => s.product === l.product))
      scheduleSave()
    }
    return true
  } catch (err) {
    sync.value = 'error'
    syncMessage.value = apiErrorMessage(err)
    return false
  }
}

/** Antes de una acción, lo pendiente debe estar guardado. */
async function flush(): Promise<boolean> {
  if (timer) clearTimeout(timer)
  if (sync.value === 'pending' || sync.value === 'error' || (changedSinceSave.value && !approved.value)) return save()
  return true
}

function setQty(l: WeeklyOrderLine, qty: number) {
  edits.value[l.product] = { qty, observation: edits.value[l.product]?.observation ?? '' }
  touch()
}

function setObservation(l: WeeklyOrderLine, text: string) {
  edits.value[l.product] = { qty: edits.value[l.product]?.qty ?? 0, observation: text }
  touch()
}

function removeLine(l: WeeklyOrderLine) {
  if (approved.value) {
    // Aprobado: quitar = cancelar lo pendiente (queda lo entregado o enviado).
    setQty(l, covered(l))
    return
  }
  if (added.value.some((a) => a.product === l.product)) added.value = added.value.filter((a) => a.product !== l.product)
  else removed.value = new Set([...removed.value, l.product])
  play('tap')
  touch()
}

function addProduct(p: Product) {
  picking.value = false
  if (removed.value.has(p._id)) {
    removed.value = new Set([...removed.value].filter((id) => id !== p._id))
  } else {
    added.value.push(addedLine(p))
    edits.value[p._id] = { qty: 1, observation: '' }
  }
  touch()
}

const pickable = computed(() => catalog.physical.filter((p) => !lines.value.some((l) => l.product === p._id)))

// ---- Explicación de cada línea ----
// ¿Qué necesita el barco? Solo cuenta lo que hay a bordo. ¿De dónde sale? Puerto, Quito o compra nueva.
function onHand(l: WeeklyOrderLine): number {
  return Math.max(0, l.atCut.abordo)
}

/** Dónde se puede conseguir: las bodegas (tenerlo en Quito no es tenerlo en el barco). */
function sources(l: WeeklyOrderLine): string {
  const parts = ACTIVE_LOCATIONS.filter((loc) => loc !== 'abordo').map((loc) => `${LOCATION_LABEL[loc]} ${stockText(l.atCut[loc], l)}`)
  if (l.atCut.bodega) parts.push(`Sin separar ${stockText(l.atCut.bodega, l)} (por verificar)`)
  return parts.join(' · ')
}

/** "Administración 10 de puerto + 6 de compra nueva · dueña 8 de Quito (en camino)". */
function contributionText(l: WeeklyOrderLine): string {
  const SOURCE = { puerto: 'puerto', quito: 'Quito', compra: 'compra nueva' } as const
  return l.contributions
    .map((c) => `${c.byName}: ${c.qty} de ${SOURCE[c.source]}${c.arrived ? '' : ' (en camino)'}`)
    .join(' · ')
}

function why(l: WeeklyOrderLine): string {
  const hay = `a bordo ${stockText(onHand(l), l)}`
  const vienen = l.incoming > 0 ? ` · vienen ${stockText(l.incoming, l)}` : ''
  if (l.basis === 'objetivo') return `Objetivo ${containerText(l.target, l)} · hay ${hay}${vienen} → sugerido ${containerText(l.suggested ?? 0, l)}`
  if (l.basis === 'consumo') return `Se consumió ${stockText(l.consumption, l)} la última semana · hay ${hay}${vienen} → sugerido ${containerText(l.suggested ?? 0, l)}`
  if (l.basis === 'revisar') return 'Revisa esta cantidad: sin objetivo ni consumo reciente y bajo el mínimo.'
  return 'Agregado a mano.'
}

/** Sugerido → bar → aprobado, solo cuando cambió. */
function trail(l: WeeklyOrderLine): string {
  const parts: string[] = []
  if (l.suggested !== null) parts.push(`Sugerido ${l.suggested}`)
  if (l.barQty !== null && l.barQty !== l.suggested) parts.push(`Bar ${l.barQty}`)
  if (l.approvedQty !== null && l.approvedQty !== l.barQty) parts.push(`Aprobado ${l.approvedQty}`)
  return parts.length > 1 || l.editedByName ? `${parts.join(' · ')}${l.editedByName ? ` · último cambio: ${l.editedByName}` : ''}` : ''
}

const withQty = computed(() => lines.value.filter((l) => (edits.value[l.product]?.qty ?? 0) > 0).length)

// ---- Acciones ----
async function sendToReview() {
  if (!order.value || busy.value) return
  if (!(await flush())) return
  const ok = await confirmStore.ask({
    title: `¿Enviar el pedido ${order.value.code} a revisión?`,
    message: `Pasa a la directora con ${withQty.value} producto(s). No compra ni mueve el inventario.`,
    confirmLabel: 'Enviar a revisión',
    icon: 'fa-paper-plane',
  })
  if (!ok) return
  busy.value = true
  try {
    order.value = await apiSendWeeklyOrder(order.value._id, order.value.version)
    resetLocal(order.value)
    play('success')
    toast.success('Enviado a revisión: ahora lo revisa la directora')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function approve(noNeeds = false) {
  if (!order.value || busy.value) return
  if (!(await flush())) return
  const ok = await confirmStore.ask(
    noNeeds
      ? {
          title: `¿Cerrar el pedido ${order.value.code} sin necesidades?`,
          message: `El barco no necesita reposición esta semana. Queda cerrado en el historial y no queda pendiente.${order.value.status === 'bar' ? ' El bar aún no lo revisó.' : ''}`,
          confirmLabel: 'Cerrar sin necesidades',
          icon: 'fa-circle-check',
        }
      : {
          title: `¿Aprobar y enviar el pedido ${order.value.code}?`,
          message: `Lo ven Administración y la dueña en Pedido semanal, con ${withQty.value} producto(s): cada una confirma su parte. No se envía correo ni WhatsApp, y nada se da por entregado.${order.value.status === 'bar' ? ' El bar aún no lo revisó.' : ''}`,
          confirmLabel: 'Aprobar y enviar pedido',
          icon: 'fa-stamp',
        },
  )
  if (!ok) return
  busy.value = true
  try {
    order.value = await apiApproveWeeklyOrder(order.value._id, order.value.version, noNeeds)
    resetLocal(order.value)
    play('success')
    toast.success(noNeeds ? 'Pedido cerrado sin necesidades' : 'Pedido aprobado: Administración y la dueña atienden su parte')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

/** Después de aprobar: los cambios se guardan como revisión, con aviso a compras. */
async function saveRevision() {
  if (!order.value || busy.value) return
  const bad = lines.value.find(belowBought)
  if (bad) {
    toast.error(`${bad.name}: ya se entregaron o enviaron ${containerText(covered(bad), bad)}; no puedes pedir menos.`)
    return
  }
  const ok = await confirmStore.ask({
    title: `¿Guardar la revisión ${order.value.revision + 1}?`,
    message: 'El pedido ya está aprobado: el cambio queda identificado y Administración y la dueña lo ven al entrar. Lo ya entregado o enviado no se borra.',
    confirmLabel: 'Guardar revisión',
    icon: 'fa-pen-to-square',
  })
  if (!ok) return
  busy.value = true
  try {
    await save()
    if (sync.value === 'saved') toast.success('Revisión guardada')
  } finally {
    busy.value = false
  }
}

async function cancel() {
  if (!order.value || busy.value) return
  const reason = await confirmStore.askReason({
    title: approved.value ? '¿Cancelar lo pendiente de entregar?' : `¿Cancelar el pedido ${order.value.code}?`,
    message: approved.value
      ? 'Cada producto queda en lo que ya se entregó o envió. Las entregas hechas no se borran.'
      : 'El pedido se descarta y queda en el historial con el motivo.',
    confirmLabel: approved.value ? 'Cancelar lo pendiente' : 'Cancelar pedido',
    danger: true,
    icon: 'fa-ban',
    reason: { label: 'Motivo (obligatorio)', suggestions: ['Ya se compró por otro lado', 'Pedido duplicado'] },
  })
  if (!reason) return
  busy.value = true
  try {
    order.value = await apiCancelWeeklyOrder(order.value._id, reason)
    resetLocal(order.value)
    localStorage.removeItem(draftKey.value)
    toast.success(approved.value ? 'Se canceló lo pendiente' : 'Pedido cancelado')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

watch(
  () => order.value?._id,
  () => {
    noting.value = null
    detail.value = null
    showHistory.value = false
  },
)

const SYNC_TEXT: Record<SyncState, string> = {
  idle: '',
  pending: 'Pendiente de enviar',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: '',
}
</script>

<template>
  <div class="page weekly">
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">Pedido semanal</h1>
        <p class="page-lead">
          El sistema lo prepara cada miércoles a las 15h00 (hora de Galápagos). El bar lo revisa, la directora lo aprueba y
          cada responsable confirma su entrega aquí mismo.
        </p>
      </div>
    </header>

    <SkeletonList v-if="loading" variant="row" :rows="6" />

    <div v-else-if="!order" class="vacio">
      <i class="fa-solid fa-calendar-week" aria-hidden="true" />
      <p>
        Aún no hay pedido. El primero se prepara el
        {{ current ? formatDateTime(current.nextCut) : 'próximo miércoles a las 15h00' }}.
      </p>
    </div>

    <template v-else>
      <!-- Otros pedidos abiertos (semanas anteriores) -->
      <nav v-if="current && current.others.some((o) => o.status !== 'cancelado')" class="others" aria-label="Otros pedidos">
        <button
          type="button"
          class="chip"
          :class="{ on: order._id === current.order?._id }"
          @click="openOrder(current.order?._id)"
        >
          {{ current.order?.code }} · esta semana
        </button>
        <button
          v-for="o in current.others.filter((x) => x.status !== 'cancelado')"
          :key="o._id"
          type="button"
          class="chip"
          :class="{ on: order._id === o._id, warn: o.overdue }"
          @click="openOrder(o._id)"
        >
          {{ o.code }} · semana del {{ o.week.split('-').reverse().slice(0, 2).join('/') }}
        </button>
      </nav>

      <section class="card head">
        <div class="head-main">
          <h2>
            Pedido {{ order.code }}
            <span class="estado" :class="{ 'estado--warn': order.phase === 'bar' || order.phase === 'directora' || order.phase === 'atender', 'estado--ok': order.phase === 'completo' || order.phase === 'sin_necesidades' }">
              {{ order.phaseLabel }}
            </span>
            <span v-if="order.revision" class="estado">Revisión {{ order.revision }}</span>
          </h2>
          <!-- La semana que representa y cuándo se generó de verdad son datos distintos -->
          <p class="muted">
            Semana del corte: miércoles {{ order.week.split('-').reverse().join('/') }}, 15h00 ·
            existencias tomadas el {{ formatDateTime(order.cutAt) }}
          </p>
          <p v-if="order.generatedLate" class="muted">
            Se generó el {{ formatDateTime(order.createdAt) }}, después del corte: la tarea automática no corrió a tiempo.
          </p>
          <p v-if="approved && order.recipient" class="muted">Lo atienden: {{ order.recipient }}</p>
        </div>
        <p v-if="sync !== 'idle'" class="sync" :class="`sync--${sync}`" role="status">
          <i
            class="fa-solid"
            :class="{
              'fa-cloud-arrow-up': sync === 'pending',
              'fa-spinner fa-spin': sync === 'saving',
              'fa-circle-check': sync === 'saved',
              'fa-circle-exclamation': sync === 'error',
            }"
            aria-hidden="true"
          />
          {{ sync === 'error' ? syncMessage : SYNC_TEXT[sync] }}
          <button v-if="sync === 'error'" type="button" class="btn btn-secondary retry" @click="save">Reintentar</button>
        </p>
      </section>

      <!-- Alerta a la directora: el bar no revisó a tiempo (no se aprueba solo) -->
      <p v-if="order.overdue && isLead" class="alert" role="alert">
        <i class="fa-solid fa-bell" aria-hidden="true" />
        <span>
          <strong>El bar no revisó el pedido {{ order.code }}.</strong> Revísalo y apruébalo: nada se aprueba ni se envía solo.
        </span>
      </p>
      <p v-else-if="order.overdue && isBar" class="alert" role="alert">
        <i class="fa-solid fa-bell" aria-hidden="true" />
        <span><strong>Se pasó el plazo de revisión de {{ order.code }}.</strong> Revísalo y pulsa Enviar a revisión.</span>
      </p>
      <p v-else-if="order.status === 'directora' && isBar" class="info">
        <i class="fa-solid fa-hourglass-half" aria-hidden="true" /> Enviado a revisión: ahora lo revisa la directora.
      </p>
      <p v-if="approved && isLead && editable" class="info">
        <i class="fa-solid fa-pen-to-square" aria-hidden="true" />
        Ya está aprobado. Si cambias algo, guárdalo como revisión: Administración y la dueña lo verán. No se puede pedir menos
        de lo ya entregado o enviado.
      </p>

      <OrderFulfillment
        v-if="approved && !order.noNeeds"
        :order="order"
        @updated="(o) => { order = o; resetLocal(o) }"
      />

      <p v-if="order.noNeeds" class="info">
        <i class="fa-solid fa-circle-check" aria-hidden="true" /> Cerrado sin necesidades: esta semana el barco no necesitó reposición.
      </p>

      <!-- Pedido en cero: cómo seguir, sin dejarlo pendiente para siempre -->
      <p v-if="editable && !approved && !withQty" class="info">
        <i class="fa-solid fa-circle-info" aria-hidden="true" />
        <span>
          El pedido está en cero. Sube la cantidad de un producto o toca «Agregar producto».
          <template v-if="isLead"> Si el barco no necesita nada, ciérralo con «Sin necesidades».</template>
          <template v-else> Si no hace falta nada, envíalo a revisión igual: la directora lo cierra.</template>
        </span>
      </p>

      <!-- Lista del pedido: compacta; otras bodegas y el cálculo van en el detalle -->
      <label v-if="lines.length > 8" class="search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input v-model="search" type="search" placeholder="Buscar producto" aria-label="Buscar producto en el pedido" />
      </label>
      <section class="lines" aria-label="Productos del pedido">
        <div v-if="!lines.length" class="vacio">
          <i class="fa-solid fa-box-open" aria-hidden="true" />
          <p>Sin productos. {{ editable ? 'Agrega lo que haga falta.' : '' }}</p>
        </div>
        <p v-else-if="!shownLines.length" class="muted">Ningún producto coincide con «{{ search }}».</p>
        <article
          v-for="l in shownLines"
          :key="l.product"
          class="card line"
          :class="{ 'line--zero': (edits[l.product]?.qty ?? 0) === 0, 'line--bad': belowBought(l) }"
        >
          <div class="line-main">
            <div class="line-name">
              <ProductIcon :icon="catalog.physical.find((p) => p._id === l.product)?.icon ?? 'bottle'" :size="22" />
              <span>
                <strong>{{ l.name }}</strong>
                <small class="hay">Hay a bordo: <b>{{ stockText(onHand(l), l) }}</b></small>
                <small v-if="l.basis === 'revisar'" class="check">Revisa esta cantidad</small>
              </span>
            </div>

            <div class="line-qty">
              <span class="qty-label">Cantidad a pedir</span>
              <QtyStepper
                v-if="editable"
                :model-value="edits[l.product]?.qty ?? 0"
                :min="0"
                :step="1"
                allow-zero
                :unit="containerText(edits[l.product]?.qty ?? 0, l).replace(/^[\d.,]+\s/, '')"
                :label="`Cantidad de ${l.name}`"
                @update:model-value="setQty(l, $event)"
              />
              <strong v-else class="qty-read">{{ containerText(edits[l.product]?.qty ?? l.qty, l) }}</strong>
            </div>
          </div>

          <p v-if="approved && !order.noNeeds" class="progress">
            En el barco {{ containerText(l.delivered, l) }}
            <template v-if="l.inTransit > 0"> · en camino {{ containerText(l.inTransit, l) }}</template>
            <template v-if="l.pending > 0"> · <b>faltan {{ containerText(l.pending, l) }}</b></template>
            <template v-else-if="!l.inTransit"> · <i class="fa-solid fa-circle-check" aria-hidden="true" /> completo</template>
            <small v-if="l.contributions.length">{{ contributionText(l) }}</small>
          </p>

          <button
            type="button"
            class="btn-text detail-toggle"
            :aria-expanded="detail === l.product"
            @click="detail = detail === l.product ? null : l.product"
          >
            <i class="fa-solid" :class="detail === l.product ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true" />
            {{ detail === l.product ? 'Ocultar detalle' : 'Ver otras bodegas y cálculo' }}
          </button>
          <div v-if="detail === l.product" class="detail">
            <p class="muted">De dónde se consigue: {{ sources(l) }}</p>
            <p class="why" :class="{ 'why--check': l.basis === 'revisar' }">
              <i class="fa-solid" :class="l.basis === 'revisar' ? 'fa-circle-question' : 'fa-lightbulb'" aria-hidden="true" />
              {{ why(l) }}
            </p>
            <p v-if="trail(l)" class="trail">{{ trail(l) }}</p>
          </div>

          <!-- "Hay otra cantidad": avisa de una diferencia; no cambia el inventario -->
          <div v-if="noting === l.product" class="note">
            <label :for="`obs-${l.product}`">¿Cuánto hay realmente? (solo es un aviso: no cambia el inventario)</label>
            <input
              :id="`obs-${l.product}`"
              :value="edits[l.product]?.observation ?? ''"
              type="text"
              maxlength="300"
              placeholder="Ej.: hay 3 latas en la barra"
              @input="setObservation(l, ($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="btn btn-secondary" @click="noting = null">Listo</button>
          </div>
          <p v-else-if="edits[l.product]?.observation" class="obs">
            <i class="fa-solid fa-eye" aria-hidden="true" /> Hay otra cantidad: {{ edits[l.product]?.observation }}
          </p>

          <div v-if="editable" class="line-actions">
            <button v-if="!approved" type="button" class="btn-text" @click="noting = noting === l.product ? null : l.product">
              <i class="fa-solid fa-eye" aria-hidden="true" /> Hay otra cantidad
            </button>
            <button type="button" class="btn-text danger" @click="removeLine(l)">
              <i class="fa-solid" :class="approved ? 'fa-ban' : 'fa-trash-can'" aria-hidden="true" />
              {{ approved ? 'Cancelar lo pendiente' : 'Quitar' }}
            </button>
          </div>
        </article>

        <button v-if="editable" type="button" class="add" @click="picking = true">
          <i class="fa-solid fa-plus" aria-hidden="true" /> Agregar producto
        </button>
      </section>

      <!-- Acción principal visible -->
      <footer v-if="(editable || (isLead && order.status !== 'cancelado')) && order.phase !== 'sin_necesidades'" class="actions">
        <button
          v-if="order.status === 'bar' && isBar"
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="busy || !!invalid"
          @click="sendToReview"
        >
          <i class="fa-solid fa-paper-plane" aria-hidden="true" /> Enviar a revisión
        </button>
        <button
          v-if="isLead && (order.status === 'directora' || order.status === 'bar') && withQty"
          type="button"
          class="btn btn-gold btn-lg"
          :disabled="busy || !!invalid"
          @click="approve()"
        >
          <i class="fa-solid fa-stamp" aria-hidden="true" /> Aprobar y enviar pedido
        </button>
        <button
          v-else-if="isLead && (order.status === 'directora' || order.status === 'bar')"
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="busy"
          @click="approve(true)"
        >
          <i class="fa-solid fa-circle-check" aria-hidden="true" /> Sin necesidades
        </button>
        <button
          v-if="approved && isLead"
          type="button"
          class="btn btn-primary btn-lg"
          :disabled="busy || !changedSinceSave || !!invalid"
          @click="saveRevision"
        >
          <i class="fa-solid fa-floppy-disk" aria-hidden="true" /> Guardar revisión
        </button>
        <button v-if="isLead && order.phase !== 'completo'" type="button" class="btn btn-secondary" :disabled="busy" @click="cancel">
          <i class="fa-solid fa-ban" aria-hidden="true" /> {{ approved ? 'Cancelar lo pendiente' : 'Cancelar pedido' }}
        </button>
      </footer>

      <!-- Historial: quién hizo qué -->
      <section class="history">
        <button type="button" class="btn-text" :aria-expanded="showHistory" @click="showHistory = !showHistory">
          <i class="fa-solid" :class="showHistory ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true" />
          Historial del pedido ({{ order.history.length }})
        </button>
        <Transition name="fade">
          <ol v-if="showHistory" class="history-list">
            <li v-for="(h, i) in [...order.history].reverse()" :key="i">
              <strong>{{ h.action }}</strong>
              <span class="muted">{{ formatDateTime(h.at) }} · {{ h.byName }}</span>
              <span v-if="h.detail">{{ h.detail }}</span>
            </li>
          </ol>
        </Transition>
      </section>
    </template>

    <ProductPicker
      v-if="picking"
      title="Agregar al pedido"
      :products="pickable"
      show="ambos"
      @pick="addProduct"
      @close="picking = false"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  padding: 0 0.8rem;
  min-height: 48px;
  border: 1.5px solid var(--line-strong);
  border-radius: 12px;
  background: var(--surface);

  input {
    flex: 1;
    min-height: 44px;
    border: 0;
    background: transparent;
    font: inherit;
    outline: none;
  }
}

.check {
  color: var(--warning);
  font-weight: 600;
}

.detail-toggle {
  justify-self: start;
}

.detail {
  display: grid;
  gap: 0.35rem;
}

.weekly {
  max-width: 980px;
}

.others {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.chip {
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1.5px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  font-weight: 600;
  cursor: pointer;

  &.on {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;
  }

  &.warn:not(.on) {
    border-color: var(--warning);
  }
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;

  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.25rem;
    font-size: 1.3rem;
  }
}

.head-main {
  flex: 1 1 280px;
  min-width: 0;

  p {
    margin: 0.15rem 0 0;
  }
}

.muted {
  color: var(--ink-600);
}

.sync {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-weight: 600;
  color: var(--ink-600);

  &--saved {
    color: #1d6b43;
  }

  &--pending {
    color: #8a5d1d;
  }

  &--error {
    color: var(--danger-ink);
  }
}

.alert,
.info {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  margin: 0 0 0.75rem;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-sm);
}

.alert {
  background: #fbf0dc;
  color: #6b4716;
}

.info {
  background: var(--powder-100);
  color: var(--navy-800);
}

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.line {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;

  &--zero {
    opacity: 0.75;
  }

  &--bad {
    border-color: var(--danger);
  }
}

.line-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.line-name {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  flex: 1 1 260px;
  min-width: 0;

  > span {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  strong {
    font-size: 1.05rem;
  }

  small {
    font-size: 0.875rem;
  }
}

.hay b {
  font-variant-numeric: tabular-nums;
}

.line-qty {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.2rem;
}

.qty-label {
  font-size: 0.8rem;
  color: var(--ink-600);
}

.qty-read {
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.why,
.trail,
.progress,
.obs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: baseline;
  margin: 0;
  font-size: 0.9rem;
  color: var(--ink-600);
}

.why--check {
  color: #8a5d1d;
  font-weight: 600;
}

.trail {
  font-size: 0.82rem;
}

.obs {
  color: var(--navy-800);
}

.note {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;

  label {
    flex: 1 1 100%;
    font-size: 0.875rem;
    color: var(--ink-600);
  }

  input {
    flex: 1 1 220px;
    min-height: 48px;
  }
}

.line-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;

  .btn-text {
    min-height: 44px;
  }

  .danger {
    color: var(--danger-ink);
  }
}

.add {
  min-height: 56px;
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--radius);
  background: transparent;
  font-weight: 600;
  color: var(--navy-700);
  cursor: pointer;
}

.actions {
  position: sticky;
  bottom: 0.75rem;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(27, 43, 37, 0.12);
}

.history {
  margin-top: 1.25rem;
}

.history-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;

  li {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.6rem 0;
    border-top: 1px solid var(--rule);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
