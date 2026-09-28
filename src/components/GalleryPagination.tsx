export const GALLERY_PAGE_SIZE = 6

function pageScrollBehavior(): ScrollBehavior {
  const systemPrefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  try {
    return systemPrefersReducedMotion || window.localStorage.getItem('bitscrawl-reduce-motion') === 'true'
      ? 'auto'
      : 'smooth'
  } catch {
    return systemPrefersReducedMotion ? 'auto' : 'smooth'
  }
}

export function GalleryPagination({
  currentPage,
  onPageChange,
  totalItems,
}: {
  currentPage: number
  onPageChange: (page: number) => void | Promise<void>
  totalItems: number
}) {
  const totalPages = Math.ceil(totalItems / GALLERY_PAGE_SIZE)
  if (totalPages <= 1) return null

  const changePage = async (nextPage: number, gallery: HTMLElement | null) => {
    await onPageChange(nextPage)
    gallery?.scrollIntoView({ behavior: pageScrollBehavior(), block: 'start' })
  }

  return <nav aria-label="Galéria lapozása" className="gallery-pagination">
    <button disabled={currentPage === 1} onClick={event => void changePage(currentPage - 1, event.currentTarget.closest('.weekly-gallery'))} type="button">← Előző</button>
    <span><strong>{currentPage}</strong> / {totalPages}</span>
    <button disabled={currentPage === totalPages} onClick={event => void changePage(currentPage + 1, event.currentTarget.closest('.weekly-gallery'))} type="button">Következő →</button>
  </nav>
}
