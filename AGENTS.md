# PDF Page Studio — Engineering & Design Specification

## Overview
- Application: High-performance visual PDF organizer, page reordering suite, and document assembler.
- Public Live URL: `https://gurpreet-pixel-hue.github.io/pdf-page-studio/`
- GitHub Repository: `https://github.com/Gurpreet-pixel-hue/pdf-page-studio`
- Deployment Platform: GitHub Pages (SSL-encrypted, automated via `.github/workflows/deploy.yml`)
- Zero Server Dependency: 100% in-browser client-side execution via WebAssembly & Web Workers. Zero telemetry leakage, 100% private. Zero local port footprint.

---

## Directory Structure
```
pdf-page-studio/
├── .github/
│   └── workflows/
│       └── deploy.yml            # Automated GitHub Pages CI/CD pipeline
├── assets/
│   ├── app_icon.png              # Source 1024x1024 app icon
│   ├── icon-192.png              # PWA manifest 192x192 icon
│   ├── icon-512.png              # PWA manifest 512x512 icon
│   └── icons.iconset/            # macOS ICNS iconset bundle
├── app.js                        # Core application logic, PDF-Lib compiler, drag-drop, watermarking, filters
├── index.html                    # Semantic HTML5 layout, PWA meta, mobile dock, settings drawer, modals
├── styles.css                    # Warm creamy alabaster design system, spring animations, responsive queries
├── manifest.json                 # Web App Manifest for PWA installation (iOS/Android/macOS)
├── launch.sh                     # Zero-port launcher script for macOS / Linux
├── create_macos_app.py           # Native macOS Application bundle generator with custom ICNS
├── test_merge.js                 # Automated headless node verification test suite
└── .gitignore                    # Git ignore configuration (AGENTS.md is strictly tracked)
```

---

## Architecture & Features

### 1. Universal Device Responsiveness
- **Desktop**: Full grid view with drag-and-drop handles, top toolbar telemetry, slide-out configuration drawer.
- **iPad / Tablet** (`max-width: 1024px`): Adaptive 3-4 column grid, touch-friendly handles.
- **Mobile** (`max-width: 768px` & `420px`):
  - Clean 2-column mobile card grid.
  - Thumb-friendly fixed bottom bar dock (`.mobile-bottom-bar`) with iOS safe-area insets (`env(safe-area-inset-bottom)`).
  - Device-agnostic micro-copy: "Choose Photos & Files" (eliminated "on Mac" references).
  - Full-screen slide-up settings drawer.

### 2. Built-in Unique Selling Points (USPs)
1. **USP 1 — Direct Mobile Camera Document Scanner**:
   - `<input type="file" capture="environment">` integrated for 1-tap physical paper scanning directly into the document queue.
2. **USP 2 — Dynamic Page Number Watermarking**:
   - In-engine PDF-Lib page numbering with configurable formats (`Page X of Y` or `X / Y`) drawn at 16pt margin using standard Helvetica fonts.
3. **USP 3 — Document Scan Enhancer (B&W Photocopy Mode)**:
   - Client-side canvas pixel transformation using luminance thresholding ($Y = 0.299R + 0.587G + 0.114B$) to remove yellow indoor cast, desk shadows, and improve text readability.
4. **USP 4 — Progressive Web App (PWA) Standalone**:
   - `manifest.json`, mobile meta viewport, apple-touch-icons for 1-tap "Add to Home Screen" on iOS & Android.

### 3. Cross-Device Launcher & Asset Cache Invalidation
- **Quick App Launcher (`#btn-install-app`, `#drawer-install-btn`)**: Universal button enabling 1-click home screen / dock icon installation:
  - **Android & Desktop Chrome/Edge**: Native W3C PWA install prompt (`beforeinstallprompt`).
  - **iPhone & iPad (iOS/iPadOS Safari)**: Illustrated 3-step guide for Safari Share $\rightarrow$ Add to Home Screen.
  - **Mac Desktop**: Safari Add to Dock + 1-click download of native `.webloc` shortcut file.
- **Pristine Header**: Header typography kept clean and uncluttered (`PDF PAGE STUDIO`), eliminating version numbers from the visual brand row.
- **Version Query Strings**: `styles.css?v=2.3.0`, `app.js?v=2.3.0`, `manifest.json?v=2.3.0` ensure immediate CDN and local browser cache bypass.
- **Cache-Control Meta Directives**: `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` forces dynamic revalidation of the HTML document shell.

---

## Anti-Vibecoding & Aesthetic Guidelines
- **Aesthetic**: Warm Creamy Alabaster & Editorial Luxury (`#faf8f5` canvas, `#f5f2eb` elevated surfaces, `#e5dfd3` borders, `#2d2621` deep espresso typography, `#c25e3e` terracotta accent).
- **Zero Emojis**: Emojis are strictly banned from UI elements, buttons, badges, and headers. Purposeful SVG glyphs and typography badges are used exclusively.
- **Spring Physics**: Dynamic micro-interactions powered by cubic-bezier spring easing: `cubic-bezier(0.175, 0.885, 0.32, 1.275)`.
- **Zero Local Ports**: No local background HTTP servers run after deployment; cloud CDN serves all traffic.

---

## Verification & Quality Assurance Commands
- Syntax Validation: `node --check app.js`
- Test Suite (Page insertion, reordering, rotation, deletion, watermarking): `node test_merge.js`
- Cloud CDN Health Check: `curl -sI https://gurpreet-pixel-hue.github.io/pdf-page-studio/ | head -n 5`
- Port Check (Must show no open processes): `lsof -iTCP:8000 -iTCP:3000 -iTCP:5173 -iTCP:8080`

---

## Git Workflow & Conventions
- Commits must use clean conventional commits: `feat: ...`, `fix: ...`, `chore: ...`.
- Strictly no AI attribution or bots (`Co-authored-by`, `[bot]`).
- `CLAUDE.md` is strictly read-only. Antigravity never modifies `CLAUDE.md`.
- `AGENTS.md` is maintained continuously on every code modification.
