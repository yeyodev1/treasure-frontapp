<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from 'vue'
import type { Product, ProductKind, RecipeIngredient } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { CATEGORY_LABELS } from '@/stores/catalog'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiCreateProduct, apiUpdateProduct } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatMoney, unitShort } from '@/utils/format'

const props = defineProps<{ product: Product | null; physical: Product[] }>()
const emit = defineEmits<{ close: []; saved: [Product] }>()

const userStore = useUserStore()
const toast = useToastStore()
const { play } = useSound()

const KINDS: Array<{ value: ProductKind; label: string; icon: string; help: string }> = [
  { value: 'fisico', label: 'Físico', icon: 'fa-wine-bottle', help: 'Botella, lata o insumo con stock propio.' },
  { value: 'receta', label: 'Receta', icon: 'fa-martini-glass-citrus', help: 'Trago, copa o cóctel: descuenta sus ingredientes.' },
  { value: 'servicio', label: 'Servicio', icon: 'fa-hand-holding-dollar', help: 'Se cobra sin mover inventario (descorche).' },
]

const UNITS = ['ml', 'unidad', 'g', 'cucharadita', 'cucharada', 'ramita', 'rodaja', 'gota', 'golpe', 'porción'].map(
  (u) => ({ value: u, label: u }),
)

const ICONS: Record<string, string> = {
  beer: 'Cerveza',
  wine: 'Copa de vino',
  bottle: 'Botella',
  shot: 'Trago',
  cocktail: 'Cóctel',
  soda: 'Lata / gaseosa',
  water: 'Agua',
  juice: 'Jugo',
  snack: 'Snack',
  lime: 'Cítrico / hierba',
  glass: 'Vaso',
}

const editing = props.product
const form = reactive({
  name: editing?.name ?? '',
  kind: (editing?.kind ?? 'receta') as string,
  category: (editing?.category ?? 'coctel') as string,
  icon: editing?.icon ?? 'cocktail',
  price: editing?.price ?? 0,
  sellable: editing?.sellable ?? true,
  stockUnit: (editing?.stockUnit ?? 'ml') as string,
  containerSize: editing?.containerSize ?? 750,
  containerLabel: editing?.containerLabel ?? 'botella',
  lowStockThreshold: editing?.lowStockThreshold ?? 0,
  servingSize: editing?.servingSize ?? 60,
  servingPrice: editing?.servingPrice ?? 0,
})

const recipe = ref(
  (editing?.recipe ?? []).map((r) => ({
    product: typeof r.product === 'object' ? r.product._id : r.product,
    qty: r.qty,
  })),
)
if (!recipe.value.length) recipe.value.push({ product: '', qty: 60 })

const saving = shallowRef(false)
const isAdmin = computed(() => userStore.isAdmin)

const ingredientOptions = computed(() =>
  props.physical
    .filter((p) => p._id !== editing?._id)
    .map((p) => ({ value: p._id, label: p.name, hint: unitShort(p.stockUnit) })),
)
const categoryOptions = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))
const iconOptions = Object.entries(ICONS).map(([value, label]) => ({ value, label }))

const byId = computed(() => new Map(props.physical.map((p) => [p._id, p])))

function unitFor(id: string): string {
  const p = byId.value.get(id) as unknown as RecipeIngredient | undefined
  return p ? unitShort(p.stockUnit) : ''
}

async function save() {
  if (!form.name.trim()) {
    toast.error('El nombre es obligatorio')
    return
  }
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    kind: form.kind,
    category: form.category,
    icon: form.icon,
  }
  if (isAdmin.value) payload.price = form.price
  if (form.kind === 'fisico') {
    Object.assign(payload, {
      sellable: form.sellable,
      stockUnit: form.stockUnit,
      containerSize: form.containerSize,
      containerLabel: form.containerLabel,
      lowStockThreshold: form.lowStockThreshold,
      servingSize: form.servingSize,
      servingPrice: form.servingPrice,
    })
  }
  if (form.kind === 'receta') {
    const clean = recipe.value.filter((r) => r.product && r.qty > 0)
    if (!clean.length) {
      toast.error('Agrega al menos un ingrediente con su medida')
      return
    }
    payload.recipe = clean
  }

  saving.value = true
  try {
    const product = editing
      ? await apiUpdateProduct(editing._id, payload)
      : await apiCreateProduct(payload)
    play('success')
    toast.success(editing ? 'Producto actualizado' : 'Producto creado')
    emit('saved', product)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="editing ? `Editar · ${editing.name}` : 'Nuevo producto'" @close="emit('close')">
    <div class="editor">
      <div class="kinds" role="radiogroup" aria-label="Tipo de producto">
        <button
          v-for="k in KINDS"
          :key="k.value"
          type="button"
          class="kind"
          :class="{ on: form.kind === k.value }"
          role="radio"
          :aria-checked="form.kind === k.value"
          @click="form.kind = k.value"
        >
          <i class="fa-solid" :class="k.icon" aria-hidden="true" />
          <strong>{{ k.label }}</strong>
          <span>{{ k.help }}</span>
        </button>
      </div>

      <div class="field">
        <label for="p-name">Nombre</label>
        <input id="p-name" v-model="form.name" type="text" />
      </div>

      <div class="row">
        <div class="field">
          <label>Categoría</label>
          <BaseSelect v-model="form.category" :options="categoryOptions" />
        </div>
        <div class="field">
          <label>Icono</label>
          <BaseSelect v-model="form.icon" :options="iconOptions" />
        </div>
      </div>

      <!-- Físico -->
      <template v-if="form.kind === 'fisico'">
        <div class="row">
          <div class="field">
            <label>Unidad de inventario</label>
            <BaseSelect v-model="form.stockUnit" :options="UNITS" />
          </div>
          <div class="field">
            <label for="p-csize">Contenido por envase</label>
            <div class="suffix">
              <input id="p-csize" v-model.number="form.containerSize" type="number" min="1" />
              <span>{{ unitShort(form.stockUnit) }}</span>
            </div>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="p-clabel">Nombre del envase</label>
            <input id="p-clabel" v-model="form.containerLabel" type="text" placeholder="botella, lata…" />
          </div>
          <div class="field">
            <label for="p-low">Alerta de stock bajo</label>
            <div class="suffix">
              <input id="p-low" v-model.number="form.lowStockThreshold" type="number" min="0" />
              <span>{{ unitShort(form.stockUnit) }}</span>
            </div>
          </div>
        </div>
        <label class="check">
          <input v-model="form.sellable" type="checkbox" />
          Se vende cerrado en el bar (si no, es solo insumo de recetas)
        </label>
        <div class="row">
          <div class="field">
            <label for="p-ssize">Medida de referencia</label>
            <div class="suffix">
              <input id="p-ssize" v-model.number="form.servingSize" type="number" min="0" />
              <span>{{ unitShort(form.stockUnit) }}</span>
            </div>
          </div>
          <div class="field">
            <label for="p-sprice">Precio de esa medida</label>
            <div class="suffix">
              <input id="p-sprice" v-model.number="form.servingPrice" type="number" min="0" step="0.25" />
              <span>USD</span>
            </div>
          </div>
        </div>
        <p class="help">La medida de referencia sirve para sugerir el precio de cócteles creados en el bar.</p>
      </template>

      <!-- Receta -->
      <template v-if="form.kind === 'receta'">
        <div class="recipe">
          <p class="recipe-title">Ingredientes y medida por servicio</p>
          <TransitionGroup name="list">
            <div v-for="(line, index) in recipe" :key="index" class="ing">
              <BaseSelect v-model="line.product" :options="ingredientOptions" placeholder="Buscar insumo…" searchable />
              <div class="suffix">
                <input v-model.number="line.qty" type="number" min="0" step="any" aria-label="Medida" />
                <span>{{ unitFor(line.product) }}</span>
              </div>
              <button type="button" class="ing-remove" aria-label="Quitar" @click="recipe.splice(index, 1)">
                <i class="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          </TransitionGroup>
          <button type="button" class="btn btn-ghost" @click="recipe.push({ product: '', qty: 30 })">
            <i class="fa-solid fa-plus" aria-hidden="true" /> Agregar ingrediente
          </button>
        </div>
      </template>

      <!-- Precio: solo Paula -->
      <div v-if="form.kind !== 'fisico' || form.sellable" class="field">
        <label for="p-price">Precio de venta (USD)</label>
        <input id="p-price" v-model.number="form.price" type="number" min="0" step="0.25" :disabled="!isAdmin" />
        <small v-if="!isAdmin" class="lock">
          <i class="fa-solid fa-lock" aria-hidden="true" /> Solo Paula cambia el precio vigente.
        </small>
        <small v-else class="help">Las ventas anteriores conservan el precio con el que se registraron.</small>
      </div>

      <details v-if="editing?.priceHistory?.length" class="history">
        <summary><i class="fa-solid fa-clock-rotate-left" aria-hidden="true" /> Historial de precios</summary>
        <ul>
          <li v-for="(h, i) in [...editing.priceHistory].reverse()" :key="i">
            <strong>{{ formatMoney(h.price) }}</strong>
            · {{ typeof h.changedBy === 'object' ? h.changedBy.name : '' }} · {{ formatDateTime(h.at) }}
          </li>
        </ul>
      </details>

      <button type="button" class="btn btn-gold" :disabled="saving" @click="save">
        <i class="fa-solid fa-floppy-disk" aria-hidden="true" /> {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.editor {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.kinds {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.kind {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 0.45rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  text-align: center;
  transition: all 0.15s ease;

  i {
    font-size: 1.15rem;
    color: var(--gold-500);
  }

  strong {
    font-size: 0.9rem;
  }

  span {
    font-size: 0.7rem;
    color: var(--ink-400);
    line-height: 1.25;
  }

  &.on {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;

    i,
    span {
      color: var(--powder-300);
    }
  }
}

.row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: 1fr 1fr;
  }
}

.suffix {
  display: flex;
  align-items: center;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  background: #fff;
  padding-right: 0.6rem;
  min-height: 48px;

  input {
    flex: 1;
    min-width: 0;
    border: none !important;
    outline: none;
    background: transparent;
  }

  span {
    font-size: 0.8rem;
    color: var(--ink-400);
  }
}

.check {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.88rem;
  font-weight: 600;

  input {
    width: 1.15rem;
    height: 1.15rem;
    accent-color: var(--navy-800);
  }
}

.help {
  margin: 0;
  font-size: 0.78rem;
  color: var(--ink-400);
}

.lock {
  color: var(--warning);
  font-weight: 600;
}

.recipe {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.recipe-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-600);
}

.ing {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 44px;
  gap: 0.4rem;
  align-items: start;
}

.ing-remove {
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--cream-100);
  color: var(--ink-600);
}

.history {
  summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.86rem;
    color: var(--ink-600);
  }

  ul {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.84rem;
    color: var(--ink-600);
  }
}
</style>
