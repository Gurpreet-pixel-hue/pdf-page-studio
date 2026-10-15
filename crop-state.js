/**
 * PDF Page Studio - Crop state helpers
 * Pure rules for which pages Auto Crop applies to and how its results are
 * recorded on a page item.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CropState = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const CONFIDENCE_THRESHOLD = 0.6;

  /** Only photographed pages can be cropped; PDF pages never can. */
  function isCroppable(page) {
    return page.sourceType === 'image';
  }

  /** Number of image pages. The Auto Crop button is hidden when this is 0. */
  function countCroppable(pages) {
    return pages.filter(isCroppable).length;
  }

  /** Indexes Auto Crop should process: image pages the user has not cropped by hand. */
  function autoCropTargets(pages) {
    const targets = [];
    pages.forEach((page, index) => {
      if (isCroppable(page) && page.cropState !== 'manual') targets.push(index);
    });
    return targets;
  }

  /**
   * Record a detector result on a page. A confident result becomes the
   * crop. A weak one leaves the page uncropped and flags it for review.
   */
  function applyDetection(page, detection) {
    page.cropConfidence = detection.confidence;
    if (detection.quad && detection.confidence >= CONFIDENCE_THRESHOLD) {
      page.cropQuad = detection.quad;
      page.cropState = 'auto';
    } else {
      page.cropQuad = null;
      page.cropState = 'needs-review';
    }
    return page.cropState;
  }

  /** Record a quad confirmed in the crop editor. */
  function applyManualCrop(page, quad) {
    page.cropQuad = quad;
    page.cropState = 'manual';
    page.cropConfidence = 1;
  }

  /** Clear any crop on a page. */
  function resetCrop(page) {
    page.cropQuad = null;
    page.cropState = 'none';
    page.cropConfidence = 0;
  }

  /** Summarise states after a run: { cropped, review }. */
  function summarize(pages, indexes) {
    let cropped = 0, review = 0;
    indexes.forEach((i) => {
      if (pages[i].cropState === 'auto') cropped++;
      else if (pages[i].cropState === 'needs-review') review++;
    });
    return { cropped, review };
  }

  return { CONFIDENCE_THRESHOLD, isCroppable, countCroppable, autoCropTargets, applyDetection, applyManualCrop, resetCrop, summarize };
}));
