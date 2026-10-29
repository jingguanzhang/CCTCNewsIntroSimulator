export const EARTH_MATERIAL_DEFAULT = Object.freeze({
  model: "classic",
  metalness: 0,
  roughness: 0.45,
  clearcoat: 0.15,
  clearcoatRoughness: 0.2,
  color: "#d3e2d9",
  specular: "#142d3c",
  shininess: 36,
  emissive: "#003449",
  emissiveIntensity: 0.35,
  cloudOpacity: 0.18,
  glowEnabled: true,
  glowColor: "#d3e7ff",
  glowIntensity: 1,
  glowWidth: 0.035,
  glowFalloff: 3,
  rimIntensity: 1,
});
export const earthMaterial = (o) => ({
  ...EARTH_MATERIAL_DEFAULT,
  ...o.earthMaterial,
});
export function validateEarthMaterial(o) {
  if (o.earthMaterial === undefined) return;
  if (
    !o.earthMaterial ||
    typeof o.earthMaterial !== "object" ||
    Array.isArray(o.earthMaterial)
  )
    throw Error("地球材质配置无效");
  const p = earthMaterial(o);
  if (!["classic", "physical"].includes(p.model))
    throw Error("未知地球材质模型");
  for (const k of ["color", "specular", "emissive", "glowColor"])
    if (!/^#[0-9a-f]{6}$/i.test(p[k])) throw Error("地球材质颜色无效");
  if (typeof p.glowEnabled !== "boolean") throw Error("外发光开关无效");
  for (const [k, min, max] of [
    ["metalness", 0, 1],
    ["roughness", 0, 1],
    ["clearcoat", 0, 1],
    ["clearcoatRoughness", 0, 1],
    ["shininess", 0, 200],
    ["emissiveIntensity", 0, 5],
    ["cloudOpacity", 0, 1],
    ["glowIntensity", 0, 5],
    ["glowWidth", 0.001, 0.2],
    ["glowFalloff", 0.5, 8],
    ["rimIntensity", 0, 5],
  ])
    if (!Number.isFinite(p[k]) || p[k] < min || p[k] > max)
      throw Error("地球材质参数超出范围：" + k);
}
