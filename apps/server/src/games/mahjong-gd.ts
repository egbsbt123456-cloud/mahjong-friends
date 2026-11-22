import { randomBytes, randomInt, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { mahjongEngine as engine } from '@board/game-core';
import type { MahjongRoomView } from '@board/contracts';
import { sessionUser, type SessionUser } from '../auth/session.js';

/* 麻将（广东麻将，好友房）服务端。规则见 docs/game-rules/mahjong-gd.md。
 * 房间状态：
 *  waiting   等人 / 准备 / 房主改设置；一局结束后也回到 waiting（保留上一局结果供展示，四人重新准备即再来一局）
 *  playing   对局中；服务器每秒处理到期的计时与托管
 *  cancelled 房主取消、没人了，或四座托管 60 秒后关房（本局作废）
 */
type State = ReturnType<typeof engine.start>;
type Room = { code: string; host_seat: number; status: MahjongRoomView['status']; settings: string; state: string; hand_no: number; dealer: number | null; version: number; created_at: number; updated_at: number };
type Seat = { seat: number; user_id: string; ready: number; last_seen: number };
class Refusal extends Error { constructor(public status: number, message: string) { super(message); } }
const codeSchema = z.string().regex(/^[A-F0-9]{10}$/);
const envelope = { requestId: z.uuid(), expectedVersion: z.number().int().nonnegative() };
const tileCode = z.string().regex(/^[mps][1-9]$|^z[1-7]$/);
const tileId = z.number().int().min(0).max(1_000_000);
const settingsInput = z.record(z.string(), z.unknown());
const action = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('settings'), settings: settingsInput }).strict(),
  z.object({ ...envelope, type: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ ...envelope, type: z.literal('leave') }).strict(),
  z.object({ ...envelope, type: z.literal('cancel') }).strict(),
  z.object({ ...envelope, type: z.literal('discard'), tileId }).strict(),
  z.object({ ...envelope, type: z.literal('selfWin') }).strict(),
  z.object({ ...envelope, type: z.literal('concealedKong'), code: tileCode }).strict(),
  z.object({ ...envelope, type: z.literal('addedKong'), code: tileCode }).strict(),
  z.object({ ...envelope, type: z.literal('win') }).strict(),
  z.object({ ...envelope, type: z.literal('pong') }).strict(),
  z.object({ ...envelope, type: z.literal('exposedKong') }).strict(),
  z.object({ ...envelope, type: z.literal('chi'), tiles: z.array(tileId).length(2) }).strict(),
  z.object({ ...envelope, type: z.literal('pass') }).strict(),
  z.object({ ...envelope, type: z.literal('resume') }).strict(),
]);
const ROOM_ACTIONS = new Set(['settings', 'ready', 'leave', 'cancel']);
const SEATS = 4;
const ONLINE_MS = 10000;
// 服务重启前就在进行的对局：停机期间没人能操作，到期时间至少顺延到启动后 15 秒
export const MAHJONG_BOOT_GRACE_MS = 15000;

export function registerMahjong(app: FastifyInstance, db: Database.Database, origin: string, production: boolean, clock: () => number = Date.now, rng: (max: number) => number = randomInt) {
  const bootAt = clock();
  const graced = new Set<string>();
  app.register(async routes => {
    const identities = new WeakMap<FastifyRequest, SessionUser>();
    const limits = new Map<string, { n: number; until: number }>();
    routes.addHook('preHandler', async (req, reply) => {
      if (production && !origin.startsWith('https://')) return reply.code(503).send({ error: '好友同玩需要 HTTPS' });
      const user = sessionUser(db, req.headers.cookie);
      if (!user) return reply.code(401).send({ error: '请先登录，再与好友同玩' });
      identities.set(req, user);
      if (req.method === 'GET') return;
      if (req.headers.origin !== origin) return reply.code(403).send({ error: '请求来源不允许' });
      const now = Date.now();
      for (const [key, v] of limits) if (v.until < now) limits.delete(key);
      if (limits.size >= 10000 && !limits.has(user.id)) return reply.code(429).send({ error: '请求繁忙，请稍后重试' });
      const limit = limits.get(user.id) ?? { n: 0, until: now + 60000 }; limits.set(user.id, limit);
      if (++limit.n > 60) return reply.code(429).send({ error: '操作太频繁，请稍后重试' });
    });
    routes.setErrorHandler((err, req, reply) => {
      if (err instanceof Refusal) return reply.code(err.status).send({ error: err.message });
      req.log.error(err); return reply.code(500).send({ error: '房间服务暂时不可用，请稍后重试' });
    });

    const getRoom = (code: string) => db.prepare('SELECT * FROM mahjong_rooms WHERE code=?').get(code) as Room | undefined;
    const parseCode = (req: FastifyRequest) => { const p = z.object({ code: codeSchema }).safeParse(req.params); if (!p.success) throw new Refusal(400, '请输入10位房间码'); return p.data.code; };
    const seatsOf = (code: string) => db.prepare('SELECT seat,user_id,ready,last_seen FROM mahjong_seats WHERE room_code=? ORDER BY seat').all(code) as Seat[];
    const member = (room: Room | undefined, user: SessionUser): Room => { if (!room || !seatsOf(room.code).some(s => s.user_id === user.id)) throw new Refusal(404, '房间不存在，或你尚未加入'); return room; };
    const touch = (code: string, userId: string) => db.prepare('UPDATE mahjong_seats SET last_seen=? WHERE room_code=? AND user_id=?').run(clock(), code, userId);
    const nickname = (id: string) => (db.prepare('SELECT nickname FROM users WHERE id=?').get(id) as { nickname: string } | undefined)?.nickname ?? '玩家';
    const unready = (code: string) => db.prepare('UPDATE mahjong_seats SET ready=0 WHERE room_code=?').run(code);
    const parseState = (room: Room) => JSON.parse(room.state) as State | null;

    // 保存对局状态，并按对局阶段换算房间状态；调用方须在事务内
    function saveGame(room: Room, state: State, now: number) {
      let status: Room['status'] = 'playing', dealer = room.dealer;
      if (state.phase === 'finished') { status = 'waiting'; dealer = engine.nextDealer(state); unready(room.code); }
      else if (state.phase === 'void') status = 'cancelled';
      db.prepare('UPDATE mahjong_rooms SET state=?,status=?,dealer=?,version=version+1,updated_at=? WHERE code=?').run(JSON.stringify(state), status, dealer, now, room.code);
    }

    // 处理到期事项（出牌超时托管、响应超时、托管座位出牌、四座托管关房）；调用方须在事务内
    function advanceRoom(room: Room): Room {
      if (room.status !== 'playing') return room;
      const now = clock();
      let state = parseState(room)!, graceChanged = false;
      // 启动后第一次碰到的进行中对局一定是停机前开的（启动后开的局在开局时就登记了）
      if (!graced.has(room.code)) {
        graced.add(room.code);
        const until = bootAt + MAHJONG_BOOT_GRACE_MS;
        if (state.deadline !== null && state.deadline < until) { state.deadline = until; graceChanged = true; }
        if (state.allHostedSince !== null && state.allHostedSince < bootAt) { state.allHostedSince = bootAt; graceChanged = true; }
      }
      const result = engine.advance(state, now);
      if (!result.changed && !graceChanged) return room;
      state = result.state;
      saveGame(room, state, now);
      return getRoom(room.code)!;
    }
    const timer = setInterval(() => {
      try {
        const due = db.prepare("SELECT code FROM mahjong_rooms WHERE status='playing' LIMIT 200").all() as { code: string }[];
        for (const { code } of due) {
          try { db.transaction(() => { const room = getRoom(code); if (room) advanceRoom(room); })(); }
          catch (error) { app.log.error({ err: error, room: code }, '麻将计时处理失败'); }
        }
      } catch (error) { app.log.error(error); }
    }, 1000);
    timer.unref();
    routes.addHook('onClose', async () => { clearInterval(timer); });

    const view = (room: Room, user: SessionUser): MahjongRoomView => {
      const seats = seatsOf(room.code), mine = seats.find(s => s.user_id === user.id)!, now = clock(), state = parseState(room);
      const playing = !!state && state.phase === 'playing';
      return {
        code: room.code, hostSeat: room.host_seat, status: room.status, version: room.version, serverNow: now,
        yourSeat: mine.seat, handNo: room.hand_no, dealer: room.dealer, settings: JSON.parse(room.settings),
        seats: seats.map(s => ({ seat: s.seat, name: nickname(s.user_id), ready: !!s.ready, online: now - s.last_seen < ONLINE_MS, hosted: playing && !!state!.seats[s.seat]!.hosted })),
        game: state ? engine.view(state, mine.seat) : null,
        updatedAt: room.updated_at,
      };
    };
    const checkActive = (user: SessionUser) => { const n = db.prepare("SELECT count(*) AS n FROM mahjong_rooms r JOIN mahjong_seats s ON r.code=s.room_code WHERE s.user_id=? AND r.status IN ('waiting','playing')").get(user.id) as { n: number }; if (n.n >= 3) throw new Refusal(409, '已有3个未结束房间，请先结束或退出'); };
    const normalized = (input: unknown) => { const r = engine.normalizeSettings(input); if (r.error) throw new Refusal(400, r.error); return r.settings; };

    routes.get('/rooms', req => {
      const user = identities.get(req)!;
      const rooms = db.prepare("SELECT r.* FROM mahjong_rooms r JOIN mahjong_seats s ON r.code=s.room_code WHERE s.user_id=? AND r.status!='cancelled' ORDER BY r.updated_at DESC LIMIT 6").all(user.id) as Room[];
      return { rooms: rooms.map(r => view(r, user)) };
    });
    routes.post('/rooms', (req, reply) => {
      const parsed = z.object({ settings: settingsInput.optional() }).strict().safeParse(req.body ?? {}); if (!parsed.success) throw new Refusal(400, '建房参数不正确');
      const settings = normalized(parsed.data.settings ?? {}), user = identities.get(req)!;
      return reply.code(201).send(db.transaction(() => {
        checkActive(user);
        const recent = db.prepare("SELECT count(*) AS n FROM mahjong_requests q JOIN mahjong_rooms r ON r.code=q.room_code WHERE q.user_id=? AND q.request_id='created' AND r.created_at>?").get(user.id, Date.now() - 3600000) as { n: number };
        if (recent.n >= 20) throw new Refusal(429, '本小时建房较多，请稍后重试');
        let code: string; do { code = randomBytes(5).toString('hex').toUpperCase(); } while (getRoom(code)); const now = Date.now();
        db.prepare("INSERT INTO mahjong_rooms VALUES(?,0,'waiting',?,'null',0,NULL,0,?,?)").run(code, JSON.stringify(settings), now, now);
        db.prepare('INSERT INTO mahjong_seats VALUES(?,0,?,0,?)').run(code, user.id, clock());
        db.prepare("INSERT INTO mahjong_requests VALUES(?,'created',?,'')").run(code, user.id);
        return view(getRoom(code)!, user);
      })());
    });
    routes.get('/rooms/:code', req => {
      const code = parseCode(req), user = identities.get(req)!;
      return db.transaction(() => { member(getRoom(code), user); touch(code, user.id); return view(advanceRoom(getRoom(code)!), user); })();
    });
    routes.post('/rooms/:code/join', req => {
      if (!z.object({}).strict().safeParse(req.body ?? {}).success) throw new Refusal(400, '加入参数不正确');
      const code = parseCode(req), user = identities.get(req)!;
      return db.transaction(() => {
        const room = getRoom(code); if (!room) throw new Refusal(404, '没有找到这个房间'); const seats = seatsOf(code);
        if (seats.some(s => s.user_id === user.id)) { touch(code, user.id); return view(room, user); }
        if (room.status !== 'waiting' || seats.length >= SEATS) throw new Refusal(409, '房间已满或已经开局'); checkActive(user);
        const seat = [0, 1, 2, 3].find(n => !seats.some(s => s.seat === n))!;
        db.prepare('INSERT INTO mahjong_seats VALUES(?,?,?,0,?)').run(code, seat, user.id, clock());
        unready(code);
        // 换了人算重新开始：重新随机定庄，清掉上一局结果
        db.prepare("UPDATE mahjong_rooms SET dealer=NULL,state='null',version=version+1,updated_at=? WHERE code=?").run(Date.now(), code);
        return view(getRoom(code)!, user);
      })();
    });
    routes.post('/rooms/:code/actions', req => {
      const parsed = action.safeParse(req.body); if (!parsed.success) throw new Refusal(400, '操作参数不正确');
      const input = parsed.data, code = parseCode(req), user = identities.get(req)!;
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      return db.transaction(() => {
        const found = getRoom(code);
        const old = db.prepare('SELECT user_id,fingerprint FROM mahjong_requests WHERE room_code=? AND request_id=?').get(code, input.requestId) as { user_id: string; fingerprint: string } | undefined;
        if (old) { if (old.user_id !== user.id || old.fingerprint !== fingerprint) throw new Refusal(409, '请求编号已使用'); if (input.type === 'leave') return { left: true }; return view(member(found, user), user); }
        member(found, user); touch(code, user.id);
        const room = advanceRoom(getRoom(code)!), mine = seatsOf(code).find(s => s.user_id === user.id)!;
        // 「我回来了」不检查版本：托管座位每秒都在出牌，版本号变化很快；收回托管本身不依赖牌面
        if (input.type !== 'resume' && input.expectedVersion !== room.version) throw new Refusal(409, '牌局已更新，请同步后重试');
        const now = clock(), stamp = Date.now();
        if (ROOM_ACTIONS.has(input.type)) {
          if (room.status !== 'waiting') throw new Refusal(409, '对局进行中，不能这样做');
          let host = room.host_seat, status: Room['status'] = room.status, settings = room.settings, state = room.state, dealer = room.dealer, handNo = room.hand_no;
          if (input.type === 'settings') {
            if (mine.seat !== host) throw new Refusal(409, '只有房主可以修改规则');
            settings = JSON.stringify(normalized(input.settings)); unready(code);
          } else if (input.type === 'cancel') {
            if (mine.seat !== host) throw new Refusal(409, '只有房主可以取消房间'); status = 'cancelled';
          } else if (input.type === 'leave') {
            db.prepare('DELETE FROM mahjong_seats WHERE room_code=? AND seat=?').run(code, mine.seat);
            const remaining = seatsOf(code); if (!remaining.length) status = 'cancelled'; else if (mine.seat === host) host = remaining[0]!.seat;
            unready(code); dealer = null; state = 'null';
          } else if (input.type === 'ready') {
            db.prepare('UPDATE mahjong_seats SET ready=? WHERE room_code=? AND seat=?').run(input.ready ? 1 : 0, code, mine.seat);
            const current = seatsOf(code);
            if (current.length === SEATS && current.every(s => s.ready)) {
              handNo += 1;
              const started = engine.start(JSON.parse(settings), dealer, rng, now, handNo);
              dealer = started.dealer; state = JSON.stringify(started); status = 'playing'; graced.add(code);
              unready(code);
              db.prepare('UPDATE mahjong_seats SET last_seen=? WHERE room_code=?').run(now, code);
            }
          }
          db.prepare('UPDATE mahjong_rooms SET host_seat=?,status=?,settings=?,state=?,dealer=?,hand_no=?,version=version+1,updated_at=? WHERE code=?').run(host, status, settings, state, dealer, handNo, stamp, code);
        } else {
          if (room.status !== 'playing') throw new Refusal(409, '对局尚未开始或已经结束');
          const move: Record<string, unknown> = { ...input }; delete move.requestId; delete move.expectedVersion;
          let next: State;
          try { next = engine.apply(parseState(room)!, mine.seat, move as { type: string }, now); }
          catch (e) { if (e instanceof Error && (e as Error & { mahjong?: boolean }).mahjong) throw new Refusal(409, e.message); throw e; }
          saveGame(room, next, stamp);
        }
        db.prepare('INSERT INTO mahjong_requests VALUES(?,?,?,?)').run(code, input.requestId, user.id, fingerprint);
        if (input.type === 'leave') return { left: true };
        return view(getRoom(code)!, user);
      })();
    });
  }, { prefix: '/api/mahjong-gd' });
}
