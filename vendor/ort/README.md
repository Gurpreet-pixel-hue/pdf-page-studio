# ONNX Runtime Web (vendored)

| file | source | licence |
|---|---|---|
| `ort.wasm.min.mjs` | `onnxruntime-web@1.23.2`, `dist/ort.wasm.min.mjs` | MIT |
| `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` | `scanic-ml@0.2.0`, `dist/` (a minimal ONNX Runtime v1.23.2 build, 1.5 MB instead of 12 MB) | MIT |

The JS and wasm are version-locked (1.23.x). The minimal wasm only contains the operators
of the corner model, so it runs the `models/doccorner-ft.ort` file and little else.
