import { audioSettings, needsAudioEncoding } from "./audio-track.js";
import { registerAacEncoder } from "./vendor/mediabunny/aac-encoder.mjs";
import { Engine, validate } from "./engine.js";
import { loadRenderAssets, releaseAssets } from "./render-assets.js";
import {
  Input,
  BufferSource,
  ALL_FORMATS,
  EncodedPacketSink,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  StreamTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
} from "./vendor/mediabunny/mediabunny.mjs";
const PRESETS = {
  720: { width: 1280, height: 720, bitrate: 6000000 },
  1080: { width: 1920, height: 1080, bitrate: 12000000 },
  1440: { width: 2560, height: 1440, bitrate: 20000000 },
  2160: { width: 3840, height: 2160, bitrate: 40000000 },
};
let canceled = false,
  busy = false;
const tick = () => new Promise((r) => setTimeout(r, 0));
function check() {
  if (canceled) throw new DOMException("导出已取消", "AbortError");
}
async function encoderConfig(size, fps) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined")
    throw Error(
      "浏览器不支持 WebCodecs H.264 编码，请使用 HTTPS 或 localhost 下的桌面 Chrome / Edge。",
    );
  for (const hardwareAcceleration of [
    "prefer-hardware",
    "no-preference",
    "prefer-software",
  ])
    for (const codec of size.height > 1080
      ? ["avc1.640033", "avc1.420033", "avc1.640034", "avc1.420034"]
      : ["avc1.64002a", "avc1.42002a", "avc1.420033"]) {
      const config = {
        codec,
        width: size.width,
        height: size.height,
        bitrate: size.bitrate,
        framerate: fps,
        latencyMode: "realtime",
        hardwareAcceleration,
        avc: { format: "avc" },
      };
      try {
        if ((await VideoEncoder.isConfigSupported(config)).supported)
          return config;
      } catch {}
    }
  throw Error(
    `此设备没有可用的 ${size.width}×${size.height} H.264 编码器。请降低分辨率或换用支持硬件编码的桌面 Chrome / Edge；不会自动降分辨率。`,
  );
}
async function audioPackets(duration, encodedBuffer) {
  const r = encodedBuffer
    ? null
    : await fetch(new URL("./bgm.m4a", import.meta.url));
  if (r && !r.ok) throw Error("音轨文件加载失败");
  const input = new Input({
    source: new BufferSource(encodedBuffer || (await r.arrayBuffer())),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || (await track.getCodec()) !== "aac")
      throw Error("BGM 不是可直接封装的 AAC 音轨");
    const config = await track.getDecoderConfig(),
      packets = [];
    for await (const packet of new EncodedPacketSink(track).packets()) {
      if (packet.timestamp >= duration) break;
      if (packet.timestamp + packet.duration <= 0) continue;
      packets.push(
        packet.clone({
          timestamp: Math.max(0, packet.timestamp),
          duration: Math.min(
            packet.duration,
            duration - Math.max(0, packet.timestamp),
          ),
        }),
      );
    }
    return {
      config,
      packets,
      duration: packets.length
        ? packets.at(-1).timestamp + packets.at(-1).duration
        : 0,
    };
  } finally {
    input.dispose();
  }
}
async function encodeAudioData(data, duration) {
  if (
    !(await canEncodeAudio("aac", {
      sampleRate: data.sampleRate,
      numberOfChannels: data.planes.length,
    }))
  )
    registerAacEncoder();
  const target = new BufferTarget(),
    out = new Output({ format: new Mp4OutputFormat(), target }),
    source = new AudioSampleSource({ codec: "aac", bitrate: 192000 });
  out.addAudioTrack(source);
  await out.start();
  try {
    for (let start = 0; start < data.planes[0].length; start += 4096) {
      check();
      const n = Math.min(4096, data.planes[0].length - start),
        chunk = new Float32Array(n * data.planes.length);
      data.planes.forEach((plane, i) =>
        chunk.set(plane.subarray(start, start + n), i * n),
      );
      const sample = new AudioSample({
        data: chunk,
        format: "f32-planar",
        numberOfChannels: data.planes.length,
        sampleRate: data.sampleRate,
        timestamp: start / data.sampleRate,
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
      if (start % 65536 === 0) await tick();
    }
    await out.finalize();
    return audioPackets(duration, target.buffer);
  } catch (e) {
    await out.cancel();
    throw e;
  }
}
async function run({
  project,
  preset,
  music = true,
  audioData = null,
  fileHandle,
  fullBackground = false,
}) {
  busy = true;
  canceled = false;
  let engine, assets, encoder, output, writable;
  const started = performance.now();
  let encoded = 0,
    submitted = 0,
    error = null,
    writes = Promise.resolve();
  try {
    validate(project);
    const size = PRESETS[preset];
    if (!size) throw Error("无效的导出分辨率");
    postMessage({ type: "status", text: "检测 H.264 编码器…" });
    const config = await encoderConfig(size, project.fps);
    check();
    postMessage({ type: "status", text: "加载素材并准备音轨…" });
    const settings = audioSettings(project);
    if (music && settings.enabled && needsAudioEncoding(project) && !audioData)
      throw Error("替换或编辑音轨后，请从生成页准备音频再导出");
    const loaded = await Promise.all([
      loadRenderAssets(),
      music && settings.enabled
        ? audioData
          ? encodeAudioData(audioData, project.duration)
          : audioPackets(project.duration)
        : null,
    ]);
    assets = loaded[0];
    const audio = loaded[1];
    check();
    const canvas = new OffscreenCanvas(size.width, size.height);
    engine = new Engine(canvas, {
      ...assets,
      interactive: false,
      pixelRatio: 1,
      antialias: size.height < 2160,
      fullResolutionBackground: fullBackground,
      preserveDrawingBuffer: false,
    });
    const gl = engine.renderer.getContext();
    if (
      size.width > gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) ||
      size.height > gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
    )
      throw Error("显卡不支持此导出尺寸，请降低分辨率");
    engine.renderer.setSize(size.width, size.height, false);
    engine.load(project);
    await engine.imagesReady();
    // Keep a non-16:9 imported template undistorted, letterboxed into the selected output size.
    const ratio = project.aspect[0] / project.aspect[1],
      vw = Math.min(size.width, size.height * ratio),
      vh = vw / ratio;
    engine.renderer.setViewport(
      Math.round((size.width - vw) / 2),
      Math.round((size.height - vh) / 2),
      Math.round(vw),
      Math.round(vh),
    );
    const frames = Math.ceil(project.duration * project.fps - 1e-8);
    let target;
    if (fileHandle) {
      writable = await fileHandle.createWritable();
      target = new StreamTarget(
        new WritableStream({ write: (chunk) => writable.write(chunk) }),
        { chunked: true, chunkSize: 4 * 1024 * 1024 },
      );
    } else target = new BufferTarget();
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: "reserve" }),
      target,
    });
    const video = new EncodedVideoPacketSource("avc");
    output.addVideoTrack(video, {
      frameRate: project.fps,
      maximumPacketCount: frames + 4,
    });
    let sound;
    if (audio) {
      sound = new EncodedAudioPacketSource("aac");
      output.addAudioTrack(sound, {
        maximumPacketCount: audio.packets.length + 4,
      });
    }
    await output.start();
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const packet = EncodedPacket.fromEncodedChunk(chunk);
        writes = writes
          .then(() => video.add(packet, meta))
          .catch((e) => {
            error = e;
          });
        encoded++;
      },
      error: (e) => {
        error = e;
      },
    });
    encoder.configure(config);
    postMessage({
      type: "started",
      frames,
      width: size.width,
      height: size.height,
      codec: config.codec,
      acceleration: config.hardwareAcceleration,
      musicDuration: audio?.duration ?? 0,
    });
    let ai = 0,
      lastReport = 0;
    const queueLimit = size.height >= 2160 ? 3 : 6;
    for (let i = 0; i < frames; i++) {
      check();
      if (error) throw error;
      while (encoder.encodeQueueSize >= queueLimit) {
        check();
        if (error) throw error;
        await tick();
      }
      if (i % queueLimit === 0) {
        await writes;
        await tick();
        check();
      }
      const t = i / project.fps,
        ts = Math.round(t * 1e6),
        next = Math.round(
          Math.min(project.duration, (i + 1) / project.fps) * 1e6,
        );
      engine.render(project, t);
      const frame = new VideoFrame(canvas, {
        timestamp: ts,
        duration: next - ts,
        alpha: "discard",
      });
      try {
        encoder.encode(frame, {
          keyFrame: i % Math.max(1, Math.round(project.fps * 2)) === 0,
        });
      } finally {
        frame.close();
      }
      submitted = i + 1;
      // Interleave original AAC packets; no audio decoding, resampling or re-encoding.
      while (
        audio &&
        ai < audio.packets.length &&
        audio.packets[ai].timestamp <= t
      ) {
        await sound.add(
          audio.packets[ai],
          ai === 0 ? { decoderConfig: audio.config } : undefined,
        );
        ai++;
      }
      if (performance.now() - lastReport > 120 || i === frames - 1) {
        lastReport = performance.now();
        postMessage({
          type: "progress",
          frame: submitted,
          frames,
          encoded,
          seconds: (performance.now() - started) / 1000,
        });
      }
    }
    postMessage({ type: "status", text: "正在完成编码与 MP4 封装…" });
    await encoder.flush();
    await writes;
    if (error) throw error;
    check();
    while (audio && ai < audio.packets.length) {
      await sound.add(
        audio.packets[ai],
        ai === 0 ? { decoderConfig: audio.config } : undefined,
      );
      ai++;
    }
    await output.finalize();
    if (writable) await writable.close();
    check();
    const seconds = (performance.now() - started) / 1000;
    if (target instanceof BufferTarget) {
      postMessage(
        {
          type: "done",
          buffer: target.buffer,
          seconds,
          frames,
          width: size.width,
          height: size.height,
        },
        [target.buffer],
      );
    } else
      postMessage({
        type: "done",
        saved: true,
        seconds,
        frames,
        width: size.width,
        height: size.height,
      });
  } catch (e) {
    try {
      await output?.cancel();
    } catch {}
    try {
      await writable?.abort();
    } catch {}
    postMessage({
      type: e.name === "AbortError" ? "canceled" : "error",
      message: e.message || String(e),
    });
  } finally {
    try {
      if (encoder && encoder.state !== "closed") encoder.close();
    } catch {}
    if (engine) {
      engine.nodes.forEach((n) => engine.disposeNode(n));
      engine.renderer.dispose();
      engine.renderer.forceContextLoss();
    }
    releaseAssets(assets);
    busy = false;
  }
}
onmessage = async ({ data }) => {
  if (data.type === "cancel") {
    canceled = true;
    return;
  }
  if (data.type === "probe") {
    try {
      const config = await encoderConfig(PRESETS[data.preset], data.fps || 24);
      postMessage({ type: "probe", id: data.id, ok: true, config });
    } catch (e) {
      postMessage({ type: "probe", id: data.id, ok: false, error: e.message });
    }
    return;
  }
  if (data.type === "start" && !busy) run(data);
};
