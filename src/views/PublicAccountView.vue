<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { apiPublicAccount } from '@/services/api'
import { formatMoney, formatDateTime } from '@/utils/format'
import type { PublicAccount } from '@/types'
import BrandSeal from '@/components/ui/BrandSeal.vue'

const route = useRoute()
const data = shallowRef<PublicAccount | null>(null)
const failed = shallowRef(false)

onMounted(async () => {
  try {
    data.value = await apiPublicAccount(String(route.params.token))
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <main class="public">
    <div class="public-card">
      <header class="public-head">
        <BrandSeal :size="76" class="public-seal" />
        <h1>Treasure of Galápagos</h1>
        <p v-if="data">Cabina {{ data.cabinNumber }} · {{ data.guestName || 'Huésped' }}</p>
      </header>

      <p v-if="failed" class="public-error">
        No encontramos esta cuenta. Pide ayuda a la tripulación.
      </p>

      <template v-else-if="data">
        <section v-if="data.account.orders.length" class="public-orders">
          <article v-for="order in data.account.orders" :key="order.id" class="public-order">
            <p class="public-order-date">{{ formatDateTime(order.createdAt) }}</p>
            <ul>
              <li v-for="(item, i) in order.items" :key="i">
                <span>
                  {{ item.qty }}× {{ item.name }}
                  <em v-if="item.courtesy" class="public-courtesy">cortesía</em>
                </span>
                <span>{{ formatMoney(item.courtesy ? 0 : item.qty * item.unitPrice) }}</span>
              </li>
            </ul>
          </article>
        </section>

        <p v-else class="public-empty">Aún no tienes consumos registrados. ¡Salud! 🥂</p>

        <footer class="public-total">
          <span>Total de tu cuenta</span>
          <strong>{{ formatMoney(data.account.total) }}</strong>
        </footer>

        <p class="public-note">
          El pago se realiza al final del crucero con la tripulación: efectivo o tarjeta.
        </p>
      </template>

      <p v-else class="public-loading">Cargando tu cuenta…</p>
    </div>
  </main>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.public {
  min-height: 100dvh;
  background:
    radial-gradient(ellipse at 15% 0%, rgba(185, 204, 224, 0.18), transparent 55%),
    radial-gradient(ellipse at 100% 100%, rgba(195, 161, 105, 0.2), transparent 55%),
    var(--navy-900);
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

.public-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-top: 2px solid var(--cream-200);
  padding-top: 0.75rem;
  margin-top: 0.75rem;

  strong {
    font-size: 1.5rem;
    color: var(--navy-800);
  }
}

.public-note {
  margin: 0.9rem 0 0;
  font-size: 0.8rem;
  color: var(--ink-400);
  text-align: center;
}

.public-empty,
.public-loading,
.public-error {
  text-align: center;
  color: var(--ink-600);
  font-weight: 600;
}

.public-error {
  color: var(--danger);
}
</style>
