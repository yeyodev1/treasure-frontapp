import { onBeforeUnmount, watch, type Ref } from 'vue'

interface Options {
  /** Elemento centinela al final de la lista. */
  sentinel: Ref<HTMLElement | null>
  /** Se llama cuando el centinela entra en pantalla. */
  onReach: () => void
}

/** Scroll infinito: observa el centinela y pide la siguiente página. */
export function useInfiniteScroll({ sentinel, onReach }: Options) {
  let observer: IntersectionObserver | null = null

  watch(
    sentinel,
    (el) => {
      observer?.disconnect()
      if (!el) return
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) onReach()
        },
        { rootMargin: '240px' },
      )
      observer.observe(el)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => observer?.disconnect())
}
