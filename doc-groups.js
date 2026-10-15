/**
 * PDF Page Studio - Document grouping helpers
 * Pure functions that derive the "Documents" view from the flat page list.
 * state.pages stays the single source of truth; a document is a run of
 * consecutive pages that share the same source file. A page flagged
 * `splitBefore` starts a new document even when the page before it comes from
 * the same file, which is how a PDF is cut into parts that move independently.
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
      while (end < pages.length && pages[end].sourceFile === file && !pages[end].splitBefore) end++;

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
    groups.forEach((group, i) => {
      const next = groups[i + 1];
      const last = pages[group.end - 1];
      group.canJoinNext = !!next
        && next.firstPage.splitBefore === true
        && next.firstPage.sourceFile === group.firstPage.sourceFile
        && group.sourceType === 'pdf'
        && next.firstPage.sourcePageIndex === last.sourcePageIndex + 1;
    });
    return groups;
  }

  const withoutCut = (page) => {
    const copy = Object.assign({}, page);
    delete copy.splitBefore;
    return copy;
  };
  const inRange = (i, length) => Number.isInteger(i) && i >= 0 && i < length;

  /**
   * Cut the document at groupIndex after its first `firstPartCount` pages.
   * Returns a new list. Both parts get a flagged first page: the flag marks
   * where a document starts, and part A needs one too, otherwise moving part B
   * in front of it would leave the two touching and merge them again. Only
   * those two pages are copied; every other page keeps its identity.
   */
  function splitDocument(pages, groupIndex, firstPartCount) {
    const groups = groupPagesIntoDocuments(pages);
    if (!inRange(groupIndex, groups.length)) return pages.slice();
    const group = groups[groupIndex];
    if (!Number.isInteger(firstPartCount) || firstPartCount < 1 || firstPartCount >= group.count) return pages.slice();
    const out = pages.slice();
    [group.start, group.start + firstPartCount].forEach((at) => {
      out[at] = Object.assign({}, pages[at], { splitBefore: true });
    });
    return out;
  }

  /** Remove the cut between the document at groupIndex and the part that continues it (the first part keeps its start marker). */
  function joinDocuments(pages, groupIndex) {
    const groups = groupPagesIntoDocuments(pages);
    if (!inRange(groupIndex, groups.length) || !groups[groupIndex].canJoinNext) return pages.slice();
    const out = pages.slice();
    const at = groups[groupIndex].end;
    out[at] = withoutCut(pages[at]);
    return out;
  }

  /**
   * Take the page at `index` out of the list. A page that starts a part hands
   * its cut to the page after it (when that comes from the same file), so
   * removing or moving it never merges two parts by accident.
   */
  function detach(pages, index) {
    const rest = pages.slice();
    let page = rest.splice(index, 1)[0];
    if (page.splitBefore) {
      const next = rest[index];
      if (next && next.sourceFile === page.sourceFile) rest[index] = Object.assign({}, next, { splitBefore: true });
      page = withoutCut(page);
    }
    return { rest, page };
  }

  /** Move one page, keeping cuts where the parts really begin. Same semantics as splicing out and back in. */
  function movePage(pages, fromIndex, toIndex) {
    if (fromIndex === toIndex || !inRange(fromIndex, pages.length) || !Number.isInteger(toIndex) || toIndex < 0) return pages.slice();
    const { rest, page } = detach(pages, fromIndex);
    rest.splice(toIndex, 0, page);
    return rest;
  }

  /** Remove one page, keeping cuts where the parts really begin. */
  function removePage(pages, index) {
    if (!inRange(index, pages.length)) return pages.slice();
    return detach(pages, index).rest;
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

  return { groupPagesIntoDocuments, moveDocument, removeDocument, splitDocument, joinDocuments, movePage, removePage };
}));
