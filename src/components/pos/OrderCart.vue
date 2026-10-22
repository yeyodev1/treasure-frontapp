<script setup lang="ts">
import type { CartLine } from '@/composables/usePosCart'
import { formatMoney } from '@/utils/format'

defineProps<{
  lines: CartLine[]
  total: number
  cabinNumber: number | null
  canCourtesy: boolean
  sending: boolean
}>()

const emit = defineEmits<{
  setQty: [index: number, qty: number]
  toggleCourtesy: [index: number]
  submit: []
  clear: []
}>()
</script>

<template>
  <aside class="cart card">
    <header class="cart-head">
      <h2>Comanda</h2>
      <span v-if="cabinNumber" class="cart-cabin">Cabina {{ cabinNumber }}</span>
      <span v-else class="cart-cabin cart-cabin--warn">Elige cabina</span>
    </header>

    <p v-if="!lines.length" class="cart-empty">Toca productos del catálogo para agregarlos.</p>

    <ul v-else class="cart-lines">
      <li v-for="(line, index) in lines" :key="`${line.product._id}-${index}`" class="line">
        <div class="line-info">
          <span class="line-name">
            {{ line.product.name }}
            <em v-if="line.courtesy" class="line-courtesy">cortesía</em>
          </span>
          <span class="line-price">{{ formatMoney(line.courtesy ? 0 : line.qty * line.product.price) }}</span>
        </div>
        <div class="line-actions">
          <button type="button" class="qty-btn" @click="emit('setQty', index, line.qty - 1)">−</button>
          <span class="line-qty">{{ line.qty }}</span>
          <button type="button" class="qty-btn" @click="emit('setQty', index, line.qty + 1)">＋</button>
          <button
            v-if="canCourtesy"
            type="button"
            class="courtesy-btn"
            :class="{ 'courtesy-btn--on': line.courtesy }"
            :title="line.courtesy ? 'Quitar cortesía' : 'Marcar cortesía'"
            @click="emit('toggleCourtesy', index)"
          >
            🎁
          </button>
        </div>
      </li>
    </ul>

    <footer v-if="lines.length" class="cart-foot">
      <div class="cart-total">
        <span>Total</span>
        <strong>{{ formatMoney(total) }}</strong>
      </div>
      <div class="cart-buttons">
        <button type="button" class="btn btn-ghost" @click="emit('clear')">Vaciar</button>
        <button
          type="button"
          class="btn btn-gold"
          :disabled="!cabinNumber || sending"
          @click="emit('submit')"
        >
          {{ sending ? 'Enviando…' : 'Enviar pedido' }}
        </button>
      </div>
    </footer>
  </aside>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.cart {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.cart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;

  h2 {
    font-size: 1.05rem;
  }
}

.cart-cabin {
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: var(--navy-800);
  color: var(--cream-100);

  &--warn {
    background: var(--warning);
    color: var(--navy-900);
  }
}

.cart-empty {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.9rem;
}

.cart-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 40dvh;
  overflow-y: auto;

  @include desktop {
    max-height: none;
  }
}

.line {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px dashed var(--cream-200);
}

.line-info {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.line-name {
  font-weight: 600;
}

.line-courtesy {
  font-style: normal;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--success);
  margin-left: 0.3rem;
}

.line-price {
  font-weight: 700;
  white-space: nowrap;
}

.line-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.qty-btn {
  @include touch-target;
  min-width: 40px;
  min-height: 40px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--cream-200);
  font-size: 1.1rem;
  font-weight: 700;
}

.line-qty {
  min-width: 1.6rem;
  text-align: center;
  font-weight: 700;
}

.courtesy-btn {
  @include touch-target;
  min-width: 40px;
  min-height: 40px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--cream-200);
  filter: grayscale(1);
  opacity: 0.6;

  &--on {
    filter: none;
    opacity: 1;
    border-color: var(--success);
    background: rgba(63, 174, 106, 0.12);
  }
}

.cart-foot {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.cart-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 1rem;

  strong {
    font-size: 1.3rem;
  }
}

.cart-buttons {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 0.5rem;
}
</style>
