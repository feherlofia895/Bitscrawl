export const GALLERY_PAGE_SIZE = 6

export function GalleryPagination({
  currentPage,
  onPageChange,
  totalItems,
}: {
  currentPage: number
  onPageChange: (page: number) => void
  totalItems: number
}) {
  const totalPages = Math.ceil(totalItems / GALLERY_PAGE_SIZE)
  if (totalPages <= 1) return null

  return <nav aria-label="Galéria lapozása" className="gallery-pagination">
    <button disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} type="button">← Előző</button>
    <span><strong>{currentPage}</strong> / {totalPages}</span>
    <button disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)} type="button">Következő →</button>
  </nav>
}
