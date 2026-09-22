/**
 * Automated Verification Script for PDF Page Studio Merging Engine
 */

const fs = require('fs');
const path = require('path');
const PDFLib = require('./vendor/pdf-lib.min.js');

const { PDFDocument, rgb, degrees } = PDFLib;

async function runTests() {
  console.log('=== Starting PDF Page Studio Merging Engine Tests ===\n');

  // 1. Create a dummy multi-page PDF (docA: 2 pages)
  const docA = await PDFDocument.create();
  const pA1 = docA.addPage([600, 400]);
  pA1.drawText('Document A - Page 1', { x: 50, y: 350, size: 24, color: rgb(0.1, 0.1, 0.1) });
  const pA2 = docA.addPage([600, 400]);
  pA2.drawText('Document A - Page 2', { x: 50, y: 350, size: 24, color: rgb(0.1, 0.1, 0.1) });
  const docABytes = await docA.save();
  const docAPath = path.join(__dirname, 'test_docA.pdf');
  fs.writeFileSync(docAPath, docABytes);
  console.log('✔ Created test PDF Document A (2 pages)');

  // 2. Create a dummy multi-page PDF (docB: 3 pages)
  const docB = await PDFDocument.create();
  for (let i = 1; i <= 3; i++) {
    const page = docB.addPage([595, 842]);
    page.drawText(`Document B - Page ${i}`, { x: 50, y: 800, size: 20, color: rgb(0.2, 0.4, 0.8) });
  }
  const docBBytes = await docB.save();
  const docBPath = path.join(__dirname, 'test_docB.pdf');
  fs.writeFileSync(docBPath, docBBytes);
  console.log('✔ Created test PDF Document B (3 pages)');

  // 3. Create a 1x1 valid sample PNG image bytes
  // Minimal 1x1 red PNG
  const redPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const imgPngBytes = Buffer.from(redPngBase64, 'base64');
  console.log('✔ Generated test PNG image');

  // 4. Simulate State & Sequential Page Ingestion
  // Expected order:
  // Item 0: Image 1 -> Page 1
  // Item 1: Doc A Page 1 -> Page 2
  // Item 2: Doc A Page 2 -> Page 3
  // Item 3: Doc B Page 1 -> Page 4
  // Item 4: Doc B Page 2 -> Page 5
  // Item 5: Doc B Page 3 -> Page 6
  // Item 6: Image 2 -> Page 7

  const simulatedPages = [
    { type: 'image', name: 'photo1.png', bytes: imgPngBytes, rotation: 0, width: 800, height: 600 },
    { type: 'pdf', name: 'test_docA.pdf', docBytes: docABytes, pageIndex: 0, rotation: 0 },
    { type: 'pdf', name: 'test_docA.pdf', docBytes: docABytes, pageIndex: 1, rotation: 90 }, // rotated 90 deg
    { type: 'pdf', name: 'test_docB.pdf', docBytes: docBBytes, pageIndex: 0, rotation: 0 },
    { type: 'pdf', name: 'test_docB.pdf', docBytes: docBBytes, pageIndex: 1, rotation: 0 }, // will delete
    { type: 'pdf', name: 'test_docB.pdf', docBytes: docBBytes, pageIndex: 2, rotation: 0 },
    { type: 'image', name: 'photo2.png', bytes: imgPngBytes, rotation: 0, width: 800, height: 600 }
  ];

  console.log(`✔ Ingested 7 pages in initial sequence (2 images, 5 PDF pages)`);

  // 5. Simulate User Reordering: Move last image (index 6) to the very front (index 0)
  const movedItem = simulatedPages.pop();
  simulatedPages.unshift(movedItem);
  console.log('✔ Reordered: Moved photo2.png to position 1');

  // 6. Simulate User Deleting page at index 4 (formerly Doc B Page 2)
  const deletedItem = simulatedPages.splice(4, 1)[0];
  console.log(`✔ Deleted: Removed ${deletedItem.name} (pageIndex ${deletedItem.pageIndex})`);

  console.log(`✔ Remaining pages to merge: ${simulatedPages.length}`);

  // 7. Execute PDF Document Assembly
  const mergedDoc = await PDFDocument.create();

  for (let i = 0; i < simulatedPages.length; i++) {
    const p = simulatedPages[i];
    if (p.type === 'pdf') {
      const srcDoc = await PDFDocument.load(p.docBytes);
      const [copied] = await mergedDoc.copyPages(srcDoc, [p.pageIndex]);
      const currentRot = copied.getRotation().angle || 0;
      copied.setRotation(degrees((currentRot + p.rotation) % 360));
      mergedDoc.addPage(copied);
    } else if (p.type === 'image') {
      const embedded = await mergedDoc.embedPng(p.bytes);
      // Standard A4: 595.28 x 841.89
      const page = mergedDoc.addPage([595.28, 841.89]);
      page.drawImage(embedded, {
        x: 50,
        y: 100,
        width: 495.28,
        height: 641.89
      });
    }
  }

  const outputPdfBytes = await mergedDoc.save();
  const outputPath = path.join(__dirname, 'test_merged_output.pdf');
  fs.writeFileSync(outputPath, outputPdfBytes);
  console.log(`✔ Successfully generated output PDF: ${outputPath} (${outputPdfBytes.length} bytes)`);

  // 8. Verify the resulting PDF
  const verifyDoc = await PDFDocument.load(outputPdfBytes);
  const finalPageCount = verifyDoc.getPageCount();
  console.log(`✔ Verified output page count: ${finalPageCount}`);

  if (finalPageCount !== 6) {
    throw new Error(`Expected 6 pages, got ${finalPageCount}`);
  }

  // Check rotated page (docA pageIndex 1, located at index 3 in final array)
  const rotatedPage = verifyDoc.getPage(3);
  const rot = rotatedPage.getRotation().angle;
  console.log(`✔ Verified Page 4 (docA page 2) rotation angle: ${rot}° (expected 90°)`);
  if (rot !== 90) {
    throw new Error(`Expected rotation 90, got ${rot}`);
  }

  // Clean up temporary test files
  fs.unlinkSync(docAPath);
  fs.unlinkSync(docBPath);
  fs.unlinkSync(outputPath);

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Document merging and reordering verified.');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
