<script setup lang="ts">
import type { CartLine } from '@/composables/usePosCart'
import { formatMoney } from '@/utils/format'

defineProps<{
  lines: CartLine[]
  total: number
  itemCount: number
  cabinNumber: number | null
  guestName: string
  canCourtesy: boolean
  sending: boolean
  /** Por qué no se puede registrar (salida no iniciada, cabina vacía…). */
  blockedReason: string
}>()

const emit = defineEmits<{
  setQty: [index: number, qty: number]
  toggleCourtesy: [index: number]
  submit: []
  cancel: []
}>()
</script>

<template>
  <aside class="cart">
    <header class="cart-head">
      <p class="cart-eyebrow">Comanda · borrador</p>
      <div class="cart-target">
        <span v-if="cabinNumber" class="cart-cabin">
          <i class="fa-solid fa-door-closed" aria-hidden="true" /> Cabina {{ cabinNumber }}
        </span>
        <span v-else class="cart-cabin cart-cabin--warn">
          <i class="fa-solid fa-hand-pointer" aria-hidden="true" /> Elige cabina
        </span>
        <span v-if="guestName" class="cart-guest">{{ guestName }}</span>
      </div>
    </header>

    <p v-if="!lines.length" class="cart-empty">
      <i class="fa-solid fa-martini-glass-empty" aria-hidden="true" />
      Toca bebidas del catálogo para agregarlas.
    </p>

    <TransitionGroup v-else name="list" tag="ul" class="cart-lines">
      <li v-for="(line, index) in lines" :key="`${line.product._id}-${line.courtesy}`" class="line">
        <div class="line-info">
          <span class="line-name">
            {{ line.product.name }}
            <em v-if="line.courtesy" class="line-courtesy">cortesía</em>
          </span>
          <span class="line-price">
            {{ formatMoney(line.courtesy ? 0 : line.qty * line.product.price) }}
          </span>
        </div>
        <div class="line-actions">
          <button
            type="button"
            class="qty-btn"
            aria-label="Quitar uno"
            @click="emit('setQty', index, line.qty - 1)"
          >
            <i class="fa-solid fa-minus" aria-hidden="true" />
          </button>
          <span class="line-qty">{{ line.qty }}</span>
          <button
            type="button"
            class="qty-btn"
            aria-label="Agregar uno"
            @click="emit('setQty', index, line.qty + 1)"
          >
            <i class="fa-solid fa-plus" aria-hidden="true" />
          </button>
          <button
            v-if="canCourtesy"
            type="button"
            class="courtesy-btn"
            :class="{ 'courtesy-btn--on': line.courtesy }"
            :title="line.courtesy ? 'Quitar cortesía' : 'Marcar como cortesía'"
            @click="emit('toggleCourtesy', index)"
          >
            <i class="fa-solid fa-gift" aria-hidden="true" />
          </button>
        </div>
      </li>
    </TransitionGroup>

    <footer class="cart-foot">
      <div class="cart-total">
        <span>{{ itemCount }} {{ itemCount === 1 ? 'bebida' : 'bebidas' }}</span>
        <strong>{{ formatMoney(total) }}</strong>
      </div>

      <p v-if="blockedReason && lines.length" class="cart-blocked">
        <i class="fa-solid fa-circle-info" aria-hidden="true" /> {{ blockedReason }}
      </p>

      <button
        type="button"
        class="btn btn-primary cart-submit"
        :disabled="!lines.length || Boolean(blockedReason) || sending"
        @click="emit('submit')"
      >
        <i class="fa-solid fa-clipboard-check" aria-hidden="true" />
        {{ sending ? 'Registrando…' : 'Registrar pedido' }}
      </button>
      <button
        type="button"
        class="btn btn-danger cart-cancel"
        :disabled="!lines.length || sending"
        @click="emit('cancel')"
      >
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" />
        Cancelar pedido
      </button>
    </footer>
  </aside>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.cart {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  background: var(--surface);
  border: 1px solid var(--cream-200);
  border-radius: var(--radius);
  padding: 1rem;
  box-shadow: var(--shadow);
  min-width: 0;
}

.cart-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-400);
}

.cart-target {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.cart-cabin {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  background: var(--navy-800);
  color: #fff;

  &--warn {
    background: rgba(185, 128, 47, 0.16);
    color: #8a5d1d;
  }
}

.cart-guest {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--ink-600);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cart-empty {
  margin: 0.3rem 0;
  color: var(--ink-400);
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cart-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 38dvh;
  overflow-y: auto;
}

.line {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px dashed var(--cream-200);
}

.line-info {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.92rem;
}

.line-name {
  font-weight: 600;
  min-width: 0;
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
  font-variant-numeric: tabular-nums;
}

.line-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.qty-btn {
  min-width: 42px;
  min-height: 42px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--cream-100);
  border: 1px solid var(--cream-200);
  font-size: 0.85rem;
  color: var(--ink-600);
  transition: transform 0.12s ease;

  &:active {
    transform: scale(0.92);
  }
}

.line-qty {
  min-width: 1.6rem;
  text-align: center;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.courtesy-btn {
  min-width: 42px;
  min-height: 42px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--cream-200);
  color: var(--ink-400);
  font-size: 0.9rem;
  margin-left: auto;
  transition: all 0.16s ease;

  &--on {
    color: var(--success);
    border-color: var(--success);
    background: rgba(63, 122, 87, 0.1);
  }
}

.cart-foot {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 0.2rem;
}

.cart-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: var(--ink-600);
  font-size: 0.9rem;

  strong {
    font-size: 1.45rem;
    color: var(--navy-800);
    font-variant-numeric: tabular-nums;
  }
}

.cart-blocked {
  margin: 0;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  background: rgba(185, 128, 47, 0.12);
  color: #7a5219;
  font-size: 0.82rem;
  font-weight: 600;
}

.cart-submit,
.cart-cancel {
  width: 100%;
  justify-content: flex-start;
  padding-left: 1rem;
}
</style>
