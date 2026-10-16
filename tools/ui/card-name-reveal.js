// Long PDF names expand on hover (desktop) and highlight + show full name while long-pressed on phone until released.
async function makePdfFile(name, pageCount = 2) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`Page ${i + 1}`, { x: 40, y: 200, size: 24 });
  }
  const bytes = await doc.save();
  return new File([bytes], name, { type: 'application/pdf' });
}

async function scenario() {
  const longName = '2026_Annual_Financial_Audit_Report_Final_Signed_Approved_Version_12_Confidential_Submission.pdf';
  const shortName = 'notes.pdf';
  await handleFiles([await makePdfFile(longName, 2), await makePdfFile(shortName, 1)]);
  await sleep(300);

  for (const mode of ['documents', 'pages']) {
    setViewMode(mode);
    await sleep(600);

    const cards = [...document.querySelectorAll('#page-grid .page-card')];
    const card = cards[0];
    const siblingCard = cards[cards.length - 1];
    const nameEl = card.querySelector('.card-filename');

    // 1. Default state: long name is single-line cropped with ellipsis
    const defaultStyle = getComputedStyle(nameEl);
    const collapsedHeight = nameEl.getBoundingClientRect().height;
    check(`[${mode}] long name is cropped by default`, defaultStyle.whiteSpace === 'nowrap' && defaultStyle.textOverflow === 'ellipsis' && nameEl.scrollWidth > nameEl.clientWidth);

    // 2. Desktop hover: full name is displayed across wrapped lines without stretching sibling cards
    const siblingHeightBefore = siblingCard.getBoundingClientRect().height;
    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(50);
    const hoverStyle = getComputedStyle(nameEl);
    const expandedHeight = nameEl.getBoundingClientRect().height;
    const siblingHeightDuring = siblingCard.getBoundingClientRect().height;
    check(`[${mode}] hovering over card displays full wrapped name`, hoverStyle.whiteSpace === 'normal' && hoverStyle.overflow === 'visible' && expandedHeight > collapsedHeight * 1.5, `${collapsedHeight}px -> ${expandedHeight}px`);
    check(`[${mode}] sibling card height is not stretched on hover`, Math.abs(siblingHeightDuring - siblingHeightBefore) <= 1, `${siblingHeightBefore} -> ${siblingHeightDuring}`);

    card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await sleep(50);
    check(`[${mode}] leaving hover restores compact single-line name`, getComputedStyle(nameEl).whiteSpace === 'nowrap');

    // 3. Phone quick tap: does not trigger long-press highlight
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 50, clientY: 50 }));
    await sleep(120);
    card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: 50, clientY: 50 }));
    await sleep(300);
    check(`[${mode}] quick tap does not trigger long-press highlight`, !card.classList.contains('is-long-press'));

    // 4. Phone scroll gesture: moving finger > 10px before timer cancels long-press
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 50, clientY: 50 }));
    await sleep(100);
    card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 50, clientY: 90 }));
    await sleep(320);
    check(`[${mode}] scrolling cancels long-press`, !card.classList.contains('is-long-press'));
    card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: 50, clientY: 90 }));

    // 5. Phone long-tap: highlights card and shows full name while held down, until released
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 60, clientY: 60 }));
    await sleep(620);
    const pressStyle = getComputedStyle(nameEl);
    const pressCardStyle = getComputedStyle(card);
    const pressHeight = nameEl.getBoundingClientRect().height;
    check(`[${mode}] long-tap highlights the card`, card.classList.contains('is-long-press') && pressCardStyle.borderColor === 'rgb(194, 65, 12)', pressCardStyle.borderColor);
    check(`[${mode}] long-tap shows full name while holding`, pressStyle.whiteSpace === 'normal' && pressHeight > collapsedHeight * 1.5);

    // Hold a bit longer to ensure it stays visible till release
    await sleep(250);
    check(`[${mode}] stays highlighted and showing full name while still holding`, card.classList.contains('is-long-press') && nameEl.getBoundingClientRect().height > collapsedHeight * 1.5);

    // Let go: highlight and full name dismiss immediately, and ghost click is suppressed
    card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: 60, clientY: 60 }));
    card.querySelector('.card-thumbnail-viewport').click();
    await sleep(50);
    check(`[${mode}] letting go removes highlight and collapses name`, !card.classList.contains('is-long-press') && getComputedStyle(nameEl).whiteSpace === 'nowrap');
    check(`[${mode}] letting go does not trigger accidental click navigation/lightbox`, state.viewMode === mode && !document.getElementById('lightbox-modal').classList.contains('active'));
  }
}
