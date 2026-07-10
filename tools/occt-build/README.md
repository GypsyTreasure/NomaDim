# OCCT trimmed build

Placeholder for the M1 milestone (CLAUDE.md "OCCT specifics"). This directory
will hold the build configuration and instructions for the custom trimmed,
single-threaded OpenCascade.js WASM build (packages: `BRepBuilderAPI`,
`BRepPrimAPI`, `BRepAlgoAPI`, `BRepFilletAPI`, `BRepMesh_IncrementalMesh`,
STL/triangulation access, `gp`, `TopoDS`, `TopExp`, `GC`/`Geom` builders,
`ShapeFix_Wire`). The built `.wasm`/`.js` artifacts are copied into
`public/wasm/` (served with `application/wasm` MIME via file extension, no
custom headers — GitHub Pages compatible per MASTER_DOCUMENT C2).

Not started — tracked for M1.
