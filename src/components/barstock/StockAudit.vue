<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import CountList from '@/components/barstock/CountList.vue'
import StockControl from '@/components/barstock/StockControl.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiCount, apiCountAction, apiCounts, apiCreateCount, apiSaveCount } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDate } from '@/utils/format'
import type { Product, StockCount } from '@/types'

/**
 * Auditoría de Tierra cada 2 semanas (pedido del cliente, 21-nov-2026): igual
 * que el bar, solo contar lo que hay. Usa el conteo físico de siempre: al
 * empezar se toma la foto del sistema y al terminar lo contado queda como
 * inventario del barco, con sus diferencias en el control.
 */
const catalog = useCatalogStore()
const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

const count = shallowRef<StockCount | null>(null)
const lastAudit = shallowRef<StockCount | null>(null)
/** Lo contado en envases por producto. */
const counts = ref<Record<string, number | null>>({})
const loading = shallowRef(true)
const busy = shallowRef(false)
const saveState = shallowRef<'idle' | 'saving' | 'saved' | 'error'>('idle')
let timer: ReturnType<typeof setTimeout> | null = null
/** Base (ml, unidad) por envase de cada producto del conteo. */
const sizeOf = (id: string) => count.value?.lines?.find((l) => l.product === id)?.containerSize || 1

function open(c: StockCount) {
  count.value = c
  counts.value = Object.fromEntries(
    (c.lines ?? [])
      .filter((l) => l.physical !== null)
      .map((l) => [l.product, Math.round((l.physical! / (l.containerSize || 1)) * 100) / 100]),
  )
}

async function load() {
  loading.value = true
  try {
    const [list] = await Promise.all([apiCounts(), catalog.load(true)])
    const onboard = list.filter((c) => c.location === 'abordo')
    lastAudit.value = onboard.find((c) => c.status === 'aprobado') ?? null
    // Una auditoría a medias se retoma donde quedó.
    const draft = onboard.find((c) => c.status === 'borrador' || c.status === 'rechazado')
    if (draft) open(await apiCount(draft._id))
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

async function start() {
  if (busy.value) return
  busy.value = true
  try {
    open(await apiCreateCount('abordo'))
    play('success')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

function lines() {
  return Object.entries(counts.value).map(([product, n]) => ({
    product,
    physical: n === null ? null : Math.round(n * sizeOf(product) * 100) / 100,
    reason: '',
  }))
}

async function save() {
  if (!count.value) return false
  if (timer) clearTimeout(timer)
  saveState.value = 'saving'
  try {
    await apiSaveCount(count.value._id, lines())
    saveState.value = 'saved'
    return true
  } catch (err) {
    saveState.value = 'error'
    toast.error(apiErrorMessage(err))
    return false
  }
}

function set(p: Product, n: number) {
  counts.value[p._id] = n
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void save(), 1500)
}

/** Solo lo que está en el conteo (todo lo físico activo al empezar). */
const products = computed(() => {
  const ids = new Set(count.value?.lines?.map((l) => l.product) ?? [])
  return catalog.physical.filter((p) => ids.has(p._id))
})
const countedTotal = computed(() => products.value.filter((p) => counts.value[p._id] != null).length)

async function finish() {
  if (!count.value || busy.value) return
  if (!countedTotal.value) {
    toast.error('Cuenta al menos un producto')
    return
  }
  const missing = products.value.length - countedTotal.value
  const ok = await confirmStore.ask({
    title: '¿Terminar la auditoría?',
    message: `${countedTotal.value} producto(s) contado(s).${
      missing > 0 ? ` ${missing} sin contar se quedan con lo que dice el sistema.` : ''
    } Lo contado queda como inventario del barco.`,
    confirmLabel: 'Terminar auditoría',
    icon: 'fa-clipboard-check',
  })
  if (!ok) return
  busy.value = true
  try {
    if (!(await save())) return
    const done = await apiCountAction(count.value._id, 'confirm')
    lastAudit.value = done
    count.value = null
    counts.value = {}
    saveState.value = 'idle'
    play('success')
    toast.success(`Auditoría ${done.code} guardada`)
    void catalog.load(true)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}

const SAVE_TEXT = {
  idle: '',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'No se pudo guardar',
} as const
</script>

<template>
  <div class="audit">
    <SkeletonList v-if="loading" :rows="6" />

    <template v-else-if="count">
      <header class="intro">
        <h2>Auditoría a bordo · {{ count.code }}</h2>
        <p>
          Cuenta lo que hay en el barco. En los licores, las botellas cerradas y cuánto queda de la abierta. Al terminar toca
          <b>TERMINAR AUDITORÍA</b>.
        </p>
      </header>

      <CountList :products="products" :counts="counts" @set="set" />

      <footer class="send-bar">
        <p class="send-info">
          <span
            ><b>{{ countedTotal }}</b> de {{ products.length }} contados</span
          >
          <span v-if="saveState !== 'idle'" :class="{ 'sync--error': saveState === 'error' }" role="status">
            {{ SAVE_TEXT[saveState] }}
            <button v-if="saveState === 'error'" type="button" class="btn btn-text" @click="save">Reintentar</button>
          </span>
        </p>
        <button type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="finish">
          <i class="fa-solid fa-clipboard-check" aria-hidden="true" /> TERMINAR AUDITORÍA
        </button>
      </footer>
    </template>

    <template v-else>
      <section class="card start">
        <i class="fa-solid fa-clipboard-check" aria-hidden="true" />
        <div>
          <h2>Auditoría a bordo</h2>
          <p>Cada 2 semanas: cuenta lo que hay en el barco, igual que el bar. Lo contado queda como inventario.</p>
          <p class="muted">
            {{
              lastAudit ? `Último conteo: ${formatDate(lastAudit.reviewedAt ?? lastAudit.createdAt)}` : 'Todavía no hay conteos a bordo.'
            }}
          </p>
        </div>
        <button type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="start">EMPEZAR AUDITORÍA</button>
      </section>

      <StockControl />
    </template>
  </div>
</template>

<style scoped lang="scss">
.audit {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.audit:has(.send-bar) {
  padding-bottom: 6rem;
}

.intro {
  h2 {
    margin: 0 0 0.3rem;
    font-size: 1.35rem;
  }

  p {
    margin: 0;
    max-width: 62ch;
    color: var(--ink-600);
    line-height: 1.45;
  }
}

.start {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem 1.2rem;

  > i {
    font-size: 1.6rem;
    color: var(--navy-600);
  }

  > div {
    flex: 1 1 260px;
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.3rem;
  }

  p {
    margin: 0.2rem 0 0;
    color: var(--ink-600);
  }
}

.send-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--surface);
  box-shadow: 0 -6px 18px rgb(0 0 0 / 8%);
}

.send-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  color: var(--ink-600);
  font-size: 0.92rem;
}

.sync--error {
  color: var(--danger-ink);
}
</style>
