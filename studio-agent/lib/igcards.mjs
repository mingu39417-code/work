// 인스타그램 카드뉴스 — 블로그용으로 써 둔 글을 여러 장 넘기는 게시물(캐러셀)로 바꿉니다(코드로 그려 비용 없음).
import crypto from 'node:crypto';
import { studioName } from './actions.mjs';
import { aiLine } from './social.mjs';

const W = 1080;
const H = 1350;
const FONT = "Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function wrap(text, max, maxLines) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (w.length > max) { if (cur) lines.push(cur); for (let i = 0; i < w.length; i += max) lines.push(w.slice(i, i + max)); cur = ''; continue; }
    if ((cur ? cur + ' ' + w : w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const cut = lines.slice(0, maxLines); cut[maxLines - 1] = cut[maxLines - 1].replace(/.{0,2}$/, '…'); return cut; }
  return lines;
}

function frame(settings, inner, page, total) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#F5EFE6"/>
  <circle cx="${W - 110}" cy="150" r="200" fill="#E9B79A" opacity="0.45"/>
  ${inner}
  <text x="90" y="${H - 80}" font-family="${FONT}" font-size="28" fill="#8A6A55">${esc(studioName(settings))}</text>
  <text x="${W - 90}" y="${H - 80}" text-anchor="end" font-family="${FONT}" font-size="28" fill="#8A6A55">${page} / ${total}</text>
</svg>`;
}

const textLines = (lines, x, y, size, lh, weight, color) => lines.map((l, i) => `<text x="${x}" y="${y + i * lh}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(l)}</text>`).join('\n  ');

// 첫 문장 두 개 정도만(카드에는 짧게)
function summary(text, max = 110) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  const parts = s.split(/(?<=[.!?。]|[다요]\.)\s+/);
  let out = '';
  for (const p of parts) { if ((out + ' ' + p).trim().length > max) break; out = (out + ' ' + p).trim(); }
  return out || s.slice(0, max);
}

export function carouselCards(settings, post) {
  const sections = [];
  for (let i = 0; i < post.blocks.length; i++) if (post.blocks[i].type === 'h') sections.push({ heading: post.blocks[i].text, body: post.blocks[i + 1]?.type === 'p' ? post.blocks[i + 1].text : '' });
  const picked = sections.slice(0, 6);
  const total = picked.length + 2;
  const svgs = [];
  const t = wrap(post.title, 11, 4);
  svgs.push(frame(settings, `<text x="90" y="240" font-family="${FONT}" font-size="32" fill="#8A6A55" letter-spacing="2">${esc(studioName(settings))} 디자인 노트</text>
  ${textLines(t, 90, 560 - (t.length - 1) * 45, 84, 108, 700, '#3B2A20')}
  <rect x="90" y="${560 - (t.length - 1) * 45 + t.length * 108 - 50}" width="140" height="10" rx="5" fill="#C9805F"/>
  <text x="90" y="${H - 200}" font-family="${FONT}" font-size="34" fill="#8A6A55">옆으로 넘겨 보세요 →</text>`, 1, total));
  picked.forEach((s, i) => {
    const h = wrap(s.heading, 13, 3);
    const b = wrap(summary(s.body), 19, 7);
    svgs.push(frame(settings, `<text x="90" y="260" font-family="${FONT}" font-size="110" font-weight="700" fill="#C9805F">${String(i + 1).padStart(2, '0')}</text>
  ${textLines(h, 90, 420, 64, 84, 700, '#3B2A20')}
  ${textLines(b, 90, 420 + h.length * 84 + 70, 40, 62, 400, '#5A4535')}`, i + 2, total));
  });
  svgs.push(frame(settings, `<text x="90" y="520" font-family="${FONT}" font-size="72" font-weight="700" fill="#3B2A20">도움이 되셨나요?</text>
  <text x="90" y="620" font-family="${FONT}" font-size="42" fill="#5A4535">로고 · SNS · 상세페이지 · 포스터</text>
  <text x="90" y="690" font-family="${FONT}" font-size="42" fill="#5A4535">디자인 문의는 프로필 링크로</text>
  <rect x="90" y="760" width="140" height="10" rx="5" fill="#C9805F"/>`, total, total));
  return svgs.map((svg) => ({ token: crypto.randomBytes(18).toString('base64url'), svg }));
}

export function carouselCaption(settings, post) {
  const intro = post.blocks.find((b) => b.type === 'p')?.text ?? '';
  const heads = post.blocks.filter((b) => b.type === 'h').slice(0, 6).map((b) => `✔ ${b.text}`).join('\n');
  const tags = (post.tags ?? []).slice(0, 15).map((x) => `#${x}`).join(' ');
  const body = `${post.title}\n\n${summary(intro, 300)}\n\n${heads}\n\n디자인 문의는 프로필 링크에서 받아요.`;
  const tail = `${tags ? `\n\n${tags}` : ''}\n\n${aiLine(settings)}`;
  return `${body.slice(0, 2200 - tail.length)}${tail}`;
}