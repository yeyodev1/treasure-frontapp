<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { Product } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useConfirmStore } from '@/stores/confirm'
import { apiCreateCustomCocktail, apiRemoveCustomCocktail } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney, unitShort } from '@/utils/format'

/**
 * Crear cóctel en el bar. Los licores se eligen como trago (pedido del
 * cliente, 31-oct-2026: "deberían aparecer los tragos, no botellas"): la
 * medida arranca en un trago y el stock se descuenta de su botella. Abajo,
 * los cócteles creados en el bar con Eliminar (sale de la carta; lo vendido
 * queda en el historial).
 */
const props = defineProps<{
  /** Insumos físicos: botellas (como trago o copa), mezcladores, frutas. */
  physical: Product[]
  /** Cócteles creados en el bar que siguen en la carta. */
  custom: Product[]
}>()
const emit = defineEmits<{ close: []; created: [Product]; removed: [Product] }>()

const confirmStore = useConfirmStore()

interface IngredientLine {
  productId: string
  qty: number
}

const SHOT_ML = 60

const name = shallowRef('')
const ingredients = ref<IngredientLine[]>([{ productId: '', qty: SHOT_ML }])
const saving = shallowRef(false)
const removing = shallowRef('')
const error = shallowRef('')

const byId = computed(() => new Map(props.physical.map((p) => [p._id, p])))

/** Cómo se nombra el insumo: el licor como trago, el vino como copa. */
function servedAs(p: Product): 'trago' | 'copa' | null {
  if (p.stockUnit !== 'ml') return null
  if (p.category === 'licor') return 'trago'
  if (p.category === 'vino' && p.containerSize >= 750) return 'copa'
  return null
}

function ingredientLabel(p: Product): string {
  const base = p.name.replace(/\s*\(botella\)\s*$/i, '')
  const as = servedAs(p)
  return as ? `${base} (${as})` : base
}

/** Medida con que arranca: un trago o una copa; el resto, la medida de siempre. */
function defaultQty(p: Product): number {
  return servedAs(p) && p.servingSize > 0 ? p.servingSize : servedAs(p) === 'trago' ? SHOT_ML : 30
}

const RANK: Record<string, number> = { licor: 0, vino: 2 }

const ingredientOptions = computed(() =>
  [...props.physical]
    // Las botellas pequeñas de vino se venden cerradas: no son insumo de coctelería.
    .filter((p) => !(p.category === 'vino' && !servedAs(p)))
    .sort((a, b) => (RANK[a.category] ?? 1) - (RANK[b.category] ?? 1) || ingredientLabel(a).localeCompare(ingredientLabel(b), 'es'))
    .map((p) => {
      const as = servedAs(p)
      return {
        value: p._id,
        label: ingredientLabel(p),
        hint: as ? `${defaultQty(p)} ${unitShort(p.stockUnit)}` : unitShort(p.stockUnit),
      }
    }),
)

function pick(line: IngredientLine, productId: string) {
  line.productId = productId
  const p = byId.value.get(productId)
  if (p) line.qty = defaultQty(p)
}

/** Sugerido $14 (pedido del cliente, 5-nov-2026); el bar lo sube o lo baja según el trago. */
const SUGGESTED_PRICE = 14
const price = shallowRef<number | ''>(SUGGESTED_PRICE)

function unitOf(line: IngredientLine): string {
  const p = byId.value.get(line.productId)
  return p ? unitShort(p.stockUnit) : ''
}

/** "1 trago", "1,5 tragos", "1 copa": ayuda a leer la medida en ml. */
function servingNote(line: IngredientLine): string {
  const p = byId.value.get(line.productId)
  const as = p ? servedAs(p) : null
  if (!p || !as || !(line.qty > 0)) return ''
  const n = Math.round((line.qty / defaultQty(p)) * 100) / 100
  const word = as === 'trago' ? (n === 1 ? 'trago' : 'tragos') : n === 1 ? 'copa' : 'copas'
  return `${String(n).replace('.', ',')} ${word}`
}

function addLine() {
  ingredients.value.push({ productId: '', qty: 30 })
}

function removeLine(index: number) {
  ingredients.value.splice(index, 1)
}

async function save() {
  error.value = ''
  const recipe = ingredients.value
    .filter((i) => i.productId && i.qty > 0)
    .map((i) => ({ product: i.productId, qty: i.qty }))

  if (!name.value.trim()) {
    error.value = 'Ponle un nombre al cóctel'
    return
  }
  if (!recipe.length) {
    error.value = 'Agrega al menos un ingrediente con su medida'
    return
  }
  if (typeof price.value !== 'number' || !(price.value > 0) || price.value > 500) {
    error.value = 'Pon el precio del cóctel (entre $0,01 y $500)'
    return
  }

  saving.value = true
  try {
    const product = await apiCreateCustomCocktail(name.value.trim(), recipe, price.value)
    emit('created', product)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    saving.value = false
  }
}

async function remove(product: Product) {
  if (removing.value) return
  const ok = await confirmStore.ask({
    title: `¿Eliminar el cóctel ${product.name}?`,
    message: 'Sale de la carta del bar. Lo que ya se vendió queda en las cuentas y en el historial.',
    confirmLabel: 'Eliminar cóctel',
    danger: true,
    icon: 'fa-trash-can',
  })
  if (!ok) return
  removing.value = product._id
  error.value = ''
  try {
    await apiRemoveCustomCocktail(product._id)
    emit('removed', product)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    removing.value = ''
  }
}
</script>

<template>
  <BaseModal title="Crear cóctel" @close="emit('close')">
    <div class="builder">
      <div class="field">
        <label for="cocktail-name">Nombre del cóctel</label>
        <input id="cocktail-name" v-model="name" type="text" placeholder="Ej. Sunset Galápagos" />
      </div>

      <div class="ingredients">
        <p class="ingredients-title">Ingredientes y medida</p>
        <TransitionGroup name="list">
          <div v-for="(line, index) in ingredients" :key="index" class="ingredient">
            <BaseSelect
              :model-value="line.productId"
              :options="ingredientOptions"
              placeholder="Elige trago o insumo…"
              searchable
              @update:model-value="(v: string) => pick(line, v)"
            />
            <label class="qty">
              <input v-model.number="line.qty" type="number" min="0" step="5" aria-label="Medida" />
              <span>{{ unitOf(line) }}</span>
            </label>
            <p v-if="servingNote(line)" class="serving-note">{{ servingNote(line) }}</p>
            <button
              type="button"
              class="ingredient-remove"
              aria-label="Quitar ingrediente"
              @click="removeLine(index)"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </TransitionGroup>
        <button type="button" class="btn btn-ghost add-line" @click="addLine">
          <i class="fa-solid fa-plus" aria-hidden="true" /> Agregar ingrediente
        </button>
      </div>

      <label class="price">
        <span>
          Precio del cóctel
          <small>Sugerido {{ formatMoney(SUGGESTED_PRICE) }}: súbelo o bájalo según el trago</small>
        </span>
        <span class="price-input">
          <span aria-hidden="true">$</span>
          <input v-model.number="price" type="number" inputmode="decimal" min="0.5" max="500" step="0.5" aria-label="Precio del cóctel en dólares" />
        </span>
      </label>

      <p v-if="error" class="builder-error">{{ error }}</p>

      <button type="button" class="btn btn-gold" :disabled="saving" @click="save">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Crear cóctel' }}
      </button>

      <!-- Cócteles creados en el bar: se pueden eliminar -->
      <section v-if="custom.length" class="created" aria-labelledby="created-title">
        <h3 id="created-title" class="created-title">Cócteles creados en el bar</h3>
        <TransitionGroup name="list" tag="ul" class="created-list">
          <li v-for="c in custom" :key="c._id" class="created-item">
            <span class="created-name">
              <strong>{{ c.name }}</strong>
              <small>{{ formatMoney(c.price) }}</small>
            </span>
            <button
              type="button"
              class="created-remove"
              :disabled="Boolean(removing)"
              :aria-label="`Eliminar ${c.name}`"
              @click="remove(c)"
            >
              <i class="fa-solid" :class="removing === c._id ? 'fa-spinner fa-spin' : 'fa-trash-can'" aria-hidden="true" />
              Eliminar
            </button>
          </li>
        </TransitionGroup>
      </section>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.builder {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.ingredients-title {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-600);
}

.ingredient {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 104px 44px;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  align-items: start;
}

.qty {
  display: flex;
  align-items: center;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  min-height: 48px;
  padding-right: 0.55rem;
  background: #fff;

  input {
    width: 100%;
    min-width: 0;
    border: none;
    outline: none;
    padding: 0.55rem 0.5rem;
    background: transparent;
  }

  span {
    font-size: 0.78rem;
    color: var(--ink-400);
  }
}

.serving-note {
  grid-column: 1 / -1;
  margin: -0.2rem 0 0;
  font-size: 0.78rem;
  color: var(--ink-400);
  text-align: right;
  padding-right: calc(44px + 0.4rem);
}

.ingredient-remove {
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--cream-100);
  color: var(--ink-600);
}

.add-line {
  width: 100%;
}

.price {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--powder-100);
  border-radius: var(--radius-sm);

  small {
    display: block;
    font-size: 0.74rem;
    color: var(--ink-400);
  }

  gap: 1rem;
}

.price-input {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--navy-800);

  input {
    width: 6.5rem;
    min-height: 48px;
    padding: 0 0.6rem;
    border: 1px solid var(--line-strong, var(--line));
    border-radius: var(--radius-sm);
    background: var(--surface, #fff);
    font: inherit;
    color: inherit;
    text-align: right;
  }
}

.created {
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}

.created-title {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-600);
}

.created-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.created-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0.35rem 0.35rem 0.8rem;
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);
}

.created-name {
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  small {
    color: var(--ink-400);
    font-variant-numeric: tabular-nums;
  }
}

.created-remove {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0 0.8rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--danger);
  transition:
    background 0.15s ease,
    opacity 0.15s ease,
    transform 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--cream-100);
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:disabled {
    opacity: 0.45;
  }
}

.builder-error {
  margin: 0;
  color: var(--danger);
  font-weight: 600;
  font-size: 0.9rem;
}
</style>
