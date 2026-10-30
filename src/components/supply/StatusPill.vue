<script setup lang="ts">
import { computed } from 'vue'
import type { PurchaseStatus, RequisitionStatus } from '@/types'
import { PURCHASE_STATUS, REQUISITION_STATUS } from './units'

const props = defineProps<{ status: PurchaseStatus | RequisitionStatus }>()

const label = computed(
  () =>
    (PURCHASE_STATUS as Record<string, string>)[props.status] ??
    (REQUISITION_STATUS as Record<string, string>)[props.status] ??
    props.status,
)

const tone = computed(() => {
  switch (props.status) {
    case 'recibida':
    case 'recibido':
    case 'atendido':
      return 'ok'
    case 'recibida_parcial':
    case 'recibido_parcial':
    case 'cerrada':
      return 'partial'
    case 'aprobado':
      return 'approved'
    case 'anulada':
    case 'rechazado':
      return 'bad'
    default:
      return 'pending'
  }
})

const icon = computed(
  () =>
    ({
      ok: 'fa-circle-check',
      partial: 'fa-circle-half-stroke',
      approved: 'fa-thumbs-up',
      bad: 'fa-ban',
      pending: 'fa-clock',
    })[tone.value],
)
</script>

<template>
  <span class="pill" :class="`pill--${tone}`">
    <i class="fa-solid" :class="icon" aria-hidden="true" /> {{ label }}
  </span>
</template>

<style scoped lang="scss">
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.86rem;
  font-weight: 700;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  white-space: nowrap;
  transition:
    background 0.2s ease,
    color 0.2s ease;

  &--pending {
    background: var(--cream-100);
    color: var(--ink-600);
    border: 1px solid var(--rule);
  }

  &--approved {
    background: var(--powder-300);
    color: var(--navy-800);
  }

  &--partial {
    background: rgba(185, 128, 47, 0.15);
    color: #8a5d1d;
  }

  &--ok {
    background: rgba(63, 122, 87, 0.14);
    color: var(--success);
  }

  &--bad {
    background: rgba(180, 72, 59, 0.12);
    color: var(--danger);
  }
}
</style>
