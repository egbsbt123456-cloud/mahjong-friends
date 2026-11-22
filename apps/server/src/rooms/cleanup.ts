import type Database from 'better-sqlite3';

/**
 * 好友房间统一清理（2026-11-22 用户确认的规则）：
 *  - 等待中的房间：页面都关着时 30 分钟无操作取消；有人开着页面时 1 小时无操作也取消。
 *  - 进行中的对局不作废：麻将有每步服务器计时和托管，四家都托管 60 秒会自己关房。
 *  - 已结束 / 已取消的房间：1 天后连同座位、请求记录一起删除（外键 ON DELETE CASCADE）。
 * “操作”以房间表 updated_at 为准：建房、加入、准备、走子、离桌等都会更新它，页面轮询不会。
 * “开着页面”由内存心跳判断（成员读取房间成功即记一次），不写数据库；服务重启后清空，
 * 等于所有等待房间从重启时起按 30 分钟重新计。
 */
export const WAITING_IDLE_MS = 30 * 60 * 1000;
export const WAITING_PRESENT_IDLE_MS = 60 * 60 * 1000;
export const PRESENCE_MS = 90 * 1000;
export const PLAYING_IDLE_MS = 24 * 60 * 60 * 1000;
export const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

type State = Record<string, unknown> & { version?: number };
interface Spec {
  game: string;          // 与 /api/<game>/rooms 的路径一致
  table: string;
  stateVersion: boolean; // 房间 version 列是否与 state.version 保持一致
  cancelWaiting(state: State): State;
  abandon?(state: State): State;
}
export const ROOM_SPECS: Spec[] = [
  { game: 'mahjong-gd', table: 'mahjong_rooms', stateVersion: false, cancelWaiting: s => s },
];
const GAMES = new Set(ROOM_SPECS.map(s => s.game));
const ROOM_PATH = /^\/api\/([a-z-]+)\/rooms\/([A-F0-9]{10})(?:[?#]|$)/;

/** 内存心跳：记录每个房间最近一次被成员成功读取的时间。 */
export class RoomPresence {
  private seen = new Map<string, number>();
  touch(game: string, code: string, at: number) { this.seen.set(`${game}:${code}`, at); }
  /** 由 onResponse 钩子调用：只有成员能拿到 200，所以 200 的 GET 即代表有人开着这个房间。 */
  record(method: string, url: string, statusCode: number, at: number) {
    if (method !== 'GET' || statusCode !== 200) return;
    const m = ROOM_PATH.exec(url);
    if (m && GAMES.has(m[1]!)) this.touch(m[1]!, m[2]!, at);
  }
  present(game: string, code: string, now: number) { const t = this.seen.get(`${game}:${code}`); return t !== undefined && now - t <= PRESENCE_MS; }
  prune(now: number) { for (const [k, t] of this.seen) if (now - t > WAITING_PRESENT_IDLE_MS) this.seen.delete(k); }
  forget(game: string, code: string) { this.seen.delete(`${game}:${code}`); }
}

export interface CleanupResult { cancelledWaiting: number; abandoned: number; purged: number }
type Row = { code: string; status: string; state: string; version: number; updated_at: number };

export function cleanupRooms(db: Database.Database, now: number, presence: RoomPresence): CleanupResult {
  const result: CleanupResult = { cancelledWaiting: 0, abandoned: 0, purged: 0 };
  for (const spec of ROOM_SPECS) {
    db.transaction(() => {
      const stale = db.prepare(`SELECT code,status,state,version,updated_at FROM ${spec.table} WHERE (status='waiting' AND updated_at<?) OR (status='playing' AND updated_at<?) LIMIT 1000`)
        .all(now - WAITING_IDLE_MS, now - PLAYING_IDLE_MS) as Row[];
      const save = db.prepare(`UPDATE ${spec.table} SET status='cancelled',state=?,version=?,updated_at=? WHERE code=? AND status=? AND updated_at=?`);
      for (const room of stale) {
        let next: State;
        if (room.status === 'waiting') {
          if (presence.present(spec.game, room.code, now) && now - room.updated_at < WAITING_PRESENT_IDLE_MS) continue;
          next = spec.cancelWaiting(JSON.parse(room.state) as State);
        } else {
          if (!spec.abandon) continue;
          next = spec.abandon(JSON.parse(room.state) as State);
        }
        const version = spec.stateVersion ? (next.version as number) : room.version + 1;
        // 条件更新：若同一时刻有人操作了房间（updated_at 已变），本次跳过
        const changed = save.run(JSON.stringify(next), version, now, room.code, room.status, room.updated_at).changes;
        if (changed) { if (room.status === 'waiting') result.cancelledWaiting++; else result.abandoned++; presence.forget(spec.game, room.code); }
      }
      result.purged += db.prepare(`DELETE FROM ${spec.table} WHERE status IN ('finished','cancelled') AND updated_at<?`).run(now - PURGE_AFTER_MS).changes;
    })();
  }
  presence.prune(now);
  return result;
}
