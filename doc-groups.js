/**
 * PDF Page Studio - Document grouping helpers
 * Pure functions that derive the "Documents" view from the flat page list.
 * state.pages stays the single source of truth; a document is a run of
 * consecutive pages that share the same source file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DocGroups = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function describeRange(pages, sourceType, total) {
    const count = pages.length;
    if (sourceType !== 'pdf') return count === 1 ? '1 page' : `${count} pages`;
    if (count === total) return count === 1 ? '1 page' : `${count} pages`;

    const indexes = pages.map(p => p.sourcePageIndex);
    const contiguous = indexes.every((n, i) => i === 0 || n === indexes[i - 1] + 1);
    if (!contiguous) return `${count} of ${total} pages`;

    const first = indexes[0] + 1;
    const last = indexes[count - 1] + 1;
    return first === last ? `p. ${first} of ${total}` : `pp. ${first}–${last} of ${total}`;
  }

  /**
   * Split pages into runs of consecutive pages from the same source file.
   * Files are compared by object identity, so two uploads with the same
   * name stay separate documents.
   */
  function groupPagesIntoDocuments(pages) {
    const groups = [];
    let start = 0;
    while (start < pages.length) {
      const file = pages[start].sourceFile;
      let end = start + 1;
      while (end < pages.length && pages[end].sourceFile === file) end++;

      const run = pages.slice(start, end);
      const first = run[0];
      groups.push({
        fileName: first.fileName,
        sourceType: first.sourceType,
        start,
        end,
        count: run.length,
        firstPage: first,
        partial: first.sourceType === 'pdf' && run.length !== first.sourceTotalPages,
        rangeLabel: describeRange(run, first.sourceType, first.sourceTotalPages)
      });
      start = end;
    }
    return groups;
  }

  /**
   * Return a new page list with the document at fromGroupIndex moved to the
   * position of toGroupIndex (same semantics as reordering single pages).
   */
  function moveDocument(pages, fromGroupIndex, toGroupIndex) {
    const groups = groupPagesIntoDocuments(pages);
    const inRange = (i) => Number.isInteger(i) && i >= 0 && i < groups.length;
    if (fromGroupIndex === toGroupIndex || !inRange(fromGroupIndex) || !inRange(toGroupIndex)) {
      return pages.slice();
    }

    const runs = groups.map(g => pages.slice(g.start, g.end));
    const moved = runs.splice(fromGroupIndex, 1)[0];
    runs.splice(toGroupIndex, 0, moved);
    return [].concat(...runs);
  }

  /** Return a new page list without the document at groupIndex. */
  function removeDocument(pages, groupIndex) {
    const groups = groupPagesIntoDocuments(pages);
    if (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
      return pages.slice();
    }
    const { start, end } = groups[groupIndex];
    return pages.slice(0, start).concat(pages.slice(end));
  }

  return { groupPagesIntoDocuments, moveDocument, removeDocument };
}));
