/* 麻将（广东麻将，好友房）规则引擎 —— 纯逻辑：不依赖 HTTP、数据库、Vue 或计时器
 * Node：module.exports；浏览器/测试：globalThis.MahjongGd
 * ruleVersion gd-1.0，规则见 docs/game-rules/mahjong-gd.md
 *
 * 所有对外函数都不修改传入的 state，而是返回新状态。
 * rng(n) 返回 [0, n) 的整数：生产环境传 crypto.randomInt，测试可注入确定性序列。
 * 牌墙顺序、别人的手牌、别人的响应选项只存在服务器状态中，view() 不输出。
 *
 * 牌编码：m1-m9 萬，p1-p9 筒，s1-s9 条，z1-z7 東南西北中發白，f1-f8 春夏秋冬梅蘭竹菊
 * 内部用 0-33 的下标做计数：萬 0-8，筒 9-17，条 18-26，字 27-33。
 */
(function (root) {
  'use strict';

  var RULES_VERSION = 'gd-1.0';
  var SEATS = 4;
  var RESPONSE_MS = 10000;      // 吃碰杠胡响应窗口上限
  var HOSTED_STEP_MS = 1000;    // 托管座位每步间隔（只为显示节奏）
  var ALL_HOSTED_MS = 60000;    // 四座都托管后多久关房
  var MAX_EVENTS = 40;
  var TURN_SECONDS = [15, 30, 60];
  var PATTERN_KEYS = ['chicken', 'pinghu', 'pengpeng', 'qidui', 'shisanyao', 'qingyise', 'hunyise',
    'dasanyuan', 'xiaosanyuan', 'dasixi', 'xiaosixi', 'tianhu', 'dihu'];
  var PATTERN_NAMES = {
    chicken: '鸡胡', pinghu: '平胡', pengpeng: '碰碰胡', qidui: '七小对', shisanyao: '十三幺',
    qingyise: '清一色', hunyise: '混一色', dasanyuan: '大三元', xiaosanyuan: '小三元',
    dasixi: '大四喜', xiaosixi: '小四喜', tianhu: '天胡', dihu: '地胡'
  };
  // 字牌关闭时强制关闭的牌型
  var HONOR_PATTERNS = ['shisanyao', 'dasanyuan', 'xiaosanyuan', 'dasixi', 'xiaosixi', 'hunyise'];
  // 鸡胡关闭时，能作为胡牌条件的牌型（天胡、地胡只是时机）
  var SHAPE_PATTERNS = ['pinghu', 'pengpeng', 'qidui', 'shisanyao', 'qingyise', 'hunyise',
    'dasanyuan', 'xiaosanyuan', 'dasixi', 'xiaosixi'];
  var BOOL_KEYS = ['honors', 'flowers', 'chi', 'pong', 'exposedKong', 'concealedKong', 'addedKong',
    'selfDraw', 'discardWin', 'robKong'];

  function fail(message) { var e = new Error(message); e.mahjong = true; throw e; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ======================= 牌 ======================= */

  var SUITS = ['m', 'p', 's'];
  var TERMINALS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  function idx(code) {
    var s = code.charAt(0), n = Number(code.slice(1));
    if (s === 'm') return n - 1;
    if (s === 'p') return 8 + n;
    if (s === 's') return 17 + n;
    if (s === 'z') return 26 + n;
    return -1; // 花牌
  }
  function codeOf(i) {
    if (i < 27) return SUITS[Math.floor(i / 9)] + (i % 9 + 1);
    return 'z' + (i - 26);
  }
  function isFlower(code) { return code.charAt(0) === 'f'; }
  function validCode(code) { var i = idx(code), n = Number(code.slice(1)); return typeof code === 'string' && /^[mpszf][1-9]$/.test(code) && (isFlower(code) ? n <= 8 : i >= 0 && i < 34); }
  function suitOf(i) { return i < 27 ? Math.floor(i / 9) : 3; } // 3 = 字
  function sortKey(code) { return isFlower(code) ? 100 + Number(code.slice(1)) : idx(code); }
  function sortTiles(tiles) {
    return tiles.slice().sort(function (a, b) { return sortKey(a.code) - sortKey(b.code) || a.id - b.id; });
  }

  // 翻牌的下一张为鬼
  function nextGhost(code) {
    var s = code.charAt(0), n = Number(code.slice(1));
    if (s === 'm' || s === 'p' || s === 's') return s + (n === 9 ? 1 : n + 1);
    if (s === 'z' && n <= 4) return 'z' + (n === 4 ? 1 : n + 1);
    if (s === 'z') return 'z' + (n === 7 ? 5 : n + 1);
    fail('花牌不能做翻牌');
  }

  function buildDeck(settings) {
    var codes = [], i, k;
    for (i = 0; i < (settings.honors ? 34 : 27); i++) { for (k = 0; k < 4; k++) codes.push(codeOf(i)); }
    if (settings.honors && settings.flowers) { for (i = 1; i <= 8; i++) codes.push('f' + i); }
    return codes.map(function (c, n) { return { id: n, code: c }; });
  }

  function shuffle(list, rng) {
    for (var i = list.length - 1; i > 0; i--) { var j = rng(i + 1), t = list[i]; list[i] = list[j]; list[j] = t; }
    return list;
  }

  /* ======================= 设置 ======================= */

  function defaultSettings() {
    var p = {};
    PATTERN_KEYS.forEach(function (k) { p[k] = true; });
    return {
      honors: true, flowers: false, chi: true, pong: true, exposedKong: true, concealedKong: true, addedKong: true,
      selfDraw: true, discardWin: true, robKong: true, ghost: 'none', patterns: p, turnSeconds: 30
    };
  }

  // 把输入整理成合法设置：自动关闭互斥项（第 2.1 节第 1、3、4 条），
  // 不能自动修正的（第 2、5 条）返回 error。
  function normalizeSettings(input) {
    var d = defaultSettings(), s = clone(d), src = input && typeof input === 'object' ? input : {};
    BOOL_KEYS.forEach(function (k) { if (src[k] !== undefined) { if (typeof src[k] !== 'boolean') return; s[k] = src[k]; } });
    if (src.ghost !== undefined) s.ghost = src.ghost;
    if (src.turnSeconds !== undefined) s.turnSeconds = src.turnSeconds;
    if (src.patterns && typeof src.patterns === 'object') {
      PATTERN_KEYS.forEach(function (k) { if (typeof src.patterns[k] === 'boolean') s.patterns[k] = src.patterns[k]; });
    }
    var error = null;
    BOOL_KEYS.forEach(function (k) { if (src[k] !== undefined && typeof src[k] !== 'boolean') error = '设置格式不正确'; });
    if (['none', 'red', 'flip'].indexOf(s.ghost) < 0) error = '鬼牌只能选无鬼、红中鬼或翻鬼';
    if (TURN_SECONDS.indexOf(s.turnSeconds) < 0) error = '每步限时只能选 15、30 或 60 秒';
    if (!s.honors) {
      s.flowers = false;
      HONOR_PATTERNS.forEach(function (k) { s.patterns[k] = false; });
      if (s.ghost === 'red') s.ghost = 'none';
    }
    if (!s.addedKong || !s.discardWin) s.robKong = false;
    if (!error && !s.selfDraw && !s.discardWin) error = '自摸胡和点炮胡至少要开一个';
    if (!error && !s.patterns.chicken && !SHAPE_PATTERNS.some(function (k) { return s.patterns[k]; })) {
      error = '关闭鸡胡后，至少要开一种能胡的牌型';
    }
    return { settings: s, error: error };
  }

  function parseSettings(input) {
    var r = normalizeSettings(input);
    if (r.error) fail(r.error);
    return r.settings;
  }

  /* ======================= 胡牌判定 ======================= */

  // counts：34 格计数（不含鬼），w：可当任意牌的鬼数，sets：还要拆出的组数，pair：是否还要一对
  // allow(i)：限定能用的牌；chow/pung：允许的组类型
  function canDecompose(counts, w, sets, pair, opt) {
    var i = 0;
    while (i < 34 && counts[i] === 0) i++;
    if (i === 34) return w === sets * 3 + (pair ? 2 : 0) && (w === 0 || opt.anyAllowed);
    if (!opt.allow(i)) return false;
    var c = counts[i];
    // 做将
    if (pair) {
      var usePair = Math.min(2, c), needW = 2 - usePair;
      if (needW <= w) {
        counts[i] -= usePair;
        var ok = canDecompose(counts, w - needW, sets, false, opt);
        counts[i] += usePair;
        if (ok) return true;
      }
    }
    if (sets === 0) return false;
    // 刻子
    if (opt.pung) {
      var usePung = Math.min(3, c), needP = 3 - usePung;
      if (needP <= w) {
        counts[i] -= usePung;
        var okP = canDecompose(counts, w - needP, sets - 1, pair, opt);
        counts[i] += usePung;
        if (okP) return true;
      }
    }
    // 顺子：i 是剩下最小的牌，可在顺子的第 1、2、3 位
    if (opt.chow && i < 27) {
      var base = Math.floor(i / 9) * 9, pos = i - base;
      for (var start = pos - 2; start <= pos; start++) {
        if (start < 0 || start > 6) continue;
        var need = 0, used = [];
        var good = true;
        for (var k = 0; k < 3; k++) {
          var t = base + start + k;
          if (t === i) { used.push(t); continue; }
          if (t < i) { need++; continue; } // 比 i 小的牌已经没有了，只能用鬼
          if (!opt.allow(t)) { good = false; break; }
          if (counts[t] > 0) used.push(t); else need++;
        }
        if (!good || need > w) continue;
        used.forEach(function (t2) { counts[t2]--; });
        var okC = canDecompose(counts, w - need, sets - 1, pair, opt);
        used.forEach(function (t2) { counts[t2]++; });
        if (okC) return true;
      }
    }
    return false;
  }

  function fullOpt(extra) {
    var o = { allow: function () { return true; }, chow: true, pung: true, anyAllowed: true };
    for (var k in extra) o[k] = extra[k];
    return o;
  }

  // 拿走一组指定的刻子（先看副露，再用手牌 + 鬼）；返回剩余所需的组数，失败返回 -1
  function takePung(ctx, i) {
    for (var m = 0; m < ctx.meldPungs.length; m++) {
      if (ctx.meldPungs[m] === i) { ctx.meldPungs.splice(m, 1); return true; }
    }
    if (ctx.sets <= 0) return false;
    var use = Math.min(3, ctx.counts[i]), need = 3 - use;
    if (need > ctx.w) return false;
    ctx.counts[i] -= use; ctx.w -= need; ctx.sets -= 1;
    return true;
  }
  function takePair(ctx, i) {
    if (!ctx.pair) return false;
    var use = Math.min(2, ctx.counts[i]), need = 2 - use;
    if (need > ctx.w) return false;
    ctx.counts[i] -= use; ctx.w -= need; ctx.pair = false;
    return true;
  }

  function seven(counts, w, allow) {
    var singles = 0, total = w;
    for (var i = 0; i < 34; i++) {
      if (counts[i] && !allow(i)) return false;
      singles += counts[i] % 2; total += counts[i];
    }
    return total === 14 && singles <= w;
  }

  function thirteen(counts, w) {
    var hasPair = false;
    for (var i = 0; i < 34; i++) {
      if (!counts[i]) continue;
      if (TERMINALS.indexOf(i) < 0 || counts[i] > 2) return false;
      if (counts[i] === 2) { if (hasPair) return false; hasPair = true; }
    }
    var total = w; for (var j = 0; j < 34; j++) total += counts[j];
    return total === 14;
  }

  /* hand：手里的牌（含要胡的那张），每项 {code, wild} 或 code 字符串
   * melds：副露 [{kind, codes}]
   * opts：{ ghost, settings, timing: 'tianhu'|'dihu'|null }
   * 返回 { win: bool, form: 'standard'|'qidui'|'shisanyao'|null, patterns: [键], names: [中文] }
   */
  function analyzeWin(hand, melds, opts) {
    var settings = opts.settings, P = settings.patterns;
    var counts = new Array(34).fill(0), w = 0, real = [];
    hand.forEach(function (t) {
      var code = typeof t === 'string' ? t : t.code;
      var wild = typeof t === 'string' ? (opts.ghost && code === opts.ghost) : !!t.wild;
      if (isFlower(code)) fail('花牌不能留在手里');
      if (!validCode(code)) fail('未知的牌：' + code);
      if (wild) { w++; } else { counts[idx(code)]++; real.push(idx(code)); }
    });
    melds = melds || [];
    var meldCodes = [];
    melds.forEach(function (m) { m.codes.forEach(function (c) { meldCodes.push(idx(c)); }); });
    var sets = 4 - melds.length;
    var none = { win: false, form: null, patterns: [], names: [] };
    if (hand.length !== sets * 3 + 2) return none;

    var meldChows = melds.filter(function (m) { return m.kind === 'chi'; }).length;
    var meldPungs = melds.filter(function (m) { return m.kind !== 'chi'; }).map(function (m) { return idx(m.codes[0]); });
    var allCodes = real.concat(meldCodes);
    var anyHonor = allCodes.some(function (i) { return i >= 27; });

    function standard(allow, chow, pung) {
      return canDecompose(counts.slice(), w, sets, true, fullOpt({ allow: allow, chow: chow, pung: pung }));
    }
    var yes = function () { return true; };
    var formStd = standard(yes, true, true);
    var formSeven = melds.length === 0 && seven(counts, w, yes);
    var formThirteen = melds.length === 0 && settings.honors && thirteen(counts, w);

    var hit = {};
    if (formStd && P.pinghu && meldPungs.length === 0 && standard(yes, true, false)) hit.pinghu = true;
    if (formStd && P.pengpeng && meldChows === 0 && standard(yes, false, true)) hit.pengpeng = true;
    if (formSeven && P.qidui) hit.qidui = true;
    if (formThirteen && P.shisanyao) hit.shisanyao = true;

    // 清一色 / 混一色：花色按实际的牌判断，鬼只补位
    var suitsSeen = {};
    allCodes.forEach(function (i) { suitsSeen[suitOf(i)] = true; });
    var numberSuits = [0, 1, 2].filter(function (s) { return suitsSeen[s]; });
    if (numberSuits.length === 1) {
      var su = numberSuits[0];
      var inSuit = function (i) { return suitOf(i) === su; };
      var inSuitOrHonor = function (i) { return suitOf(i) === su || i >= 27; };
      var sevenOk = function (allow) { return melds.length === 0 && P.qidui && seven(counts, w, allow); };
      if (P.qingyise && !anyHonor && (standard(inSuit, true, true) || sevenOk(inSuit))) hit.qingyise = true;
      if (P.hunyise && anyHonor && (standard(inSuitOrHonor, true, true) || sevenOk(inSuitOrHonor))) hit.hunyise = true;
    }

    // 三元 / 四喜
    function withFixed(pungs, pairCode) {
      var ctx = { counts: counts.slice(), w: w, sets: sets, pair: true, meldPungs: meldPungs.slice() };
      for (var k = 0; k < pungs.length; k++) { if (!takePung(ctx, pungs[k])) return false; }
      if (pairCode !== null && !takePair(ctx, pairCode)) return false;
      // 剩下的副露（吃、碰）已经是完整的组；手里还要拆 ctx.sets 组
      return canDecompose(ctx.counts, ctx.w, ctx.sets, ctx.pair, fullOpt({}));
    }
    if (settings.honors && formStd) {
      var D = [31, 32, 33], W = [27, 28, 29, 30];
      if (P.dasanyuan && withFixed(D, null)) hit.dasanyuan = true;
      if (P.xiaosanyuan && D.some(function (pc) { return withFixed(D.filter(function (x) { return x !== pc; }), pc); })) hit.xiaosanyuan = true;
      if (P.dasixi && withFixed(W, null)) hit.dasixi = true;
      if (P.xiaosixi && W.some(function (pc) { return withFixed(W.filter(function (x) { return x !== pc; }), pc); })) hit.xiaosixi = true;
    }

    var shapeHit = SHAPE_PATTERNS.some(function (k) { return hit[k]; });
    var chickenOk = formStd && P.chicken;
    if (!shapeHit && !chickenOk) return none;

    var list = PATTERN_KEYS.filter(function (k) { return hit[k]; });
    if (!list.length) list.push('chicken');
    if (opts.timing === 'tianhu' && P.tianhu) list.push('tianhu');
    if (opts.timing === 'dihu' && P.dihu) list.push('dihu');
    var form = hit.shisanyao ? 'shisanyao' : (hit.qidui ? 'qidui' : (formStd ? 'standard' : (formSeven ? 'qidui' : 'shisanyao')));
    return { win: true, form: form, patterns: list, names: list.map(function (k) { return PATTERN_NAMES[k]; }) };
  }

  /* ======================= 状态工具 ======================= */

  function nextSeat(s) { return (s + 1) % SEATS; }
  function dist(from, to) { return (to - from + SEATS) % SEATS; }
  function turnMs(st) { return st.settings.turnSeconds * 1000; }

  function log(st, ev) {
    st.eventSeq += 1; ev.seq = st.eventSeq;
    if (ev.seat === undefined) ev.seat = null;
    st.events.push(ev);
    if (st.events.length > MAX_EVENTS) st.events.splice(0, st.events.length - MAX_EVENTS);
  }

  function handTiles(st, seat, extra) {
    var list = st.seats[seat].hand.map(function (t) { return { code: t.code, wild: !!st.ghost && t.code === st.ghost }; });
    if (extra) list.push({ code: extra.code, wild: false }); // 别人打出 / 抢杠的牌按牌面算
    return list;
  }
  function meldView(m) { return { kind: m.kind, codes: m.tiles.map(function (t) { return t.code; }) }; }
  function meldsOf(st, seat) { return st.seats[seat].melds.map(meldView); }
  function countCode(hand, code) { return hand.filter(function (t) { return t.code === code; }).length; }
  function takeCode(hand, code, n) {
    var out = [];
    for (var i = hand.length - 1; i >= 0 && out.length < n; i--) { if (hand[i].code === code) out.push(hand.splice(i, 1)[0]); }
    return out;
  }

  function timingFor(st, seat, selfDraw) {
    var me = st.seats[seat];
    if (me.discarded || me.melds.length) return null;
    if (seat === st.dealer) return selfDraw ? 'tianhu' : null;
    return st.claimed ? null : 'dihu';
  }

  function winCheck(st, seat, extraTile, selfDraw) {
    return analyzeWin(handTiles(st, seat, extraTile), meldsOf(st, seat),
      { ghost: st.ghost, settings: st.settings, timing: timingFor(st, seat, selfDraw) });
  }

  function hostedCount(st) { return st.seats.filter(function (x) { return x.hosted; }).length; }

  function setTurn(st, seat, now) {
    st.turn = seat; st.stage = 'discard'; st.response = null;
    st.deadline = now + (st.seats[seat].hosted ? HOSTED_STEP_MS : turnMs(st));
  }

  /* ======================= 摸牌 / 补花 ======================= */

  // 从牌头（fromTail=false）或牌尾摸一张；摸到花自动亮出并从牌尾补。牌墙空了返回 null
  function drawTile(st, seat, fromTail) {
    var tile = fromTail ? st.wall.pop() : st.wall.shift();
    while (tile && isFlower(tile.code)) {
      st.seats[seat].flowers.push(tile);
      log(st, { kind: 'flower', seat: seat, code: tile.code });
      tile = st.wall.pop();
    }
    if (!tile) return null;
    st.seats[seat].hand.push(tile);
    return tile;
  }

  function drawGame(st) {
    st.phase = 'finished'; st.stage = null; st.turn = null; st.deadline = null; st.response = null;
    st.result = { type: 'draw', winner: null, from: null, tile: null, kongFlower: false, patterns: [], names: [] };
    st.allHostedSince = null;
    log(st, { kind: 'drawGame' });
  }

  function giveDraw(st, seat, now, fromTail) {
    if (st.wall.length === 0) { drawGame(st); return; }
    var t = drawTile(st, seat, fromTail);
    if (!t) { drawGame(st); return; }
    var me = st.seats[seat];
    me.passedWin = false;
    st.lastDrawn = t.id; st.drawnFromKong = !!fromTail;
    log(st, { kind: fromTail ? 'kongDraw' : 'draw', seat: seat, left: st.wall.length });
    setTurn(st, seat, now);
  }

  /* ======================= 结束 ======================= */

  function finishWin(st, seat, type, from, tile, analysis, kongFlower) {
    st.phase = 'finished'; st.stage = null; st.turn = null; st.deadline = null; st.response = null;
    st.allHostedSince = null;
    st.result = {
      type: type, winner: seat, from: from, tile: tile ? tile.code : null, kongFlower: !!kongFlower,
      patterns: analysis.patterns, names: analysis.names, form: analysis.form
    };
    log(st, { kind: 'win', seat: seat, type: type, from: from });
  }

  function nextDealer(st) {
    if (!st.result || st.result.type === 'void') return null;
    if (st.result.type === 'draw' || st.result.winner === st.dealer) return st.dealer;
    return nextSeat(st.dealer);
  }

  /* ======================= 合法操作 ======================= */

  function chiOptions(st, seat, tile) {
    var i = idx(tile.code);
    if (i >= 27) return [];
    var hand = st.seats[seat].hand, base = Math.floor(i / 9) * 9, pos = i - base, out = [];
    [[-2, -1], [-1, 1], [1, 2]].forEach(function (d) {
      var a = pos + d[0], b = pos + d[1];
      if (a < 0 || b > 8) return;
      var ca = codeOf(base + a), cb = codeOf(base + b);
      if (countCode(hand, ca) && countCode(hand, cb)) out.push([ca, cb]);
    });
    return out;
  }

  function responseOptions(st, seat, from, tile) {
    var me = st.seats[seat], S = st.settings, o = [];
    if (S.discardWin && !me.passedWin && winCheck(st, seat, tile, false).win) o.push('win');
    var same = countCode(me.hand, tile.code);
    if (S.pong && same >= 2) o.push('pong');
    if (S.exposedKong && same >= 3 && st.wall.length > 0) o.push('exposedKong');
    var chis = S.chi && seat === nextSeat(from) ? chiOptions(st, seat, tile) : [];
    if (chis.length) o.push('chi');
    return { actions: o, chi: chis };
  }

  function turnOptions(st, seat) {
    var me = st.seats[seat], S = st.settings, r = { discard: true, selfWin: false, concealedKongs: [], addedKongs: [] };
    if (S.selfDraw && st.lastDrawn !== null && winCheck(st, seat, null, true).win) r.selfWin = true;
    if (st.wall.length > 0) {
      var seen = {};
      me.hand.forEach(function (t) {
        if (seen[t.code]) return; seen[t.code] = true;
        var n = countCode(me.hand, t.code);
        if (S.concealedKong && n === 4 && t.code !== st.ghost) r.concealedKongs.push(t.code);
        if (S.addedKong && me.melds.some(function (m) { return m.kind === 'pong' && m.tiles[0].code === t.code; })) r.addedKongs.push(t.code);
      });
    }
    return r;
  }

  // 某座位当前能做的事（view 和服务器校验共用）
  function legal(st, seat) {
    var r = { hosted: false, canResume: false, turn: null, response: null };
    if (!st || st.phase !== 'playing' || seat < 0 || seat >= SEATS) return r;
    var me = st.seats[seat];
    r.hosted = me.hosted; r.canResume = me.hosted;
    if (me.hosted) return r;
    if (st.stage === 'discard' && st.turn === seat) r.turn = turnOptions(st, seat);
    if ((st.stage === 'response' || st.stage === 'robKong') && st.response.options[seat] && st.response.choices[seat] === undefined) {
      r.response = clone(st.response.options[seat]);
    }
    return r;
  }

  /* ======================= 响应窗口 ======================= */

  function openResponse(st, kind, from, tile, now) {
    var options = {}, choices = {}, any = false;
    for (var k = 1; k < SEATS; k++) {
      var seat = (from + k) % SEATS, op;
      if (kind === 'discard') op = responseOptions(st, seat, from, tile);
      else {
        var me = st.seats[seat];
        op = { actions: (!me.passedWin && winCheck(st, seat, tile, false).win) ? ['win'] : [], chi: [] };
      }
      if (!op.actions.length) continue;
      any = true;
      options[seat] = op;
      if (st.seats[seat].hosted) choices[seat] = { type: 'pass', auto: true };
    }
    if (!any) return false;
    st.stage = kind === 'discard' ? 'response' : 'robKong';
    st.turn = null;
    st.response = { kind: kind, from: from, tile: tile, options: options, choices: choices };
    st.deadline = now + Math.min(RESPONSE_MS, turnMs(st));
    tryResolve(st, now, false); // 有选项的人全在托管时立刻结算
    return true;
  }

  // 按优先级尝试结算；还要等人就返回 false
  function tryResolve(st, now, force) {
    var R = st.response, from = R.from, order = [];
    for (var k = 1; k < SEATS; k++) { var x = (from + k) % SEATS; if (R.options[x]) order.push(x); }
    function choice(seat) {
      var c = R.choices[seat];
      if (c === undefined && force) { c = R.choices[seat] = { type: 'pass', auto: true }; }
      return c;
    }
    function has(seat, a) { return R.options[seat].actions.indexOf(a) >= 0; }
    var winner = null, i, seat, c;
    for (i = 0; i < order.length; i++) {
      seat = order[i];
      if (!has(seat, 'win')) continue;
      c = choice(seat);
      if (c === undefined) return false;
      if (c.type === 'win') { winner = seat; break; }
    }
    var claim = null;
    if (winner === null && R.kind === 'discard') {
      for (i = 0; i < order.length && !claim; i++) {
        seat = order[i];
        if (!has(seat, 'pong') && !has(seat, 'exposedKong')) continue;
        c = choice(seat);
        if (c === undefined) return false;
        if (c.type === 'pong' || c.type === 'exposedKong') claim = { seat: seat, c: c };
      }
      for (i = 0; i < order.length && !claim; i++) {
        seat = order[i];
        if (!has(seat, 'chi')) continue;
        c = choice(seat);
        if (c === undefined) return false;
        if (c.type === 'chi') claim = { seat: seat, c: c };
      }
    }
    // 记录过胡：能胡却没胡的人
    order.forEach(function (x) {
      if (x !== winner && has(x, 'win')) st.seats[x].passedWin = true;
    });
    var tile = R.tile;
    if (winner !== null) {
      var analysis = winCheck(st, winner, tile, false);
      if (R.kind === 'discard') {
        st.seats[from].river.pop();
        st.seats[winner].hand.push(tile);
        finishWin(st, winner, 'discard', from, tile, analysis, false);
      } else {
        var kh = st.seats[from].hand, at = kh.findIndex(function (t) { return t.id === tile.id; });
        kh.splice(at, 1);
        st.seats[winner].hand.push(tile);
        finishWin(st, winner, 'robKong', from, tile, analysis, false);
      }
      return true;
    }
    if (R.kind === 'robKong') { completeAddedKong(st, from, tile, now); return true; }
    if (claim) { doClaim(st, claim.seat, claim.c, now); return true; }
    st.response = null;
    giveDraw(st, nextSeat(from), now, false);
    return true;
  }

  function doClaim(st, seat, c, now) {
    var R = st.response, tile = R.tile, me = st.seats[seat];
    st.seats[R.from].river.pop();
    st.claimed = true; st.response = null; st.lastDrawn = null; st.drawnFromKong = false;
    if (c.type === 'chi') {
      var picked = c.tiles.map(function (id) { var at = me.hand.findIndex(function (t) { return t.id === id; }); return me.hand.splice(at, 1)[0]; });
      var tiles = sortTiles(picked.concat([tile]));
      me.melds.push({ kind: 'chi', tiles: tiles, from: R.from });
      log(st, { kind: 'chi', seat: seat, from: R.from, codes: tiles.map(function (t) { return t.code; }) });
      setTurn(st, seat, now); return;
    }
    if (c.type === 'pong') {
      me.melds.push({ kind: 'pong', tiles: takeCode(me.hand, tile.code, 2).concat([tile]), from: R.from });
      log(st, { kind: 'pong', seat: seat, from: R.from, code: tile.code });
      setTurn(st, seat, now); return;
    }
    me.melds.push({ kind: 'exposedKong', tiles: takeCode(me.hand, tile.code, 3).concat([tile]), from: R.from });
    log(st, { kind: 'kong', seat: seat, from: R.from, type: 'exposed', code: tile.code });
    giveDraw(st, seat, now, true);
  }

  function completeAddedKong(st, seat, tile, now) {
    var me = st.seats[seat];
    var at = me.hand.findIndex(function (t) { return t.id === tile.id; });
    me.hand.splice(at, 1);
    var m = me.melds.find(function (x) { return x.kind === 'pong' && x.tiles[0].code === tile.code; });
    m.kind = 'addedKong'; m.tiles.push(tile);
    st.claimed = true; st.response = null;
    log(st, { kind: 'kong', seat: seat, type: 'added', code: tile.code });
    giveDraw(st, seat, now, true);
  }

  /* ======================= 行动 ======================= */

  function doDiscard(st, seat, tileId, now, auto) {
    var me = st.seats[seat], at = me.hand.findIndex(function (t) { return t.id === tileId; });
    if (at < 0) fail('这张牌不在你手里');
    var tile = me.hand.splice(at, 1)[0];
    me.river.push(tile); me.discarded = true;
    st.lastDrawn = null; st.drawnFromKong = false;
    st.lastDiscard = { seat: seat, tile: tile };
    log(st, { kind: 'discard', seat: seat, code: tile.code, auto: !!auto });
    if (!openResponse(st, 'discard', seat, tile, now)) giveDraw(st, nextSeat(seat), now, false);
  }

  function autoDiscardId(st, seat) {
    var hand = st.seats[seat].hand;
    if (st.lastDrawn !== null && hand.some(function (t) { return t.id === st.lastDrawn; })) return st.lastDrawn;
    var sorted = sortTiles(hand);
    return sorted[sorted.length - 1].id;
  }

  function doTurnAction(st, seat, a, now) {
    if (st.stage !== 'discard' || st.turn !== seat) fail('还没有轮到你');
    var opt = turnOptions(st, seat), me = st.seats[seat];
    if (a.type === 'discard') { doDiscard(st, seat, a.tileId, now, false); return; }
    if (a.type === 'selfWin') {
      if (!opt.selfWin) fail('现在不能自摸胡');
      var tile = me.hand.find(function (t) { return t.id === st.lastDrawn; });
      finishWin(st, seat, 'selfDraw', null, tile, winCheck(st, seat, null, true), st.drawnFromKong);
      return;
    }
    if (a.type === 'concealedKong') {
      if (opt.concealedKongs.indexOf(a.code) < 0) fail('现在不能暗杠这张牌');
      me.melds.push({ kind: 'concealedKong', tiles: takeCode(me.hand, a.code, 4), from: null });
      st.claimed = true;
      log(st, { kind: 'kong', seat: seat, type: 'concealed' });
      giveDraw(st, seat, now, true); return;
    }
    if (a.type === 'addedKong') {
      if (opt.addedKongs.indexOf(a.code) < 0) fail('现在不能补杠这张牌');
      var kt = me.hand.filter(function (t) { return t.code === a.code; }).pop();
      st.lastDrawn = null;
      log(st, { kind: 'addKongTry', seat: seat, code: a.code });
      if (st.settings.robKong && openResponse(st, 'robKong', seat, kt, now)) return;
      completeAddedKong(st, seat, kt, now); return;
    }
    fail('操作不正确');
  }

  function doResponse(st, seat, a, now) {
    if (st.stage !== 'response' && st.stage !== 'robKong') fail('现在不能响应');
    var op = st.response.options[seat];
    if (!op || st.response.choices[seat] !== undefined) fail('你现在没有可以做的选择');
    if (a.type === 'pass') { st.response.choices[seat] = { type: 'pass' }; }
    else {
      if (op.actions.indexOf(a.type) < 0) fail('现在不能这样做');
      if (a.type === 'chi') {
        var hand = st.seats[seat].hand;
        if (!Array.isArray(a.tiles) || a.tiles.length !== 2 || a.tiles[0] === a.tiles[1]) fail('请选择两张牌来吃');
        var codes = a.tiles.map(function (id) {
          var t = hand.find(function (x) { return x.id === id; });
          if (!t) fail('选中的牌不在你手里');
          return t.code;
        }).sort(function (x, y) { return idx(x) - idx(y); });
        if (!op.chi.some(function (p) { return p[0] === codes[0] && p[1] === codes[1]; })) fail('这两张牌不能吃');
        st.response.choices[seat] = { type: 'chi', tiles: a.tiles.slice() };
      } else {
        st.response.choices[seat] = { type: a.type };
      }
    }
    tryResolve(st, now, false);
  }

  function setHosted(st, seat, now) {
    if (st.seats[seat].hosted) return;
    st.seats[seat].hosted = true;
    log(st, { kind: 'hosted', seat: seat });
    if (hostedCount(st) === SEATS && st.allHostedSince === null) st.allHostedSince = now;
  }

  function doResume(st, seat, now) {
    if (!st.seats[seat].hosted) fail('你没有在托管');
    st.seats[seat].hosted = false;
    st.allHostedSince = null;
    log(st, { kind: 'resume', seat: seat });
    if (st.stage === 'discard' && st.turn === seat) st.deadline = now + turnMs(st);
  }

  /* ======================= 对外接口 ======================= */

  function emptySeat() { return { hand: [], melds: [], flowers: [], river: [], hosted: false, passedWin: false, discarded: false }; }

  // settings 需已通过 parseSettings；dealer 为 null 时随机定庄
  function start(settings, dealer, rng, now, handNo) {
    var S = parseSettings(settings);
    if (dealer === null || dealer === undefined) dealer = rng(SEATS);
    var st = {
      rulesVersion: RULES_VERSION, settings: S, phase: 'playing', handNo: handNo || 1, dealer: dealer,
      wall: shuffle(buildDeck(S), rng), deckSize: 0, ghost: null, indicator: null, setAside: [],
      seats: [emptySeat(), emptySeat(), emptySeat(), emptySeat()],
      turn: null, stage: null, lastDrawn: null, drawnFromKong: false, lastDiscard: null,
      response: null, deadline: null, claimed: false, allHostedSince: null,
      result: null, events: [], eventSeq: 0
    };
    st.deckSize = st.wall.length;
    var k, seat;
    for (k = 0; k < 13; k++) { for (seat = 0; seat < SEATS; seat++) st.seats[(dealer + seat) % SEATS].hand.push(st.wall.shift()); }
    var last = st.wall.shift();
    st.seats[dealer].hand.push(last);
    st.lastDrawn = last.id;
    // 补花：从庄家开始
    for (k = 0; k < SEATS; k++) {
      seat = (dealer + k) % SEATS;
      var me = st.seats[seat], f;
      while ((f = me.hand.findIndex(function (t) { return isFlower(t.code); })) >= 0) {
        var fl = me.hand.splice(f, 1)[0];
        me.flowers.push(fl);
        var rep = st.wall.pop();
        me.hand.push(rep);
        if (seat === dealer && fl.id === st.lastDrawn) st.lastDrawn = rep.id;
      }
    }
    if (S.ghost === 'red') st.ghost = 'z5';
    if (S.ghost === 'flip') {
      var ind = st.wall.pop();
      while (isFlower(ind.code)) { st.setAside.push(ind); ind = st.wall.pop(); }
      st.indicator = ind; st.ghost = nextGhost(ind.code);
    }
    log(st, { kind: 'deal', seat: dealer, ghost: st.ghost });
    setTurn(st, dealer, now);
    return st;
  }

  var TURN_ACTIONS = ['discard', 'selfWin', 'concealedKong', 'addedKong'];
  var RESPONSE_ACTIONS = ['win', 'pong', 'exposedKong', 'chi', 'pass'];

  function apply(state, seat, action, now) {
    var st = clone(state);
    if (!action || typeof action.type !== 'string') fail('操作不正确');
    if (typeof seat !== 'number' || seat < 0 || seat >= SEATS) fail('你不在这局对局中');
    if (st.phase !== 'playing') fail('对局已经结束');
    if (action.type === 'resume') { doResume(st, seat, now); return st; }
    if (st.seats[seat].hosted) fail('托管中，请先点「我回来了」');
    if (TURN_ACTIONS.indexOf(action.type) >= 0) doTurnAction(st, seat, action, now);
    else if (RESPONSE_ACTIONS.indexOf(action.type) >= 0) doResponse(st, seat, action, now);
    else fail('操作不正确');
    return st;
  }

  // 处理到期事项：四座托管关房 → 出牌超时（进托管并打刚摸的牌）→ 响应超时（算过）
  function advance(state, now) {
    var st = clone(state), changed = false, guard = 0;
    while (st.phase === 'playing' && guard++ < 50) {
      if (st.allHostedSince !== null && now >= st.allHostedSince + ALL_HOSTED_MS) {
        st.phase = 'void'; st.stage = null; st.turn = null; st.deadline = null; st.response = null;
        st.result = { type: 'void', winner: null, from: null, tile: null, kongFlower: false, patterns: [], names: [] };
        log(st, { kind: 'void' });
        changed = true; break;
      }
      if (st.deadline === null || now < st.deadline) break;
      changed = true;
      if (st.stage === 'discard') {
        var seat = st.turn;
        if (!st.seats[seat].hosted) setHosted(st, seat, now);
        doDiscard(st, seat, autoDiscardId(st, seat), now, true);
      } else {
        tryResolve(st, now, true);
      }
    }
    return { state: st, changed: changed };
  }

  // 指定座位能看到的内容
  function view(state, seat) {
    var st = state, done = st.phase !== 'playing', me = seat >= 0 && seat < SEATS ? seat : -1;
    function meldFor(m, owner) {
      var hidden = m.kind === 'concealedKong' && owner !== me && !done;
      return { kind: m.kind, from: m.from, codes: hidden ? null : m.tiles.map(function (t) { return t.code; }) };
    }
    var R = st.response;
    return {
      rulesVersion: st.rulesVersion, settings: clone(st.settings), phase: st.phase, handNo: st.handNo,
      dealer: st.dealer, turn: st.turn, stage: st.stage, deadline: st.deadline,
      wallCount: st.wall.length, ghost: st.ghost, indicator: st.indicator ? st.indicator.code : null,
      setAside: st.setAside.map(function (t) { return t.code; }),
      lastDiscard: st.lastDiscard ? { seat: st.lastDiscard.seat, code: st.lastDiscard.tile.code } : null,
      response: R ? { kind: R.kind, from: R.from, code: R.tile.code, waiting: true } : null,
      allHostedSince: st.allHostedSince,
      hand: me >= 0 ? sortTiles(st.seats[me].hand).map(function (t) { return { id: t.id, code: t.code }; }) : [],
      lastDrawn: me >= 0 && st.turn === me ? st.lastDrawn : null,
      legal: legal(st, me),
      players: st.seats.map(function (x, i) {
        return {
          seat: i, handCount: x.hand.length, hosted: x.hosted,
          melds: x.melds.map(function (m) { return meldFor(m, i); }),
          flowers: x.flowers.map(function (t) { return t.code; }),
          river: x.river.map(function (t) { return t.code; }),
          hand: done ? sortTiles(x.hand).map(function (t) { return t.code; }) : null
        };
      }),
      result: st.result ? clone(st.result) : null,
      events: clone(st.events)
    };
  }

  var MahjongGd = {
    RULES_VERSION: RULES_VERSION, RESPONSE_MS: RESPONSE_MS, HOSTED_STEP_MS: HOSTED_STEP_MS, ALL_HOSTED_MS: ALL_HOSTED_MS,
    PATTERN_KEYS: PATTERN_KEYS, PATTERN_NAMES: PATTERN_NAMES,
    idx: idx, codeOf: codeOf, nextGhost: nextGhost, buildDeck: buildDeck, sortTiles: sortTiles,
    defaultSettings: defaultSettings, normalizeSettings: normalizeSettings, parseSettings: parseSettings,
    analyzeWin: analyzeWin, start: start, apply: apply, advance: advance, legal: legal, view: view, nextDealer: nextDealer
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = MahjongGd; }
  root.MahjongGd = MahjongGd;
})(typeof window !== 'undefined' ? window : globalThis);
