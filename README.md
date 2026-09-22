# PDF Page Studio

> **High-Performance Visual Image & PDF Reordering, Sequential Numbering, and Document Assembler**

**Live Web Application**: [https://gurpreet-pixel-hue.github.io/pdf-page-studio/](https://gurpreet-pixel-hue.github.io/pdf-page-studio/)

---

## Overview

**PDF Page Studio** is a privacy-first, client-side web application and macOS desktop tool designed to organize, reorder, and merge images and multi-page PDFs into unified PDF documents with complete visual control.

All rendering, page extraction, image encoding, and PDF compilation occur **100% locally in-browser in memory**. No files are ever uploaded to any third-party server, guaranteeing absolute confidentiality.

---

## Key Features

- **Multi-File Batch Ingestion**: Upload dozens of images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`) and multi-page PDFs simultaneously or incrementally.
- **Strict Default Page Sequencing**: The 1st image selected is automatically designated `PAGE 1`, the 2nd is `PAGE 2`, and multi-page PDFs are sequentially exploded into individual page cards.
- **Interactive Drag-and-Drop Grid**: Smooth 60fps card dragging with dynamic target drop indicators. All page tags update immediately in real time.
- **Micro-Controls per Page**:
  - Rotate 90° Clockwise and Counter-Clockwise.
  - Quick Move Left (←) and Move Right (→) buttons.
  - Delete individual pages.
  - Fullscreen Lightbox Modal to inspect image resolution and text sharpness.
- **Batch Sorting Actions**:
  - Reset to original upload order.
  - Sort alphabetically by file name (A-Z or Z-A).
  - Reverse entire document page order.
- **Document Export Configuration**:
  - Page Formats: Standard A4 (Proportional Auto-fit), Original Image Dimensions, or US Letter.
  - Page Orientation: Auto (Best fit per page), Force Portrait, or Force Landscape.
  - Margins: None (0 mm), Compact (5 mm), or Standard (10 mm).
  - Image Quality: Lossless/Original or Optimized (compact file size).
  - Custom Output Filename with automatic `.pdf` sanitization.

---

## Local Development & Native macOS Launcher

### Prerequisites
- Any modern web browser (Safari, Chrome, Firefox, Edge, Arc)
- Python 3 (for optional local background server) or Node.js

### Quick Start
```bash
# Clone the repository
git clone https://github.com/Gurpreet-pixel-hue/pdf-page-studio.git
cd pdf-page-studio

# Launch locally
./launch.sh
# Opens http://127.0.0.1:7890/index.html
```

### Automated Tests
Run the headless Node.js verification test suite:
```bash
node test_merge.js
```

---

## License
MIT License. Free for personal, commercial, and collaborative team use.
