import * as THREE from "./vendor/three/three.module.js";
// Font outline direction is not a reliable hole flag (CFF/TTF/custom SVG differ).
// Build the contour containment tree, then use even/odd depth for islands/holes.
function inside(p, poly) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      yes = !yes;
  }
  return yes;
}
export function glyphShapes(path, segments = 12) {
  const cs = path.subPaths
    .map((p) => {
      const pts = p.getPoints(Math.max(12, segments));
      return {
        path: p,
        pts,
        area: Math.abs(THREE.ShapeUtils.area(pts)),
        parent: null,
        depth: 0,
      };
    })
    .filter((c) => c.area > 1e-12)
    .sort((a, b) => b.area - a.area);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    for (let j = i - 1; j >= 0; j--) {
      const outer = cs[j];
      if (c.pts.every((p) => inside(p, outer.pts))) {
        c.parent = outer;
        c.depth = outer.depth + 1;
        break;
      }
    }
  }
  const shapes = [];
  for (const c of cs) {
    if (c.depth % 2 === 0) {
      c.shape = new THREE.Shape();
      c.shape.curves = c.path.curves.slice();
      c.shape.autoClose = true;
      shapes.push(c.shape);
    } else {
      const hole = new THREE.Path();
      hole.curves = c.path.curves.slice();
      hole.autoClose = true;
      c.parent.shape.holes.push(hole);
    }
  }
  return shapes;
}
