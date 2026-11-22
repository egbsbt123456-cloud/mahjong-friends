/* 麻将牌面（平台原创 SVG，风格参考用户提供的样图，未使用第三方素材）
 * code：m1-m9 萬，p1-p9 筒，s1-s9 条，z1-z7 東南西北中發白，f1-f8 春夏秋冬梅蘭竹菊
 * tileUrl(code, ghost) 返回可直接用于 <img src> 的 data URI（有缓存）
 */
const C = { blue: '#1d3f8a', green: '#1f7a45', red: '#c8302b', ink: '#142d5c', gold: '#e9cf86' };
const FONT = "'STKaiti','KaiTi','Kaiti SC','Songti SC','STSong','SimSun','Noto Serif CJK SC','Noto Serif SC',serif";
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR = ['東', '南', '西', '北', '中', '發', '白'];
const FLOWER = ['春', '夏', '秋', '冬', '梅', '蘭', '竹', '菊'];

const txt = (x: number, y: number, s: string, size: number, fill: string) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${FONT}" font-weight="700" text-anchor="middle" dominant-baseline="central">${s}</text>`;
const frame = (inner: string) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">' +
  '<defs><linearGradient id="iv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf5"/><stop offset="1" stop-color="#efe5cb"/></linearGradient></defs>' +
  '<rect x="1.5" y="5.5" width="57" height="73" rx="8" fill="#1d5a44"/>' +
  '<rect x="1.5" y="1.5" width="57" height="72" rx="8" fill="url(#iv)" stroke="#d8ccab" stroke-width="1"/>' +
  inner + '</svg>';

/* ---------- 筒 ---------- */
const dot = (x: number, y: number, r: number, c: string) =>
  `<circle cx="${x}" cy="${y}" r="${r * 0.8}" fill="none" stroke="${c}" stroke-width="${r * 0.34}"/><circle cx="${x}" cy="${y}" r="${r * 0.3}" fill="${c}"/>`;
type Dot = [number, number, number, keyof typeof C];
const DOTS: Record<number, Dot[]> = {
  2: [[30, 23, 10, 'blue'], [30, 53, 10, 'red']],
  3: [[16, 18, 8.5, 'blue'], [30, 38, 8.5, 'green'], [44, 58, 8.5, 'red']],
  4: [[19, 24, 9, 'blue'], [41, 24, 9, 'blue'], [19, 52, 9, 'green'], [41, 52, 9, 'green']],
  5: [[17, 18, 8, 'blue'], [43, 18, 8, 'blue'], [30, 38, 8, 'red'], [17, 58, 8, 'blue'], [43, 58, 8, 'blue']],
  6: [[19, 17, 7.5, 'blue'], [41, 17, 7.5, 'blue'], [19, 38, 7.5, 'green'], [41, 38, 7.5, 'green'], [19, 59, 7.5, 'blue'], [41, 59, 7.5, 'blue']],
  7: [[14, 15, 6.5, 'blue'], [30, 15, 6.5, 'blue'], [46, 15, 6.5, 'blue'], [20, 38, 7, 'red'], [40, 38, 7, 'red'], [20, 59, 7, 'green'], [40, 59, 7, 'green']],
  8: [[20, 14, 6.3, 'blue'], [40, 14, 6.3, 'blue'], [20, 30, 6.3, 'red'], [40, 30, 6.3, 'red'], [20, 46, 6.3, 'red'], [40, 46, 6.3, 'red'], [20, 62, 6.3, 'blue'], [40, 62, 6.3, 'blue']],
  9: [[14, 17, 6.6, 'green'], [30, 17, 6.6, 'green'], [46, 17, 6.6, 'green'], [14, 38, 6.6, 'red'], [30, 38, 6.6, 'red'], [46, 38, 6.6, 'red'], [14, 59, 6.6, 'blue'], [30, 59, 6.6, 'blue'], [46, 59, 6.6, 'blue']],
};
function pin(n: number) {
  if (n === 1) {
    let petals = '';
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; petals += `<circle cx="${(30 + Math.cos(a) * 5).toFixed(2)}" cy="${(38 + Math.sin(a) * 5).toFixed(2)}" r="2.4" fill="#fff6ea"/>`; }
    return `<circle cx="30" cy="38" r="19" fill="none" stroke="${C.blue}" stroke-width="4.5"/><circle cx="30" cy="38" r="13.2" fill="none" stroke="${C.blue}" stroke-width="1.4"/><circle cx="30" cy="38" r="9.5" fill="${C.red}"/>${petals}<circle cx="30" cy="38" r="2" fill="#f3c34a"/>`;
  }
  return DOTS[n]!.map(d => dot(d[0], d[1], d[2], C[d[3]])).join('');
}

/* ---------- 条 ---------- */
function stick(x: number, y: number, h: number, c: string, w = 5) {
  const t = y - h / 2;
  let out = `<rect x="${x - w / 2}" y="${t}" width="${w}" height="${h}" rx="${w / 2}" fill="${c}"/>`;
  for (const k of [0.1, 0.5, 0.9]) out += `<rect x="${x - w / 2 - 0.7}" y="${t + h * k - 0.9}" width="${w + 1.4}" height="1.8" rx="0.9" fill="${c}"/>`;
  return out + `<rect x="${x - w * 0.18}" y="${t + 2}" width="${w * 0.24}" height="${h - 4}" rx="0.5" fill="#ffffff" opacity="0.32"/>`;
}
type Stick = [number, number, 'g' | 'r', number?, number?];
const STICKS: Record<number, Stick[]> = {
  2: [[30, 24, 'g'], [30, 52, 'g']],
  3: [[30, 24, 'g'], [19, 52, 'g'], [41, 52, 'g']],
  4: [[20, 24, 'g'], [40, 24, 'g'], [20, 52, 'g'], [40, 52, 'g']],
  5: [[16, 24, 'g'], [44, 24, 'g'], [30, 38, 'r'], [16, 52, 'g'], [44, 52, 'g']],
  6: [[16, 24, 'g'], [30, 24, 'g'], [44, 24, 'g'], [16, 52, 'g'], [30, 52, 'g'], [44, 52, 'g']],
  7: [[30, 16, 'g', 16], [16, 38, 'g', 16], [30, 38, 'r', 16], [44, 38, 'g', 16], [16, 60, 'g', 16], [30, 60, 'r', 16], [44, 60, 'g', 16]],
  8: [[12, 24, 'g', 22, 4.6], [24, 24, 'g', 22, 4.6], [36, 24, 'g', 22, 4.6], [48, 24, 'g', 22, 4.6], [12, 52, 'g', 22, 4.6], [24, 52, 'g', 22, 4.6], [36, 52, 'g', 22, 4.6], [48, 52, 'g', 22, 4.6]],
  9: [[14, 16, 'g', 16], [30, 16, 'r', 16], [46, 16, 'g', 16], [14, 38, 'g', 16], [30, 38, 'r', 16], [46, 38, 'g', 16], [14, 60, 'g', 16], [30, 60, 'r', 16], [46, 60, 'g', 16]],
};
const leaf = (x: number, y: number, rx: number, ry: number, rot: number, c: string) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${x} ${y})" fill="${c}"/>`;
function sou(n: number) {
  if (n === 1) {
    return stick(20, 46, 50, C.green, 6) +
      leaf(33, 58, 9, 2.6, -25, C.green) + leaf(11, 62, 7, 2.2, 30, C.green) + leaf(32, 68, 7, 2, 10, '#2f9a5a') +
      `<path d="M22 30 C26 20 36 16 44 18 C42 24 36 30 28 32 Z" fill="${C.blue}"/>` +
      `<path d="M28 31 L18 54 L24 33 Z" fill="${C.red}"/>` +
      `<circle cx="42" cy="17" r="4.6" fill="${C.blue}"/>` +
      '<path d="M46 16.5 L52 17.5 L46 19 Z" fill="#e3a52a"/>' +
      `<path d="M40 13 L38 7 L42 11 L43 6 L44 12 Z" fill="${C.red}"/>` +
      '<circle cx="43.3" cy="16.2" r="1" fill="#fff"/>' +
      '<path d="M26 26 C30 22 35 21 39 22" stroke="#7ea6e0" stroke-width="1.2" fill="none"/>';
  }
  return STICKS[n]!.map(s => stick(s[0], s[1], s[3] ?? 22, s[2] === 'r' ? C.red : C.green, s[4])).join('');
}

/* ---------- 萬 / 字 ---------- */
const man = (n: number) => txt(30, 25, NUM[n - 1]!, 22, C.ink) + txt(30, 56, '萬', 28, C.red);
function honor(n: number) {
  if (n === 7) return `<rect x="13" y="16" width="34" height="44" rx="3" fill="none" stroke="${C.blue}" stroke-width="3"/><rect x="17.5" y="20.5" width="25" height="35" rx="1.5" fill="none" stroke="${C.blue}" stroke-width="1.2"/>`;
  return txt(30, 38, HONOR[n - 1]!, 38, n === 5 ? C.red : n === 6 ? C.green : C.ink);
}

/* ---------- 花 ---------- */
function blossom(x: number, y: number, r: number, c: string) {
  let o = '';
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; o += `<circle cx="${(x + Math.cos(a) * r).toFixed(2)}" cy="${(y + Math.sin(a) * r).toFixed(2)}" r="${(r * 0.9).toFixed(2)}" fill="${c}"/>`; }
  return o + `<circle cx="${x}" cy="${y}" r="${(r * 0.55).toFixed(2)}" fill="#f6d35b"/>`;
}
function maple(x: number, y: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; pts.push(`${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`); }
  return `<polygon points="${pts.join(' ')}" fill="#e8742a"/>`;
}
const BRANCH = '<path d="M12 70 C20 58 26 52 34 46 C40 41 44 36 48 28" stroke="#6b4a2b" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M30 49 C34 54 40 56 46 56" stroke="#6b4a2b" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
function flowerArt(n: number) {
  switch (n) {
    case 1: return BRANCH + blossom(26, 50, 3.2, '#f29bb8') + blossom(44, 32, 3.2, '#f29bb8') + blossom(44, 56, 2.8, '#f6b9cc') + leaf(36, 42, 3.5, 1.6, -40, '#5aa86a');
    case 2: return '<path d="M30 70 C30 60 30 56 30 52" stroke="#2f8a4f" stroke-width="2" fill="none"/><ellipse cx="18" cy="64" rx="10" ry="5" fill="#3f9a5c"/>' +
      '<path d="M30 54 C22 50 20 40 24 34 C27 40 29 46 30 54 Z" fill="#f08fb0"/><path d="M30 54 C38 50 40 40 36 34 C33 40 31 46 30 54 Z" fill="#f08fb0"/><path d="M30 54 C26 44 27 34 30 28 C33 34 34 44 30 54 Z" fill="#f6b3c9"/>';
    case 3: return '<path d="M14 70 C24 60 34 50 46 30" stroke="#6b4a2b" stroke-width="1.8" fill="none"/>' + maple(24, 52, 8) + maple(42, 34, 7) + maple(40, 58, 6);
    case 4: return BRANCH + `<circle cx="26" cy="50" r="2.6" fill="${C.red}"/><circle cx="44" cy="32" r="2.6" fill="${C.red}"/><circle cx="42" cy="56" r="2.4" fill="${C.red}"/>` +
      '<path d="M20 54 C24 50 30 50 33 47" stroke="#ffffff" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M38 38 C42 35 45 32 48 28" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M20 54 C24 50 30 50 33 47" stroke="#9aa7b4" stroke-width="0.6" fill="none"/><path d="M38 38 C42 35 45 32 48 28" stroke="#9aa7b4" stroke-width="0.6" fill="none"/>';
    case 5: return BRANCH + blossom(26, 50, 3.4, '#e5486e') + blossom(44, 32, 3.4, '#e5486e') + blossom(43, 56, 3, '#ec7090');
    case 6: return '<path d="M30 72 C24 60 16 52 12 40" stroke="#2f8a4f" stroke-width="2" fill="none"/><path d="M30 72 C34 60 42 52 50 46" stroke="#2f8a4f" stroke-width="2" fill="none"/><path d="M30 72 C29 62 30 54 32 46" stroke="#3f9a5c" stroke-width="1.6" fill="none"/>' +
      '<path d="M32 46 C26 42 26 34 32 30 C34 36 36 40 32 46 Z" fill="#7b55c4"/><path d="M32 46 C38 44 44 40 44 34 C38 36 34 40 32 46 Z" fill="#9673d6"/><path d="M32 46 C26 46 20 44 18 38 C24 38 28 42 32 46 Z" fill="#9673d6"/><circle cx="32" cy="44" r="1.6" fill="#f6d35b"/>';
    case 7: return stick(30, 50, 40, '#2f8a4f', 4.4) + leaf(40, 40, 9, 2.4, -25, '#3f9a5c') + leaf(20, 52, 9, 2.4, 25, '#3f9a5c') + leaf(40, 58, 8, 2.2, 15, '#2f8a4f') + leaf(22, 36, 7, 2, -15, '#2f8a4f');
    case 8: {
      let p = '';
      for (let i = 0; i < 14; i++) p += leaf(30, 44, 9, 2.4, i * 360 / 14, i % 2 ? '#f2b300' : '#f7c932');
      return '<path d="M30 70 L30 54" stroke="#2f8a4f" stroke-width="2"/>' + leaf(22, 64, 6, 2.6, 30, '#3f9a5c') + leaf(38, 64, 6, 2.6, -30, '#3f9a5c') + p + '<circle cx="30" cy="44" r="3.4" fill="#e09a00"/>';
    }
  }
  return '';
}
const flower = (n: number) => txt(13, 13, FLOWER[n - 1]!, 12.5, C.red) + txt(50, 69, String(n > 4 ? n - 4 : n), 9, C.ink) + flowerArt(n);

const BACK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">' +
  '<rect x="1.5" y="5.5" width="57" height="73" rx="8" fill="#163f31"/>' +
  '<rect x="1.5" y="1.5" width="57" height="72" rx="8" fill="#2f6e55" stroke="#255a45" stroke-width="1"/>' +
  `<rect x="6" y="6" width="48" height="63" rx="5" fill="none" stroke="${C.gold}" stroke-width="0.9" opacity="0.55"/>` +
  `<rect x="20" y="27" width="9" height="9" rx="2" fill="#f2ecd9"/><rect x="31" y="27" width="9" height="9" rx="2" fill="${C.gold}"/>` +
  `<rect x="20" y="38" width="9" height="9" rx="2" fill="${C.gold}"/><rect x="31" y="38" width="9" height="9" rx="2" fill="#f2ecd9"/>` +
  '</svg>';
const GHOST_MARK = '<circle cx="49" cy="11" r="7.5" fill="#d99a1e" stroke="#fff8e6" stroke-width="1.4"/>' + txt(49, 11.3, '鬼', 9, '#ffffff');
const DEALER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18.5" fill="#d9a63a"/><circle cx="20" cy="20" r="15.5" fill="#b8262b"/><circle cx="20" cy="20" r="13.8" fill="none" stroke="#f3d18a" stroke-width="0.8"/>' + txt(20, 20.5, '莊', 18, '#fff7e6') + '</svg>';

function tileSvg(code: string, ghost: boolean) {
  const s = code.charAt(0), n = Number(code.slice(1));
  let inner = s === 'm' ? man(n) : s === 'p' ? pin(n) : s === 's' ? sou(n) : s === 'z' ? honor(n) : s === 'f' ? flower(n) : '';
  if (ghost) inner += GHOST_MARK;
  return frame(inner);
}
const uri = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">';
/* 侧面两家的牌横着摆：rot=90 牌顶朝右（左边的上家），rot=-90 牌顶朝左（右边的下家） */
function rotate(svg: string, rot: number) {
  if (!rot) return svg;
  const inner = svg.replace(OPEN, '<svg width="60" height="80" viewBox="0 0 60 80">');
  const t = rot === 90 ? 'translate(80 0) rotate(90)' : 'translate(0 60) rotate(-90)';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><g transform="${t}">${inner}</g></svg>`;
}
const cache = new Map<string, string>();
export function tileUrl(code: string, ghost = false, rot = 0) {
  const key = code + (ghost ? '*' : '') + '@' + rot;
  let url = cache.get(key);
  if (!url) { url = uri(rotate(tileSvg(code, ghost), rot)); cache.set(key, url); }
  return url;
}
export const backUrl = uri(BACK);
export function backUrlRot(rot = 0) {
  const key = 'back@' + rot;
  let url = cache.get(key);
  if (!url) { url = uri(rotate(BACK, rot)); cache.set(key, url); }
  return url;
}
export const dealerUrl = uri(DEALER);
export function tileName(code: string | null | undefined) {
  if (!code) return '';
  const s = code.charAt(0), n = Number(code.slice(1));
  if (s === 'm') return NUM[n - 1] + '萬';
  if (s === 'p') return NUM[n - 1] + '筒';
  if (s === 's') return NUM[n - 1] + '条';
  if (s === 'z') return n === 7 ? '白板' : HONOR[n - 1]!;
  if (s === 'f') return FLOWER[n - 1]!;
  return code;
}
