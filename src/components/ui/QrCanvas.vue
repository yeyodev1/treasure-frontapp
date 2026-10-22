<script setup lang="ts">
import { useTemplateRef, watchEffect } from 'vue'
import QRCode from 'qrcode'

const props = defineProps<{ text: string; size?: number }>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

watchEffect(() => {
  if (!canvas.value || !props.text) return
  QRCode.toCanvas(canvas.value, props.text, {
    width: props.size ?? 220,
    margin: 1,
    color: { dark: '#0b2239', light: '#ffffff' },
  })
})
</script>

<template>
  <canvas ref="canvas" class="qr" />
</template>

<style scoped>
.qr {
  border-radius: 10px;
  background: #fff;
}
</style>
