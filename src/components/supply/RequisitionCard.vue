<script setup lang="ts">
import { computed } from 'vue'
import { formatDateTime } from '@/utils/format'
import type { Requisition } from '@/types'
import StatusPill from './StatusPill.vue'
import { personName, requisitionUnit, stockText } from './units'

/** Tarjeta de requerimiento con su historia: quién, cuándo y qué. */
const props = defineProps<{ requisition: Requisition; compact?: boolean }>()

const r = computed(() => props.requisition)
const isRevision = computed(() => r.value.kind === 'revision')

function lineText(index: number): string {
  const line = r.value.lines[index]
  if (!line) return ''
  if (isRevision.value) return line.name
  const info = requisitionUnit(line)
  const pending = Math.max(0, line.qty - line.receivedQty)
  const base = `${line.name}: ${stockText(line.qty, info)}`
  if (!line.receivedQty) return base
  return pending > 0 ? `${base} · recibido ${stockText(line.receivedQty, info)}` : `${base} · recibido completo`
}

function receiptText(receipt: Requisition['receipts'][number]): string {
  return receipt.lines
    .map((l) => {
      const line = r.value.lines[l.index]
      return line ? `${line.name} +${stockText(l.qty, requisitionUnit(line))}` : ''
    })
    .filter(Boolean)
    .join(' · ')
}

const reviewVerb = computed(() => {
  if (isRevision.value) return 'Atendió'
  return r.value.status === 'rechazado' ? 'Rechazó' : 'Aprobó'
})
</script>

<template>
  <article class="card rq" :class="`rq--${r.status}`">
    <header class="rq-head">
      <span class="rq-code">
        <i class="fa-solid" :class="isRevision ? 'fa-magnifying-glass-chart' : 'fa-dolly'" aria-hidden="true" />
        <strong>{{ r.code }}</strong>
        <small>{{ isRevision ? 'Revisión de inventario' : 'Abastecimiento' }}</small>
      </span>
      <StatusPill :status="r.status" />
    </header>

    <ul class="rq-lines">
      <li v-for="(_, i) in r.lines" :key="i">{{ lineText(i) }}</li>
    </ul>
    <p v-if="r.note" class="rq-note"><i class="fa-solid fa-comment" aria-hidden="true" /> {{ r.note }}</p>

    <ol v-if="!compact" class="rq-history">
      <li>
        <i class="fa-solid fa-paper-plane" aria-hidden="true" />
        <span><strong>Solicitó {{ personName(r.requestedBy) }}</strong> · {{ formatDateTime(r.createdAt) }}</span>
      </li>
      <li v-if="r.reviewedAt">
        <i
          class="fa-solid"
          :class="r.status === 'rechazado' ? 'fa-ban' : 'fa-thumbs-up'"
          aria-hidden="true"
        />
        <span>
          <strong>{{ reviewVerb }} {{ personName(r.reviewedBy) }}</strong> · {{ formatDateTime(r.reviewedAt) }}
          <template v-if="r.reviewNote"> · «{{ r.reviewNote }}»</template>
        </span>
      </li>
      <li v-for="receipt in r.receipts" :key="receipt.key">
        <i class="fa-solid fa-truck-ramp-box" aria-hidden="true" />
        <span>
          <strong>Recibió {{ personName(receipt.by) }}</strong> · {{ formatDateTime(receipt.at) }} · {{ receiptText(receipt) }}
          <template v-if="receipt.note"> · «{{ receipt.note }}»</template>
        </span>
      </li>
    </ol>
    <p v-else class="rq-meta">
      {{ personName(r.requestedBy) }} · {{ formatDateTime(r.createdAt) }}
    </p>

    <div v-if="$slots.default" class="rq-actions">
      <slot />
    </div>
  </article>
</template>

<style scoped lang="scss">
.rq {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.95rem 1rem;
}

.rq-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.rq-code {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;

  i {
    color: var(--gold-500);
  }

  strong {
    font-size: 1.05rem;
  }

  small {
    color: var(--ink-400);
    font-weight: 600;
  }
}

.rq-lines {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.95rem;
}

.rq-note {
  margin: 0;
  font-size: 0.9rem;
  color: var(--ink-600);

  i {
    color: var(--ink-400);
    margin-right: 0.3rem;
  }
}

.rq-history {
  list-style: none;
  margin: 0;
  padding: 0.6rem 0 0;
  border-top: 1px solid var(--cream-200);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.86rem;
  color: var(--ink-600);

  li {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
  }

  i {
    width: 16px;
    margin-top: 0.15rem;
    color: var(--ink-400);
    flex-shrink: 0;
  }
}

.rq-meta {
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink-400);
}

.rq-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.25rem;

  :slotted(.btn) {
    min-height: 52px;
  }
}
</style>
