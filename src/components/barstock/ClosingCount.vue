<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import {
  apiCloseClosingCount,
  apiCurrentClosingCount,
  apiDecideClosingCount,
  apiRecountLines,
  apiSaveClosingLines,
  apiSendClosingCount,
  apiStartInitialCount,
  type ClosingCount,
  type ClosingLine,
  type CountGroup,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import { formatDateTime, formatMoney } from '@/utils/format'
import { plural } from '@/components/supply/units'

/**
 * Conteo de cierre (Bar-stock, 24-nov-2026). Se abre solo al finalizar el
 * crucero, por categoría y siempre en el mismo orden. El bartender cuenta a
 * ciegas (sin ver el esperado); lo que cuadra queda listo y lo demás lo
 * recuenta la directora, también a ciegas, y asigna el motivo. La merma mayor
 * al límite, una botella completa faltante o una repetición pasan a Gerencia.
 * Sin señal, lo contado se guarda en el teléfono y se envía al volver.
 */
const userStore = useUserStore()
const toast = useToastStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const count = shallowRef<ClosingCount | null>(null)
const last = shallowRef<{ code: string; verifiedAt: string; verifiedByName: string; wasteTotal: number } | null>(null)
const loading = shallowRef(true)
const busy = shallowRef(false)

const role = computed(() => userStore.role)
const isLead = computed(() => role.value === 'direccion' || role.value === 'duena')
/** Quién cuenta ahora: el bartender (o la directora en el conteo inicial, que hacen juntos). */
const counting = computed(() => count.value?.status === 'borrador' && (role.value === 'bartender' || isLead.value))
const recounting = computed(() => count.value?.status === 'enviado' && isLead.value)
const deciding = computed(() => count.value?.status === 'gerencia' && role.value === 'duena')

/* ── Lo contado, en partes: cerradas + abierta, o cajas + sueltas ── */
interface Parts {
  closed: number
  open: number
  cases: number
}
const parts = reactive<Record<string, Parts>>({})
const OPEN = [
  { value: 0, label: 'Vacía' },
  { value: 0.25, label: '¼' },
  { value: 0.5, label: '½' },
  { value: 0.75, label: '¾' },
]
const dirty = new Set<string>()
const draftKey = computed(() => (count.value ? `closing-${count.value.id}-${count.value.status}` : ''))

function partsOf(l: ClosingLine, value: number | null | undefined): Parts {
  const v = value ?? 0
  if (l.countsOpen) return { closed: Math.floor(v + 1e-9), open: Math.round((v - Math.floor(v + 1e-9)) * 4) / 4, cases: 0 }
  if (l.caseSize > 0) return { cases: Math.floor(v / l.caseSize), closed: Math.round(v % l.caseSize), open: 0 }
  return { closed: Math.round(v), open: 0, cases: 0 }
}
function totalOf(l: ClosingLine, p: Parts) {
  if (l.countsOpen) return p.closed + p.open
  return p.cases * (l.caseSize || 0) + p.closed
}
/** Qué valor edita cada quien: el bartender lo contado; la directora su recuento. */
const editValue = (l: ClosingLine) => (recounting.value ? l.recount : l.physical)

function hydrate(c: ClosingCount | null) {
  count.value = c
  for (const k of Object.keys(parts)) delete parts[k]
  if (!c) return
  let saved: Record<string, Parts> = {}
  try {
    saved = JSON.parse(localStorage.getItem(`closing-${c.id}-${c.status}`) ?? '{}')
  } catch {
    saved = {}
  }
  for (const l of c.lines) {
    const v = editValue(l)
    parts[l.product] = saved[l.product] ?? (v === null || v === undefined ? (null as unknown as Parts) : partsOf(l, v))
  }
  // Lo contado sin señal en este teléfono vuelve y se envía.
  dirty.clear()
  for (const k of Object.keys(saved)) dirty.add(k)
  if (dirty.size) schedule()
}

async function load() {
  loading.value = true
  try {
    const data = await apiCurrentClosingCount()
    last.value = data.last
    hydrate(data.count)
    group.value = groups.value[0]?.key ?? 'licores'
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* ── Pestañas por categoría (con ✓ al terminar) ── */
const ORDER: CountGroup[] = ['licores', 'vinos', 'cervezas', 'gaseosas', 'insumos']
const group = shallowRef<CountGroup>('licores')
const isDone = (l: ClosingLine) => parts[l.product] !== null && parts[l.product] !== undefined
const groups = computed(() =>
  ORDER.map((key) => {
    const items = (count.value?.lines ?? []).filter((l) => l.group === key)
    return { key, label: count.value?.groups[key] ?? key, items, done: items.filter(isDone).length }
  }).filter((g) => g.items.length),
)
const current = computed(() => groups.value.find((g) => g.key === group.value) ?? groups.value[0])
const doneTotal = computed(() => (count.value?.lines ?? []).filter(isDone).length)

function set(l: ClosingLine, patch: Partial<Parts>) {
  const prev = parts[l.product] ?? { closed: 0, open: 0, cases: 0 }
  parts[l.product] = { ...prev, ...patch }
  dirty.add(l.product)
  schedule()
}
function markZero(l: ClosingLine) {
  set(l, { closed: 0, open: 0, cases: 0 })
}

/* ── Guardar: en el teléfono al instante; en el servidor cada pocos segundos ── */
const syncState = shallowRef<'ok' | 'pending' | 'offline'>('ok')
let timer: ReturnType<typeof setTimeout> | undefined
function schedule() {
  try {
    localStorage.setItem(draftKey.value, JSON.stringify(Object.fromEntries(Object.entries(parts).filter(([k]) => dirty.has(k)))))
  } catch {
    // Sin almacenamiento local: se guarda solo en el servidor.
  }
  syncState.value = 'pending'
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), 1500)
}
async function flush() {
  const c = count.value
  if (!c || !dirty.size) return true
  const lines = c.lines
    .filter((l) => dirty.has(l.product) && parts[l.product])
    .map((l) => ({ productId: l.product, value: totalOf(l, parts[l.product]!) }))
  try {
    const next = recounting.value
      ? await apiRecountLines(c.id, lines.map((x) => ({ productId: x.productId, recount: x.value })))
      : await apiSaveClosingLines(c.id, lines.map((x) => ({ productId: x.productId, physical: x.value })))
    dirty.clear()
    try {
      localStorage.removeItem(draftKey.value)
    } catch {
      // nada que limpiar
    }
    syncState.value = 'ok'
    count.value = next
    return true
  } catch {
    syncState.value = navigator.onLine ? 'pending' : 'offline'
    return false
  }
}
const onOnline = () => void flush()
window.addEventListener('online', onOnline)
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('online', onOnline)
  void flush()
})

/* ── Acciones ── */
async function send() {
  const c = count.value
  if (!c || busy.value) return
  if (doneTotal.value < c.lines.length) {
    toast.error(`Faltan ${c.lines.length - doneTotal.value} producto(s) por contar`)
    return
  }
  if (!(await flush())) {
    toast.error('Sin señal: lo contado quedó guardado en el teléfono. Envía cuando vuelva la conexión.')
    return
  }
  const ok = await confirmStore.ask({
    title: '¿Enviar el conteo?',
    message: c.kind === 'inicial' ? 'Queda como conteo inicial verificado y reemplaza los números actuales.' : 'La app compara con lo esperado. Lo que no cuadre lo recuenta la directora.',
    confirmLabel: 'Enviar conteo',
    icon: 'fa-paper-plane',
  })
  if (!ok) return
  busy.value = true
  try {
    hydrate(await apiSendClosingCount(c.id))
    play('success')
    toast.success(count.value?.status === 'aprobado' ? 'Conteo verificado' : `Enviado: la directora recuenta ${count.value?.toRecount ?? ''} producto(s)`)
    if (count.value?.status === 'aprobado') await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

const MOTIVES = [
  { value: 'rotura', label: 'Rotura no reg.' },
  { value: 'cortesia', label: 'Cortesía no reg.' },
  { value: 'consumo', label: 'Consumo no reg.' },
  { value: 'faltante', label: 'Faltante' },
] as const
async function setMotive(l: ClosingLine, motive: string) {
  const c = count.value
  if (!c) return
  try {
    count.value = await apiRecountLines(c.id, [{ productId: l.product, motive }])
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

const compared = computed(() => Boolean(count.value?.lines.length && count.value.lines.every((l) => l.recount !== null && l.result)))
async function compare() {
  if (!(await flush())) {
    toast.error('Sin señal: el recuento quedó en el teléfono')
    return
  }
  if (!compared.value) toast.push('Recuenta todos los productos de la lista para comparar')
}

async function close() {
  const c = count.value
  if (!c || busy.value) return
  busy.value = true
  try {
    hydrate(await apiCloseClosingCount(c.id))
    play('success')
    toast.success(count.value?.status === 'gerencia' ? 'Pasó a Gerencia para que apruebe la merma' : 'Conteo cerrado y verificado')
    if (count.value?.status === 'aprobado') await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function decide(approved: boolean) {
  const c = count.value
  if (!c || busy.value) return
  const comment = approved
    ? ''
    : await confirmStore.askReason({
        title: '¿Rechazar la merma?',
        message: 'Vuelve a la directora con tu comentario para que recuente.',
        confirmLabel: 'Rechazar',
        danger: true,
        icon: 'fa-rotate-left',
        reason: { label: 'Comentario (obligatorio)', suggestions: ['Recontar con el bartender', 'Revisar las roturas registradas'] },
      })
  if (!approved && !comment) return
  busy.value = true
  try {
    hydrate(await apiDecideClosingCount(c.id, approved, comment || ''))
    play('success')
    toast.success(approved ? 'Merma aprobada: conteo verificado' : 'Devuelto a la directora')
    if (approved) await load()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

async function openInitial() {
  const ok = await confirmStore.ask({
    title: '¿Abrir el conteo inicial?',
    message: 'Bartender y directora cuentan todo juntos. Al enviarlo queda verificado y reemplaza los números actuales (incluidos los negativos).',
    confirmLabel: 'Abrir conteo',
    icon: 'fa-clipboard-list',
  })
  if (!ok) return
  try {
    hydrate(await apiStartInitialCount())
    group.value = groups.value[0]?.key ?? 'licores'
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

const unit = (l: ClosingLine, n: number) => plural(l.containerLabel || 'unidad', n)
const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n * 100) / 100).replace('.', ','))
const RESULT: Record<string, string> = { corregido: 'Corregido', merma: 'Merma', tolerancia: 'Tolerancia', ok: 'Cuadra' }
const limitNote = computed(() =>
  count.value && count.value.wasteTotal > 0 && !count.value.toManagement.length ? 'Bajo el límite: la cierras tú.' : '',
)
</script>

<template>
  <section class="cc">
    <SkeletonList v-if="loading" variant="row" :rows="6" />

    <!-- Sin conteo abierto -->
    <template v-else-if="!count">
      <div class="cc-empty">
        <i class="fa-solid fa-clipboard-check" aria-hidden="true" />
        <div>
          <p class="cc-title">No hay conteo abierto</p>
          <p class="muted">
            El conteo de cierre se abre solo al finalizar el crucero.
            <template v-if="last">Último verificado: {{ last.code }} · {{ formatDateTime(last.verifiedAt) }}<template v-if="last.verifiedByName"> · {{ last.verifiedByName }}</template><template v-if="last.wasteTotal"> · merma {{ formatMoney(last.wasteTotal) }}</template>.</template>
            <template v-else>Todavía no hay un conteo verificado: el arranque es un conteo inicial de bartender y directora juntos.</template>
          </p>
        </div>
        <button v-if="isLead" type="button" class="btn btn-secondary" @click="openInitial">
          <i class="fa-solid fa-clipboard-list" aria-hidden="true" /> Conteo inicial
        </button>
      </div>
    </template>

    <template v-else>
      <header class="cc-head">
        <div>
          <p class="cc-kicker">{{ count.kind === 'inicial' ? 'Conteo inicial' : `Cierre · ${count.cruise}` }} · {{ count.code }}</p>
          <h2 class="cc-title">
            {{
              counting
                ? count.kind === 'inicial' ? 'Contar todo juntos' : 'Conteo de cierre'
                : recounting
                  ? compared ? 'Resultado' : 'Verificar diferencias'
                  : count.status === 'gerencia'
                    ? 'Merma por decidir'
                    : count.status === 'enviado'
                      ? 'Enviado a la directora'
                      : 'Conteo'
            }}
          </h2>
        </div>
        <span v-if="counting || recounting" class="sync" :class="`sync--${syncState}`">
          <i class="fa-solid" :class="syncState === 'ok' ? 'fa-cloud' : syncState === 'offline' ? 'fa-plug-circle-xmark' : 'fa-cloud-arrow-up'" aria-hidden="true" />
          {{ syncState === 'ok' ? 'Guardado' : syncState === 'offline' ? 'Sin señal: guardado en el teléfono' : 'Guardando…' }}
        </span>
      </header>

      <!-- El bartender enviado espera a la directora -->
      <p v-if="count.status === 'enviado' && !isLead" class="note">
        La directora recuenta a ciegas {{ count.lines.length }} producto(s) con diferencia. Tú ya terminaste.
      </p>
      <p v-if="count.status === 'gerencia' && !deciding" class="note">
        Pasó a Gerencia: {{ count.toManagement.join(' · ') }}.
      </p>
      <p v-if="count.decision && !count.decision.approved && recounting" class="note note--warn">
        Gerencia devolvió el conteo: «{{ count.decision.comment }}». Recuenta lo que era merma.
      </p>

      <!-- Contar o recontar: por categoría, en el mismo orden siempre -->
      <template v-if="counting || (recounting && !compared)">
        <p v-if="recounting" class="muted">Solo las categorías con diferencias. No se muestra lo que contó el bartender.</p>
        <nav class="cats" aria-label="Categorías">
          <button
            v-for="g in groups"
            :key="g.key"
            type="button"
            class="cat"
            :class="{ 'cat--on': group === g.key, 'cat--done': g.done === g.items.length }"
            :aria-current="group === g.key ? 'step' : undefined"
            @click="group = g.key"
          >
            <i v-if="g.done === g.items.length" class="fa-solid fa-check" aria-hidden="true" />
            {{ g.label }}<template v-if="recounting"> ({{ g.items.length }})</template>
          </button>
        </nav>
        <p v-if="current" class="progress-text">
          {{ current.label }} · {{ current.done }} de {{ current.items.length }} · total {{ doneTotal }} de {{ count.lines.length }}
        </p>
        <div class="bar" aria-hidden="true"><span :style="{ width: `${(doneTotal / Math.max(1, count.lines.length)) * 100}%` }" /></div>

        <ul v-if="current" class="items">
          <li v-for="l in current.items" :key="l.product" class="item" :class="{ 'item--done': isDone(l) }">
            <p class="item-name">
              <strong>{{ l.name }}</strong> <small>({{ l.containerLabel }})</small>
              <button v-if="!isDone(l)" type="button" class="btn-text zero" @click="markZero(l)">No hay</button>
            </p>
            <template v-if="l.countsOpen">
              <QtyStepper :model-value="parts[l.product]?.closed ?? 0" allow-zero :label="`Cerradas`" @update:model-value="set(l, { closed: $event })" />
              <div class="seg" role="radiogroup" :aria-label="`Abierta de ${l.name}`">
                <button
                  v-for="o in OPEN"
                  :key="o.value"
                  type="button"
                  role="radio"
                  :aria-checked="parts[l.product]?.open === o.value"
                  :class="{ on: parts[l.product] && parts[l.product]!.open === o.value }"
                  @click="set(l, { open: o.value })"
                >
                  {{ o.label }}
                </button>
              </div>
            </template>
            <template v-else-if="l.caseSize > 0">
              <QtyStepper :model-value="parts[l.product]?.cases ?? 0" allow-zero :label="`Cajas de ${l.caseSize}`" @update:model-value="set(l, { cases: $event })" />
              <QtyStepper :model-value="parts[l.product]?.closed ?? 0" allow-zero label="Sueltas" @update:model-value="set(l, { closed: $event })" />
              <small v-if="parts[l.product]" class="muted">= {{ totalOf(l, parts[l.product]!) }} {{ unit(l, totalOf(l, parts[l.product]!)) }}</small>
            </template>
            <QtyStepper v-else :model-value="parts[l.product]?.closed ?? 0" allow-zero :label="unit(l, 2)" @update:model-value="set(l, { closed: $event })" />
          </li>
        </ul>

        <div class="actions">
          <button
            v-if="current && groups.indexOf(current) < groups.length - 1"
            type="button"
            class="btn btn-secondary"
            @click="group = groups[groups.indexOf(current) + 1]!.key"
          >
            Siguiente <i class="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
          <button v-if="counting" type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="send">
            <i class="fa-solid" :class="busy ? 'fa-spinner fa-spin' : 'fa-paper-plane'" aria-hidden="true" /> Enviar conteo
          </button>
          <button v-else type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="compare">
            <i class="fa-solid fa-scale-balanced" aria-hidden="true" /> Comparar
          </button>
        </div>
      </template>

      <!-- Resultado del recuento (directora) o detalle para Gerencia -->
      <template v-else-if="(recounting && compared) || count.status === 'gerencia' || role === 'duena'">
        <ul class="results">
          <li v-for="l in count.lines.filter((x) => x.result && x.result !== 'ok')" :key="l.product" class="result" :class="`result--${l.result}`">
            <p class="item-name">
              <strong>{{ l.name }}</strong>
              <span class="tag" :class="`tag--${l.result}`">{{ RESULT[l.result] }}</span>
              <span v-if="l.fullBottle" class="tag tag--merma">Botella completa</span>
            </p>
            <p class="muted">
              <template v-if="l.result === 'corregido'">Coincide con el sistema: era error de conteo.</template>
              <template v-else-if="l.result === 'tolerancia'">Dentro de tolerancia (botella abierta).</template>
              <template v-else>
                Recontó {{ fmtQty(l.recount) }}<template v-if="l.expected !== undefined"> · esperado {{ fmtQty(l.expected) }}</template><template v-if="l.physical !== undefined && l.physical !== null"> · bartender {{ fmtQty(l.physical) }}</template>
                · {{ l.value ? formatMoney(l.value) : 'sin costo (en unidades)' }}
              </template>
            </p>
            <div v-if="l.result === 'merma' && recounting" class="seg seg--motives" role="radiogroup" :aria-label="`Motivo de ${l.name}`">
              <button
                v-for="m in MOTIVES"
                :key="m.value"
                type="button"
                role="radio"
                :aria-checked="l.motive === m.value"
                :class="{ on: l.motive === m.value }"
                @click="setMotive(l, m.value)"
              >
                {{ m.label }}
              </button>
            </div>
            <p v-else-if="l.result === 'merma' && l.motive" class="muted">Motivo: {{ MOTIVES.find((m) => m.value === l.motive)?.label }}</p>
          </li>
        </ul>
        <div class="waste">
          <p>
            Merma del crucero <strong>{{ formatMoney(count.wasteTotal) }}</strong>
            <template v-if="limitNote"> · {{ limitNote }}</template>
          </p>
          <p v-if="count.toManagement.length" class="muted">Pasa a Gerencia: {{ count.toManagement.join(' · ') }}.</p>
        </div>
        <div class="actions">
          <button v-if="recounting" type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="close">
            <i class="fa-solid" :class="busy ? 'fa-spinner fa-spin' : 'fa-lock'" aria-hidden="true" /> Cerrar conteo
          </button>
          <template v-if="deciding">
            <button type="button" class="btn btn-secondary" :disabled="busy" @click="decide(false)">Rechazar</button>
            <button type="button" class="btn btn-primary" :disabled="busy" @click="decide(true)">Aprobar merma</button>
          </template>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped lang="scss">
.cc {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.cc-empty {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);

  > i {
    font-size: 1.6rem;
    color: var(--navy-600);
  }

  > div {
    flex: 1 1 260px;
  }
}

.cc-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}

.cc-kicker {
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink-600);
}

.cc-title {
  margin: 0;
  font-size: 1.25rem;
  color: var(--navy-900);
}

.muted {
  margin: 0;
  color: var(--ink-600);
}

.note {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--pill-info-bg);
  color: var(--pill-info-ink);

  &--warn {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }
}

.sync {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--ink-600);

  &--offline {
    color: var(--warning-ink);
  }
}

.cats {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding-bottom: 2px;
}

.cat {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1.5px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  font-weight: 600;
  color: var(--navy-800);

  &--done {
    border-color: var(--success);
  }

  &--on {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;
  }
}

.progress-text {
  margin: 0;
  font-size: 0.9rem;
  color: var(--ink-600);
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: var(--cream-100);

  span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--navy-600);
    transition: width 0.2s ease;
  }
}

.items,
.results {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item,
.result {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.item--done {
  border-color: var(--pill-ok-bg);
}

.item-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
  margin: 0;

  small {
    color: var(--ink-600);
  }
}

.zero {
  margin-left: auto;
  min-height: 40px;
  color: var(--navy-700);
}

.seg {
  display: flex;
  gap: 0.4rem;

  button {
    flex: 1 1 0;
    min-height: 44px;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-weight: 600;
    color: var(--navy-800);

    &.on {
      border-color: var(--navy-800);
      background: var(--navy-800);
      color: #fff;
    }
  }

  &--motives {
    flex-wrap: wrap;

    button {
      flex: 1 1 130px;
    }
  }
}

.tag {
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  background: var(--pill-neutral-bg);
  color: var(--pill-neutral-ink);

  &--corregido,
  &--ok {
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }

  &--merma {
    background: var(--pill-danger-bg);
    color: var(--pill-danger-ink);
  }
}

.waste {
  padding: 0.8rem 0.9rem;
  border-radius: var(--radius);
  background: var(--cream-100);

  p {
    margin: 0;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
