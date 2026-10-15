/**
 * PDF Page Studio - Output file names
 * Turns whatever the user typed into a safe PDF file name.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FileName = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const FALLBACK = 'Merged_Document';
  const MAX_BASE = 120;
  const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i; // not allowed as a file name on Windows

  /** The editable part of a name: no .pdf, never empty. */
  function baseName(input, fallback) {
    let name = String(input == null ? '' : input);
    name = name.replace(/[\u0000-\u001f\u007f]+/g, ' ');       // control characters
    name = name.replace(/[\\/:*?"<>|]/g, '-');                  // illegal on Windows, macOS or Android
    name = name.replace(/\s+/g, ' ').trim();
    while (/\.pdf$/i.test(name)) name = name.slice(0, -4).trimEnd();
    name = name.replace(/^\.+/, '').replace(/[. ]+$/, '');      // not hidden, no trailing dot or space
    if (name.length > MAX_BASE) name = name.slice(0, MAX_BASE).trimEnd();
    if (!name || /^-+$/.test(name) && !/[a-z0-9]/i.test(String(input))) return fallback || FALLBACK;
    if (RESERVED.test(name)) name += '-file';
    return name;
  }

  /** A complete, safe file name ending in .pdf. */
  function cleanPdfName(input, fallback) {
    return `${baseName(input, fallback)}.pdf`;
  }

  return { cleanPdfName, baseName };
}));
