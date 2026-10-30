<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiCreateRequisition } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import type { Product, Requisition } from '@/types'
import FlowHeader from './FlowHeader.vue'
import ProductPicker from './ProductPicker.vue'
import SaveStatus from './SaveStatus.vue'
import UnitQty from './UnitQty.vue'
import { normalize, qtyText, stockText, type QtyMode } from './units'

/**
 * Solicitar productos en una sola pantalla (checklist 29-oct, 15): buscar el
 * producto, indicar cantidad y unidad, nota opcional y el resumen a la vista.
 * "Enviar solicitud" guarda sin otra confirmación idéntica y luego muestra
 * el número y el estado. La aprobación de Dirección de crucero va aparte.
 */
const emit = defineEmits<{ back: []; saved: [requisition: Requisition] }>()

const catalog = useCatalogStore()
const toast = useToastStore()
const { play } = useSound()
const save = useSaveAttempt('la solicitud')

interface Line {
  product: Product
  qty: number
  mode: QtyMode
}

const kind = shallowRef<'abastecimiento' | 'revision'>('abastecimiento')
const lines = ref<Line[]>([])
const note = shallowRef('')
const query = shallowRef('')
const picking = shallowRef(false)
const tried = shallowRef(false)
const saved = shallowRef<Requisition | null>(null)

onMounted(async () => {
  try {
    await catalog.load(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
})

const isRevision = computed(() => kind.value === 'revision')
const locked = computed(() => save.state.value === 'saving' || save.state.value === 'saved')
const qtyOk = computed(() => isRevision.value || lines.value.every((l) => Number.isFinite(l.qty) && l.qty > 0))
const ready = computed(
  () => lines.value.length > 0 && qtyOk.value && (!isRevision.value || note.value.trim().length > 0),
)

/** Resultados en la misma pantalla: escribir y tocar el producto. */
const results = computed(() => {
  const q = normalize(query.value.trim())
  if (!q) return []
  const taken = new Set(lines.value.map((l) => l.product._id))
  return catalog.physical.filter((p) => !taken.has(p._id) && normalize(p.name).includes(q)).slice(0, 6)
})

function setKind(next: 'abastecimiento' | 'revision') {
  if (locked.value) return
  kind.value = next
  tried.value = false
  play('tap')
}

function addProduct(product: Product) {
  picking.value = false
  query.value = ''
  if (lines.value.some((l) => l.product._id === product._id)) return
  lines.value.push({ product, qty: 1, mode: 'envase' })
  play('tap')
}

function removeLine(index: number) {
  if (locked.value) return
  lines.value.splice(index, 1)
  play('tap')
}

async function send() {
  tried.value = true
  if (!ready.value) {
    play('error')
    return
  }
  const result = await save.run((key) =>
    apiCreateRequisition({
      kind: kind.value,
      lines: lines.value.map((l) => ({
        productId: l.product._id,
        qty: isRevision.value ? 0 : l.qty,
        unit: l.mode,
      })),
      note: note.value.trim() || undefined,
      idempotencyKey: key,
    }),
  )
  if (result.ok) {
    saved.value = result.value
    play('success')
  } else {
    play('error')
  }
}

/** Otra solicitud desde cero (la anterior ya quedó guardada). */
function startOver() {
  lines.value = []
  note.value = ''
  query.value = ''
  tried.value = false
  saved.value = null
  save.reset()
  play('tap')
}

function finish() {
  if (saved.value) emit('saved', saved.value)
}
</script>

<template>
  <section class="flow">
    <FlowHeader
      :title="isRevision ? 'Revisión de inventario' : 'Solicitar productos'"
      icon="fa-hand-holding-droplet"
      back-label="Abastecimiento"
      @back="emit('back')"
    />

    <div class="pane">
      <div class="dest dest--compact">
        <button
          type="button"
          class="dest-btn"
          :class="{ on: !isRevision }"
          :aria-pressed="!isRevision"
          :disabled="locked"
          @click="setKind('abastecimiento')"
        >
          <i class="fa-solid fa-dolly" aria-hidden="true" />
          <strong>Solicitar producto</strong>
          <small>Falta en el bar y lo debe subir bodega</small>
          <i v-if="!isRevision" class="fa-solid fa-circle-check tick" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="dest-btn"
          :class="{ on: isRevision }"
          :aria-pressed="isRevision"
          :disabled="locked"
          @click="setKind('revision')"
        >
          <i class="fa-solid fa-magnifying-glass-chart" aria-hidden="true" />
          <strong>Revisión de inventario</strong>
          <small>El sistema dice una cosa y en la barra hay otra</small>
          <i v-if="isRevision" class="fa-solid fa-circle-check tick" aria-hidden="true" />
        </button>
      </div>

      <!-- Producto: se busca aquí mismo -->
      <div v-if="!locked" class="field">
        <label for="rq-search">Producto</label>
        <div class="finder">
          <label class="finder-input">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input
              id="rq-search"
              v-model="query"
              type="text"
              autocomplete="off"
              placeholder="Escribe el nombre: club, tanqueray…"
            />
            <button v-if="query" type="button" class="finder-clear" aria-label="Borrar búsqueda" @click="query = ''">
              <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </label>
          <button type="button" class="btn btn-ghost finder-all" @click="picking = true">
            <i class="fa-solid fa-list" aria-hidden="true" /> Ver catálogo
          </button>
        </div>
        <TransitionGroup tag="ul" name="line" class="results">
          <li v-for="p in results" :key="p._id">
            <button type="button" class="result" @click="addProduct(p)">
              <ProductIcon :icon="p.icon" :size="24" />
              <span class="result-text">
                <strong>{{ p.name }}</strong>
                <small>A bordo: {{ stockText(p.onboardStock, p) }}</small>
              </span>
              <i class="fa-solid fa-plus" aria-hidden="true" />
            </button>
          </li>
        </TransitionGroup>
        <small v-if="query.trim() && !results.length" class="muted">No hay productos con "{{ query }}".</small>
        <small v-if="tried && !lines.length" class="err">Elige al menos un producto.</small>
      </div>

      <TransitionGroup tag="div" name="line" class="lines">
        <article v-for="(line, i) in lines" :key="line.product._id" class="card line">
          <header class="line-head">
            <ProductIcon :icon="line.product.icon" :size="26" />
            <strong>{{ line.product.name }}</strong>
            <button
              v-if="!locked"
              type="button"
              class="remove"
              :aria-label="`Quitar ${line.product.name}`"
              @click="removeLine(i)"
            >
              <i class="fa-solid fa-trash-can" aria-hidden="true" />
            </button>
          </header>
          <span class="line-sub">A bordo según el sistema: {{ stockText(line.product.onboardStock, line.product) }}</span>
          <UnitQty
            v-if="!isRevision && !locked"
            v-model="line.qty"
            v-model:mode="line.mode"
            :product="line.product"
            :label="`Cantidad de ${line.product.name}`"
            allow-base
          />
        </article>
      </TransitionGroup>

      <div class="field">
        <label for="rq-note">{{ isRevision ? 'Qué ves (obligatorio)' : 'Nota (opcional)' }}</label>
        <input
          id="rq-note"
          v-model="note"
          type="text"
          :disabled="locked"
          :placeholder="isRevision ? 'Ej. el sistema dice 0 pero hay 1 botella en la barra' : 'Ej. para la cena de mañana'"
          :class="{ invalid: tried && isRevision && !note.trim() }"
        />
        <small v-if="tried && isRevision && !note.trim()" class="err">Cuenta qué ves para que se revise con un conteo.</small>
      </div>

      <!-- Resumen a la vista: lo que se va a enviar -->
      <Transition name="fade">
        <section v-if="lines.length" class="card resume" aria-label="Resumen">
          <h3 class="resume-title">Resumen</h3>
          <ul class="resume-lines">
            <li v-for="line in lines" :key="line.product._id">
              <span>{{ line.product.name }}</span>
              <strong v-if="isRevision">Revisión de inventario</strong>
              <strong v-else-if="Number.isFinite(line.qty) && line.qty > 0">{{ qtyText(line.qty, line.mode, line.product) }}</strong>
              <strong v-else class="bad">Falta la cantidad</strong>
            </li>
          </ul>
          <p v-if="note.trim()" class="resume-note">Nota: {{ note }}</p>
          <p v-if="!saved" class="resume-hint">
            <i class="fa-solid fa-circle-info" aria-hidden="true" />
            {{ isRevision ? 'Se revisará con un conteo físico.' : 'Dirección de crucero la aprueba y bodega la sube al barco. Hasta entonces el stock no cambia.' }}
          </p>
        </section>
      </Transition>

      <SaveStatus
        :state="save.state.value"
        :message="save.message.value"
        :offline="save.offline.value"
        :saved-text="saved ? (isRevision ? `Revisión ${saved.code} enviada · Se revisará con un conteo.` : `Solicitud ${saved.code} enviada · Pendiente de aprobación`) : 'Guardado'"
        @retry="send"
      />

      <Transition name="fade" mode="out-in">
        <div v-if="saved" key="done" class="footer">
          <button type="button" class="btn btn-primary big" @click="finish">
            <i class="fa-solid fa-list-check" aria-hidden="true" /> Ver mis solicitudes
          </button>
          <button type="button" class="btn btn-ghost big" @click="startOver">
            <i class="fa-solid fa-plus" aria-hidden="true" /> Nueva solicitud
          </button>
        </div>
        <div v-else key="send" class="footer">
          <button
            type="button"
            class="btn btn-gold big"
            :disabled="save.state.value === 'saving' || (tried && !ready)"
            @click="send"
          >
            <i class="fa-solid" :class="save.state.value === 'saving' ? 'fa-spinner fa-spin' : 'fa-paper-plane'" aria-hidden="true" />
            {{ save.state.value === 'saving' ? 'Enviando…' : isRevision ? 'Enviar revisión' : 'Enviar solicitud' }}
          </button>
        </div>
      </Transition>
    </div>

    <ProductPicker
      v-if="picking"
      title="¿Qué necesitas?"
      :products="catalog.physical"
      show="abordo"
      :taken="lines.map((l) => l.product._id)"
      @pick="addProduct"
      @close="picking = false"
    />
  </section>
</template>

<style scoped lang="scss">
@use './flow' as *;

.dest--compact .dest-btn {
  min-height: 84px;

  &:disabled {
    opacity: 0.6;
  }
}

.finder {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.finder-input {
  flex: 1 1 220px;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 52px;
  padding: 0 0.85rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--ink-400);
  transition: border-color 0.15s ease;

  &:focus-within {
    border-color: var(--gold-500);
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1rem;
    color: var(--ink-900);
    min-height: 0;
    padding: 0;
  }
}

.finder-clear {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
}

.finder-all {
  min-height: 52px;
}

.results {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.result {
  width: 100%;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  text-align: left;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease;

  &:hover {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.99);
  }

  > i {
    margin-left: auto;
    color: var(--navy-700);
  }
}

.result-text {
  display: flex;
  flex-direction: column;
  min-width: 0;

  small {
    color: var(--ink-400);
  }
}

.resume {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.9rem 1rem;
}

.resume-title {
  margin: 0;
  font-size: 1.2rem;
  color: var(--ink-900);
}

.resume-lines {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--rule);
  }

  .bad {
    color: var(--danger);
  }
}

.resume-note,
.resume-hint {
  margin: 0;
  font-size: 0.95rem;
  color: var(--ink-600);
}

.resume-hint i {
  color: var(--navy-700);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
