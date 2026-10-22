import { onBeforeUnmount, shallowRef, type CSSProperties, type Ref } from 'vue'

/**
 * Posiciona un panel flotante (menú de select, calendario) con position:fixed
 * anclado a su disparador. Al ir teleportado al body no lo recorta ningún
 * modal con overflow; se reubica con scroll/resize y se voltea hacia arriba
 * cuando no hay espacio abajo.
 */
export function useAnchoredPanel(trigger: Ref<HTMLElement | null>, options?: { minWidth?: number }) {
  const style = shallowRef<CSSProperties>({})
  const openUp = shallowRef(false)

  function reposition() {
    const el = trigger.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const panelMax = 300
    const spaceBelow = window.innerHeight - rect.bottom
    const flip = spaceBelow < panelMax && rect.top > spaceBelow
    openUp.value = flip

    const width = Math.max(rect.width, options?.minWidth ?? 0)
    const left = Math.min(rect.left, window.innerWidth - width - 8)

    style.value = {
      position: 'fixed',
      left: `${Math.max(8, left)}px`,
      width: `${width}px`,
      maxHeight: `${Math.min(panelMax, (flip ? rect.top : spaceBelow) - 12)}px`,
      ...(flip
        ? { bottom: `${window.innerHeight - rect.top + 6}px` }
        : { top: `${rect.bottom + 6}px` }),
    }
  }

  function bind() {
    reposition()
    window.addEventListener('resize', reposition)
    // capture: también reacciona al scroll de contenedores internos (modales).
    window.addEventListener('scroll', reposition, true)
  }

  function unbind() {
    window.removeEventListener('resize', reposition)
    window.removeEventListener('scroll', reposition, true)
  }

  onBeforeUnmount(unbind)

  return { style, openUp, bind, unbind }
}
