<script setup lang="ts">
import OwnerPanel from '@/components/owner/OwnerPanel.vue'
import BartenderCommissions from '@/components/owner/BartenderCommissions.vue'
import AgencyBilling from '@/components/owner/AgencyBilling.vue'

/**
 * Resumen del negocio (solo Gerencia; el servidor también lo restringe).
 * El bloque antiguo de ventas quedó unificado en OwnerPanel con el mismo
 * filtro de crucero o periodo (checklist 29-oct, 06 y 08).
 */
</script>

<template>
  <div class="page">
    <header class="dash-head">
      <h1 class="page-title">Resumen del negocio</h1>
      <p class="subtitle">Ventas del bar, cobros, costo y margen con un mismo filtro.</p>
    </header>

    <OwnerPanel />
    <BartenderCommissions />
    <AgencyBilling />
  </div>
</template>

<style scoped lang="scss">
.dash-head {
  margin-bottom: 1.25rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.subtitle {
  margin: 0;
  font-size: 1rem;
  color: #55636d;
}
</style>
