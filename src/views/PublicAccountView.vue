<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { apiPublicAccount } from '@/services/api'
import { TIMEZONE } from '@/utils/format'
import type { PublicAccount } from '@/types'
import BrandSeal from '@/components/ui/BrandSeal.vue'

/**
 * Cuenta del pasajero (QR): en inglés, como la prefactura, con total, pagos
 * y saldo (checklist 29-oct, 22). Medios de pago iguales a los de Cobros.
 */
const route = useRoute()
const data = shallowRef<PublicAccount | null>(null)
const failed = shallowRef(false)

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const formatUsd = (value: number) => money.format(value)
const formatWhen = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  })

const METHOD_EN: Record<string, string> = {
  efectivo: 'Cash',
  tarjeta: 'Card',
  transferencia: 'Bank transfer',
  online: 'Online payment',
}

// La app es en español (<html lang="es">); esta página es del pasajero y va
// en inglés completa, también para el navegador y su traductor.
const previousLang = document.documentElement.lang
onBeforeUnmount(() => {
  document.documentElement.lang = previousLang
})

onMounted(async () => {
  document.documentElement.lang = 'en'
  document.title = 'Your onboard account · Treasure of Galapagos'
  try {
    data.value = await apiPublicAccount(String(route.params.token))
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <main class="public" lang="en">
    <div class="public-card">
      <header class="public-head">
        <BrandSeal :size="104" class="public-seal" />
        <h1>Your onboard account</h1>
        <p v-if="data">{{ data.cruiseName }} · Cabin {{ data.cabinNumber }}{{ data.guestName ? ` · ${data.guestName}` : '' }}</p>
      </header>

      <p v-if="failed" class="public-error">
        We could not find this account. Please ask the crew for help.
      </p>

      <Transition v-else-if="data" name="fade" appear>
        <div>
          <section v-if="data.account.orders.length" class="public-orders">
            <article v-for="order in data.account.orders" :key="order.id" class="public-order">
              <p class="public-order-date">{{ formatWhen(order.createdAt) }}</p>
              <ul>
                <li v-for="(item, i) in order.items" :key="i">
                  <span>
                    {{ item.qty }} × {{ item.name }}
                    <em v-if="item.courtesy" class="public-courtesy">complimentary</em>
                  </span>
                  <span>{{ formatUsd(item.courtesy ? 0 : item.qty * item.unitPrice) }}</span>
                </li>
              </ul>
            </article>
          </section>

          <p v-else class="public-empty">
            <i class="fa-solid fa-champagne-glasses" aria-hidden="true" />
            No items recorded yet.
          </p>

          <dl class="public-sums">
            <div class="public-sum">
              <dt>Total</dt>
              <dd>{{ formatUsd(data.account.total) }}</dd>
            </div>
            <div class="public-sum">
              <dt>Payments received</dt>
              <dd>{{ formatUsd(data.account.paid) }}</dd>
            </div>
            <ul v-if="data.account.payments.length" class="public-payments">
              <li v-for="(p, i) in data.account.payments" :key="i">
                <span>{{ formatWhen(p.createdAt) }} · {{ METHOD_EN[p.method] ?? p.method }}</span>
                <span>{{ formatUsd(p.total) }}</span>
              </li>
            </ul>
            <div class="public-sum public-sum--due">
              <dt>Balance due</dt>
              <dd>{{ formatUsd(data.account.due) }}</dd>
            </div>
          </dl>

          <p class="public-note">
            Payment is settled with the crew at the end of the cruise: cash, card, bank transfer or online
            payment. Currency: USD.
          </p>
        </div>
      </Transition>

      <p v-else class="public-loading">Loading your account…</p>
    </div>
  </main>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.public {
  min-height: 100dvh;
  background: var(--powder-300) url('/brand/algas.png') center / 520px auto repeat fixed;
  display: flex;
  justify-content: center;
  padding: 1.25rem 1rem 2rem;
}

.public-card {
  width: 100%;
  max-width: 460px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 1.5rem 1.25rem;
  height: fit-content;

  @include tablet {
    padding: 2rem 1.75rem;
  }
}

.public-head {
  text-align: center;
  margin-bottom: 1.25rem;

  h1 {
    font-size: 1.3rem;
  }

  p {
    margin: 0.25rem 0 0;
    color: var(--ink-400);
    font-weight: 600;
    font-size: 0.9rem;
  }
}

.public-seal {
  margin: 0 auto 0.6rem;
  color: var(--navy-800);
}

.public-order {
  margin-bottom: 0.9rem;

  ul {
    list-style: none;
    margin: 0;
    padding: 0;

    li {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.2rem 0;
      font-size: 0.92rem;
    }
  }
}

.public-order-date {
  margin: 0 0 0.15rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ink-400);
}

.public-courtesy {
  font-style: normal;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--success);
}

.public-sums {
  margin: 0.75rem 0 0;
  border-top: 2px solid var(--cream-200);
  padding-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.public-sum {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;

  dt {
    font-weight: 600;
    color: var(--ink-600);
  }

  dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  &--due {
    border-top: 1px solid var(--cream-200);
    padding-top: 0.5rem;
    margin-top: 0.2rem;

    dd {
      font-size: 1.5rem;
      color: var(--navy-800);
    }
  }
}

.public-payments {
  list-style: none;
  margin: 0;
  padding: 0 0 0 0.75rem;
  font-size: 0.82rem;
  color: var(--ink-400);

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
}

.fade-enter-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from {
  opacity: 0;
}

.public-note {
  margin: 0.9rem 0 0;
  font-size: 0.8rem;
  color: var(--ink-400);
}

.public-empty,
.public-loading,
.public-error {
  text-align: center;
  color: var(--ink-600);
  font-weight: 600;
}

.public-empty i {
  color: var(--gold-500);
  margin-right: 0.35rem;
}

.public-error {
  color: var(--danger);
}
</style>
