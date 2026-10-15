/**
 * PDF Page Studio - Page finder logic
 * Pure rules for turning per-page "a section starts here" scores into sections,
 * page numbers and typed lines. No DOM, so it is unit-tested in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PageFinder = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULT_CUTOFF = 1.5;
  const DEFAULT_FLOOR = -0.5;   // measured: a page scoring below this was never a heading, except one duplicate page
  const MORE_CANDIDATES = 10;
  const DEFAULT_ASSIGNMENTS = 2;
  const MAX_EXTRA_PAGES = 20;

  /** Highest score first; equal scores keep the lower page first. */
  function rankPages(scores) {
    return scores.slice().sort((a, b) => b.score - a.score || a.page - b.page);
  }

  /**
   * Choose the section start pages.
   * With an entry count N: the N best pages, but never a page at or below `floor`: an entry is left
   * without a page rather than filled with a page that does not look like a heading at all.
   * Without: every page above the cut-off. `confident` says a chosen page is above the cut-off.
   * `more` lists the best of the rest.
   */
  function pickSections(scores, options) {
    const opts = options || {};
    const cutoff = opts.cutoff === undefined ? DEFAULT_CUTOFF : opts.cutoff;
    const floor = opts.floor === undefined ? DEFAULT_FLOOR : opts.floor;
    const ranked = rankPages(scores);
    const n = Number.isInteger(opts.entryCount) && opts.entryCount > 0 ? Math.min(opts.entryCount, ranked.length) : null;
    const chosen = n !== null ? ranked.slice(0, n).filter((p) => p.score > floor) : ranked.filter((p) => p.score > cutoff);
    const sections = chosen
      .map((p) => ({ page: p.page, score: p.score, confident: p.score > cutoff }))
      .sort((a, b) => a.page - b.page);
    const taken = new Set(sections.map((s) => s.page));
    const more = ranked.filter((p) => !taken.has(p.page)).slice(0, MORE_CANDIDATES).map((p) => ({ page: p.page, score: p.score }));
    return { sections, more };
  }

  /** Pairs of heading pages that follow each other, such as [16, 17]. */
  function adjacentPairs(pages) {
    const sorted = pages.slice().sort((a, b) => a - b);
    const pairs = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) pairs.push([sorted[i - 1], sorted[i]]);
    }
    return pairs;
  }

  /** Pages before the first heading: certificate, index, anything else. */
  function frontPageCount(sections) {
    return sections.length ? Math.max(0, sections[0].page - 1) : 0;
  }

  /** The pre-answer to "how should pages be counted?". One page in front is ambiguous, so the user decides. */
  function defaultCounting(front) {
    if (front >= 2) return { mode: 'as-is', extra: 0 };
    if (front === 0) return { mode: 'add', extra: 2 };
    return { mode: 'ask', extra: 1 };
  }

  const clampExtra = (n) => Math.min(MAX_EXTRA_PAGES, Math.max(0, Math.round(Number(n) || 0)));

  /** The number to print for a PDF page under the chosen counting. */
  function numberedPage(page, counting) {
    if (page === null || page === undefined) return null;
    return page + (counting.mode === 'add' ? clampExtra(counting.extra) : 0);
  }

  /** A sentence that says how the numbers were counted, so a copied list is never ambiguous. */
  function describeCounting(counting) {
    const extra = counting.mode === 'add' ? clampExtra(counting.extra) : 0;
    if (extra > 0) return `Page numbers include ${extra} extra page${extra === 1 ? '' : 's'} in front of this PDF.`;
    return 'Page numbers are the PDF page numbers.';
  }

  /** "Experiment 1..n-a" then "Assignment 1..a". */
  function makeLabels(count, assignments) {
    const a = Math.min(Math.max(Number.isInteger(assignments) ? assignments : DEFAULT_ASSIGNMENTS, 0), count);
    const labels = [];
    for (let i = 1; i <= count - a; i++) labels.push(`Experiment ${i}`);
    for (let j = 1; j <= a; j++) labels.push(`Assignment ${j}`);
    return labels;
  }

  /**
   * Give each entry a page. Entries marked missing (or set to "not in this PDF") take no section,
   * so the entries after them move up to the next section. Every other entry takes the next section
   * in order. A manual page choice changes only that entry and never shifts the others. Entries
   * with no section left are 'unknown', never filled with a guess.
   */
  function assignEntries(entryCount, sectionPages, missing, overrides) {
    let next = 0;
    const rows = [];
    for (let i = 0; i < entryCount; i++) {
      const hasOverride = overrides.has(i);
      const override = hasOverride ? overrides.get(i) : undefined;
      if (missing.has(i) || override === null) {
        rows.push({ index: i, page: null, status: 'missing', manual: override === null });
        continue;
      }
      const auto = next < sectionPages.length ? sectionPages[next++] : null;
      if (hasOverride) rows.push({ index: i, page: override, status: 'ok', manual: true });
      else if (auto !== null) rows.push({ index: i, page: auto, status: 'ok', manual: false });
      else rows.push({ index: i, page: null, status: 'unknown', manual: false });
    }
    return rows;
  }

  /** Pages that more than one entry points at (a manual choice can collide with an automatic one). */
  function duplicatePages(rows) {
    const seen = new Map();
    rows.forEach((r) => { if (r.page !== null) seen.set(r.page, (seen.get(r.page) || 0) + 1); });
    return [...seen.entries()].filter(([, n]) => n > 1).map(([page]) => page).sort((a, b) => a - b);
  }

  /** The typed result, one line per entry, then the counting sentence. */
  function formatResult(rows, labels, counting) {
    if (rows.length === 0) return 'No sections found.';
    const lines = rows.map((r) => {
      const label = labels[r.index];
      if (r.page === null) return `${label} – ${r.status === 'missing' ? 'not in this PDF' : 'page not found'}`;
      return `${label} – page ${numberedPage(r.page, counting)}`;
    });
    return `${lines.join('\n')}\n\n${describeCounting(counting)}`;
  }

  return {
    DEFAULT_CUTOFF, DEFAULT_FLOOR, MORE_CANDIDATES, DEFAULT_ASSIGNMENTS, MAX_EXTRA_PAGES,
    rankPages, pickSections, adjacentPairs, frontPageCount, defaultCounting,
    numberedPage, describeCounting, makeLabels, assignEntries, duplicatePages, formatResult
  };
}));
