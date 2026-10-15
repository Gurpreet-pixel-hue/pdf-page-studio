// Export asks for a file name first: prefilled, live preview of the final name, Esc/Cancel do nothing, Enter exports.
const modal = () => document.getElementById('export-name-modal');
const input = () => document.getElementById('export-name-input');
const preview = () => document.getElementById('export-name-preview').textContent;
const confirmBtn = () => document.getElementById('export-name-confirm-btn');
const isOpen = () => modal().classList.contains('active');
const type = (v) => { input().value = v; input().dispatchEvent(new Event('input', { bubbles: true })); };

async function scenario() {
  const downloads = [];
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push(this.download); else realClick.call(this); };

  // 1. Nothing to export: no dialog.
  document.getElementById('export-pdf-btn').disabled = false;
  document.getElementById('export-pdf-btn').click();
  await sleep(150);
  check('no dialog when there are no pages', !isOpen());

  await handleFiles([await makeImageFile(300, 400, (ctx, w, h) => { ctx.fillStyle = '#9ac'; ctx.fillRect(0, 0, w, h); }, 'a.jpg')]);

  // 2. The Export button asks for a name, prefilled with the last one, without exporting yet.
  document.getElementById('export-pdf-btn').click();
  await waitFor(isOpen);
  check('dialog opens on Export', isOpen());
  check('name is prefilled without .pdf', input().value === 'Merged_Document', input().value);
  check('preview shows the full file name', preview() === 'Merged_Document.pdf', preview());
  check('the name is selected so typing replaces it', input().selectionStart === 0 && input().selectionEnd === input().value.length && document.activeElement === input());
  check('nothing is exported until confirmed', downloads.length === 0 && !document.getElementById('processing-modal').classList.contains('active'));

  // 3. Live preview while typing, with unsafe characters cleaned.
  type('DWM: Lab 1/2');
  check('preview cleans unsafe characters', preview() === 'DWM- Lab 1-2.pdf', preview());
  type('Notes.PDF');
  check('a typed .pdf is not doubled', preview() === 'Notes.pdf', preview());
  type('');
  check('empty name disables Export', confirmBtn().disabled);
  type('   ');
  check('blank name disables Export', confirmBtn().disabled);

  // 4. Escape cancels and changes nothing.
  type('Should not stick');
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes the dialog', !isOpen());
  await sleep(200);
  check('cancel exports nothing and keeps the old name', downloads.length === 0 && state.settings.filename === 'Merged_Document.pdf', state.settings.filename);

  // 5. Enter confirms: the file is downloaded under the chosen name.
  document.getElementById('export-pdf-btn').click();
  await waitFor(isOpen);
  type('My Journal');
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => downloads.length === 1, 30000);
  check('downloaded under the typed name', downloads[0] === 'My Journal.pdf', downloads[0]);
  check('dialog is closed after exporting', !isOpen());
  check('the name is remembered in settings', state.settings.filename === 'My Journal.pdf' && document.getElementById('setting-filename').value === 'My Journal.pdf', state.settings.filename);

  // 6. Next time the dialog starts from the last name; the Export button in the dialog also works.
  document.getElementById('export-pdf-btn').click();
  await waitFor(isOpen);
  check('dialog is prefilled with the last name', input().value === 'My Journal', input().value);
  type('Second copy');
  confirmBtn().click();
  await waitFor(() => downloads.length === 2, 30000);
  check('Export button in the dialog downloads', downloads[1] === 'Second copy.pdf', downloads[1]);

  // 7. Cancel button.
  document.getElementById('export-pdf-btn').click();
  await waitFor(isOpen);
  document.getElementById('export-name-cancel-btn').click();
  await sleep(200);
  check('Cancel button closes without exporting', !isOpen() && downloads.length === 2);

  // 8. The phone's Export button asks too.
  const mobile = document.getElementById('mobile-export-btn');
  if (mobile) {
    mobile.click();
    await waitFor(isOpen);
    check('mobile Export button opens the dialog', isOpen());
    document.getElementById('export-name-cancel-btn').click();
    await sleep(150);
  }

  // 9. Calling the exporter directly with a name still works (used by other flows).
  await exportMergedPdf({ fileName: 'Direct.pdf' });
  check('direct export uses the given name', downloads[downloads.length - 1] === 'Direct.pdf', downloads[downloads.length - 1]);
  HTMLAnchorElement.prototype.click = realClick;
}
