<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { Product } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { apiCreateCustomCocktail } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney, unitShort } from '@/utils/format'

/** Insumos físicos disponibles como ingredientes (botellas, mezcladores, frutas). */
const props = defineProps<{ physical: Product[] }>()
const emit = defineEmits<{ close: []; created: [Product] }>()

interface IngredientLine {
  productId: string
  qty: number
}

const name = shallowRef('')
const ingredients = ref<IngredientLine[]>([{ productId: '', qty: 60 }])
const saving = shallowRef(false)
const error = shallowRef('')

const byId = computed(() => new Map(props.physical.map((p) => [p._id, p])))

const ingredientOptions = computed(() =>
  props.physical.map((p) => ({ value: p._id, label: p.name, hint: unitShort(p.stockUnit) })),
)

/** Mismo cálculo que el servidor: medida / medida de referencia × precio de referencia. */
const suggested = computed(() => {
  let total = 0
  for (const ing of ingredients.value) {
    const p = byId.value.get(ing.productId)
    if (p && p.servingSize > 0) total += (ing.qty / p.servingSize) * p.servingPrice
  }
  return Math.ceil(total * 2) / 2
})

function unitOf(line: IngredientLine): string {
  const p = byId.value.get(line.productId)
  return p ? unitShort(p.stockUnit) : ''
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

  saving.value = true
  try {
    const product = await apiCreateCustomCocktail(name.value.trim(), recipe)
    emit('created', product)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    saving.value = false
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
              v-model="line.productId"
              :options="ingredientOptions"
              placeholder="Elige insumo…"
              searchable
            />
            <label class="qty">
              <input v-model.number="line.qty" type="number" min="0" step="5" aria-label="Medida" />
              <span>{{ unitOf(line) }}</span>
            </label>
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

      <div class="price">
        <span>
          Precio sugerido
          <small>según la medida de cada licor</small>
        </span>
        <strong>{{ formatMoney(suggested) }}</strong>
      </div>

      <p v-if="error" class="builder-error">{{ error }}</p>

      <button type="button" class="btn btn-gold" :disabled="saving" @click="save">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
        {{ saving ? 'Guardando…' : 'Crear y agregar a la comanda' }}
      </button>
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

  strong {
    font-size: 1.3rem;
    color: var(--navy-800);
  }
}

.builder-error {
  margin: 0;
  color: var(--danger);
  font-weight: 600;
  font-size: 0.9rem;
}
</style>
