import {it,expect} from 'vitest';
import {mahjongEngine} from '@board/game-core';
// 测试里大量构造半成品状态，统一按宽松类型使用引擎；对外类型仍由 mahjong-gd-engine.d.cts 约束
const E: any = mahjongEngine;

/* ---------- 工具 ---------- */
let nid=1000;
// '123m 456p 11z 1f' → 牌（新编号）
const tl=(s: any): any[]=>s.trim()?s.trim().split(/\s+/).flatMap((g: any)=>{const su=g.slice(-1);return g.slice(0,-1).split('').map((n: any)=>({id:nid++,code:su+n}));}):[];
const codes=(s: any)=>tl(s).map((t: any)=>t.code);
const thrown=(fn: any)=>{try{fn();return null;}catch(e: any){return e instanceof Error?e.message:String(e);}};
const zero=()=>0;
const rnd=(n: any)=>Math.floor(Math.random()*n);
const S=(over: any={}): any=>{const d=E.defaultSettings();return {...d,...over,patterns:{...d.patterns,...(over.patterns||{})}};};
const win=(hand: any,melds: any=[],over: any={},ghost: any=null,timing: any=null)=>E.analyzeWin(codes(hand),melds,{ghost,settings:E.parseSettings(S(over)),timing});
const meld=(kind: any,s: any)=>({kind,codes:codes(s)});

// 构造一个指定手牌和牌墙的对局：turn 号座位处于出牌阶段，手里最后一张视为刚摸的牌
function craft(hands: any,wall: any,o: any={}): any{
 const st=E.start(S(o.settings||{}),o.dealer??0,zero,0);
 st.seats.forEach((x: any,i: any)=>{x.hand=tl(hands[i]||'');x.melds=[];x.flowers=[];x.river=[];});
 st.wall=tl(wall);st.setAside=[];st.indicator=null;st.ghost=o.ghost??null;
 st.turn=o.turn??0;st.stage='discard';st.response=null;st.deadline=1000000;
 const h=st.seats[st.turn].hand;st.lastDrawn=o.drawn===false?null:h[h.length-1].id;
 st.claimed=!!o.claimed;st.seats.forEach((x: any,i: any)=>{x.discarded=o.discarded??true;x.passedWin=false;x.hosted=!!(o.hosted||[])[i];});
 st.deckSize=0;
 return st;
}
const idOf=(st: any,seat: any,code: any)=>{const t=st.seats[seat].hand.filter((x: any)=>x.code===code).pop();if(!t)throw new Error('no '+code);return t.id;};
const act=(st: any,seat: any,a: any,now=0)=>E.apply(st,seat,a,now);
const discard=(st: any,seat: any,code: any,now=0)=>act(st,seat,{type:'discard',tileId:idOf(st,seat,code)},now);

/* ---------- 牌 / 设置 ---------- */
it('builds 108 / 136 / 144 tile decks with four of each tile and one of each flower',()=>{
 const count=(st: any)=>{const m: any={};st.forEach((t: any)=>m[t.code]=(m[t.code]||0)+1);return m;};
 const d108=E.buildDeck({honors:false,flowers:false}),d136=E.buildDeck({honors:true,flowers:false}),d144=E.buildDeck({honors:true,flowers:true});
 expect(d108).toHaveLength(108);expect(d136).toHaveLength(136);expect(d144).toHaveLength(144);
 const c=count(d144);for(const k of Object.keys(c))expect(c[k]).toBe(k[0]==='f'?1:4);
 expect(Object.keys(count(d108)).some(k=>k[0]==='z'||k[0]==='f')).toBe(false);
 expect(new Set(d144.map((t: any)=>t.id)).size).toBe(144);
});
it('turns off every honour-only option when honours are off',()=>{
 const r=E.normalizeSettings(S({honors:false,flowers:true,ghost:'red'}));
 expect(r.error).toBeNull();expect(r.settings.flowers).toBe(false);expect(r.settings.ghost).toBe('none');
 for(const k of ['shisanyao','dasanyuan','xiaosanyuan','dasixi','xiaosixi','hunyise'])expect(r.settings.patterns[k]).toBe(false);
 for(const k of ['qingyise','pinghu','pengpeng','qidui','chicken'])expect(r.settings.patterns[k]).toBe(true);
 expect(E.normalizeSettings(S({honors:false,ghost:'flip'})).settings.ghost).toBe('flip');
});
it('links rob-kong to added-kong and discard-win, and rejects impossible settings',()=>{
 expect(E.normalizeSettings(S({addedKong:false})).settings.robKong).toBe(false);
 expect(E.normalizeSettings(S({discardWin:false})).settings.robKong).toBe(false);
 expect(E.normalizeSettings(S({})).settings.robKong).toBe(true);
 expect(E.normalizeSettings(S({selfDraw:false,discardWin:false})).error).toBe('自摸胡和点炮胡至少要开一个');
 const onlyTiming={chicken:false,pinghu:false,pengpeng:false,qidui:false,shisanyao:false,qingyise:false,hunyise:false,dasanyuan:false,xiaosanyuan:false,dasixi:false,xiaosixi:false};
 expect(E.normalizeSettings(S({patterns:onlyTiming})).error).toBe('关闭鸡胡后，至少要开一种能胡的牌型');
 expect(E.normalizeSettings(S({patterns:{...onlyTiming,pengpeng:true}})).error).toBeNull();
 // 字牌关后只剩字牌类牌型 → 也不合法
 expect(E.normalizeSettings(S({honors:false,patterns:{...onlyTiming,dasanyuan:true}})).error).not.toBeNull();
 expect(E.normalizeSettings(S({turnSeconds:20})).error).not.toBeNull();
 expect(E.normalizeSettings(S({ghost:'any'})).error).not.toBeNull();
 expect(E.normalizeSettings(S({chi:'yes'})).error).not.toBeNull();
 expect(thrown(()=>E.parseSettings(S({selfDraw:false,discardWin:false})))).toBe('自摸胡和点炮胡至少要开一个');
 for(const t of [15,30,60])expect(E.normalizeSettings(S({turnSeconds:t})).error).toBeNull();
});
it('maps the flipped indicator to the next tile as ghost',()=>{
 expect(E.nextGhost('m9')).toBe('m1');expect(E.nextGhost('p3')).toBe('p4');expect(E.nextGhost('s8')).toBe('s9');
 expect(E.nextGhost('z1')).toBe('z2');expect(E.nextGhost('z4')).toBe('z1');
 expect(E.nextGhost('z5')).toBe('z6');expect(E.nextGhost('z7')).toBe('z5');
 expect(thrown(()=>E.nextGhost('f1'))).not.toBeNull();
});

/* ---------- 发牌 ---------- */
const total=(st: any)=>st.wall.length+st.setAside.length+(st.indicator?1:0)+st.seats.reduce((n: any,x: any)=>n+x.hand.length+x.flowers.length+x.river.length+x.melds.reduce((m: any,y: any)=>m+y.tiles.length,0),0);
it('deals 14 to the dealer and 13 to others, random dealer when not given',()=>{
 for(const honors of [false,true]){
  const st=E.start(S({honors}),2,rnd,500);
  expect(st.seats.map((x: any)=>x.hand.length)).toEqual([13,13,14,13]);
  expect(st.wall.length).toBe((honors?136:108)-53);expect(total(st)).toBe(st.deckSize);
  expect(st).toMatchObject({turn:2,stage:'discard',dealer:2,phase:'playing',deadline:500+30000,ghost:null});
  expect(st.seats[2].hand.some((t: any)=>t.id===st.lastDrawn)).toBe(true);
 }
 expect(E.start(S(),null,()=>3,0).dealer).toBe(3);
 expect(thrown(()=>E.start(S({selfDraw:false,discardWin:false}),0,zero,0))).not.toBeNull();
});
it('replaces flowers at the deal from the tail until no flower is left in any hand',()=>{
 for(let g=0;g<50;g++){
  const st=E.start(S({flowers:true}),g%4,rnd,0);
  expect(st.seats.every((x: any)=>x.hand.every((t: any)=>t.code[0]!=='f'))).toBe(true);
  expect(st.seats.map((x: any)=>x.hand.length)).toEqual([0,1,2,3].map(i=>i===g%4?14:13));
  expect(total(st)).toBe(144);
  expect(st.seats.reduce((n: any,x: any)=>n+x.flowers.length,0)+st.wall.filter((t: any)=>t.code[0]==='f').length+st.setAside.length).toBe(8);
 }
});
it('sets red-dragon ghosts or flips an indicator from the tail that leaves the wall',()=>{
 expect(E.start(S({ghost:'red'}),0,rnd,0).ghost).toBe('z5');
 for(let g=0;g<30;g++){
  const st=E.start(S({ghost:'flip',flowers:true}),0,rnd,0);
  expect(st.indicator).not.toBeNull();expect(st.indicator.code[0]).not.toBe('f');
  expect(st.ghost).toBe(E.nextGhost(st.indicator.code));
  expect(st.wall.some((t: any)=>t.id===st.indicator.id)).toBe(false);
  expect(st.setAside.every((t: any)=>t.code[0]==='f')).toBe(true);expect(total(st)).toBe(144);
 }
});

/* ---------- 胡牌判定 ---------- */
it('recognises standard hands and rejects near misses',()=>{
 expect(thrown(()=>win('123m 456m 789p 111s 19z'))).toBe('未知的牌：z9');
 expect(win('123m 456m 789p 111s 77z').win).toBe(true);
 expect(win('123m 456m 789p 111s 77z').names).toEqual(['鸡胡']);
 expect(win('123m 456m 789p 111s 17z').win).toBe(false);
 expect(win('111222333m 44455p').win).toBe(true);
 expect(win('123m 456m 789p 111s 7z').win).toBe(false); // 张数不对
 expect(win('789m 891p 111s 22z 345s').win).toBe(false); // 九一不能连
 expect(win('123z 456z 777z 11m 234m').win).toBe(false); // 字牌不能成顺
 expect(win('11m',[meld('pong','222p'),meld('chi','345s'),meld('exposedKong','6666m'),meld('concealedKong','7777z')]).win).toBe(true);
});
it('recognises seven pairs (four of a kind counts as two pairs) and thirteen orphans',()=>{
 expect(win('1133m 5577p 99s 1122z').names).toEqual(['七小对']);
 expect(win('1111m 5577p 99s 1122z').win).toBe(true);
 expect(win('1133m 5577p 99s 1123z').win).toBe(false);
 expect(win('1133m 5577p 99s 1122z',[],{patterns:{qidui:false}}).win).toBe(false);
 expect(win('19m 19p 19s 12345677z').names).toEqual(['十三幺']);
 expect(win('19m 19p 19s 12345667z').win).toBe(true);
 expect(win('19m 19p 19s 1234566z 2m').win).toBe(false);
 expect(win('19m 19p 19s 1234567z 1m',[],{patterns:{shisanyao:false}}).win).toBe(false);
 expect(win('11m 19p 19s 1234567z 9m',[],{}).names).toEqual(['十三幺']);
});
it('lets ghosts stand for any tile in standard, seven-pair and thirteen-orphan hands',()=>{
 // 红中鬼
 expect(win('123m 456m 789p 11s 5z 7z',[],{},'z5').win).toBe(false);
 expect(win('123m 456m 789p 11s 2s 55z',[],{},'z5').win).toBe(true); // 两张鬼凑刻子
 expect(win('13m 456m 789p 111s 99s 5z',[],{},'z5').win).toBe(true); // 鬼补坎张
 expect(win('1133m 5577p 9s 1122z 5z',[],{},'z5').names).toEqual(['七小对']);
 expect(win('19m 19p 19s 123467z 5z 1m',[],{},'z5').names).toEqual(['十三幺']);
 expect(win('19m 9p 19s 123467z 55z 1m',[],{},'z5').names).toEqual(['十三幺']);
 // 四张鬼不能直接胡
 expect(win('5555z 1357m 2468p 9s 1z',[],{},'z5').win).toBe(false);
 // 只差一对时四鬼可以补成
 expect(win('5555z 123m 456p 789s 1z',[],{},'z5').win).toBe(true);
});
it('scores each confirmed pattern and refuses a chicken hand when chicken is off',()=>{
 expect(win('123m 456m 789p 222s 77z').names).toEqual(['鸡胡']);
 expect(win('123m 456m 789p 234s 77z').names).toEqual(['平胡']);
 expect(win('123m 456m 789p 234s 99s').names).toEqual(['平胡']);
 expect(win('123m 456m 789p 99s',[meld('chi','234s')]).names).toEqual(['平胡']);
 expect(win('123m 456m 789p 99s',[meld('pong','222s')]).names).toEqual(['鸡胡']);
 expect(win('111m 444p 777s 222z 33z').names).toEqual(['碰碰胡']);
 expect(win('111m 33z',[meld('pong','444p'),meld('exposedKong','7777s'),meld('concealedKong','2222z')]).names).toEqual(['碰碰胡']);
 expect(win('123456789m 11122m').names).toEqual(['清一色']);
 expect(win('1133557799m 1122m').names).toEqual(['七小对','清一色']);
 expect(win('123456m 111z 222z 33m').names).toEqual(['混一色']);
 expect(win('555z 666z 777z 123m 99p').names).toEqual(['大三元']);
 expect(win('555z 666z 77z 123m 456p').names).toEqual(['小三元']);
 expect(win('111z 222z 333z 444z 99m').names).toEqual(['碰碰胡','混一色','大四喜']);
 expect(win('111z 222z 333z 444z 77z').names).toEqual(['碰碰胡','大四喜']);
 expect(win('111z 222z 333z 44z 123m').names).toEqual(['混一色','小四喜']);
 expect(win('111z 222z 333z 44z 555z').names).toEqual(['碰碰胡','小四喜']);
 expect(win('123m 22z',[meld('pong','111z'),meld('pong','333z'),meld('exposedKong','4444z')]).names).toEqual(['混一色','小四喜']);
 const noChicken={patterns:{chicken:false}};
 expect(win('123m 456m 789p 111s 77z',[],noChicken).win).toBe(false);
 expect(win('111m 444p 777s 222z 33z',[],noChicken).names).toEqual(['碰碰胡']);
 expect(win('111m 444p 777s 222z 33z',[],{patterns:{chicken:false,pengpeng:false,pinghu:true}}).win).toBe(false);
 expect(win('123m 456m 789p 234s 99s',[],{patterns:{pinghu:false}}).names).toEqual(['鸡胡']);
 expect(win('123m 456m 789p 234s 99s',[],{},null,'tianhu').names).toEqual(['平胡','天胡']);
 expect(win('123m 456m 789p 111s 77z',[],{},null,'dihu').names).toEqual(['鸡胡','地胡']);
 expect(win('123m 456m 789p 111s 77z',[],{patterns:{dihu:false}},null,'dihu').names).toEqual(['鸡胡']);
});
it('judges suits by real tiles and keeps honour patterns away when honours are off',()=>{
 // 鬼补位后仍是清一色
 expect(win('123456789m 1112m 5z',[],{},'z5').patterns).toContain('qingyise');
 // 混一色需要真的有字牌
 expect(win('123456789m 1112m 5z',[],{},'z5').patterns).not.toContain('hunyise');
 // 副露有别的花色就不是清一色
 expect(win('123456m 789m 11m',[meld('chi','123p')]).patterns).not.toContain('qingyise');
 expect(win('123m 456m 789p 111s 99s',[],{honors:false}).win).toBe(true);
});

/* ---------- 出牌与响应 ---------- */
it('passes the turn to the next seat when nobody can respond, and keeps the input untouched',()=>{
 const st=craft(['123m 456m 789m 135p 7z','147s 258s 369s 1z','147m 258p 369s 2z','14p 25s 369m 3z 4z'],'9p 9s 8p',{});
 const before=JSON.stringify(st);
 const t=discard(st,0,'z7',50);
 expect(JSON.stringify(st)).toBe(before);
 expect(t).toMatchObject({turn:1,stage:'discard',deadline:50+30000});
 expect(t.seats[1].hand.at(-1).code).toBe('p9');expect(t.wall).toHaveLength(2);
 expect(t.seats[0].river.map((x: any)=>x.code)).toEqual(['z7']);
 expect(thrown(()=>discard(st,1,'z1'))).toBe('还没有轮到你');
 expect(thrown(()=>act(st,0,{type:'discard',tileId:-5}))).toBe('这张牌不在你手里');
 expect(thrown(()=>act(st,0,{type:'fly'}))).toBe('操作不正确');
});
it('allows chi only from the left player and lists every chi option',()=>{
 // 座位 0 打 4m：座位 1 可以吃 23/35/56，座位 2 也有 35m 但不能吃
 const st=craft(['4m 111p 222p 333p 999s','2356m 111s 444z 55z','35m 777p 888s 666z 1z','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s'],'1p 2p',{});
 const t=discard(st,0,'m4');
 expect(t.stage).toBe('response');
 expect(Object.keys(t.response.options)).toEqual(['1']);
 expect(t.response.options[1].chi).toEqual([['m2','m3'],['m3','m5'],['m5','m6']]);
 expect(E.legal(t,2).response).toBeNull();
 expect(thrown(()=>act(t,1,{type:'chi',tiles:[idOf(t,1,'m2'),idOf(t,1,'m6')]}))).toBe('这两张牌不能吃');
 const c=act(t,1,{type:'chi',tiles:[idOf(t,1,'m5'),idOf(t,1,'m3')]});
 expect(c).toMatchObject({turn:1,stage:'discard',lastDrawn:null,claimed:true});
 expect(c.seats[1].melds[0]).toMatchObject({kind:'chi',from:0});
 expect(c.seats[1].melds[0].tiles.map((x: any)=>x.code)).toEqual(['m3','m4','m5']);
 expect(c.seats[0].river).toHaveLength(0);expect(c.wall).toHaveLength(2); // 吃后不摸牌
 expect(E.legal(c,1).turn.selfWin).toBe(false);
});
it('gives pong / kong priority over chi and waits for higher priority players',()=>{
 const st=craft(['4m 111p 222p 333p 999s','23m 111s 444z 555z 6z 7z','44m 777p 888s 666z 1z','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s'],'1p 2p',{});
 const t=discard(st,0,'m4');
 expect(t.response.options[1].actions).toEqual(['chi']);expect(t.response.options[2].actions).toEqual(['pong']);
 const a=act(t,1,{type:'chi',tiles:[idOf(t,1,'m2'),idOf(t,1,'m3')]});
 expect(a.stage).toBe('response'); // 还在等碰
 expect(act(a,2,{type:'pass'})).toMatchObject({turn:1,stage:'discard'});
 const p=act(a,2,{type:'pong'});
 expect(p).toMatchObject({turn:2,stage:'discard',lastDrawn:null});
 expect(p.seats[2].melds[0].kind).toBe('pong');expect(p.seats[1].melds).toHaveLength(0);
 // 碰的人先选，不用等吃
 expect(act(t,2,{type:'pong'})).toMatchObject({turn:2,stage:'discard'});
});
it('gives a discard to the nearest winner only after closer winners decide',()=>{
 const H='123m 456m 789p 111s 7z';
 const st=craft(['7z 111p 222p 333p 99s',H,H,H],'1p 2p',{});
 const t=discard(st,0,'z7');
 expect(Object.keys(t.response.options)).toEqual(['1','2','3']);
 const a=act(t,3,{type:'win'});expect(a.stage).toBe('response');
 const b=act(a,1,{type:'pass'});expect(b.stage).toBe('response');
 const c=act(b,2,{type:'win'});
 expect(c.phase).toBe('finished');expect(c.result).toMatchObject({type:'discard',winner:2,from:0,tile:'z7',names:['鸡胡']});
 expect(c.seats[2].hand).toHaveLength(14);expect(c.seats[0].river).toHaveLength(0);
 const d=act(act(t,3,{type:'win'}),1,{type:'win'});
 expect(d.result.winner).toBe(1);
 expect(E.nextDealer(d)).toBe(1);
});
it('handles exposed kong with a tail draw and counts a kong-draw win as self draw',()=>{
 const st=craft(['5p 111m 222m 333m 99s','555p 123s 456s 78s 77z','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s'],'1m 2m 9s',{});
 const t=discard(st,0,'p5');
 expect(t.response.options[1].actions).toEqual(['pong','exposedKong']);
 const k=act(t,1,{type:'exposedKong'});
 expect(k).toMatchObject({turn:1,stage:'discard',drawnFromKong:true});
 expect(k.seats[1].hand.at(-1).code).toBe('s9');expect(k.wall.map((x: any)=>x.code)).toEqual(['m1','m2']);
 expect(k.seats[1].melds[0]).toMatchObject({kind:'exposedKong',from:0});
 const w=act(k,1,{type:'selfWin'});
 expect(w.result).toMatchObject({type:'selfDraw',winner:1,kongFlower:true,tile:'s9'});
});
it('allows concealed kong (not of ghosts) and added kong, both drawing from the tail',()=>{
 const st=craft(['1111m 222p 333p 44s 5z 6z','','','' ],'7z 8s 9s',{});
 expect(E.legal(st,0).turn.concealedKongs).toEqual(['m1']);
 const k=act(st,0,{type:'concealedKong',code:'m1'});
 expect(k.seats[0].melds[0].kind).toBe('concealedKong');expect(k.seats[0].hand.at(-1).code).toBe('s9');expect(k.claimed).toBe(true);
 // 红中鬼时 4 张红中不能暗杠
 const g=craft(['5555z 222p 333p 44s 6z 7z','','',''],'1z',{ghost:'z5'});
 expect(E.legal(g,0).turn.concealedKongs).toEqual([]);
 expect(thrown(()=>act(g,0,{type:'concealedKong',code:'z5'}))).toBe('现在不能暗杠这张牌');
 // 补杠：没人能抢就直接补
 const a=craft(['222p 333p 44s 66z 1m','','',''],'7z 8s',{});
 a.seats[0].melds=[{kind:'pong',tiles:tl('111m'),from:2}];
 expect(E.legal(a,0).turn.addedKongs).toEqual(['m1']);
 const b=act(a,0,{type:'addedKong',code:'m1'});
 expect(b.seats[0].melds[0].kind).toBe('addedKong');expect(b.seats[0].melds[0].tiles).toHaveLength(4);
 expect(b.seats[0].hand.at(-1).code).toBe('s8');expect(b.stage).toBe('discard');
 // 牌墙空了不能杠
 const e=craft(['1111m 222p 333p 44s 5z 6z','','',''],'',{});
 expect(E.legal(e,0).turn.concealedKongs).toEqual([]);
});
it('lets only added kongs be robbed, and gives the robbed tile to the nearest winner',()=>{
 const R='23m 456p 789p 111s 77z';
 const st=craft(['222p 333p 44s 66z 1m','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s',R,R],'7z 8s',{});
 st.seats[0].melds=[{kind:'pong',tiles:tl('111m'),from:2}];
 const t=act(st,0,{type:'addedKong',code:'m1'});
 expect(t.stage).toBe('robKong');expect(Object.keys(t.response.options)).toEqual(['2','3']);
 expect(t.response.options[2].actions).toEqual(['win']);
 const w=act(act(t,3,{type:'win'}),2,{type:'win'});
 expect(w.result).toMatchObject({type:'robKong',winner:2,from:0,tile:'m1'});
 expect(w.seats[0].hand.some((x: any)=>x.code==='m1')).toBe(false);expect(w.seats[0].melds[0].kind).toBe('pong');
 const p=act(act(t,2,{type:'pass'}),3,{type:'pass'});
 expect(p.seats[0].melds[0].kind).toBe('addedKong');expect(p.turn).toBe(0);
 expect(p.seats[2].passedWin).toBe(true);
 // 关闭抢杠胡：不开窗口
 const off=craft(['222p 333p 44s 66z 1m','',R,R],'7z 8s',{settings:{robKong:false}});
 off.seats[0].melds=[{kind:'pong',tiles:tl('111m'),from:2}];
 expect(act(off,0,{type:'addedKong',code:'m1'}).seats[0].melds[0].kind).toBe('addedKong');
 // 暗杠不能抢
 const c=craft(['1111m 222p 333p 44s 5z 6z','',R,R],'7z 8s',{});
 expect(act(c,0,{type:'concealedKong',code:'m1'}).stage).toBe('discard');
});
it('blocks winning on others after passing a win until the player draws again',()=>{
 const H='123m 456m 789p 111s 7z',F='1z 2z 3z 4z 5z 6z 1s 2s 3s 4s 5s 6s 9p';
 // 座位 3 打 7z，座位 1 能胡但选过；轮到座位 0 摸打，座位 0 再打 7z 时座位 1 不能胡
 const st=craft(['7z 1p 2p 3p 4p 5p 6p 8p 9p 1m 1m 1m 2m 4m',H,F,'7z 111p 222p 333p 99s'],'4m 5m 6m',{turn:3});
 const a=discard(st,3,'z7');
 expect(a.response.options[1].actions).toEqual(['win']);
 const b=act(a,1,{type:'pass'});
 expect(b.seats[1].passedWin).toBe(true);expect(b.turn).toBe(0);
 const c=discard(b,0,'z7');
 expect(c.stage).toBe('discard');expect(c.turn).toBe(1); // 没人能胡，座位 1 直接摸牌
 expect(c.seats[1].passedWin).toBe(false);               // 自己摸牌后解除
 // 过胡状态下自摸不受影响
 const d=craft(['',H.replace('7z','77z'),'',''],'1p',{turn:1});
 d.seats[1].passedWin=true;
 expect(E.legal(d,1).turn.selfWin).toBe(true);
});
it('passes win and chooses pong instead counts as passing the win',()=>{
 const st=craft(['7z 111p 222p 333p 99s','123m 456m 789p 111s 7z 7z'.replace(' 7z 7z',' 77z').replace('111s 77z','11s 77z'),'1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s','1z 2z 3z 4z 5z 6z 7z 1s 2s 3p 7p 8p 9p'],'9p',{});
 const t=discard(st,0,'z7');
 expect(t.response.options[1].actions).toEqual(['win','pong']);
 const p=act(t,1,{type:'pong'});
 expect(p.seats[1].passedWin).toBe(true);expect(p.seats[1].melds[0].kind).toBe('pong');
});
it('ends in a draw when the wall is empty but still allows claims on the last discard',()=>{
 const st=craft(['7z 111p 222p 333p 99s','777z 1m 2m 3m 4m 5m 6m 7m 8m 9m','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s','1z 2z 3z 4z 5z 6z 7z 1s 2s 3p 7p 8p 9p'],'',{});
 const t=discard(st,0,'z7');
 expect(t.response.options[1].actions).toEqual(['pong']); // 没有牌补，不能明杠
 const d=act(t,1,{type:'pass'});
 expect(d.phase).toBe('finished');expect(d.result.type).toBe('draw');expect(E.nextDealer(d)).toBe(0);
 const p=act(t,1,{type:'pong'});expect(p.turn).toBe(1);
 const q=discard(p,1,'m1');expect(q.phase).toBe('finished');
});
it('moves the dealer: dealer wins keeps it, another winner passes it on',()=>{
 const st=craft(['123m 456m 789p 111s 77z','','',''],'1p',{dealer:0});
 const w=act(st,0,{type:'selfWin'});
 expect(w.result).toMatchObject({type:'selfDraw',winner:0,kongFlower:false});expect(E.nextDealer(w)).toBe(0);
 const o=craft(['','123m 456m 789p 111s 77z','',''],'1p',{dealer:0,turn:1});
 expect(E.nextDealer(act(o,1,{type:'selfWin'}))).toBe(1);
 const o2=craft(['','','123m 456m 789p 111s 77z',''],'1p',{dealer:3,turn:2});
 expect(E.nextDealer(act(o2,2,{type:'selfWin'}))).toBe(0);
});
it('treats a discarded ghost as its face, and lets hand ghosts claim as their face',()=>{
 // 红中鬼：座位 0 打出红中，座位 2 手里两张红中可以碰；座位 1 不能把它当万能牌胡
 const st=craft(['5z 111p 222p 333p 99s','123m 456m 789p 111s 7z','55z 1m 4m 7m 1p 4p 7p 1s 4s 7s 2z 3z','1z 2z 3z 4z 6z 7z 1s 2s 3s 7s 8s 9s 9p'],'1p 2p',{ghost:'z5'});
 const t=discard(st,0,'z5');
 expect(t.response.options[2].actions).toEqual(['pong']);
 expect(t.response.options[1]).toBeUndefined();
 // 同一手牌，打出 7z 就能胡
 expect(discard(craft(['7z 111p 222p 333p 99s','123m 456m 789p 111s 7z','','1z'],'1p',{ghost:'z5'}),0,'z7').response.options[1].actions).toEqual(['win']);
 // 翻鬼 m5：手里 m4、m5（鬼）可以吃上家的 m6，但鬼不能当 m7 去吃
 const c=craft(['6m 111p 222p 333p 99s','45m 1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 9p','','1z'],'1p',{ghost:'m5'});
 expect(discard(c,0,'m6').response.options[1].chi).toEqual([['m4','m5']]);
 const c2=craft(['8m 111p 222p 333p 99s','56m 1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 9p','','1z'],'1p',{ghost:'m5'});
 expect(discard(c2,0,'m8').stage).toBe('discard'); // 56m 不能吃 8m
});
it('marks heaven and earth wins only before any discard or claim',()=>{
 const H='123m 456m 789p 234s 99s';
 const st=craft([H,'','',''],'1p',{discarded:false});
 expect(act(st,0,{type:'selfWin'}).result.names).toEqual(['平胡','天胡']);
 const o=craft(['','123m 456m 789p 111s 77z','',''],'1p',{discarded:false,turn:1});
 expect(act(o,1,{type:'selfWin'}).result.names).toEqual(['鸡胡','地胡']);
 const c=craft(['','123m 456m 789p 111s 77z','',''],'1p',{discarded:false,turn:1,claimed:true});
 expect(act(c,1,{type:'selfWin'}).result.names).toEqual(['鸡胡']);
 const d=craft(['7z 111p 222p 333p 99s','123m 456m 789p 111s 7z','',''],'1p',{discarded:false});
 const w=act(discard(d,0,'z7'),1,{type:'win'});expect(w.result.names).toEqual(['鸡胡','地胡']);
 const ds=craft(['123m 456m 789p 111s 77z','','',''],'1p',{discarded:true});
 expect(act(ds,0,{type:'selfWin'}).result.names).toEqual(['鸡胡']);
});
it('refuses self-draw without a fresh draw and when self-draw is off',()=>{
 const st=craft(['123m 456m 789p 111s 77z','','',''],'1p',{drawn:false});
 expect(E.legal(st,0).turn.selfWin).toBe(false);expect(thrown(()=>act(st,0,{type:'selfWin'}))).toBe('现在不能自摸胡');
 const off=craft(['123m 456m 789p 111s 77z','','',''],'1p',{settings:{selfDraw:false}});
 expect(E.legal(off,0).turn.selfWin).toBe(false);
 const noDis=craft(['7z 111p 222p 333p 99s','123m 456m 789p 111s 7z','',''],'1p',{settings:{discardWin:false}});
 expect(discard(noDis,0,'z7').stage).toBe('discard');
});

/* ---------- 计时 / 托管 ---------- */
it('hosts a seat that times out on its turn and discards the freshly drawn tile',()=>{
 const st=craft(['123m 456m 789p 111s 77z','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s','1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s','1z 2z 3z 4z 5z 6z 7z 1s 2s 3p 7p 8p 9p'],'1p 2p 3p',{});
 st.deadline=1000;
 expect(E.advance(st,999).changed).toBe(false);
 const r=E.advance(st,1000);
 expect(r.changed).toBe(true);
 expect(r.state.seats[0].hosted).toBe(true);
 expect(r.state.seats[0].river.map((x: any)=>x.code)).toEqual(['z7']); // 能自摸也不胡，打刚摸的牌
 expect(r.state.turn).toBe(1);
 // 托管后不能自己操作，只能点我回来了
 expect(thrown(()=>act(r.state,0,{type:'pass'}))).toBe('托管中，请先点「我回来了」');
 expect(E.legal(r.state,0)).toMatchObject({hosted:true,canResume:true,turn:null});
});
it('discards the right-most sorted tile when a hosted seat has nothing freshly drawn',()=>{
 const st=craft(['5z 1m 9s 3p','','',''],'1p',{drawn:false,hosted:[true]});
 st.deadline=10;
 const r=E.advance(st,10).state;
 expect(r.seats[0].river.map((x: any)=>x.code)).toEqual(['z5']);
});
it('makes hosted seats pass every response and play their draw after one second',()=>{
 const H='123m 456m 789p 111s 7z';
 const st=craft(['7z 111p 222p 333p 99s',H,'1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s','1z 2z 3z 4z 5z 6z 7z 1s 2s 3p 7p 8p 9p'],'4p 5p',{hosted:[false,true,false,false]});
 const t=discard(st,0,'z7',100);
 expect(t.stage).toBe('discard');expect(t.turn).toBe(1);expect(t.deadline).toBe(100+E.HOSTED_STEP_MS);
 expect(t.seats[1].river).toHaveLength(0);expect(t.seats[0].river.map((x: any)=>x.code)).toEqual(['z7']); // 托管不胡
 const n=E.advance(t,1100).state;
 expect(n.seats[1].river.map((x: any)=>x.code)).toEqual(['p4']);expect(n.turn).toBe(2);
});
it('only takes back a hosted seat on 「我回来了」 and gives a full turn',()=>{
 const st=craft(['123m 456m 789p 111s 77z','','',''],'1p',{hosted:[true]});
 st.deadline=1000;
 const r=act(st,0,{type:'resume'},500);
 expect(r.seats[0].hosted).toBe(false);expect(r.deadline).toBe(500+30000);
 expect(thrown(()=>act(r,0,{type:'resume'}))).toBe('你没有在托管');
 expect(act(r,0,{type:'selfWin'}).phase).toBe('finished');
});
it('treats a response timeout as pass without hosting',()=>{
 const H='123m 456m 789p 111s 7z';
 const st=craft(['7z 111p 222p 333p 99s',H,'1z 2z 3z 4z 5z 6z 7z 1s 2s 3s 7s 8s 9s','1z 2z 3z 4z 5z 6z 7z 1s 2s 3p 7p 8p 9p'],'4p 5p',{});
 const t=discard(st,0,'z7',0);
 expect(t.deadline).toBe(E.RESPONSE_MS);
 const r=E.advance(t,E.RESPONSE_MS).state;
 expect(r.seats[1].hosted).toBe(false);expect(r.seats[1].passedWin).toBe(false);// 自己摸牌后解除
 expect(r.turn).toBe(1);expect(r.stage).toBe('discard');
});
it('voids the hand 60 seconds after all four seats are hosted unless someone returns',()=>{
 const st=craft(['123m 456m 789p 111s 77z','','',''],'1p 2p 3p 4p',{hosted:[false,true,true,true]});
 st.deadline=0;
 const h=E.advance(st,0).state;
 expect(h.allHostedSince).toBe(0);
 const later=E.advance(h,E.ALL_HOSTED_MS).state;
 expect(later.phase).toBe('void');expect(later.result.type).toBe('void');expect(E.nextDealer(later)).toBeNull();
 const back=act(h,2,{type:'resume'},30000);
 expect(back.allHostedSince).toBeNull();
 expect(E.advance(back,E.ALL_HOSTED_MS).state.phase).toBe('playing');
});

/* ---------- 隐藏信息 ---------- */
it('shows only public information to each seat',()=>{
 const st=craft(['1111m 222p 333p 44s 5z 6z','123s 456s 789s 1z 2z 3z 4z','',''],'7z 8s 9s',{});
 const k=act(st,0,{type:'concealedKong',code:'m1'});
 const v1=E.view(k,1),v0=E.view(k,0);
 expect(v1.players[0].hand).toBeNull();expect(v1.players[0].handCount).toBe(k.seats[0].hand.length);
 expect(v1.players[0].melds[0].codes).toBeNull();expect(v0.players[0].melds[0].codes).toEqual(['m1','m1','m1','m1']);
 expect(JSON.stringify(v1)).not.toContain('"wall"');expect(v1.wallCount).toBe(2);
 expect(v1.hand.map((t: any)=>t.code)).toEqual(['s1','s2','s3','s4','s5','s6','s7','s8','s9','z1','z2','z3','z4']);
 expect(v1.lastDrawn).toBeNull();expect(v0.lastDrawn).not.toBeNull();
 // 响应窗口：只看到自己的选项
 const H='123m 456m 789p 111s 7z';
 const r=discard(craft(['7z 111p 222p 333p 99s',H,H,''],'1p',{}),0,'z7');
 expect(E.view(r,1).legal.response.actions).toEqual(['win']);
 expect(JSON.stringify(E.view(r,3))).not.toContain('options');expect(E.view(r,3).legal.response).toBeNull();
 const done=act(r,1,{type:'win'});
 const vd=E.view(done,3);
 expect(vd.players[2].hand).toHaveLength(13);expect(vd.result.winner).toBe(1);
});

/* ---------- 随机对局 ---------- */
it('plays 1000 random hands without errors and never loses or duplicates a tile',()=>{
 const pick=(a: any)=>a[Math.floor(Math.random()*a.length)];
 const ghosts=['none','red','flip'];
 let wins=0,draws=0,voids=0;
 for(let g=0;g<1000;g++){
  const settings=S({honors:g%5!==0,flowers:g%3===0,ghost:ghosts[g%3],chi:g%7!==0,robKong:g%2===0,turnSeconds:15,
   patterns:{chicken:g%4!==0}});
  let st=E.start(settings,null,rnd,0),now=0,steps=0;
  const size=st.deckSize;
  const check=()=>{
   expect(total(st)).toBe(size);
   const ids=[...st.wall,...st.setAside,...(st.indicator?[st.indicator]:[]),...st.seats.flatMap((x: any)=>[...x.hand,...x.flowers,...x.river,...x.melds.flatMap((m: any)=>m.tiles)])].map((t: any)=>t.id);
   expect(new Set(ids).size).toBe(size);
  };
  while(st.phase==='playing'&&steps++<2000){
   const r=Math.random();
   if(r<0.05){now=st.deadline??now;st=E.advance(st,now).state;check();continue;}
   if(r<0.07){const h=st.seats.findIndex((x: any)=>x.hosted);if(h>=0){st=E.apply(st,h,{type:'resume'},now);continue;}}
   if(st.stage==='discard'){
    const L=E.legal(st,st.turn);
    if(!L.turn){now=st.deadline;st=E.advance(st,now).state;check();continue;}
    const opts: any[]=[];
    if(L.turn.selfWin&&Math.random()<0.7)opts.push({type:'selfWin'});
    L.turn.concealedKongs.forEach((c: any)=>opts.push({type:'concealedKong',code:c}));
    L.turn.addedKongs.forEach((c: any)=>opts.push({type:'addedKong',code:c}));
    if(!opts.length||Math.random()<0.5)opts.push({type:'discard',tileId:pick(st.seats[st.turn].hand).id});
    st=E.apply(st,st.turn,pick(opts),now);
   }else{
    const seats=Object.keys(st.response.options).map(Number).filter(s=>E.legal(st,s).response);
    if(!seats.length){now=st.deadline;st=E.advance(st,now).state;check();continue;}
    const s=pick(seats),o=E.legal(st,s).response,choices: any[]=[{type:'pass'}];
    o.actions.forEach((a: any)=>{
     if(a==='chi'){const pair=pick(o.chi);choices.push({type:'chi',tiles:pair.map((c: any)=>st.seats[s].hand.find((t: any)=>t.code===c).id)});}
     else choices.push({type:a});
    });
    if(pair2(choices))choices.push(choices[1]);
    st=E.apply(st,s,pick(choices),now);
   }
   check();
  }
  expect(st.phase).not.toBe('playing');
  if(st.result.type==='draw')draws++;else if(st.result.type==='void')voids++;
  else{
   wins++;
   const w=st.result.winner,x=st.seats[w];
   const a=E.analyzeWin(x.hand.map((t: any)=>({code:t.code,wild:!!st.ghost&&t.code===st.ghost&&!(st.result.type!=='selfDraw'&&t.code===st.result.tile&&t===x.hand[x.hand.length-1])})),x.melds.map((m: any)=>({kind:m.kind,codes:m.tiles.map((t: any)=>t.code)})),{ghost:st.ghost,settings:st.settings,timing:null});
   expect(a.win).toBe(true);
  }
 }
 expect(wins+draws+voids).toBe(1000);
 expect(wins).toBeGreaterThan(0);expect(draws).toBeGreaterThan(0);
},120000);
function pair2(c: any){return c.length>1&&Math.random()<0.5;}
