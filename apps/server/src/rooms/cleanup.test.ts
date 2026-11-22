import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {openDatabase,migrate} from '../database/index.js';
import {createApp} from '../app.js';
import {RoomPresence,cleanupRooms,WAITING_IDLE_MS,WAITING_PRESENT_IDLE_MS,PURGE_AFTER_MS,PRESENCE_MS} from './cleanup.js';
const origin='https://board.test',MIN=60000,DAY=86400000;
const headers=(user:string)=>({origin,cookie:`board_session=${user}`});

it('cancels idle waiting tables, honours open pages for one hour, keeps running hands and purges ended tables',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mahjong-cleanup-')),path=join(dir,'db.sqlite');
 const data=openDatabase(path);migrate(data.sqlite);
 for(const user of ['alice','bob','carol','dave']){
  data.sqlite.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at) VALUES(?,?,?,?,?)').run(user,user,user,'unused',Date.now());
  data.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(user).digest('hex'),user,Date.now()+3600000);
 }
 const db=data.sqlite,made=createApp({databasePath:path,origin,production:true,logger:false}),app=made.app;
 const post=(url:string,user:string,payload:object)=>app.inject({method:'POST',url,headers:headers(user),payload});
 const get=(url:string,user:string)=>app.inject({url,headers:headers(user)});
 const age=(code:string,ms:number)=>db.prepare('UPDATE mahjong_rooms SET updated_at=? WHERE code=?').run(Date.now()-ms,code);
 const status=(code:string)=>(db.prepare('SELECT status FROM mahjong_rooms WHERE code=?').get(code) as {status:string}|undefined)?.status;
 const clean=()=>made.cleanupRooms(Date.now());
 try{
  const rooms:string[]=[];for(let i=0;i<3;i++)rooms.push((await post('/api/mahjong-gd/rooms','alice',{})).json().code as string);
  expect((await post('/api/mahjong-gd/rooms','alice',{})).statusCode).toBe(409);
  for(const code of rooms)age(code,WAITING_IDLE_MS-MIN);expect(clean().cancelledWaiting).toBe(0);
  for(const code of rooms)age(code,WAITING_IDLE_MS+MIN);expect(clean().cancelledWaiting).toBe(3);
  expect((await get(`/api/mahjong-gd/rooms/${rooms[0]}`,'alice')).json().status).toBe('cancelled');
  expect((await post(`/api/mahjong-gd/rooms/${rooms[1]}/join`,'bob',{})).statusCode).toBe(409);

  const open=(await post('/api/mahjong-gd/rooms','alice',{})).json().code as string;
  expect((await get(`/api/mahjong-gd/rooms/${open}`,'alice')).statusCode).toBe(200);
  age(open,45*MIN);clean();expect(status(open)).toBe('waiting');
  await get(`/api/mahjong-gd/rooms/${open}`,'alice');age(open,WAITING_PRESENT_IDLE_MS+MIN);clean();expect(status(open)).toBe('cancelled');

  const live=(await post('/api/mahjong-gd/rooms','alice',{})).json().code as string;for(const u of ['bob','carol','dave'])await post(`/api/mahjong-gd/rooms/${live}/join`,u,{});
  for(const u of ['alice','bob','carol','dave']){const v=(await get(`/api/mahjong-gd/rooms/${live}`,u)).json();expect((await post(`/api/mahjong-gd/rooms/${live}/actions`,u,{type:'ready',ready:true,requestId:randomUUID(),expectedVersion:v.version})).statusCode).toBe(200);}
  age(live,2*DAY);clean();expect(status(live)).toBe('playing');

  expect((db.prepare('SELECT count(*) AS n FROM mahjong_seats WHERE room_code=?').get(rooms[2]) as {n:number}).n).toBe(1);
  age(rooms[2]!,PURGE_AFTER_MS+MIN);age(rooms[1]!,PURGE_AFTER_MS-60*MIN);
  expect(clean().purged).toBe(1);
  expect(status(rooms[2]!)).toBeUndefined();expect((db.prepare('SELECT count(*) AS n FROM mahjong_seats WHERE room_code=?').get(rooms[2]) as {n:number}).n).toBe(0);
  expect(status(rooms[1]!)).toBe('cancelled');expect(status(live)).toBe('playing');
 }finally{await app.close();db.close();if(dirname(dir)===tmpdir()&&basename(dir).startsWith('mahjong-cleanup-'))rmSync(dir,{recursive:true,force:true});}
});

it('treats only successful member reads of a table as presence',()=>{
 const p=new RoomPresence(),t=1_000_000;
 p.record('GET','/api/mahjong-gd/rooms/0123456789',200,t);expect(p.present('mahjong-gd','0123456789',t+PRESENCE_MS)).toBe(true);expect(p.present('mahjong-gd','0123456789',t+PRESENCE_MS+1)).toBe(false);
 p.record('GET','/api/mahjong-gd/rooms/ABCDEF0123',404,t);p.record('POST','/api/mahjong-gd/rooms/ABCDEF0123/actions',200,t);expect(p.present('mahjong-gd','ABCDEF0123',t)).toBe(false);
});

it('does not fail on an empty database',()=>{
 const {sqlite}=openDatabase(':memory:');migrate(sqlite);
 try{expect(cleanupRooms(sqlite,Date.now(),new RoomPresence())).toEqual({cancelledWaiting:0,abandoned:0,purged:0});}finally{sqlite.close();}
});
