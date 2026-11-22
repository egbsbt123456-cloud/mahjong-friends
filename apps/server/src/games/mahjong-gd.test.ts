import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {openDatabase,migrate} from '../database/index.js';
import {createApp} from '../app.js';
import {MAHJONG_BOOT_GRACE_MS} from './mahjong-gd.js';
import {WAITING_IDLE_MS} from '../rooms/cleanup.js';
const origin='https://board.test';
const headers=(user:string)=>({origin,cookie:`board_session=${user}`});
// 注入的随机数恒为 0：洗牌结果固定，随机定庄落在 0 号位
const zero=()=>0;
const USERS=['alice','bob','carol','dave','erin'];

function setup(){
 const dir=mkdtempSync(join(tmpdir(),'board-mahjong-')),path=join(dir,'db.sqlite');
 const data=openDatabase(path);migrate(data.sqlite);
 for(const user of USERS){
  data.sqlite.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at) VALUES(?,?,?,?,?)').run(user,user,user,'unused',Date.now());
  data.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(user).digest('hex'),user,Date.now()+3600000);
 }data.sqlite.close();
 return {dir,path,done:()=>{if(dirname(dir)===tmpdir()&&basename(dir).startsWith('board-mahjong-'))rmSync(dir,{recursive:true,force:true});}};
}
// 直接改数据库里的整局状态（测试专用，用来摆出指定牌型）
function patchState(path:string,code:string,fn:(s:any)=>void){
 const db=openDatabase(path).sqlite;
 const row=db.prepare('SELECT state FROM mahjong_rooms WHERE code=?').get(code) as {state:string};
 const s=JSON.parse(row.state);fn(s);
 db.prepare('UPDATE mahjong_rooms SET state=? WHERE code=?').run(JSON.stringify(s),code);db.close();
}

it('runs an authenticated four-seat table: settings, hidden hands, idempotent moves, restart, hosting, resume and closing an all-hosted table',async()=>{
 const t=setup();let now=5_000_000;const clock=()=>now;
 const open=()=>createApp({databasePath:t.path,origin,production:true,logger:false,mahjongClock:clock,mahjongRandom:zero}).app;
 let app=open();
 const post=(url:string,user:string,payload:object)=>app.inject({method:'POST',url,headers:headers(user),payload});
 const get=(url:string,user:string)=>app.inject({url,headers:headers(user)});
 const cmd=(type:string,expectedVersion:number,extra:object={},requestId=randomUUID())=>({type,expectedVersion,requestId,...extra});
 try{
  expect((await app.inject('/api/mahjong-gd/rooms')).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/mahjong-gd/rooms',headers:{...headers('alice'),origin:'https://evil.test'},payload:{}})).statusCode).toBe(403);
  const bad=await post('/api/mahjong-gd/rooms','alice',{settings:{selfDraw:false,discardWin:false}});
  expect(bad.statusCode).toBe(400);expect(bad.json().error).toBe('自摸胡和点炮胡至少要开一个');
  const created=await post('/api/mahjong-gd/rooms','alice',{});expect(created.statusCode).toBe(201);
  const room=created.json(),base=`/api/mahjong-gd/rooms/${room.code}`;
  expect(room).toMatchObject({status:'waiting',yourSeat:0,hostSeat:0,handNo:0,dealer:null,game:null,settings:{honors:true,flowers:false,ghost:'none',turnSeconds:30}});
  expect(JSON.stringify(room)).not.toContain('user_id');
  expect((await get(base,'bob')).statusCode).toBe(404);

  // 五个人抢三个空位
  const candidates=['bob','carol','dave','erin'],joins=await Promise.all(candidates.map(u=>post(base+'/join',u,{})));
  expect(joins.map(r=>r.statusCode).sort()).toEqual([200,200,200,409]);
  const players=['alice',...candidates.filter((_,i)=>joins[i]!.statusCode===200)],outsider=candidates[joins.findIndex(r=>r.statusCode===409)]!;
  expect((await get(base,outsider)).statusCode).toBe(404);
  const seatOf:Record<string,number>={};for(const u of players)seatOf[u]=(await get(base,u)).json().yourSeat;
  const at=(seat:number)=>players.find(u=>seatOf[u]===seat)!;
  expect(Object.values(seatOf).sort()).toEqual([0,1,2,3]);

  // 准备后改规则：所有人的准备被取消；只有房主能改；字牌关闭会连带关掉花牌和字牌牌型
  let v=(await get(base,'alice')).json().version as number;
  v=(await post(base+'/actions',at(1),cmd('ready',v,{ready:true}))).json().version;
  expect((await post(base+'/actions',at(1),cmd('settings',v,{settings:{chi:false}}))).statusCode).toBe(409);
  const bad2=await post(base+'/actions','alice',cmd('settings',v,{settings:{patterns:{chicken:false,pinghu:false,pengpeng:false,qidui:false,shisanyao:false,qingyise:false,hunyise:false,dasanyuan:false,xiaosanyuan:false,dasixi:false,xiaosixi:false}}}));
  expect(bad2.statusCode).toBe(400);
  const changed=await post(base+'/actions','alice',cmd('settings',v,{settings:{honors:false,flowers:true,turnSeconds:15}}));
  expect(changed.statusCode).toBe(200);
  expect(changed.json().settings).toMatchObject({honors:false,flowers:false,turnSeconds:15,patterns:{shisanyao:false,hunyise:false,chicken:true}});
  expect(changed.json().seats.every((s:any)=>!s.ready)).toBe(true);
  v=(await post(base+'/actions','alice',cmd('settings',changed.json().version,{settings:{}}))).json().version; // 改回默认
  for(const u of players){const r=await post(base+'/actions',u,cmd('ready',v,{ready:true}));expect(r.statusCode).toBe(200);v=r.json().version;}

  // 开局：rng 恒 0 → 0 号位做庄
  let view=(await get(base,'alice')).json();
  expect(view).toMatchObject({status:'playing',handNo:1,dealer:0});
  expect(view.game).toMatchObject({phase:'playing',stage:'discard',turn:0,dealer:0,wallCount:136-53,deadline:now+30000});
  expect(view.game.hand).toHaveLength(14);expect(view.seats.every((s:any)=>!s.ready&&s.online&&!s.hosted)).toBe(true);
  const other=(await get(base,at(2))).json();
  expect(other.game.hand).toHaveLength(13);expect(other.game.players[0].hand).toBeNull();expect(other.game.lastDrawn).toBeNull();
  expect(JSON.stringify(other)).not.toContain('"wall"');expect(other.game.legal.turn).toBeNull();
  v=view.version;
  expect((await post(base+'/actions','alice',cmd('settings',v,{settings:{}}))).statusCode).toBe(409);
  expect((await post(base+'/actions','alice',cmd('leave',v))).statusCode).toBe(409);
  expect((await post(base+'/actions',at(1),cmd('discard',v,{tileId:other.game.hand[0].id}))).statusCode).toBe(409);
  expect((await post(base+'/actions','alice',cmd('discard',v,{tileId:other.game.hand[0].id}))).statusCode).toBe(409); // 不是自己的牌
  expect((await post(base+'/actions','alice',cmd('discard',v,{tileId:'x'}))).statusCode).toBe(400);
  expect((await post(base+'/actions','alice',{...cmd('discard',v,{tileId:view.game.lastDrawn}),seat:1})).statusCode).toBe(400);

  // 出牌：同一个请求重复提交只生效一次；同编号换内容被拒绝
  const play=cmd('discard',v,{tileId:view.game.lastDrawn}),played=await post(base+'/actions','alice',play);
  expect(played.statusCode).toBe(200);
  expect(played.json().game.hand).toHaveLength(13);expect(played.json().game.players[0].river).toHaveLength(1);
  expect((await post(base+'/actions','alice',play)).json().version).toBe(played.json().version);
  expect((await post(base+'/actions','alice',{...play,tileId:view.game.hand[0].id})).statusCode).toBe(409);
  expect((await post(base+'/actions','alice',cmd('discard',v,{tileId:view.game.hand[0].id}))).statusCode).toBe(409); // 版本过期

  // 若有人能响应，先让响应窗口超时（只算过、不托管）
  view=(await get(base,'alice')).json();
  if(view.game.stage==='response'){now=view.game.deadline;view=(await get(base,'alice')).json();}
  expect(view.game).toMatchObject({stage:'discard'});
  expect(view.seats.every((s:any)=>!s.hosted)).toBe(true);
  const turn=view.game.turn as number;

  // 重启：状态保留；停机前设的到期时间至少顺延到启动后 15 秒
  await app.close();now+=60000;const bootAt=now;app=open();
  view=(await get(base,at(turn))).json();
  expect(view.game).toMatchObject({turn,stage:'discard',deadline:bootAt+MAHJONG_BOOT_GRACE_MS});
  expect(view.seats.every((s:any)=>!s.hosted)).toBe(true);
  expect((await get('/api/mahjong-gd/rooms',at(turn))).json().rooms).toHaveLength(1);

  // 出牌超时 → 托管并自动打出刚摸的牌；托管中不能操作，点「我回来了」收回
  const drawn=view.game.lastDrawn;
  now=view.game.deadline;view=(await get(base,at(turn))).json();
  expect(view.seats[turn].hosted).toBe(true);expect(view.game.legal).toMatchObject({hosted:true,canResume:true,turn:null});
  expect(view.game.events.some((e:any)=>e.kind==='discard'&&e.seat===turn&&e.auto)).toBe(true);
  expect(view.game.hand.some((x:any)=>x.id===drawn)).toBe(false);
  expect((await post(base+'/actions',at(turn),cmd('pass',view.version))).statusCode).toBe(409);
  const back=await post(base+'/actions',at(turn),cmd('resume',0)); // 「我回来了」不受版本号限制（托管时版本变化很快）
  expect(back.statusCode).toBe(200);expect(back.json().seats[turn].hosted).toBe(false);
  // 刷新不会收回：再次托管后多次读取，仍在托管
  for(let i=0;i<80&&!(await get(base,'alice')).json().seats.every((s:any)=>s.hosted);i++){now+=30001;}
  view=(await get(base,'alice')).json();
  expect(view.seats.every((s:any)=>s.hosted)).toBe(true);
  expect(view.game.allHostedSince).not.toBeNull();
  for(const u of players)expect((await get(base,u)).json().seats[seatOf[u]!].hosted).toBe(true);

  // 四座都托管 60 秒 → 关房、本局作废
  now=view.game.allHostedSince+60000;
  const closed=(await get(base,'alice')).json();
  expect(closed.status).toBe('cancelled');expect(closed.game).toMatchObject({phase:'void',result:{type:'void',winner:null}});
  expect((await post(base+'/actions','alice',cmd('ready',closed.version,{ready:true}))).statusCode).toBe(409);
  expect((await get('/api/mahjong-gd/rooms','alice')).json().rooms).toHaveLength(0);

  const check=openDatabase(t.path);check.sqlite.prepare("UPDATE users SET status='disabled' WHERE id='alice'").run();check.sqlite.close();
  expect((await get(base,'alice')).statusCode).toBe(401);
 }finally{await app.close();t.done();}
},30000);

it('finishes a hand, keeps the dealer on a dealer win, lets players leave and starts the next hand',async()=>{
 const t=setup();let now=9_000_000;const clock=()=>now;
 const app=createApp({databasePath:t.path,origin,production:true,logger:false,mahjongClock:clock,mahjongRandom:zero}).app;
 const post=(url:string,user:string,payload:object)=>app.inject({method:'POST',url,headers:headers(user),payload});
 const get=(url:string,user:string)=>app.inject({url,headers:headers(user)});
 const cmd=(type:string,expectedVersion:number,extra:object={})=>({type,expectedVersion,requestId:randomUUID(),...extra});
 try{
  const room=(await post('/api/mahjong-gd/rooms','alice',{settings:{ghost:'red'}})).json(),base=`/api/mahjong-gd/rooms/${room.code}`;
  expect(room.settings.ghost).toBe('red');
  for(const u of ['bob','carol','dave'])expect((await post(base+'/join',u,{})).statusCode).toBe(200);
  expect((await post(base+'/join','erin',{})).statusCode).toBe(409);
  let v=(await get(base,'alice')).json().version;
  for(const u of ['alice','bob','carol','dave'])v=(await post(base+'/actions',u,cmd('ready',v,{ready:true}))).json().version;
  let view=(await get(base,'alice')).json();
  expect(view.game.ghost).toBe('z5');expect(view.dealer).toBe(0);
  // 摆一副能自摸的牌给庄家
  let id=5000;const tiles=(s:string)=>s.split(' ').flatMap(g=>g.slice(0,-1).split('').map(n=>({id:id++,code:g.slice(-1)+n})));
  patchState(t.path,room.code,s=>{s.seats[0].hand=tiles('123m 456m 789p 111s 77z');s.lastDrawn=s.seats[0].hand.at(-1).id;s.seats[0].discarded=true;}); // 已出过牌，不算天胡
  view=(await get(base,'alice')).json();
  expect(view.game.legal.turn.selfWin).toBe(true);
  const won=await post(base+'/actions','alice',cmd('selfWin',view.version));
  expect(won.statusCode).toBe(200);
  expect(won.json()).toMatchObject({status:'waiting',dealer:0,handNo:1,game:{phase:'finished',result:{type:'selfDraw',winner:0,names:['鸡胡']}}});
  const seen=(await get(base,'bob')).json();
  expect(seen.game.players[0].hand).toHaveLength(14);expect(seen.game.players[2].hand).toHaveLength(13);
  // 结束后对局操作被拒绝；房主可以改规则
  expect((await post(base+'/actions','alice',cmd('discard',seen.version,{tileId:5000}))).statusCode).toBe(409);
  v=(await post(base+'/actions','alice',cmd('settings',seen.version,{settings:{ghost:'flip'}}))).json().version;
  // 再来一局：庄家胡了连庄
  for(const u of ['alice','bob','carol','dave'])v=(await post(base+'/actions',u,cmd('ready',v,{ready:true}))).json().version;
  view=(await get(base,'alice')).json();
  expect(view).toMatchObject({status:'playing',handNo:2,dealer:0});
  expect(view.game.indicator).not.toBeNull();expect(typeof view.game.ghost).toBe('string');
  // 让闲家（1 号位）自摸：下一局轮到 1 号位做庄
  patchState(t.path,room.code,s=>{s.turn=1;s.stage='discard';s.seats[1].hand=tiles('123m 456m 789p 111s 77z');s.lastDrawn=s.seats[1].hand.at(-1).id;s.seats.forEach((x:any)=>x.discarded=true);s.claimed=true;s.response=null;s.deadline=now+30000;});
  view=(await get(base,'bob')).json();
  const w2=await post(base+'/actions','bob',cmd('selfWin',view.version));
  expect(w2.json()).toMatchObject({status:'waiting',dealer:1,game:{result:{type:'selfDraw',winner:1}}});
  // 有人离开：重新随机定庄、清掉上一局；房主离开后房主转给下一个人
  v=w2.json().version;
  const left=await post(base+'/actions','alice',cmd('leave',v));expect(left.json()).toEqual({left:true});
  view=(await get(base,'bob')).json();
  expect(view).toMatchObject({hostSeat:1,dealer:null,game:null});expect(view.seats).toHaveLength(3);
  expect((await get(base,'alice')).statusCode).toBe(404);
  // 空位可以有新人加入
  expect((await post(base+'/join','erin',{})).json().yourSeat).toBe(0);
  // 房主取消
  view=(await get(base,'bob')).json();
  expect((await post(base+'/actions','carol',cmd('cancel',view.version))).statusCode).toBe(409);
  expect((await post(base+'/actions','bob',cmd('cancel',view.version))).json().status).toBe('cancelled');
 }finally{await app.close();t.done();}
});

it('cleans up idle waiting tables but never abandons a running hand',async()=>{
 const t=setup();
 const {app,cleanupRooms}=createApp({databasePath:t.path,origin,production:true,logger:false,mahjongRandom:zero});
 const post=(url:string,user:string,payload:object)=>app.inject({method:'POST',url,headers:headers(user),payload});
 try{
  const idle=(await post('/api/mahjong-gd/rooms','alice',{})).json();
  const busy=(await post('/api/mahjong-gd/rooms','bob',{})).json(),base=`/api/mahjong-gd/rooms/${busy.code}`;
  for(const u of ['carol','dave','erin'])await post(base+'/join',u,{});
  let v=(await app.inject({url:base,headers:headers('bob')})).json().version;
  for(const u of ['bob','carol','dave','erin'])v=(await post(base+'/actions',u,{type:'ready',ready:true,requestId:randomUUID(),expectedVersion:v})).json().version;
  const later=Date.now()+2*24*3600*1000;
  const db=openDatabase(t.path).sqlite;db.prepare('UPDATE mahjong_rooms SET updated_at=?').run(Date.now()-WAITING_IDLE_MS-60000);db.close();
  const result=cleanupRooms(Date.now());
  expect(result.cancelledWaiting).toBeGreaterThanOrEqual(1);
  const check=openDatabase(t.path).sqlite;
  const status=(code:string)=>(check.prepare('SELECT status FROM mahjong_rooms WHERE code=?').get(code) as {status:string}|undefined)?.status;
  expect(status(idle.code)).toBe('cancelled');expect(status(busy.code)).toBe('playing');
  check.close();
  cleanupRooms(later);
  const again=openDatabase(t.path).sqlite;
  expect(again.prepare('SELECT count(*) AS n FROM mahjong_rooms WHERE code=?').get(idle.code)).toEqual({n:0});
  expect((again.prepare('SELECT status FROM mahjong_rooms WHERE code=?').get(busy.code) as {status:string}).status).toBe('playing');
  expect(again.prepare('SELECT count(*) AS n FROM mahjong_seats WHERE room_code=?').get(idle.code)).toEqual({n:0});
  again.close();
 }finally{await app.close();t.done();}
});

it('does not open mahjong tables on production HTTP',async()=>{
 const {app}=createApp({databasePath:':memory:',origin:'http://board.test',production:true,logger:false});
 try{expect((await app.inject('/api/mahjong-gd/rooms')).statusCode).toBe(503);}finally{await app.close();}
});
