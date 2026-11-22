import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function openDatabase(path:string){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const sqlite=new Database(path);sqlite.pragma('foreign_keys=ON');sqlite.pragma('journal_mode=WAL');sqlite.pragma('busy_timeout=5000');return {sqlite};
}
export function migrate(sqlite:Database.Database){
 sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
 sqlite.transaction(()=>{
  if(sqlite.prepare('SELECT version FROM schema_migrations WHERE version=1').get())return;
  sqlite.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL);
  CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
  CREATE INDEX sessions_expiry ON sessions(expires_at);
  CREATE TABLE mahjong_rooms(code TEXT PRIMARY KEY,host_seat INTEGER NOT NULL,status TEXT NOT NULL,settings TEXT NOT NULL,state TEXT NOT NULL,hand_no INTEGER NOT NULL DEFAULT 0,dealer INTEGER,version INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX mahjong_status ON mahjong_rooms(status);
  CREATE TABLE mahjong_seats(room_code TEXT NOT NULL REFERENCES mahjong_rooms(code) ON DELETE CASCADE,seat INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),ready INTEGER NOT NULL DEFAULT 0,last_seen INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_code,seat),UNIQUE(room_code,user_id));
  CREATE INDEX mahjong_seats_user ON mahjong_seats(user_id);
  CREATE TABLE mahjong_requests(room_code TEXT NOT NULL REFERENCES mahjong_rooms(code) ON DELETE CASCADE,request_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,PRIMARY KEY(room_code,request_id));`);
  sqlite.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(new Date().toISOString());
 })();
}
