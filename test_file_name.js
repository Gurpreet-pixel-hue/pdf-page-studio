const assert = require('assert');
const { cleanPdfName, baseName } = require('./file-name.js');

// plain names get .pdf
assert.strictEqual(cleanPdfName('Lab Journal'), 'Lab Journal.pdf');
assert.strictEqual(cleanPdfName('  Lab Journal  '), 'Lab Journal.pdf', 'surrounding spaces are trimmed');
// an extension typed in any case is not doubled
assert.strictEqual(cleanPdfName('Lab.pdf'), 'Lab.pdf');
assert.strictEqual(cleanPdfName('Lab.PDF'), 'Lab.pdf');
assert.strictEqual(cleanPdfName('Lab.pdf.pdf'), 'Lab.pdf');
assert.strictEqual(cleanPdfName('v1.2 final'), 'v1.2 final.pdf', 'dots inside a name are kept');
// characters that are not allowed in file names on Windows, macOS or Android become hyphens
assert.strictEqual(cleanPdfName('CN: exp 1/2'), 'CN- exp 1-2.pdf');
assert.strictEqual(cleanPdfName('a\\b*c?d"e<f>g|h'), 'a-b-c-d-e-f-g-h.pdf');
assert.strictEqual(cleanPdfName('tab\there\nnewline'), 'tab here newline.pdf', 'control characters become spaces');
assert.strictEqual(cleanPdfName('a   b'), 'a b.pdf', 'runs of spaces collapse');
assert.strictEqual(cleanPdfName('--a--'), '--a--.pdf', 'hyphens the user typed are theirs');
// names that would be hidden or empty fall back
assert.strictEqual(cleanPdfName('.hidden'), 'hidden.pdf', 'leading dots are dropped so the file is not hidden');
assert.strictEqual(cleanPdfName(''), 'Merged_Document.pdf');
assert.strictEqual(cleanPdfName('   '), 'Merged_Document.pdf');
assert.strictEqual(cleanPdfName('.pdf'), 'Merged_Document.pdf');
assert.strictEqual(cleanPdfName('///'), 'Merged_Document.pdf', 'a name of only illegal characters falls back');
assert.strictEqual(cleanPdfName(undefined), 'Merged_Document.pdf');
assert.strictEqual(cleanPdfName(null, 'Mine'), 'Mine.pdf', 'custom fallback');
// Windows reserved names get a safe suffix
assert.strictEqual(cleanPdfName('CON'), 'CON-file.pdf');
assert.strictEqual(cleanPdfName('nul.pdf'), 'nul-file.pdf');
// trailing dots and spaces (invalid on Windows) go
assert.strictEqual(cleanPdfName('name. '), 'name.pdf');
// very long names are shortened but keep the extension
const long = cleanPdfName('x'.repeat(400));
assert.ok(long.endsWith('.pdf') && long.length <= 124, 'long name is capped: ' + long.length);
// unicode is kept
assert.strictEqual(cleanPdfName('नोट्स 1'), 'नोट्स 1.pdf');
// baseName shows the user the editable part
assert.strictEqual(baseName('Lab Journal.pdf'), 'Lab Journal');
assert.strictEqual(baseName('Lab'), 'Lab');
assert.strictEqual(baseName(''), 'Merged_Document');
console.log('file-name: all assertions passed');
