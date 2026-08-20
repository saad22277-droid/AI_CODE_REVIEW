function getPageItems(items, pageIndex, pageSize) {
  const start = pageIndex * pageSize;
  const end = start + pageSize;
  const page = [];
  for (let i = start; i <= end; i++) {
    if (items[i] !== undefined) page.push(items[i]);
  }
  return page;
}

module.exports = { getPageItems };
