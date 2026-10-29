export const EDITOR_STORAGE = "broadcast-motion-studio-v4-167619dec8-tail2";
export function logoToText(o, content = "CCTV", size = 1.25) {
  o.type = "text";
  o.text = {
    content,
    size,
    tracking: 0,
    depth: o.geometry?.depth ?? 0.15,
    bevelSize: Math.min(0.025, o.geometry?.bevelSize ?? 0.015),
    bevelThickness: 0.015,
    bevelSegments: 3,
    curveSegments: 12,
  };
  delete o.geometry;
  return o;
}
export function textFields(p) {
  return p.objects
    .filter((o) => ["text", "text2d", "logo"].includes(o.type))
    .map((o) => ({
      id: o.id,
      label: o.name,
      content: o.text?.content ?? "CCTV",
      size: o.text?.size ?? 1.25,
      logo: o.type === "logo",
      screen: o.type === "text2d",
      sourceMode: o.text?.sourceMode,
      svgName: o.text?.svg?.name,
    }));
}
export function applyFields(base, fields) {
  const p = structuredClone(base);
  for (const f of fields) {
    const o = p.objects.find((o) => o.id === f.id);
    if (!o) continue;
    if (o.type === "logo") {
      if (f.content !== "CCTV" || Number(f.size) !== 1.25)
        logoToText(o, f.content, Number(f.size));
    } else if (["text", "text2d"].includes(o.type)) {
      o.text.content = f.content;
      o.text.size = Number(f.size);
    }
  }
  return p;
}
