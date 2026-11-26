<script setup lang="ts">
import ClosingCount from '@/components/barstock/ClosingCount.vue'

/**
 * Control de Administración (Bar-stock, 24-nov-2026): única pantalla de
 * conteo de su rol. Aparece solo el día asignado (un día de cambio de crucero
 * al azar cada 2 semanas); cuenta a ciegas licores, vinos y cervezas y lo
 * envía a Gerencia sin ver el resultado.
 */
</script>

<template>
  <ClosingCount mode="admin" />
</template>
