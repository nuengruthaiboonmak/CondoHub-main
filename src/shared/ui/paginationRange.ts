export function paginationRange(total: number, current: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const start = current <= 3 ? 1 : current >= total - 2 ? total - 2 : current - 1;
  const end = current <= 3 ? 3 : current >= total - 2 ? total : current + 1;
  const visible = [
    ...new Set([1, ...Array.from({ length: end - start + 1 }, (_, index) => start + index), total]),
  ];
  const pages: Array<number | 'ellipsis'> = [];
  for (const page of visible) {
    const previous = pages.at(-1);
    if (typeof previous === 'number' && page - previous > 1) pages.push('ellipsis');
    pages.push(page);
  }
  return pages;
}
