<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { Product } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { apiCreateCustomCocktail } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'

const props = defineProps<{ products: Product[] }>()
const emit = defineEmits<{ close: []; created: [Product] }>()

interface IngredientLine {
  productId: string
  qty: number
}

const name = shallowRef('')
const ingredients = ref<IngredientLine[]>([{ productId: '', qty: 1 }])
const saving = shallowRef(false)
const error = shallowRef('')

// Solo productos simples pueden ser ingredientes (no cócteles dentro de cócteles).
const ingredientOptions = computed(() =>
  props.products
    .filter((p) => !p.isCocktail)
    .map((p) => ({ value: p._id, label: p.name, hint: `${formatMoney(p.price)}/${p.unit}` })),
)

const priceMap = computed(() => new Map(props.products.map((p) => [p._id, p.price])))

/** Precio automático: suma de ingredientes, igual que lo calcula el backend. */
const autoPrice = computed(() =>
  ingredients.value.reduce(
    (sum, ing) => sum + (priceMap.value.get(ing.productId) ?? 0) * ing.qty,
    0,
  ),
)

function addLine() {
  ingredients.value.push({ productId: '', qty: 1 })
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
    error.value = 'Agrega al menos un ingrediente'
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
        <p class="ingredients-title">Ingredientes</p>
        <TransitionGroup name="list">
          <div v-for="(line, index) in ingredients" :key="index" class="ingredient">
            <BaseSelect v-model="line.productId" :options="ingredientOptions" placeholder="Elige…" />
            <input
              v-model.number="line.qty"
              type="number"
              min="0.25"
              step="0.25"
              aria-label="Cantidad"
            />
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
        <span>Precio automático</span>
        <strong>{{ formatMoney(autoPrice) }}</strong>
      </div>

      <p v-if="error" class="builder-error">{{ error }}</p>

      <button type="button" class="btn btn-gold" :disabled="saving" @click="save">
        {{ saving ? 'Guardando…' : 'Crear y agregar al catálogo' }}
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
  grid-template-columns: 1fr 76px 44px;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  align-items: start;

  input {
    padding: 0.55rem 0.6rem;
    border: 1.5px solid var(--cream-200);
    border-radius: var(--radius-sm);
    min-height: 48px;
    width: 100%;
  }
}

.ingredient-remove {
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--cream-200);
  color: var(--ink-600);
}

.add-line {
  width: 100%;
}

.price {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.75rem 1rem;
  background: var(--cream-200);
  border-radius: var(--radius-sm);

  strong {
    font-size: 1.25rem;
  }
}

.builder-error {
  margin: 0;
  color: var(--danger);
  font-weight: 600;
  font-size: 0.9rem;
}
</style>
