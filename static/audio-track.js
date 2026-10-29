export const DEFAULT_AUDIO_URL = new URL("./bgm.m4a", import.meta.url).href;
export function audioSettings(p) {
  return {
    enabled: true,
    name: "背景音乐",
    src: null,
    in: 0,
    out: p.duration,
    offset: 0,
    volume: 1,
    ...p.audio,
  };
}
export function needsAudioEncoding(p) {
  const a = audioSettings(p);
  return (
    !!a.src ||
    a.in !== 0 ||
    a.out < p.duration - 1e-6 ||
    a.offset !== 0 ||
    a.volume !== 1
  );
}
let cacheKey = null,
  cachePromise = null;
export async function decodeTrack(src = DEFAULT_AUDIO_URL) {
  if (src === cacheKey && cachePromise) return cachePromise;
  cacheKey = src;
  cachePromise = (async () => {
    const r = await fetch(src);
    if (!r.ok) throw Error("音频读取失败");
    const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)({
      sampleRate: 48000,
    });
    try {
      let buffer = await ctx.decodeAudioData(await r.arrayBuffer());
      if (buffer.duration > 600) throw Error("音频长度请控制在 10 分钟内");
      if (buffer.numberOfChannels > 2) {
        const mix = new OfflineAudioContext(
            2,
            buffer.length,
            buffer.sampleRate,
          ),
          source = mix.createBufferSource();
        source.buffer = buffer;
        source.connect(mix.destination);
        source.start();
        buffer = await mix.startRendering();
      }
      const peaks = Array.from({ length: 128 }, (_, i) => {
        const data = buffer.getChannelData(0),
          start = Math.floor((i * data.length) / 128),
          end = Math.floor(((i + 1) * data.length) / 128);
        let peak = 0;
        for (
          let j = start;
          j < end;
          j += Math.max(1, Math.floor((end - start) / 200))
        )
          peak = Math.max(peak, Math.abs(data[j]));
        return peak;
      });
      return { buffer, duration: buffer.duration, peaks };
    } finally {
      await ctx.close();
    }
  })();
  return cachePromise;
}
export async function readAudioFile(file) {
  if (file.size > 20 * 1024 * 1024) throw Error("音频文件上限为 20 MB");
  const bytes = await file.arrayBuffer();
  const src = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(
      new Blob([bytes], {
        type: file.type.startsWith("audio/") ? file.type : "audio/octet-stream",
      }),
    );
  });
  const info = await decodeTrack(src);
  return { src, name: file.name, duration: info.duration };
}
export function syncAudioElement(el, p, time, playing, rate = 1) {
  const a = audioSettings(p),
    src = a.src || DEFAULT_AUDIO_URL;
  if (el._trackSrc !== src) {
    el.pause();
    el._trackSrc = src;
    el.src = src;
    el.load();
  }
  el.volume = a.volume;
  el.playbackRate = rate;
  const t = time - a.in + a.offset;
  if (
    !a.enabled ||
    time < a.in ||
    time >= a.out ||
    t < 0 ||
    !Number.isFinite(el.duration) ||
    t >= el.duration
  ) {
    el.pause();
    return;
  }
  if (Math.abs(el.currentTime - t) > 0.12) el.currentTime = t;
  if (playing) {
    if (el.paused) el.play().catch(() => {});
  } else el.pause();
}
export async function prepareAudioExport(p) {
  const a = audioSettings(p);
  if (!a.enabled || !needsAudioEncoding(p)) return null;
  const { buffer } = await decodeTrack(a.src || DEFAULT_AUDIO_URL),
    sampleRate = 48000,
    count = Math.ceil(p.duration * sampleRate),
    channels = Math.min(2, buffer.numberOfChannels),
    start = Math.round(a.in * sampleRate),
    offset = Math.round(a.offset * sampleRate),
    end = Math.min(
      count,
      Math.round(a.out * sampleRate),
      start + buffer.length - offset,
    );
  const planes = Array.from({ length: channels }, (_, ch) => {
    const dest = new Float32Array(count),
      source = buffer.getChannelData(ch);
    for (let i = start; i < end; i++)
      dest[i] = source[offset + i - start] * a.volume;
    return dest;
  });
  return { sampleRate, planes };
}
export function validateAudio(p) {
  if (!p || p.audio === undefined) return;
  const a = p.audio;
  if (!a || typeof a.enabled !== "boolean" || typeof a.name !== "string")
    throw Error("音轨配置无效");
  for (const [key, lo, hi] of [
    ["in", 0, p.duration],
    ["out", a.in + 0.001, p.duration + 0.001],
    ["offset", 0, 600],
    ["volume", 0, 1],
  ])
    if (
      typeof a[key] !== "number" ||
      !Number.isFinite(a[key]) ||
      a[key] < lo ||
      a[key] > hi
    )
      throw Error("音轨 " + key + " 超出范围");
  if (
    a.src !== null &&
    a.src !== undefined &&
    (typeof a.src !== "string" ||
      !/^data:audio\/[\w.+-]+;base64,/.test(a.src) ||
      a.src.length > 29000000)
  )
    throw Error("音轨须为内嵌音频文件，最大 20 MB");
}
