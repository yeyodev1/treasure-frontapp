<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiConsume, apiWetsuit } from '@/services/api'
import { apiErrorMessage, isNetworkError } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { Product } from '@/types'

/**
 * Wetsuits (pedido del cliente, 5-nov-2026): igual que el bar, se elige la
 * cabina y cuántos wetsuits alquilaron. Por persona: cruceros A y B $50 + IVA,
 * crucero C $80 + IVA (precio del catálogo). Se suma a la cuenta de la cabina
 * junto con las bebidas, o lo paga la agencia y va a su factura.
 */
const cruiseStore = useCruiseStore()
const toast = useToastStore()
const { play } = useSound()
const { active: cruise, cabins } = storeToRefs(cruiseStore)

type Payer = 'cabina' | 'agencia'

const loading = shallowRef(true)
const wetsuit = shallowRef<Pick<Product, '_id' | 'name' | 'price'> | null>(null)
const selectedCabin = shallowRef<number | null>(null)
const qty = shallowRef(1)
const payer = shallowRef<Payer>('cabina')
/** Otro valor por persona (pedido del cliente, 13-nov-2026): vacío = precio del catálogo. */
const otherPrice = shallowRef(false)
const customPrice = shallowRef('')
const sending = shallowRef(false)
/** Misma clave hasta que se guarde: reintentar sin señal nunca duplica. */
let key = crypto.randomUUID()

const cabin = computed(() => cabins.value.find((c) => c.number === selectedCabin.value) ?? null)
const cruiseLabel = computed(() => (cruise.value ? (cruise.value.code ? `Crucero ${cruise.value.code}` : cruise.value.name) : ''))
const parsedCustom = computed(() => Number(customPrice.value.replace(',', '.')))
const unitPrice = computed(() => (otherPrice.value ? parsedCustom.value : (wetsuit.value?.price ?? 0)))
const total = computed(() => (wetsuit.value && unitPrice.value > 0 ? Math.round(unitPrice.value * qty.value * 100) / 100 : 0))

const blockedReason = computed(() => {
  if (!cruise.value) return 'Aún no hay crucero programado.'
  if (cruise.value.status === 'planificado') return `${cruiseLabel.value} aún no ha iniciado. Dirección de crucero debe iniciarlo.`
  if (cruise.value.status === 'cerrado') return `La operación de ${cruiseLabel.value} está finalizada: ya no se registran consumos nuevos.`
  if (!wetsuit.value) return `${cruiseLabel.value} no tiene trayecto A, B o C: no hay precio de wetsuit.`
  if (!cabin.value) return 'Elige la cabina.'
  if (otherPrice.value && !(parsedCustom.value > 0)) return 'Escribe el valor por persona.'
  return ''
})

function passengerNames(c: { passengers: Array<{ name: string; isPayer?: boolean }> }) {
  const main = c.passengers.find((p) => p.isPayer) ?? c.passengers[0]
  if (!main) return ''
  const first = main.name.trim().split(/\s+/)[0] ?? main.name
  return c.passengers.length > 1 ? `${first} +${c.passengers.length - 1}` : first
}

function pickCabin(number: number, hasPassengers: boolean) {
  if (!hasPassengers) {
    toast.push(`Cabina ${number} sin pasajeros. Dirección de crucero debe registrarlos.`)
    return
  }
  selectedCabin.value = number
}

// Cambiar lo que se registra es otro registro: nueva clave.
watch([selectedCabin, qty, payer, otherPrice, customPrice], () => {
  key = crypto.randomUUID()
})

onMounted(async () => {
  try {
    await cruiseStore.loadActive(true)
    if (cruise.value) wetsuit.value = (await apiWetsuit(cruise.value._id)).product
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
})

async function register() {
  if (blockedReason.value || !cruise.value || !cabin.value || !wetsuit.value || sending.value) return
  sending.value = true
  const n = qty.value
  const where = payer.value === 'agencia' ? 'la factura de la agencia' : `la cuenta de la cabina ${cabin.value.number}`
  try {
    await apiConsume({
      cruiseId: cruise.value._id,
      cabinNumber: cabin.value.number,
      productId: wetsuit.value._id,
      qty: n,
      ...(otherPrice.value ? { customPrice: Math.round(parsedCustom.value * 100) / 100 } : {}),
      // Lo que paga la agencia va como cortesía de agencia: no se cobra a la cabina y entra en su factura.
      ...(payer.value === 'agencia'
        ? { courtesy: true, courtesyKind: 'agencia' as const, courtesyReason: 'Wetsuit pagado por la agencia' }
        : {}),
      idempotencyKey: key,
      clientAt: new Date().toISOString(),
    })
    play('success')
    toast.success(`${n} ${n === 1 ? 'wetsuit' : 'wetsuits'} · ${formatMoney(total.value)} a ${where}`)
    key = crypto.randomUUID()
    qty.value = 1
    payer.value = 'cabina'
    otherPrice.value = false
    customPrice.value = ''
    selectedCabin.value = null
  } catch (err) {
    play('error')
    toast.error(isNetworkError(err) ? 'Sin señal: no se guardó. Vuelve a tocar «Agregar» cuando haya conexión.' : apiErrorMessage(err))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="page wetsuits">
    <header class="head">
      <h1 class="page-title"><i class="fa-solid fa-person-swimming" aria-hidden="true" /> Wetsuits</h1>
      <p class="lead">
        <template v-if="cruise">{{ cruiseLabel }}<template v-if="wetsuit"> · {{ formatMoney(wetsuit.price) }} por persona (IVA incluido)</template></template>
        <template v-else>Sin crucero</template>
      </p>
    </header>

    <SkeletonList v-if="loading" variant="tile" :rows="9" />
    <template v-else>
      <section class="block" aria-labelledby="cabin-title">
        <h2 id="cabin-title" class="step">1. Cabina</h2>
        <div class="cabins" role="radiogroup" aria-label="Cabina">
          <button
            v-for="c in cabins"
            :key="c.number"
            type="button"
            role="radio"
            class="cabin"
            :class="{ 'cabin--active': c.number === selectedCabin, 'cabin--empty': !c.passengers.length }"
            :aria-checked="c.number === selectedCabin"
            @click="pickCabin(c.number, c.passengers.length > 0)"
          >
            <span class="cabin-number">Cab {{ c.number }}</span>
            <span class="cabin-guests">{{ c.passengers.length ? passengerNames(c) : 'Sin pasajeros' }}</span>
          </button>
        </div>
      </section>

      <section class="block card form">
        <div class="row">
          <h2 class="step">2. ¿Cuántos wetsuits alquilaron?</h2>
          <QtyStepper v-model="qty" :min="1" :max="50" label="Wetsuits" />
        </div>

        <div class="row">
          <h2 class="step">3. ¿Quién paga?</h2>
          <div class="seg" role="radiogroup" aria-label="Quién paga">
            <button type="button" role="radio" :aria-checked="payer === 'cabina'" :class="{ on: payer === 'cabina' }" @click="payer = 'cabina'">
              <i class="fa-solid fa-bed" aria-hidden="true" /> Cuenta de la cabina
            </button>
            <button type="button" role="radio" :aria-checked="payer === 'agencia'" :class="{ on: payer === 'agencia' }" @click="payer = 'agencia'">
              <i class="fa-solid fa-building" aria-hidden="true" /> Agencia
            </button>
          </div>
          <p class="hint">
            {{ payer === 'agencia'
              ? 'No se cobra a la cabina: va a «Cortesías de agencia» para la factura de la agencia.'
              : 'Se suma a la cuenta de la cabina junto con las bebidas, antes de que paguen.' }}
          </p>
        </div>

        <div class="row">
          <h2 class="step">4. Valor por persona</h2>
          <div class="seg" role="radiogroup" aria-label="Valor por persona">
            <button type="button" role="radio" :aria-checked="!otherPrice" :class="{ on: !otherPrice }" @click="otherPrice = false">
              <i class="fa-solid fa-tag" aria-hidden="true" /> {{ wetsuit ? formatMoney(wetsuit.price) : 'Catálogo' }}
            </button>
            <button type="button" role="radio" :aria-checked="otherPrice" :class="{ on: otherPrice }" @click="otherPrice = true">
              <i class="fa-solid fa-pen" aria-hidden="true" /> Otro valor
            </button>
          </div>
          <div v-if="otherPrice" class="field custom-price">
            <label for="wetsuit-price">Valor por persona (USD, IVA incluido)</label>
            <input id="wetsuit-price" v-model="customPrice" type="text" inputmode="decimal" autocomplete="off" placeholder="Ej. 40" />
          </div>
        </div>

        <p v-if="blockedReason" class="blocked">
          <i class="fa-solid" :class="cabin ? 'fa-circle-info' : 'fa-hand-pointer'" aria-hidden="true" /> {{ blockedReason }}
        </p>

        <button type="button" class="btn btn-gold btn-lg" :disabled="Boolean(blockedReason) || sending" @click="register">
          <i class="fa-solid" :class="sending ? 'fa-spinner fa-spin' : 'fa-plus'" aria-hidden="true" />
          <template v-if="sending">Agregando…</template>
          <template v-else>Agregar {{ qty }} {{ qty === 1 ? 'wetsuit' : 'wetsuits' }}<template v-if="wetsuit"> · {{ formatMoney(total) }}</template></template>
        </button>
        <p class="hint">Para corregir uno ya agregado, usa la cuenta de la cabina en Bar.</p>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.wetsuits {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.head {
  .page-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .lead {
    margin: 0.25rem 0 0;
    color: var(--ink-600);
  }
}

.step {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--ink-900);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.25rem;
}

.hint {
  margin: 0.45rem 0 0;
  color: var(--ink-600);
  font-size: 0.95rem;
}

.custom-price {
  margin-top: 0.6rem;
}

.blocked {
  margin: 0;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  color: var(--ink-600);
  font-weight: 600;
}

.cabins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 0.45rem;
}

.cabin {
  @include touch-target;
  min-width: 0;
  min-height: 62px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.2rem;
  padding: 0.5rem 0.6rem;
  background: var(--surface);
  border: 2px solid var(--cream-200);
  border-radius: var(--radius-sm);
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;

  &:active {
    transform: scale(0.97);
  }

  &--active {
    border-color: var(--navy-800);
    background: var(--navy-800);
    color: #fff;

    .cabin-guests {
      color: var(--powder-300);
    }
  }

  &--empty {
    opacity: 0.5;
  }
}

.cabin-number {
  font-family: var(--font-serif);
  font-weight: 600;
}

.cabin-guests {
  font-size: 0.85rem;
  color: var(--ink-600);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;

  button {
    min-height: 52px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-strong, var(--line));
    background: var(--surface);
    color: var(--ink-600);
    font-weight: 600;

    &.on {
      background: var(--navy-800);
      border-color: var(--navy-800);
      color: #fff;
    }
  }
}
</style>
