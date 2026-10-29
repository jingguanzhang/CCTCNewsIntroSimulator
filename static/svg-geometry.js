import { smoothExtrusion } from "./smooth-normals.js";
import * as THREE from "./vendor/three/three.module.js";
export function validateSvg(text, type) {
  if (
    text.sourceMode !== undefined &&
    !["text", "svg"].includes(text.sourceMode)
  )
    throw Error("未知文字来源模式");
  if (
    text.sourceMode === "svg" &&
    (!["text", "text2d"].includes(type) || !text.svg)
  )
    throw Error("SVG 模式需要有效轮廓");
  if (text.svg === undefined) return;
  const svg = text.svg;
  if (
    !svg ||
    typeof svg.name !== "string" ||
    svg.name.length > 512 ||
    !Array.isArray(svg.contours) ||
    svg.contours.length < 1 ||
    svg.contours.length > 128
  )
    throw Error("SVG 轮廓配置无效");
  let count = 0;
  for (const shape of svg.contours) {
    if (!shape || !Array.isArray(shape.holes) || shape.holes.length > 128)
      throw Error("SVG 孔洞配置无效");
    for (const ring of [shape.outer, ...shape.holes]) {
      if (
        !Array.isArray(ring) ||
        ring.length < 3 ||
        (count += ring.length) > 20000
      )
        throw Error("SVG 轮廓点数无效或超过 20000");
      for (const p of ring)
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every((v) => Number.isFinite(v) && Math.abs(v) <= 100)
        )
          throw Error("SVG 坐标无效");
    }
  }
}
export function svgGeometry(p, flat = false) {
  const shapes = p.svg.contours.map((c) => {
    const points = (r) =>
      r.map(([x, y]) => new THREE.Vector2(x * p.size, y * p.size));
    const s = new THREE.Shape(points(c.outer));
    s.holes = c.holes.map((r) => new THREE.Path(points(r)));
    return s;
  });
  const geo = flat
    ? new THREE.ShapeGeometry(shapes, p.curveSegments)
    : new THREE.ExtrudeGeometry(shapes, {
        depth: p.depth,
        bevelEnabled: p.bevelSize > 0 && p.bevelThickness > 0,
        bevelSize: p.bevelSize,
        bevelThickness: p.bevelThickness,
        bevelSegments: p.bevelSegments,
        curveSegments: p.curveSegments,
        steps: 1,
      });
  if (!flat) smoothExtrusion(geo);
  geo.translate(0, 0, -p.depth / 2);
  return geo;
}
