// Demo project generator (spec §7 "demo details"): synthetic but cinematic footage made with ffmpeg lavfi.
// Scenes are built from a few static layers (sky gradient, light glows, silhouettes) rendered once with geq,
// graded with real 3D LUTs (.cube) — "after" = a creative look, "before" = a flat LOG-like curve —
// then animated with cheap overlays (parallax, rising sun) plus film grain, vignette and letterboxing.
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { runFfmpeg } from './ffmpeg.mjs';
import { isFile, writeFileAtomic, rmrf } from './fsutil.mjs';
import { loadContent } from './content.mjs';

export const W = 1280;
export const H = 720;
export const FPS = 24;
const TAG709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];

// ---------------------------------------------------------------------------------------------
// looks (3D LUTs)

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = (c, s) => {
  const y = luma(...c);
  return c.map((v) => y + (v - y) * s);
};
/** normalized logistic S-curve (0→0, 1→1), k = strength */
const scurve = (x, k) => {
  const f = (v) => 1 / (1 + Math.exp(-k * (v - 0.5)));
  return (f(x) - f(0)) / (f(1) - f(0));
};
/** shadows/highlights split toning */
const split = (c, shadow, highlight) => {
  const y = luma(...c);
  const sh = 1 - smooth(0.05, 0.55, y);
  const hi = smooth(0.35, 0.95, y);
  return c.map((v, i) => v + shadow[i] * sh + highlight[i] * hi);
};

export const LOOKS = {
  /** flat, desaturated, lifted blacks / rolled highlights — what a camera LOG file looks like */
  log: (r, g, b) => {
    const f = (v) => 0.095 + 0.8 * Math.pow(v, 0.78);
    return sat([f(r), f(g), f(b)], 0.52);
  },
  tealOrange: (r, g, b) => sat(split([r, g, b].map((v) => scurve(v, 5.2)), [-0.05, 0.015, 0.07], [0.07, 0.02, -0.07]), 1.18),
  neon: (r, g, b) => sat(split([r, g, b].map((v) => scurve(v, 6)), [0.02, -0.03, 0.06], [0.04, -0.02, 0.05]), 1.35),
  coolFilm: (r, g, b) => {
    const c = [r, g, b].map((v) => 0.035 + 0.94 * scurve(v, 4.4));
    return sat(split(c, [-0.02, 0.01, 0.05], [0.02, 0.01, -0.015]), 0.78);
  },
  golden: (r, g, b) => sat(split([r, g, b].map((v) => scurve(Math.pow(v, 0.95), 4.6)), [0.01, -0.005, 0.03], [0.08, 0.035, -0.06]), 1.22),
  clean: (r, g, b) => sat(split([r, g, b].map((v) => 0.02 + 0.97 * scurve(Math.pow(v, 0.92), 3.6)), [0.0, 0.0, 0.015], [0.02, 0.01, -0.01]), 1.08),
  bleach: (r, g, b) => {
    const c = [r, g, b].map((v) => scurve(v, 7.5));
    return sat(split(c, [-0.01, 0.0, 0.02], [0.02, 0.015, -0.01]), 0.42);
  },
};

export function cubeText(fn, size = 17) {
  const lines = [`TITLE "tonecraft demo"`, `LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const o = fn(r / (size - 1), g / (size - 1), b / (size - 1)).map(clamp01);
        lines.push(`${o[0].toFixed(5)} ${o[1].toFixed(5)} ${o[2].toFixed(5)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// layers (single-frame geq renders)

const n = (v) => Number(v.toFixed(4));

function skyLayer({ top, mid, hor, m = 0.55, haze = 5 }) {
  const ch = (i) =>
    `clip(if(lt(Y/H,${m}),${top[i]}+(${mid[i]}-${top[i]})*pow(Y/H/${m},1.3),${mid[i]}+(${hor[i]}-${mid[i]})*pow((Y/H-${m})/${n(1 - m)},0.9))+${haze}*sin(Y/H*19+X/W*4.5),0,255)`;
  // smooth → rendered at half size and upscaled (4× cheaper, visually identical under grain)
  return { w: W, h: H, lo: 2, geq: `r='${ch(0)}':g='${ch(1)}':b='${ch(2)}':a=255`, x: '0', y: '0' };
}

function glowLayer({ color, x, y, size = 0.34, strength = 1, vx = 0, vy = 0 }) {
  const s = Math.round(W * size);
  return {
    w: s,
    h: s,
    lo: 2,
    geq: `r=${color[0]}:g=${color[1]}:b=${color[2]}:a='clip(255*${strength}*exp(-(pow(X/W-0.5,2)+pow(Y/H-0.5,2))/(2*0.0370)),0,255)'`,
    x: `${Math.round(x * W - s / 2)}+${vx}*t`,
    y: `${Math.round(y * H - s / 2)}+${vy}*t`,
  };
}

function ridgeLayer({ color, base, amps, freqs, phases, speed = 10, alpha = 255, fade = 0 }) {
  const w = W + Math.ceil(Math.abs(speed) * 12) + 40;
  const edge = [`H*${base}`, ...amps.map((a, i) => `${a}*sin(X/${freqs[i]}+${phases[i] ?? 0})`)].join('+');
  const fadeTerm = fade ? `*clip(1-(Y-(${edge}))/(H*${fade}),0.25,1)` : '';
  return {
    w,
    h: H,
    geq: `r=${color[0]}:g=${color[1]}:b=${color[2]}:a='clip((Y-(${edge}))/1.4+0.5,0,1)*${alpha}${fadeTerm}'`,
    x: `-${speed}*t`,
    y: '0',
  };
}

/** City skyline: random-height blocks with lit windows. */
function skylineLayer({ color, window: win = null, base, range, cw, seed = 1, speed = 10, density = 0.7 }) {
  const w = W + Math.ceil(Math.abs(speed) * 12) + 40;
  // classic shader hash: fract(sin(x) * 43758.5453) → pseudo-random 0..1 per column / window
  const rnd = (a) => `mod(abs(sin(${a}*12.9898+${seed}*78.233))*43758.5453,1)`;
  const top = `H*(${base}-${range}*${rnd(`floor(X/${cw})`)})`;
  const inside = `gt(Y,${top})`;
  const lit = win
    ? `*between(mod(X,${Math.round(cw / 4)}),2,${Math.round(cw / 8) + 2})*between(mod(Y,15),4,9)*gt(${rnd(`(floor(X/${Math.round(cw / 4)})*7+floor(Y/15)*13)`)},${density})*gt(Y,${top}+10)`
    : '*0';
  const ch = (i) => (win ? `if(${inside}${lit},${win[i]},${color[i]})` : `${color[i]}`);
  return { w, h: H, geq: `r='${ch(0)}':g='${ch(1)}':b='${ch(2)}':a='255*${inside}'`, x: `-${speed}*t`, y: '0' };
}

/** Product bottle on a sweep, with shading and a specular strip. */
function bottleLayer({ color, cx = 0.5, bw = 0.07, top = 0.36, bottom = 0.8 }) {
  const X0 = Math.round(cx * W);
  const hw = Math.round(bw * W);
  const y0 = Math.round(top * H);
  const y1 = Math.round(bottom * H);
  const r = Math.round(hw * 0.55);
  const neckW = Math.round(hw * 0.36);
  const neckH = Math.round(hw * 0.55);
  const capH = Math.round(hw * 0.5);
  const body = `lt(hypot(max(abs(X-${X0})-${hw - r},0),max(max(${y0 + r}-Y,Y-${y1 - r}),0)),${r})`;
  const neck = `lt(abs(X-${X0}),${neckW})*between(Y,${y0 - neckH},${y0 + 4})`;
  const cap = `lt(abs(X-${X0}),${Math.round(neckW * 1.25)})*between(Y,${y0 - neckH - capH},${y0 - neckH})`;
  const shade = `(0.5+0.5*cos((X-${X0})/${hw}*1.35))`;
  const spec = `(150*exp(-pow((X-${X0 - Math.round(hw * 0.5)})/${Math.max(3, Math.round(hw * 0.07))},2)))`;
  const ch = (i) => `if(${cap},28,clip(${color[i]}*${shade}+${spec}*gt(${body}+${neck},0),0,255))`;
  const a = `255*gt(${body}+${neck}+${cap},0)`;
  return { w: W, h: H, geq: `r='${ch(0)}':g='${ch(1)}':b='${ch(2)}':a='${a}'`, x: '0', y: '0' };
}

function shadowLayer({ cx = 0.5, cy = 0.8, rx = 0.16, ry = 0.035, strength = 0.55 }) {
  return {
    w: W,
    h: H,
    geq: `r=0:g=0:b=0:a='clip(255*${strength}*exp(-(pow((X-${cx * W})/${rx * W},2)+pow((Y-${cy * H})/${ry * H},2))),0,255)'`,
    x: '0',
    y: '0',
  };
}

const vignetteGeq = (strength) =>
  `r=0:g=0:b=0:a='clip(255*${strength}*pow(clip((hypot((X-${W / 2})/${W / 2},(Y-${H / 2})/${H / 2})-0.5)/0.85,0,1),1.5),0,255)'`;

// ---------------------------------------------------------------------------------------------
// scenes

export const SCENES = {
  dusk: {
    look: 'tealOrange',
    letterbox: true,
    layers: [
      skyLayer({ top: [18, 26, 62], mid: [96, 74, 112], hor: [236, 152, 104] }),
      glowLayer({ color: [255, 226, 170], x: 0.68, y: 0.6, size: 0.46, vx: 3, vy: -8 }),
      ridgeLayer({ color: [46, 38, 56], base: 0.6, amps: [36, 16, 6], freqs: [150, 61, 19], phases: [1.3, 0.4, 0], speed: 7 }),
      ridgeLayer({ color: [10, 9, 14], base: 0.74, amps: [42, 19, 7], freqs: [210, 77, 23], phases: [2.1, 0.9, 0], speed: 20 }),
    ],
  },
  neon: {
    look: 'neon',
    layers: [
      skyLayer({ top: [8, 6, 22], mid: [34, 14, 52], hor: [84, 28, 86], haze: 3 }),
      glowLayer({ color: [255, 60, 190], x: 0.28, y: 0.55, size: 0.5, vx: 16, vy: 0, strength: 0.9 }),
      glowLayer({ color: [40, 210, 255], x: 0.78, y: 0.5, size: 0.44, vx: -14, vy: 2, strength: 0.85 }),
      skylineLayer({ color: [24, 16, 40], window: [255, 120, 220], base: 0.62, range: 0.3, cw: 56, seed: 3, speed: 6, density: 0.75 }),
      skylineLayer({ color: [6, 5, 12], window: [130, 230, 255], base: 0.8, range: 0.34, cw: 88, seed: 7, speed: 18, density: 0.7 }),
    ],
  },
  dawn: {
    look: 'coolFilm',
    letterbox: true,
    layers: [
      skyLayer({ top: [58, 72, 98], mid: [124, 138, 154], hor: [200, 204, 208], haze: 3 }),
      glowLayer({ color: [255, 244, 226], x: 0.34, y: 0.6, size: 0.3, vx: 2, vy: -5, strength: 0.85 }),
      ridgeLayer({ color: [150, 160, 174], base: 0.56, amps: [30, 12, 5], freqs: [170, 55, 17], phases: [0.3, 1.9, 0], speed: 4, alpha: 210, fade: 0.25 }),
      ridgeLayer({ color: [92, 102, 118], base: 0.66, amps: [34, 14, 6], freqs: [190, 66, 21], phases: [2.4, 0.2, 1], speed: 10, alpha: 235, fade: 0.3 }),
      ridgeLayer({ color: [26, 30, 36], base: 0.8, amps: [26, 11, 5], freqs: [230, 71, 25], phases: [1.1, 2.7, 0], speed: 24 }),
    ],
  },
  golden: {
    look: 'golden',
    layers: [
      skyLayer({ top: [74, 112, 168], mid: [222, 170, 122], hor: [255, 212, 146], m: 0.5 }),
      glowLayer({ color: [255, 238, 186], x: 0.5, y: 0.68, size: 0.62, vx: 0, vy: -6 }),
      ridgeLayer({ color: [124, 92, 70], base: 0.64, amps: [22, 10, 4], freqs: [260, 90, 31], phases: [0.6, 1.2, 0], speed: 5 }),
      ridgeLayer({ color: [42, 34, 18], base: 0.78, amps: [14, 6, 4, 3], freqs: [300, 60, 2.3, 1.3], phases: [2, 0.5, 0, 1], speed: 16 }),
    ],
  },
  studio: {
    look: 'clean',
    vignette: 0.32,
    layers: [
      skyLayer({ top: [228, 210, 216], mid: [214, 192, 200], hor: [172, 148, 158], m: 0.62, haze: 1.5 }),
      glowLayer({ color: [255, 250, 244], x: 0.3, y: 0.42, size: 0.6, vx: 40, vy: 0, strength: 0.75 }),
      shadowLayer({ cx: 0.5, cy: 0.8, rx: 0.15, ry: 0.03 }),
      bottleLayer({ color: [214, 132, 150] }),
    ],
  },
  city: {
    look: 'bleach',
    layers: [
      skyLayer({ top: [40, 52, 70], mid: [122, 128, 136], hor: [204, 194, 172] }),
      glowLayer({ color: [255, 232, 196], x: 0.62, y: 0.62, size: 0.36, vx: 2, vy: -4 }),
      skylineLayer({ color: [74, 80, 90], base: 0.6, range: 0.26, cw: 48, seed: 11, speed: 5 }),
      skylineLayer({ color: [16, 18, 22], window: [255, 212, 150], base: 0.78, range: 0.36, cw: 80, seed: 5, speed: 15, density: 0.78 }),
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// rendering

export class SceneRenderer {
  constructor({ ffmpeg, tmp }) {
    this.ffmpeg = ffmpeg;
    this.tmp = tmp;
    this.cache = new Map();
  }

  async lut(look) {
    const file = path.join(this.tmp, `${look}.cube`);
    if (!(await isFile(file))) await fsp.writeFile(file, cubeText(LOOKS[look]));
    return file;
  }

  /** Render + grade a scene's static layers in one ffmpeg call → { after: [png], before: [png], vignette } */
  async layers(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const job = (async () => {
      const scene = SCENES[key];
      const out = { after: [], before: [] };
      // LUTs are referenced relative to the ffmpeg working directory (tmp) so no drive letters, spaces or
      // quotes from the user's temp path ever end up inside the filtergraph string (Windows-safe).
      const afterLut = path.basename(await this.lut(scene.look));
      const beforeLut = path.basename(await this.lut('log'));
      const args = [];
      const graph = [];
      const maps = [];
      scene.layers.forEach((L, i) => {
        const lo = L.lo || 1;
        const w = Math.round(L.w / lo);
        const h = Math.round(L.h / lo);
        args.push('-f', 'lavfi', '-i', `color=c=black@0:s=${w}x${h}:r=1:d=1,format=rgba`);
        const up = lo > 1 ? `,scale=${L.w}:${L.h}:flags=bicubic` : '';
        graph.push(`[${i}:v]geq=${L.geq}${up},split=2[x${i}][y${i}]`, `[x${i}]lut3d=file='${afterLut}'[a${i}]`, `[y${i}]lut3d=file='${beforeLut}'[b${i}]`);
        const a = path.join(this.tmp, `${key}-${i}-after.png`);
        const b = path.join(this.tmp, `${key}-${i}-before.png`);
        maps.push(['-map', `[a${i}]`, '-frames:v', '1', '-update', '1', a], ['-map', `[b${i}]`, '-frames:v', '1', '-update', '1', b]);
        out.after.push(a);
        out.before.push(b);
      });
      const strength = scene.vignette ?? 0.72;
      out.vignette = path.join(this.tmp, `vignette-${key}.png`);
      args.push('-f', 'lavfi', '-i', `color=c=black@0:s=${W}x${H}:r=1:d=1,format=rgba`);
      graph.push(`[${scene.layers.length}:v]geq=${vignetteGeq(strength)}[vg]`);
      maps.push(['-map', '[vg]', '-frames:v', '1', '-update', '1', out.vignette]);
      await runFfmpeg(this.ffmpeg, [...args, '-filter_complex', graph.join(';'), ...maps.flat()], { cwd: this.tmp });
      return out;
    })();
    this.cache.set(key, job);
    return job;
  }

  /**
   * Composite subgraph for one look; appends its inputs to `inputs` and returns filter chains ending in [label].
   * frames: number of frames; t0: time offset (s) so single-frame renders can pick any moment.
   */
  graph(key, files, which, inputs, { frames, t0 = 0, label }) {
    const scene = SCENES[key];
    const parts = [];
    const loop = `loop=loop=${frames - 1}:size=1:start=0,setpts=N/(${FPS}*TB)`;
    const add = (f) => {
      inputs.push(f);
      return inputs.length - 1;
    };
    files.forEach((f, i) => parts.push(`[${add(f)}:v]${loop}[${label}l${i}]`));
    let cur = `${label}l0`;
    const t = t0 ? `(t+${t0})` : 't';
    scene.layers.forEach((L, i) => {
      if (i === 0) return;
      const x = L.x.replace(/\bt\b/g, t);
      const y = L.y.replace(/\bt\b/g, t);
      parts.push(`[${cur}][${label}l${i}]overlay=x='${x}':y='${y}':format=rgb[${label}c${i}]`);
      cur = `${label}c${i}`;
    });
    if (which === 'after') {
      parts.push(`[${add(files.vignette)}:v]${loop}[${label}vg]`);
      parts.push(`[${cur}][${label}vg]overlay=format=rgb[${label}v]`);
      cur = `${label}v`;
    }
    const grain = which === 'after' ? 'noise=c0s=5:c0f=t' : 'noise=c0s=3:c0f=t';
    const bars = scene.letterbox ? ',drawbox=x=0:y=0:w=iw:h=92:color=black:t=fill,drawbox=x=0:y=628:w=iw:h=92:color=black:t=fill' : '';
    parts.push(`[${cur}]format=yuv420p,${grain}${bars}[${label}]`);
    return parts;
  }

  /** Render a scene to video(s) and still frames in a single ffmpeg call. */
  async render(key, { duration = 6, video = null, beforeVideo = null, frames: stills = [] }) {
    const L = await this.layers(key);
    const files = (look) => Object.assign([...(look === 'before' ? L.before : L.after)], { vignette: L.vignette });
    const total = Math.round(duration * FPS);
    const inputs = [];
    const graph = [];
    const outs = [];
    const enc = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'superfast', '-crf', '17', '-pix_fmt', 'yuv420p', ...TAG709, '-movflags', '+faststart'];
    if (video) {
      graph.push(...this.graph(key, files('after'), 'after', inputs, { frames: total, label: 'A' }));
      outs.push('-map', '[A]', ...enc, video);
    }
    if (beforeVideo) {
      graph.push(...this.graph(key, files('before'), 'before', inputs, { frames: total, label: 'B' }));
      outs.push('-map', '[B]', ...enc, beforeVideo);
    }
    stills.forEach((st, i) => {
      const label = `S${i}`;
      graph.push(...this.graph(key, files(st.look), st.look === 'before' ? 'before' : 'after', inputs, { frames: 1, t0: st.t, label }));
      outs.push('-map', `[${label}]`, '-frames:v', '1', ...(/\.jpe?g$/i.test(st.file) ? ['-q:v', '2'] : []), '-update', '1', st.file);
    });
    if (!outs.length) return;
    const args = [];
    for (const f of inputs) args.push('-i', f);
    await runFfmpeg(this.ffmpeg, [...args, '-filter_complex', graph.join(';'), ...outs]);
  }
}

// ---------------------------------------------------------------------------------------------
// demo content

export const DEMO_WORKS = [
  {
    scene: 'dusk',
    raw: { main: true, ba: [{ t: 3 }] },
    work: {
      slug: 'demo-dusk-drive',
      title: '[DEMO] 해질녘 드라이브 — 자동차 광고',
      client: 'DEMO 모터스',
      category: 'commercial',
      year: 2026,
      date: '2026-05-14',
      summary: '노을빛 하이라이트와 청록 섀도로 입체감을 살린 광고 룩 (데모용 합성 영상)',
      notes: [
        '이 작업은 사이트 동작을 보여주기 위한 데모입니다. 영상은 ffmpeg로 합성한 추상 이미지입니다.',
        '로그 원본의 낮은 대비를 S커브로 정리하고, 하이라이트는 따뜻하게·섀도는 청록으로 분리해 깊이를 만들었습니다.',
      ],
      credits: [
        { role: '감독', name: 'DEMO 감독' },
        { role: '촬영', name: 'DEMO 촬영감독' },
      ],
      camera: 'ARRI ALEXA Mini LF',
      featured: true,
      order: 1,
      comparisons: [{ caption: '카메라 LOG 원본 → 최종 그레이딩', beforeLabel: 'LOG', afterLabel: 'GRADED' }],
    },
  },
  {
    scene: 'neon',
    raw: { main: true, baVideo: true },
    work: {
      slug: 'demo-neon-night',
      title: '[DEMO] 네온 나이트 — 뮤직비디오',
      client: 'DEMO 아티스트',
      category: 'music-video',
      year: 2026,
      summary: '마젠타와 시안 네온이 부딪히는 밤거리 무드 (데모용 합성 영상)',
      notes: ['데모 영상입니다. 비포·애프터가 영상일 때 좌우 비교 영상(baVideo)이 함께 만들어지는 예시입니다.'],
      credits: [{ role: '감독', name: 'DEMO 감독' }],
      camera: 'Sony FX6',
      featured: true,
      order: 2,
      comparisons: [{ caption: '영상 비교 — 재생 버튼을 눌러 보세요', beforeLabel: 'LOG', afterLabel: 'GRADED' }],
      baVideo: true,
      baTimes: [2],
    },
  },
  {
    scene: 'dawn',
    raw: { main: true, ba: [{ t: 1.5 }, { t: 4.5 }], stills: [1, 3, 5] },
    work: {
      slug: 'demo-dawn-short',
      title: '[DEMO] 단편영화 「새벽」',
      category: 'film',
      year: 2025,
      summary: '차갑고 절제된 새벽 톤, 안개 층의 분리감 (데모용 합성 영상)',
      notes: [
        '데모 영상입니다. 스틸 컷(stills)과 비포·애프터 두 쌍을 가진 작업 예시입니다.',
        '채도를 덜어 내고 섀도에 푸른 기운을 더해, 인물이 없는 풍경에서도 이야기의 온도가 느껴지도록 했습니다.',
      ],
      credits: [
        { role: '연출', name: 'DEMO 연출' },
        { role: '촬영', name: 'DEMO 촬영' },
      ],
      camera: 'RED KOMODO 6K',
      order: 3,
      comparisons: [{ caption: '안개 층 분리', beforeLabel: 'LOG', afterLabel: 'GRADED' }, { caption: '하이라이트 롤오프' }],
    },
  },
  {
    scene: 'golden',
    raw: { main: true, ba: [{ t: 3 }] },
    work: {
      slug: 'demo-golden-hour',
      title: '[DEMO] 골든아워 — 브랜디드 필름',
      client: 'DEMO 브랜드',
      category: 'branded',
      year: 2025,
      summary: '따뜻한 역광과 부드러운 하이라이트 롤오프 (데모용 합성 영상)',
      notes: ['데모 영상입니다.'],
      camera: 'Blackmagic Pocket 6K',
      order: 4,
      comparisons: [{ caption: '역광 하이라이트 정리' }],
    },
  },
  {
    scene: 'studio',
    raw: { main: true, ba: [{ t: 2 }], poster: 3 },
    work: {
      slug: 'demo-cosmetic',
      title: '[DEMO] 코스메틱 제품 영상',
      client: 'DEMO 코스메틱',
      category: 'product',
      year: 2025,
      summary: '제품 고유색을 정확히 맞춘 클린 룩 (데모용 합성 영상)',
      notes: ['데모 영상입니다. poster 이미지를 따로 넣은 작업 예시입니다.'],
      camera: 'Canon C70',
      order: 5,
      comparisons: [{ caption: '제품 색 매칭', beforeLabel: 'LOG', afterLabel: 'GRADED' }],
    },
  },
  {
    scene: 'city',
    raw: { main: true },
    work: {
      slug: 'demo-city-bleach',
      title: '[DEMO] 블리치 바이패스 — 뮤직비디오',
      client: 'DEMO 밴드',
      category: 'music-video',
      year: 2024,
      summary: '은잔존(블리치 바이패스) 느낌의 거친 고대비 (데모용 합성 영상)',
      notes: ['데모 영상입니다. 비포·애프터 없이 영상만 있는 작업 예시입니다.'],
      order: 6,
    },
  },
  {
    scene: 'golden',
    raw: { ba: [{ t: 5 }] },
    work: {
      slug: 'demo-private-draft',
      title: '[DEMO] 비공개 초안 (publish: false)',
      category: 'commercial',
      year: 2026,
      summary: 'publish: false — 배포용 site/ 에는 나타나지 않고 미리보기에서만 보입니다.',
      order: 7,
      publish: false,
      consent: 'granted',
    },
  },
  {
    scene: 'dawn',
    raw: { ba: [{ t: 3 }] },
    work: {
      slug: 'demo-pending-consent',
      title: '[DEMO] 동의 대기 작업 (consent: pending)',
      category: 'film',
      year: 2026,
      summary: "consent: 'pending' — 공개 설정이어도 동의 전에는 배포되지 않습니다.",
      order: 8,
      publish: true,
      consent: 'pending',
    },
  },
];

function worksModule(works) {
  return `// 데모 프로젝트 작업 목록 — tools/demo.mjs 가 자동으로 만든 파일입니다 (실제 작업이 아닙니다).
// 형식은 content/works.mjs 와 같습니다. 다시 만들려면: npm run demo
export default ${JSON.stringify(works, null, 2)};
`;
}

/** Pick category ids that exist in the site config (fall back to the first ones). */
export function mapCategories(works, categories) {
  const ids = categories.map((c) => c.id);
  return works.map((w, i) => ({ ...w, category: ids.includes(w.category) ? w.category : ids[i % Math.max(1, ids.length)] || w.category }));
}

const FALLBACK_SITE = `export default {
  brand: { name: 'TONECRAFT', person: '임민규', role: '컬러리스트', tagline: '장면의 온도를 설계합니다' },
  contact: { email: 'crafttone3@gmail.com', kmongUrl: '' },
  categories: [
    { id: 'commercial', label: '광고' },
    { id: 'music-video', label: '뮤직비디오' },
    { id: 'film', label: '영화·단편' },
    { id: 'branded', label: '브랜디드' },
    { id: 'product', label: '제품' },
  ],
};
`;

/**
 * Create <root>/content + <root>/raw with synthetic footage.
 * Returns { works, created, skipped } (raw work folders generated / reused).
 */
export async function generateDemoProject({ root, repoRoot, ffmpeg, force = false, log = () => {}, concurrency }) {
  await fsp.mkdir(path.join(root, 'content'), { recursive: true });
  const repoSite = path.join(repoRoot, 'content', 'site.mjs');
  const siteDst = path.join(root, 'content', 'site.mjs');
  if (await isFile(repoSite)) await fsp.copyFile(repoSite, siteDst);
  else await writeFileAtomic(siteDst, FALLBACK_SITE);
  const { site } = await loadContent(root);
  const works = mapCategories(
    DEMO_WORKS.map((d) => ({ publish: true, consent: 'granted', ...d.work })),
    site.categories,
  );
  await writeFileAtomic(path.join(root, 'content', 'works.mjs'), worksModule(works));

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'tonecraft-demo-'));
  try {
    return await renderAll({ root, ffmpeg, force, log, concurrency, tmp, works });
  } finally {
    await rmrf(tmp);
  }
}

async function renderAll({ root, ffmpeg, force, log, concurrency, tmp, works }) {
  const renderer = new SceneRenderer({ ffmpeg, tmp });
  const rawWorks = path.join(root, 'raw', 'works');
  let created = 0;
  let skipped = 0;
  const tasks = DEMO_WORKS.map((d) => async () => {
    const dir = path.join(rawWorks, d.work.slug);
    const marker = path.join(dir, '.demo-complete');
    if (!force && (await isFile(marker))) {
      skipped++;
      return;
    }
    await rmrf(dir);
    await fsp.mkdir(dir, { recursive: true });
    const t0 = Date.now();
    const stills = [];
    for (const [i, p] of (d.raw.ba || []).entries()) {
      stills.push({ t: p.t, look: 'before', file: path.join(dir, `before-${i + 1}.png`) });
      stills.push({ t: p.t, look: 'after', file: path.join(dir, `after-${i + 1}.png`) });
    }
    if (d.raw.stills?.length) await fsp.mkdir(path.join(dir, 'stills'), { recursive: true });
    for (const [i, t] of (d.raw.stills || []).entries()) stills.push({ t, look: 'after', file: path.join(dir, 'stills', `still-${i + 1}.jpg`) });
    if (d.raw.poster !== undefined) stills.push({ t: d.raw.poster, look: 'after', file: path.join(dir, 'poster.jpg') });
    await renderer.render(d.scene, {
      duration: 6,
      video: d.raw.main ? path.join(dir, 'main.mp4') : null,
      beforeVideo: d.raw.baVideo ? path.join(dir, 'before-1.mp4') : null,
      frames: stills,
    });
    if (d.raw.baVideo) await fsp.copyFile(path.join(dir, 'main.mp4'), path.join(dir, 'after-1.mp4'));
    await fsp.writeFile(marker, new Date().toISOString());
    created++;
    log(`원본 생성: ${d.work.slug} (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  });

  const limit = concurrency || Math.max(1, Math.min(4, Math.floor((os.cpus()?.length || 2) / 1.5)));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]();
    }),
  );

  // showreel: 4 × 3 s from the rendered mains, cross-dissolved, with a quiet ambient pad
  const reelDir = path.join(root, 'raw', 'reel');
  const reelFile = path.join(reelDir, 'tonecraft-demo-reel.mp4');
  if (force || created > 0 || !(await isFile(reelFile))) {
    await rmrf(reelDir);
    await fsp.mkdir(reelDir, { recursive: true });
    const picks = ['demo-dusk-drive', 'demo-neon-night', 'demo-golden-hour', 'demo-dawn-short'].map((s) => path.join(rawWorks, s, 'main.mp4'));
    const seg = 3.45; // 4 × 3.45 s − 3 × 0.6 s dissolves = 12 s
    const fade = 0.6;
    const args = [];
    for (const f of picks) args.push('-ss', '1', '-t', String(seg), '-i', f);
    const fc = [];
    picks.forEach((_, i) => fc.push(`[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p[v${i}]`));
    let cur = 'v0';
    for (let i = 1; i < picks.length; i++) {
      const offset = n(i * (seg - fade));
      fc.push(`[${cur}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset}[x${i}]`);
      cur = `x${i}`;
    }
    const total = n(picks.length * seg - (picks.length - 1) * fade);
    fc.push(`[${cur}]fade=t=in:st=0:d=0.5,fade=t=out:st=${n(total - 0.6)}:d=0.6[vout]`);
    fc.push(
      `sine=f=110:d=${total}[s1];sine=f=164.81:d=${total}[s2];sine=f=220:d=${total}[s3];anoisesrc=d=${total}:c=pink:a=0.02[s4];` +
        `[s1][s2][s3][s4]amix=inputs=4:weights='1 0.6 0.35 1',volume=0.35,afade=t=in:d=1.5,afade=t=out:st=${n(total - 1.5)}:d=1.5[aout]`,
    );
    args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', ...TAG709, '-c:a', 'aac', '-b:a', '160k', '-t', String(total), '-movflags', '+faststart', reelFile);
    const t0 = Date.now();
    await runFfmpeg(ffmpeg, args);
    log(`원본 생성: 쇼릴 ${total.toFixed(1)}초 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  }

  return { works, created, skipped };
}
