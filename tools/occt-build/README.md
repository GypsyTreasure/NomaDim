# OCCT trimmed build

Placeholder for the M1 milestone (CLAUDE.md "OCCT specifics"). This directory
will hold the build configuration and instructions for the custom trimmed,
single-threaded OpenCascade.js WASM build (packages: `BRepBuilderAPI`,
`BRepPrimAPI`, `BRepAlgoAPI`, `BRepFilletAPI`, `BRepMesh_IncrementalMesh`,
STL/triangulation access, `gp`, `TopoDS`, `TopExp`, `GC`/`Geom` builders,
`ShapeFix_Wire`, `ShapeFix_Shape` + `BRepCheck_Analyzer` — the last two are
needed to heal an invalid fillet/chamfer/boolean face so it still meshes and
exports watertight, ADR-0057). The built `.wasm`/`.js` artifacts are copied into
`public/wasm/` (served with `application/wasm` MIME via file extension, no
custom headers — GitHub Pages compatible per MASTER_DOCUMENT C2).

## ⚠️ OUTSTANDING — trimmed build owed (M8, ADR-0078)

**Status:** the app currently ships the **full untrimmed** OCCT, delivered as a
build-time gzip (`public/wasm/opencascade.full.wasm.gzc`, ~50 MB → ~13 MB,
gunzipped in-browser). The **trimmed build (< 8 MB) is still owed** — it could
not be produced in the CI/agent environment (no emscripten SDK, no network for
the multi-GB `donalffons/opencascade.js` build image). The owner chose to accept
the gzip delivery now and **finish the trimmed build once a toolchain with
network access is available.**

**To finish it (on a machine with Docker + network):**

1. Use the `donalffons/opencascade.js` custom-build image with a `yml` listing
   only the packages above (bindings for `BRepBuilderAPI`, `BRepPrimAPI`,
   `BRepAlgoAPI`, `BRepFilletAPI`, `BRepMesh_IncrementalMesh`, STL/triangulation,
   `gp`, `TopoDS`, `TopExp`, `GC`/`Geom`, `ShapeFix_Wire`, `ShapeFix_Shape`,
   `BRepCheck_Analyzer`, `STEPControl` read/write).
2. Emit `opencascade.custom.{js,wasm}`; verify the golden kernel tests
   (volume/area/bbox) still pass against it.
3. Drop the artifacts into `public/wasm/`, point `kernel-worker/occt.ts` +
   `kernel/wasmLoader.ts` at the new basename, and let the existing gzip plugin
   compress it. Target < 8 MB → kernel-ready < 12 s on Fast-3G.

Only the build artifact is missing; the whole delivery pipeline (gzip, in-browser
decompression, lazy boot, progress, service-worker cache) already works and will
carry a smaller `.wasm` unchanged.
