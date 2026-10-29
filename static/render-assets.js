export async function loadRenderAssets() {
  const base = new URL("./", import.meta.url);
  const fetchAsset = async (name) => {
    const r = await fetch(new URL(name, base));
    if (!r.ok) throw Error("资源加载失败：" + name + " (" + r.status + ")");
    return r;
  };
  const font = fetchAsset("editor-font.otf").then((r) => r.arrayBuffer());
  const entries = [
    ["earth", "earth.jpg"],
    ["cloud", "earthCloud.png"],
    ["red", "rgb-r.png"],
    ["green", "rgb-g.png"],
    ["blue", "rgb-b.png"],
  ];
  const bitmaps = Object.fromEntries(
    await Promise.all(
      entries.map(async ([key, file]) => [
        key,
        await createImageBitmap(await (await fetchAsset(file)).blob(), {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        }),
      ]),
    ),
  );
  return { fontBuffer: await font, bitmaps };
}
export function releaseAssets(assets) {
  for (const bitmap of Object.values(assets?.bitmaps || {})) bitmap.close();
}
