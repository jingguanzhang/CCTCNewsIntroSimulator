import * as THREE from "./vendor/three/three.module.js";

// Smooth only coincident vertices, never weld positions, UVs, groups or holes.
// Unlike coarse position welding this preserves thin strokes and small bevels.
export function smoothExtrusion(geometry, angle = Math.PI / 3) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.getAttribute("position");
  if (!p || !p.count) return g;
  const normals = new Float32Array(p.count * 3),
    faces = [],
    vertices = new Map();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3(),
    cross = new THREE.Vector3();
  const key = (i) =>
    `${Math.round(p.getX(i) * 1e6)},${Math.round(p.getY(i) * 1e6)},${Math.round(p.getZ(i) * 1e6)}`;
  const keys = Array.from({ length: p.count }, (_, i) => key(i));
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    cross.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const n = cross.clone().normalize();
    faces.push(n);
    const points = [a.clone(), b.clone(), c.clone()];
    for (let j = 0; j < 3; j++) {
      const u = points[(j + 1) % 3].clone().sub(points[j]),
        v = points[(j + 2) % 3].clone().sub(points[j]);
      const weight = u.lengthSq() && v.lengthSq() ? u.angleTo(v) : 0;
      const list = vertices.get(keys[i + j]) || [];
      list.push({ normal: n, weight });
      vertices.set(keys[i + j], list);
    }
  }
  const threshold = Math.cos(angle),
    sum = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const n = faces[Math.floor(i / 3)];
    sum.set(0, 0, 0);
    // Flat caps stay flat. Matching bevel ends meet the cap tangentially.
    const cap = vertices
      .get(keys[i])
      .find(
        (f) => Math.abs(f.normal.z) > 1 - 1e-6 && n.dot(f.normal) > threshold,
      );
    if (cap) sum.copy(cap.normal);
    else {
      for (const f of vertices.get(keys[i]))
        if (n.dot(f.normal) > threshold)
          sum.addScaledVector(f.normal, f.weight);
      if (sum.lengthSq() < 1e-20) sum.copy(n);
      sum.normalize();
    }
    normals[i * 3] = sum.x;
    normals[i * 3 + 1] = sum.y;
    normals[i * 3 + 2] = sum.z;
  }
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.userData.autoSmooth = true;
  return g;
}
