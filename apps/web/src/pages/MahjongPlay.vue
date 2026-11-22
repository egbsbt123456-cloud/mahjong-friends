<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue';
import type {MahjongRoomView} from '@board/contracts';
import AccountPanel from '../components/AccountPanel.vue';
import RulesButton from '../components/RulesButton.vue';
import {tileUrl,backUrl,backUrlRot,dealerUrl,tileName} from '../mahjong-tiles';

/* 麻将（广东麻将）好友房页面。规则见 docs/game-rules/mahjong-gd.md。
 * 所有能做的操作都来自服务器下发的 game.legal，页面不自己判定能否胡、碰、杠。 */
type Tile={id:number;code:string};
type Meld={kind:string;from:number|null;codes:string[]|null};
type Player={seat:number;handCount:number;hosted:boolean;melds:Meld[];flowers:string[];river:string[];hand:string[]|null};
type Legal={hosted:boolean;canResume:boolean;turn:null|{discard:boolean;selfWin:boolean;concealedKongs:string[];addedKongs:string[]};response:null|{actions:string[];chi:string[][]}};
type Result={type:'selfDraw'|'discard'|'robKong'|'draw'|'void';winner:number|null;from:number|null;tile:string|null;kongFlower:boolean;patterns:string[];names:string[]};
type Ev={seq:number;kind:string;seat:number|null;code?:string;from?:number;type?:string;auto?:boolean;ghost?:string|null};
type Settings={honors:boolean;flowers:boolean;chi:boolean;pong:boolean;exposedKong:boolean;concealedKong:boolean;addedKong:boolean;selfDraw:boolean;discardWin:boolean;robKong:boolean;ghost:'none'|'red'|'flip';patterns:Record<string,boolean>;turnSeconds:15|30|60};
type Game={phase:'playing'|'finished'|'void';stage:null|'discard'|'response'|'robKong';turn:number|null;deadline:number|null;dealer:number;handNo:number;wallCount:number;ghost:string|null;indicator:string|null;setAside:string[];lastDiscard:{seat:number;code:string}|null;response:null|{kind:string;from:number;code:string};allHostedSince:number|null;hand:Tile[];lastDrawn:number|null;legal:Legal;players:Player[];result:Result|null;events:Ev[]};
type BoolKey='honors'|'flowers'|'chi'|'pong'|'exposedKong'|'concealedKong'|'addedKong'|'selfDraw'|'discardWin'|'robKong';

const PATTERNS:[string,string][]=[['chicken','鸡胡'],['pinghu','平胡'],['pengpeng','碰碰胡'],['qidui','七小对'],['shisanyao','十三幺'],['qingyise','清一色'],['hunyise','混一色'],['dasanyuan','大三元'],['xiaosanyuan','小三元'],['dasixi','大四喜'],['xiaosixi','小四喜'],['tianhu','天胡'],['dihu','地胡']];
const HONOR_ONLY=['shisanyao','dasanyuan','xiaosanyuan','dasixi','xiaosixi','hunyise'];
const SHAPES=['pinghu','pengpeng','qidui','shisanyao','qingyise','hunyise','dasanyuan','xiaosanyuan','dasixi','xiaosixi'];
const CLAIMS:[BoolKey,string][]=[['chi','吃'],['pong','碰'],['exposedKong','明杠'],['concealedKong','暗杠'],['addedKong','补杠']];
const WINS:[BoolKey,string][]=[['selfDraw','自摸胡'],['discardWin','点炮胡'],['robKong','抢杠胡']];
const POS=['me','right','top','left'] as const;
const ALL_HOSTED_MS=60000,RESPONSE_MS=10000;

const user=ref<{nickname:string}|null>(null),room=ref<MahjongRoomView|null>(null),rooms=ref<MahjongRoomView[]>([]);
const code=ref(''),error=ref(''),busy=ref(false),uncertain=ref(false),copied=ref(false);
const picked=ref<number|null>(null),chiOpen=ref(false),showLog=ref(false),dismissedHand=ref<string>('');
const viewport=ref({width:window.innerWidth,height:window.innerHeight}),tick=ref(performance.now());
let clockAnchor={server:Date.now(),local:performance.now()},animationTimer:ReturnType<typeof setInterval>|undefined;
let epoch=0,stopped=false,timer:ReturnType<typeof setTimeout>|undefined;

const game=computed(()=>(room.value?.game??null) as Game|null);
const settings=computed(()=>(room.value?.settings??null) as Settings|null);
const legal=computed(()=>game.value?.phase==='playing'?game.value.legal:null);
const serverNow=computed(()=>clockAnchor.server+(tick.value-clockAnchor.local));
const isHost=computed(()=>!!room.value&&room.value.hostSeat===room.value.yourSeat);
const inGame=computed(()=>room.value?.status==='playing'&&game.value?.phase==='playing');
const portrait=computed(()=>viewport.value.height>viewport.value.width&&viewport.value.width<=900);
const playing=computed(()=>room.value?.status==='playing'&&!!game.value);
// 牌桌按固定画布 1120×600 设计，整体按比例缩放铺满屏幕（竖屏时整桌缩小，上方留出横屏提示）
const W=1120,H=600;
const stageEl=ref<HTMLElement>(),stageSize=ref({w:0,h:0});let ro:ResizeObserver|undefined;
watch(stageEl,el=>{ro?.disconnect();ro=undefined;if(el){ro=new ResizeObserver(([e])=>{if(e)stageSize.value={w:e.contentRect.width,h:e.contentRect.height};});ro.observe(el);}});
const scale=computed(()=>{const w=stageSize.value.w||viewport.value.width,h=(stageSize.value.h||viewport.value.height)-(portrait.value?140:0);return Math.max(0.2,Math.min(1.4,w/W,h/H));});
// 屏幕比 1120×600 更扁（例如手机横屏被浏览器地址栏挤矮）时，把桌面横向拉宽铺满，不留两边空白
const canvasW=computed(()=>{const w=stageSize.value.w||viewport.value.width;return Math.max(W,Math.min(2400,Math.floor(w/scale.value)));});
// 可选全屏：只在浏览器支持时显示（iPhone Safari 不支持网页全屏）
const fsSupported=typeof document!=='undefined'&&!!document.documentElement.requestFullscreen&&document.fullscreenEnabled!==false;
const isFullscreen=ref(!!document.fullscreenElement);
const onFsChange=()=>{isFullscreen.value=!!document.fullscreenElement;};
// 手机：对局中强制全屏。浏览器只允许在点击里进入全屏，所以不在全屏时盖一层「点一下进入全屏」，退出全屏后会再次出现
const isMobile=computed(()=>{void viewport.value;return typeof matchMedia!=='undefined'&&matchMedia('(pointer: coarse)').matches&&Math.min(viewport.value.width,viewport.value.height)<=900;});
const needFs=computed(()=>playing.value&&isMobile.value&&fsSupported&&!isFullscreen.value);
async function enterFullscreen(){
 try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen({navigationUI:'hide'});}
 catch{error.value='这个浏览器不允许全屏，可以试试把网页添加到桌面';return;}
 // 能锁横屏的浏览器（多数安卓）顺便锁成横屏
 try{await (screen.orientation as ScreenOrientation & {lock?:(o:string)=>Promise<void>}).lock?.('landscape');}catch{/* 不支持就算了 */}
}
async function toggleFullscreen(){if(document.fullscreenElement){try{await document.exitFullscreen();}catch{/* 忽略 */}}else await enterFullscreen();}

const nameOf=(seat:number|null|undefined)=>seat===null||seat===undefined?'':room.value?.seats.find(s=>s.seat===seat)?.name??'玩家';
const seatInfo=(seat:number)=>room.value?.seats.find(s=>s.seat===seat);
const playerAt=(pos:typeof POS[number])=>{const r=room.value,g=game.value;if(!r||!g)return null;const seat=(r.yourSeat+POS.indexOf(pos))%4;return g.players[seat]??null;};
const me=computed(()=>playerAt('me'));
const posOf=(seat:number)=>POS[(seat-(room.value?.yourSeat??0)+4)%4]!;
const OPP=[{pos:'left',rot:90},{pos:'top',rot:0},{pos:'right',rot:-90}] as const;
const opps=computed(()=>OPP.flatMap(o=>{const p=playerAt(o.pos);return p?[{pos:o.pos,rot:o.rot,p}]:[];}));
const arrowPos=computed(()=>{const g=game.value;if(!g)return '';const s=g.turn??g.response?.from??null;return s===null?'':posOf(s);});

// 计时
const remainingMs=computed(()=>{const g=game.value;if(!inGame.value||!g?.deadline)return null;return Math.max(0,g.deadline-serverNow.value);});
const remaining=computed(()=>remainingMs.value===null?null:Math.ceil(remainingMs.value/1000));
const stepMs=computed(()=>{const g=game.value,t=(settings.value?.turnSeconds??30)*1000;return g?.stage==='discard'?t:Math.min(RESPONSE_MS,t);});
const ringLevel=computed(()=>remaining.value===null?'':remaining.value<=5?'danger':remaining.value<=10?'warn':'');
const ringStyle=computed(()=>remainingMs.value===null?{}:{'--p':String(Math.min(1,remainingMs.value/stepMs.value))});
const allHostedLeft=computed(()=>{const g=game.value;if(!inGame.value||g?.allHostedSince===null||g?.allHostedSince===undefined)return null;return Math.max(0,Math.ceil((g.allHostedSince+ALL_HOSTED_MS-serverNow.value)/1000));});

// 手牌：刚摸的那张单独放在最右边
const drawn=computed(()=>{const g=game.value;return g&&g.lastDrawn!==null?g.hand.find(t=>t.id===g.lastDrawn)??null:null;});
const handTiles=computed(()=>{const g=game.value;if(!g)return [] as Tile[];return g.hand.filter(t=>t.id!==drawn.value?.id);});
const ghost=computed(()=>game.value?.ghost??null);
const canDiscard=computed(()=>!!legal.value?.turn&&!busy.value&&!uncertain.value);
const respond=computed(()=>busy.value||uncertain.value?null:legal.value?.response??null);
const turnOpts=computed(()=>busy.value||uncertain.value?null:legal.value?.turn??null);

const statusLine=computed(()=>{
 const r=room.value,g=game.value;if(!r)return '';
 if(r.status==='cancelled')return g?.phase==='void'?'四家都托管超过 60 秒，本局作废，房间已关闭':'房间已取消';
 if(r.status==='waiting')return g?.phase==='finished'?`第 ${r.handNo} 局结束 · 四人都准备后开始下一局`:`在座 ${r.seats.length}/4 人 · 四人都准备后开局`;
 if(!g)return '';
 if(legal.value?.hosted)return '你在托管中：系统只打摸到的牌，不吃碰杠胡';
 if(respond.value)return g.stage==='robKong'?`${nameOf(g.response?.from)} 补杠 ${tileName(g.response?.code)}，可以抢杠胡`:`${nameOf(g.response?.from)} 打出 ${tileName(g.response?.code)}`;
 if(turnOpts.value)return turnOpts.value.selfWin?'可以自摸！也可以继续出牌':'轮到你出牌：点一下抬起，再点一次打出';
 if(g.stage==='response'||g.stage==='robKong')return '等待其他玩家响应…';
 return `等待 ${nameOf(g.turn)} 出牌`;
});

// 一局结束 / 作废的结果弹窗
const resultKey=computed(()=>{const r=room.value,g=game.value;return r&&g?.result?`${r.code}-${g.handNo}`:'';});
const resultOpen=computed(()=>!!resultKey.value&&dismissedHand.value!==resultKey.value);
const result=computed(()=>game.value?.result??null);
const resultTitle=computed(()=>{const x=result.value;if(!x)return '';
 if(x.type==='draw')return '流局 · 平局';if(x.type==='void')return '本局作废';
 const who=x.winner===room.value?.yourSeat?'你':nameOf(x.winner);
 return x.type==='selfDraw'?`${who} ${x.kongFlower?'杠上开花':'自摸'}`:x.type==='robKong'?`${who} 抢杠胡`:`${who} 胡了`;});
const resultSub=computed(()=>{const x=result.value;if(!x)return '';
 if(x.type==='discard')return `${nameOf(x.from)} 点炮`;if(x.type==='robKong')return `抢了 ${nameOf(x.from)} 的补杠`;
 if(x.type==='draw')return '牌墙摸完，没有人胡';if(x.type==='void')return '四家都托管超过 60 秒，房间已关闭';return '其他三家负';});
const resultPlayers=computed(()=>{const g=game.value;if(!g)return [] as Player[];return POS.map(p=>playerAt(p)!).filter(Boolean);});

function meldTiles(m:Meld){return m.codes??[null,null,null,null];}
const meldLabel=(m:Meld)=>({chi:'吃',pong:'碰',exposedKong:'明杠',addedKong:'补杠',concealedKong:'暗杠'} as Record<string,string>)[m.kind]??'';
function eventText(e:Ev){
 const n=nameOf,t=tileName;
 switch(e.kind){
  case 'deal':return `第 ${game.value?.handNo??''} 局开始 · ${n(e.seat)} 坐庄${e.ghost?` · 鬼牌 ${t(e.ghost)}`:''}`;
  case 'flower':return `${n(e.seat)} 补花 ${t(e.code)}`;
  case 'kongDraw':return `${n(e.seat)} 杠后从牌尾补牌`;
  case 'discard':return `${n(e.seat)} 打出 ${t(e.code)}${e.auto?'（托管）':''}`;
  case 'chi':return `${n(e.seat)} 吃 ${n(e.from)} 的牌`;
  case 'pong':return `${n(e.seat)} 碰 ${t(e.code)}`;
  case 'kong':return e.type==='concealed'?`${n(e.seat)} 暗杠`:`${n(e.seat)} ${e.type==='added'?'补杠':'明杠'} ${t(e.code)}`;
  case 'addKongTry':return `${n(e.seat)} 要补杠 ${t(e.code)}`;
  case 'win':return `${n(e.seat)} ${e.type==='selfDraw'?'自摸':e.type==='robKong'?'抢杠胡':'胡牌'}`;
  case 'drawGame':return '牌墙摸完，流局';
  case 'hosted':return `${n(e.seat)} 超时，进入托管`;
  case 'resume':return `${n(e.seat)} 回来了`;
  case 'void':return '四家都托管超过 60 秒，本局作废';
 }
 return '';
}
const recentEvents=computed(()=>[...(game.value?.events??[])].filter(e=>e.kind!=='draw').reverse());
const isLastDiscard=(seat:number,i:number)=>{const g=game.value,p=g?.players[seat];return !!g&&!!p&&g.lastDiscard?.seat===seat&&i===p.river.length-1&&p.river[i]===g.lastDiscard.code&&(g.stage==='response'||g.turn!==seat);};

class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
async function api(path:string,body?:unknown){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw new ApiError(data.error||'请求失败',r.status);return data;}
function accept(next:MahjongRoomView){
 clockAnchor={server:next.serverNow??Date.now(),local:performance.now()};tick.value=performance.now();
 const g=next.game as Game|null;
 if(!g?.legal?.turn||!g.hand.some(t=>t.id===picked.value))picked.value=null;
 if(!g?.legal?.response)chiOpen.value=false;
 room.value=next;uncertain.value=false;
}
const BASE='/api/mahjong-gd/rooms';
async function list(current=epoch){const data=await api(BASE);if(current===epoch)rooms.value=data.rooms;}
async function account(){const current=++epoch;room.value=null;rooms.value=[];try{const data=await api('/api/auth/me');if(current!==epoch)return;user.value=data.user;if(user.value)await list(current);}catch(e){if(current===epoch){user.value=null;if(!(e instanceof ApiError&&e.status===401))error.value=e instanceof Error?e.message:'账号暂不可用';}}}
async function enter(join=false,key=code.value){if(busy.value)return;const current=++epoch;busy.value=true;error.value='';try{key=key.trim().toUpperCase();if(join&&!/^[A-F0-9]{10}$/.test(key))throw new Error('请输入好友发来的10位房间码');const data=await api(join?`${BASE}/${key}/join`:BASE,{});if(current===epoch){accept(data);copied.value=false;}}catch(e){if(current===epoch)error.value=e instanceof Error?e.message:'无法进入房间';}finally{busy.value=false;}}
async function resume(key:string){if(busy.value)return;busy.value=true;const current=++epoch;error.value='';try{const next=await api(`${BASE}/${key}`);if(current===epoch)accept(next);}catch(e){if(current===epoch)error.value=e instanceof Error?e.message:'恢复失败';}finally{busy.value=false;}}
async function back(){epoch++;room.value=null;uncertain.value=false;picked.value=null;error.value='';if(user.value)try{await list();}catch(e){error.value=e instanceof Error?e.message:'暂时无法加载房间';}}
async function act(type:string,extra:object={}){
 if(!room.value||busy.value||uncertain.value)return;busy.value=true;error.value='';const current=epoch,key=room.value.code;
 try{const next=await api(`${BASE}/${key}/actions`,{type,requestId:crypto.randomUUID(),expectedVersion:room.value.version,...extra});if(current===epoch&&key===room.value?.code){if(next.left)await back();else accept(next);}}
 catch(e){if(current===epoch){uncertain.value=true;picked.value=null;error.value=e instanceof Error?e.message:'操作未确认，正在同步';}}
 finally{busy.value=false;chiOpen.value=false;}
}
async function poll(){
 if(stopped)return;
 if(room.value&&user.value&&!busy.value){const current=epoch,key=room.value.code;try{const next=await api(`${BASE}/${key}`);if(current===epoch&&room.value?.code===key&&!busy.value&&next.version>=room.value.version){if(uncertain.value)error.value='';accept(next);}}catch(e){if(current===epoch){uncertain.value=true;error.value=e instanceof Error?e.message:'连接中断，正在重试';if(e instanceof ApiError&&e.status===401){user.value=null;room.value=null;window.dispatchEvent(new Event('boardgame:account-changed'));}}}}
 timer=setTimeout(poll,1200);
}

// 出牌：点一下抬起，再点一次（或点「出牌」）打出
function tap(t:Tile){if(!canDiscard.value)return;if(picked.value===t.id){void act('discard',{tileId:t.id});picked.value=null;}else picked.value=t.id;error.value='';}
function discardPicked(){if(canDiscard.value&&picked.value!==null){const id=picked.value;picked.value=null;void act('discard',{tileId:id});}}
function chiWith(pair:string[]){
 const g=game.value;if(!g)return;const used=new Set<number>();
 const ids=pair.map(c=>{const t=g.hand.find(x=>x.code===c&&!used.has(x.id));if(t)used.add(t.id);return t?.id;});
 if(ids.some(x=>x===undefined))return;void act('chi',{tiles:ids});
}
function chi(){const o=respond.value;if(!o)return;if(o.chi.length===1)chiWith(o.chi[0]!);else chiOpen.value=!chiOpen.value;}

// 房主改规则：立即提交（服务器会取消所有人的准备）；先在本地挡住两种不合法组合
function changeSettings(fn:(s:Settings)=>void){
 const s=settings.value;if(!s||!isHost.value||room.value?.status!=='waiting')return;
 const next=JSON.parse(JSON.stringify(s)) as Settings;fn(next);
 if(!next.selfDraw&&!next.discardWin){error.value='自摸胡和点炮胡至少要开一个';return;}
 if(!next.honors)HONOR_ONLY.forEach(k=>next.patterns[k]=false);
 else if(!s.honors)HONOR_ONLY.forEach(k=>next.patterns[k]=true); // 重新打开字牌时恢复字牌类牌型
 if(!next.patterns.chicken&&!SHAPES.some(k=>next.patterns[k])){error.value='关闭鸡胡后，至少要开一种能胡的牌型';return;}
 void act('settings',{settings:next});
}
const setBool=(k:BoolKey,v:boolean)=>changeSettings(s=>{s[k]=v;});
const setPattern=(k:string,v:boolean)=>changeSettings(s=>{s.patterns[k]=v;});
function boolDisabled(k:BoolKey){const s=settings.value!;if(k==='flowers')return !s.honors;if(k==='robKong')return !s.addedKong||!s.discardWin;return false;}
const patternDisabled=(k:string)=>!settings.value!.honors&&HONOR_ONLY.includes(k);
const ghostLabel=(g:string)=>g==='red'?'红中鬼':g==='flip'?'翻鬼':'无鬼';
const deckLabel=computed(()=>{const s=settings.value;if(!s)return '';return !s.honors?'108 张（万条筒）':s.flowers?'144 张（含字牌、花牌）':'136 张（含字牌）';});

async function copy(){try{await navigator.clipboard.writeText(room.value!.code);copied.value=true;}catch{error.value='请手动选择房间码复制';}}
function resize(){viewport.value={width:window.innerWidth,height:window.innerHeight};}
onMounted(()=>{document.addEventListener('fullscreenchange',onFsChange);animationTimer=setInterval(()=>{tick.value=performance.now();},250);window.addEventListener('resize',resize);void account();void poll();window.addEventListener('boardgame:account-changed',account);});
onUnmounted(()=>{document.removeEventListener('fullscreenchange',onFsChange);if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});ro?.disconnect();stopped=true;epoch++;clearTimeout(timer);clearInterval(animationTimer);window.removeEventListener('resize',resize);window.removeEventListener('boardgame:account-changed',account);});
</script>

<template>
 <main class="mj-page" :class="{playing:inGame,portrait}">
  <nav v-if="!playing"><RouterLink to="/">← 首页</RouterLink><button v-if="room" @click="back">房间列表</button><span class="nav-title">麻将</span><RulesButton game="mahjong-gd" /><AccountPanel compact /></nav>

  <section v-if="!room" class="lobby">
   <p class="kicker">四方牌桌 · 房主定规矩</p><h1>四个人，一张桌，打一圈。</h1>
   <p class="intro">广东麻将好友房：四人各自登录，房主建桌后可以选择牌组、吃碰杠、鬼牌和能胡的牌型。<br>没有积分和番数，先胡的人赢；牌墙摸完就是平局。</p>
   <p v-if="!user" class="hint">请先点击右上角“登录 / 注册”。好友也需要登录自己的账号。</p>
   <template v-else>
    <div class="actions-card">
     <div><button class="primary" :disabled="busy" @click="enter(false)">创建牌桌</button><span class="label">建好后再选规则</span></div>
     <span class="or">或</span>
     <form @submit.prevent="enter(true)"><label for="room-code">好友房间码</label><div><input id="room-code" v-model="code" maxlength="10" autocomplete="off" placeholder="10 位房间码"><button :disabled="busy">加入牌桌</button></div></form>
    </div>
    <div v-if="rooms.length" class="resume"><h2>继续我的牌桌</h2><button v-for="item in rooms" :key="item.code" @click="resume(item.code)">{{item.code}} · {{item.status==='waiting'?`等待中 ${item.seats.length}/4`:`第 ${item.handNo} 局进行中`}} →</button></div>
   </template>
   <p v-if="error" class="error" role="alert">{{error}}</p>
  </section>

  <template v-else>
   <!-- 对局中：整张牌桌铺满屏幕，按比例缩放 -->
   <div v-if="playing&&game&&me" ref="stageEl" class="stage" :class="{portrait}">
    <div class="canvas" :style="{'--s':String(scale),width:canvasW+'px'}">
     <aside class="rail">
      <button class="rail-btn" @click="back">房间<br>列表</button>
      <RulesButton game="mahjong-gd" />
      <button class="rail-btn" @click="showLog=!showLog">记录</button>
      <button v-if="fsSupported&&!isMobile" class="rail-btn fs" @click="toggleFullscreen">{{isFullscreen?'退出':'全屏'}}<br>{{isFullscreen?'全屏':'显示'}}</button>
      <div class="rail-info"><small>牌墙</small><b>{{game.wallCount}}</b></div>
      <div v-if="game.ghost" class="rail-info"><small>鬼牌</small><img :src="tileUrl(game.ghost,true)" :alt="`鬼牌 ${tileName(game.ghost)}`"><small v-if="game.indicator">翻 {{tileName(game.indicator)}}</small></div>
      <div v-if="settings" class="rail-info"><small>{{settings.turnSeconds}} 秒/步</small></div>
      <button class="rail-code" :title="copied?'已复制':'复制房间码'" @click="copy"><small>{{copied?'已复制':'牌桌'}}</small><code>{{room.code.slice(0,5)}}<br>{{room.code.slice(5)}}</code></button>
     </aside>
     <div class="felt">
      <template v-for="o in opps" :key="o.pos">
       <div class="hcol" :class="o.pos">
        <span v-for="(mm,mi) in o.p.melds" :key="'m'+mi" class="meld" :title="meldLabel(mm)"><img v-for="(c,ci) in meldTiles(mm)" :key="ci" :src="c?tileUrl(c,false,o.rot):backUrlRot(o.rot)" :alt="c?tileName(c):'暗杠'"></span>
        <span class="backs" :aria-label="`${o.p.handCount} 张手牌`"><img v-for="n in o.p.handCount" :key="n" :src="backUrlRot(o.rot)" alt=""></span>
       </div>
       <div class="river" :class="o.pos"><img v-for="(c,i) in o.p.river" :key="i" :src="tileUrl(c,false,o.rot)" :alt="tileName(c)" :class="{last:isLastDiscard(o.p.seat,i)}"></div>
       <div class="plate" :class="[o.pos,{turn:game.turn===o.p.seat}]">
        <div class="avatar" :class="game.turn===o.p.seat?ringLevel:''" :style="game.turn===o.p.seat?ringStyle:{}"><span>{{nameOf(o.p.seat).slice(0,1)}}</span><img v-if="game.dealer===o.p.seat" class="dealer" :src="dealerUrl" alt="庄"></div>
        <div class="pl-info"><b><i class="dot" :class="{online:seatInfo(o.p.seat)?.online}"></i>{{nameOf(o.p.seat)}}</b>
         <span class="pl-tags"><small>{{o.pos==='left'?'上家':o.pos==='right'?'下家':'对家'}}</small><em v-if="o.p.hosted" class="hosted">托管中</em><b v-if="game.turn===o.p.seat&&remaining!==null&&!o.p.hosted" class="secs" :class="ringLevel">{{remaining}}s</b></span>
         <span v-if="o.p.flowers.length" class="pl-flowers"><img v-for="f in o.p.flowers" :key="f" :src="tileUrl(f)" :alt="tileName(f)"></span></div>
       </div>
      </template>

      <div class="compass">
       <span v-if="arrowPos" class="arrow" :class="arrowPos"></span>
       <p class="c-top">第 {{game.handNo}} 局 · 剩 <b>{{game.wallCount}}</b> 张</p>
       <p v-if="remaining!==null" class="c-time" :class="ringLevel">{{remaining}}</p>
       <p class="c-status">{{allHostedLeft!==null?`四家都在托管 · ${allHostedLeft} 秒后关房`:uncertain?'连接中断，正在同步…':statusLine}}</p>
      </div>

      <div class="river me"><img v-for="(c,i) in me.river" :key="i" :src="tileUrl(c)" :alt="tileName(c)" :class="{last:isLastDiscard(me.seat,i)}"></div>
      <div class="plate me" :class="{turn:game.turn===me.seat}">
       <div class="avatar" :class="game.turn===me.seat||respond?ringLevel:''" :style="game.turn===me.seat||respond?ringStyle:{}"><span>{{nameOf(me.seat).slice(0,1)}}</span><img v-if="game.dealer===me.seat" class="dealer" :src="dealerUrl" alt="庄"></div>
       <div class="pl-info"><b>{{nameOf(me.seat)}}（你）</b>
        <span class="pl-tags"><em v-if="me.hosted" class="hosted">托管中</em><b v-if="(game.turn===me.seat||respond)&&remaining!==null&&!me.hosted" class="secs" :class="ringLevel">{{remaining}}s</b></span>
        <span v-if="me.flowers.length" class="pl-flowers"><img v-for="f in me.flowers" :key="f" :src="tileUrl(f)" :alt="tileName(f)"></span></div>
      </div>

      <div class="act" role="group" aria-label="操作">
       <template v-if="legal?.hosted"><span class="host-note">托管中：只打摸到的牌</span><button class="resume-btn" :disabled="busy||uncertain" @click="act('resume')">我回来了</button></template>
       <template v-else-if="respond">
        <span class="resp-tile"><img :src="tileUrl(game.response!.code)" :alt="tileName(game.response!.code)"></span>
        <button v-if="respond.actions.includes('win')" class="win" @click="act('win')">胡</button>
        <button v-if="respond.actions.includes('exposedKong')" class="claim" @click="act('exposedKong')">杠</button>
        <button v-if="respond.actions.includes('pong')" class="claim" @click="act('pong')">碰</button>
        <button v-if="respond.actions.includes('chi')" class="claim" @click="chi">吃</button>
        <button class="pass" @click="act('pass')">过</button>
        <div v-if="chiOpen" class="chi-pick"><button v-for="(pair,i) in respond.chi" :key="i" @click="chiWith(pair)"><img v-for="c in [...pair,game.response!.code].sort()" :key="c" :src="tileUrl(c)" :alt="tileName(c)"></button></div>
       </template>
       <template v-else-if="turnOpts">
        <small class="act-hint">{{picked===null?'点一下抬起，再点一次打出':'再点一次打出'}}</small>
        <button v-if="turnOpts.selfWin" class="win" @click="act('selfWin')">自摸</button>
        <button v-for="c in turnOpts.concealedKongs" :key="'c'+c" class="claim" @click="act('concealedKong',{code:c})">暗杠 {{tileName(c)}}</button>
        <button v-for="c in turnOpts.addedKongs" :key="'a'+c" class="claim" @click="act('addedKong',{code:c})">补杠 {{tileName(c)}}</button>
        <button class="play" :disabled="picked===null" @click="discardPicked">出牌</button>
       </template>
      </div>

      <div class="myrow">
       <span v-if="me.melds.length" class="my-melds"><span v-for="(mm,mi) in me.melds" :key="mi" class="meld" :title="meldLabel(mm)"><img v-for="(c,ci) in meldTiles(mm)" :key="ci" :src="c?tileUrl(c):backUrl" :alt="c?tileName(c):'暗杠'"></span></span>
       <div class="hand" role="group" aria-label="我的手牌">
        <button v-for="t in handTiles" :key="t.id" class="mjt" :class="{picked:picked===t.id}" :disabled="!canDiscard" :aria-pressed="picked===t.id" :aria-label="tileName(t.code)+(t.code===ghost?'（鬼）':'')" @click="tap(t)"><img :src="tileUrl(t.code,t.code===ghost)" alt=""></button>
        <button v-if="drawn" class="mjt drawn" :class="{picked:picked===drawn.id}" :disabled="!canDiscard" :aria-pressed="picked===drawn.id" :aria-label="'刚摸到 '+tileName(drawn.code)+(drawn.code===ghost?'（鬼）':'')" @click="tap(drawn)"><img :src="tileUrl(drawn.code,drawn.code===ghost)" alt=""></button>
       </div>
      </div>
     </div>
    </div>
    <button v-if="needFs" class="fs-gate" @click="enterFullscreen"><b>⛶</b><span>点一下进入全屏</span><small>全屏后隐藏地址栏，牌更大；退出全屏会回到这里</small></button>
    <div v-if="portrait&&!needFs" class="rotate-big"><b>📱 ↻</b><span>请把手机横过来</span><small>横屏时牌更大、更好点；竖屏也能继续玩。</small></div>
    <p v-if="error" class="toast" role="alert">{{error}}</p>
    <aside v-if="showLog" class="log"><h3>本局记录 <button class="ghost close" @click="showLog=false">收起</button></h3><ol><li v-for="e in recentEvents" :key="e.seq" :class="`ev-${e.kind}`">{{eventText(e)}}</li></ol></aside>
   </div>

   <template v-else>
    <div class="room-bar">
     <span class="code">牌桌 <code>{{room.code}}</code><button class="ghost" @click="copy">{{copied?'已复制':'复制'}}</button></span>
     <span v-if="settings" class="pill">{{settings.turnSeconds}} 秒 / 步</span>
     <strong role="status" class="status-line">{{uncertain?'连接中断，正在同步…':statusLine}}</strong>
     <div class="bar-actions">
      <button v-if="game" class="ghost" @click="showLog=!showLog">记录</button>
      <button v-if="room.status==='waiting'&&game?.result" class="ghost" @click="dismissedHand=''">上局结果</button>
      <button v-if="room.status==='waiting'" :disabled="busy||uncertain" @click="act('leave')">离桌</button>
      <button v-if="room.status==='waiting'&&isHost" :disabled="busy||uncertain" @click="act('cancel')">取消牌桌</button>
     </div>
    </div>
    <p v-if="error" class="error" role="alert">{{error}}</p>

   <!-- 等待：座位 + 规则 -->
   <section v-if="room.status==='waiting'" class="waiting">
    <div class="wait-seats">
     <h2>等好友入座</h2><p>把房间码发给好友；四人到齐并全部准备就开局。房主改规则会取消所有人的准备。</p>
     <ul class="seat-list">
      <li v-for="s in room.seats" :key="s.seat" :class="{ready:s.ready,me:s.seat===room.yourSeat}"><span class="dot" :class="{online:s.online}"></span><b>{{s.name}}</b><small v-if="s.seat===room.hostSeat">房主</small><small v-if="room.dealer===s.seat" class="dealer-tag">下局庄家</small><em>{{s.ready?'已准备':'未准备'}}</em></li>
      <li v-for="n in Math.max(0,4-room.seats.length)" :key="'empty'+n" class="empty">空座位</li>
     </ul>
     <button class="primary big" :disabled="busy||uncertain" @click="act('ready',{ready:!seatInfo(room.yourSeat)?.ready})">{{seatInfo(room.yourSeat)?.ready?'取消准备':game?.result?'准备下一局':'准备'}}</button>
    </div>
    <div v-if="settings" class="settings" :class="{locked:!isHost}">
     <h2>本桌规则 <small>{{isHost?'你是房主，可以修改':'只有房主可以修改'}}</small></h2>
     <div class="set-group"><h3>牌组 <small>{{deckLabel}}</small></h3>
      <label class="toggle"><input type="checkbox" :checked="settings.honors" :disabled="!isHost||busy" @change="setBool('honors',($event.target as HTMLInputElement).checked)"><span>字牌</span></label>
      <label class="toggle" :class="{off:boolDisabled('flowers')}"><input type="checkbox" :checked="settings.flowers" :disabled="!isHost||busy||boolDisabled('flowers')" @change="setBool('flowers',($event.target as HTMLInputElement).checked)"><span>花牌</span></label>
     </div>
     <div class="set-group"><h3>吃碰杠</h3><label v-for="[k,l] in CLAIMS" :key="k" class="toggle"><input type="checkbox" :checked="settings[k]" :disabled="!isHost||busy" @change="setBool(k,($event.target as HTMLInputElement).checked)"><span>{{l}}</span></label></div>
     <div class="set-group"><h3>胡牌方式</h3><label v-for="[k,l] in WINS" :key="k" class="toggle" :class="{off:boolDisabled(k)}"><input type="checkbox" :checked="settings[k]" :disabled="!isHost||busy||boolDisabled(k)" @change="setBool(k,($event.target as HTMLInputElement).checked)"><span>{{l}}</span></label></div>
     <div class="set-group"><h3>鬼牌</h3><div class="segmented"><button v-for="g in ['none','red','flip']" :key="g" :class="{on:settings.ghost===g}" :disabled="!isHost||busy||(g==='red'&&!settings.honors)" @click="changeSettings(s=>{s.ghost=g as Settings['ghost'];})">{{ghostLabel(g)}}</button></div></div>
     <div class="set-group"><h3>牌型 <small>{{settings.patterns.chicken?'鸡胡开：任意 4 组 + 1 对就能胡':'鸡胡关：至少满足一个开启的牌型'}}</small></h3><label v-for="[k,l] in PATTERNS" :key="k" class="toggle" :class="{off:patternDisabled(k)}"><input type="checkbox" :checked="settings.patterns[k]" :disabled="!isHost||busy||patternDisabled(k)" @change="setPattern(k,($event.target as HTMLInputElement).checked)"><span>{{l}}</span></label></div>
     <div class="set-group"><h3>每步限时</h3><div class="segmented"><button v-for="t in [15,30,60]" :key="t" :class="{on:settings.turnSeconds===t}" :disabled="!isHost||busy" @click="changeSettings(s=>{s.turnSeconds=t as Settings['turnSeconds'];})">{{t}} 秒</button></div><p class="note">超时进入托管：只打摸到的牌、一律不吃碰杠胡，点「我回来了」才收回。</p></div>
    </div>
   </section>

   <section v-else-if="room.status==='cancelled'" class="waiting"><div class="wait-seats"><h2>{{statusLine}}</h2><button class="primary big" @click="back">回到房间列表</button></div></section>

    <aside v-if="showLog&&game" class="log"><h3>上局记录 <button class="ghost close" @click="showLog=false">收起</button></h3><ol><li v-for="e in recentEvents" :key="e.seq">{{eventText(e)}}</li></ol></aside>
   </template>

   <!-- 结果 -->
   <div v-if="resultOpen&&result" class="result" role="dialog" aria-live="assertive">
    <div class="result-panel">
     <p class="r-kicker">第 {{game?.handNo}} 局</p>
     <h2 :class="{me:result.winner===room.yourSeat}">{{resultTitle}}</h2>
     <p class="r-sub">{{resultSub}}</p>
     <p v-if="result.names.length" class="r-patterns"><span v-for="n in result.names" :key="n">{{n}}</span></p>
     <p v-if="result.tile" class="r-tile">胡 <img :src="tileUrl(result.tile)" :alt="tileName(result.tile)"></p>
     <div v-if="result.type!=='void'" class="r-hands">
      <div v-for="p in resultPlayers" :key="p.seat" class="r-row" :class="{winner:p.seat===result.winner}">
       <b>{{nameOf(p.seat)}}<small v-if="p.seat===game?.dealer">庄</small><small v-if="p.seat===result.from&&(result.type==='discard'||result.type==='robKong')" class="lose">{{result.type==='discard'?'点炮':'被抢杠'}}</small></b>
       <span class="r-tiles"><img v-for="(c,i) in p.hand??[]" :key="i" :src="tileUrl(c,c===game?.ghost)" :alt="tileName(c)"></span>
       <span class="melds sm"><span v-for="(m,mi) in p.melds" :key="mi" class="meld"><img v-for="(c,ci) in meldTiles(m)" :key="ci" :src="c?tileUrl(c):backUrl" :alt="c?tileName(c):''"></span></span>
      </div>
     </div>
     <div class="end-actions">
      <button v-if="room.status==='waiting'" class="primary" :disabled="busy||uncertain||!!seatInfo(room.yourSeat)?.ready" @click="act('ready',{ready:true});dismissedHand=resultKey">{{seatInfo(room.yourSeat)?.ready?'已准备':'准备下一局'}}</button>
      <button @click="dismissedHand=resultKey">{{room.status==='waiting'?'查看规则 / 座位':'关闭'}}</button>
      <button @click="back">房间列表</button>
     </div>
    </div>
   </div>
  </template>
 </main>
</template>

<style scoped>
.mj-page{--t:46px;--r:26px;--m:30px;--b:12px;min-height:100dvh;background:#f8f7f2;color:#223b34;font-size:14px;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
nav{display:flex;align-items:center;gap:20px;min-height:72px;padding:12px max(20px,calc((100vw - 1200px)/2));border-bottom:1px solid #dedfd5;background:#f8f7f2;position:relative}
nav>a{color:#677970;font-size:13px;white-space:nowrap}.nav-title{flex:1;font-size:19px;font-weight:750;letter-spacing:2px}nav :deep(.account-panel){color:#223b34;top:66px}
button,input{font:inherit}button{cursor:pointer;color:#264f40;background:#fffefa;border:1px solid #d3d8cc;border-radius:6px;padding:9px 14px;transition:background .15s,border-color .15s,transform .15s}button:hover:not(:disabled){background:#edf0e6;border-color:#a4b39f}button:disabled{opacity:.45;cursor:not-allowed}
.primary{background:#264f40;color:#fff;border-color:#264f40}.primary:hover:not(:disabled){background:#345e4d;color:#fff}.ghost{background:transparent}
.lobby{max-width:1100px;margin:0 auto;padding:56px 28px 70px}.kicker{color:#7a8167;letter-spacing:3px;font-size:12px}h1{font-size:40px;letter-spacing:-1px;margin:16px 0}.intro,.hint{color:#69786d;line-height:1.9}
.actions-card{display:flex;align-items:center;gap:28px;flex-wrap:wrap;margin:34px 0;padding:26px;background:#fffefa;border:1px solid #e0e3d9;border-radius:10px}.actions-card>div{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.label{font-size:12px;color:#69786d}.or{color:#818777}
label{font-size:12px;color:#69786d}form label{display:block;margin-bottom:8px}form>div{display:flex;gap:8px}input[type=text],#room-code{width:190px;min-width:0;background:#f8faf5;border:1px solid #bcc9bd;padding:9px;border-radius:5px;text-transform:uppercase;color:#223b34}
.resume button{display:block;margin:10px 0}.error{padding:12px 20px;color:#994a38;background:#f9ebe5;border-radius:6px;max-width:1200px;margin:12px auto}
.room-bar{max-width:1200px;margin:14px auto 0;padding:12px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fffefa;border:1px solid #e0e3d9;border-radius:10px}.room-bar code{letter-spacing:2px;color:#926741;font-size:14px}.room-bar .ghost{padding:5px 9px;font-size:12px;margin-left:6px}.pill{font-size:12px;color:#476a50;background:#edf2e7;border-radius:99px;padding:4px 10px}
.status-line{flex:1;min-width:200px;color:#476a50}.status-line.alert{color:#a5372a}.bar-actions{display:flex;gap:8px;flex-wrap:wrap}.bar-actions button{font-size:12px;padding:7px 11px}

/* ---------- 等待 ---------- */
.waiting{max-width:1100px;margin:24px auto;padding:0 12px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:18px;align-items:start}
.wait-seats,.settings{padding:24px;background:#fffefa;border:1px solid #e0e3d9;border-radius:12px}.wait-seats{text-align:center}.wait-seats p{color:#69786d;line-height:1.8}
.seat-list{list-style:none;padding:0;margin:20px 0;display:grid;gap:10px}.seat-list li{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid #e0e3d9;border-radius:8px;background:#f8faf5}.seat-list li.ready{border-color:#9caf96;background:#eef4ea}.seat-list li.me{box-shadow:inset 3px 0 #264f40}.seat-list em{margin-left:auto;font-style:normal;color:#69786d;font-size:12px}.seat-list small{font-size:11px;color:#926741}.seat-list .dealer-tag{color:#b8262b}.seat-list .empty{color:#a2a89c;border-style:dashed;background:none}.big{padding:13px 34px;font-size:15px}
.settings h2{margin:0 0 6px;font-size:17px}.settings h2 small,.set-group h3 small{font-weight:400;font-size:12px;color:#7a8167;margin-left:6px}
.set-group{padding:12px 0;border-top:1px solid #eceee6}.set-group:first-of-type{border-top:0}.set-group h3{margin:0 0 8px;font-size:13px;color:#264f40}
.toggle{display:inline-flex;align-items:center;gap:6px;margin:0 8px 8px 0;padding:6px 11px 6px 8px;border:1px solid #d3d8cc;border-radius:999px;background:#f8faf5;color:#264f40;font-size:13px;cursor:pointer}.toggle input{accent-color:#264f40;margin:0}.toggle:has(input:checked){background:#e6efe2;border-color:#9caf96}.toggle.off{opacity:.45;cursor:not-allowed}.locked .toggle{cursor:default}
.segmented{display:inline-flex}.segmented button{border-radius:0;margin-left:-1px;padding:7px 14px;font-size:13px}.segmented button:first-child{border-radius:6px 0 0 6px}.segmented button:last-child{border-radius:0 6px 6px 0}.segmented .on{background:#264f40;color:#fff;border-color:#264f40}.note{margin:8px 0 0;font-size:12px;color:#7a8167}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#b8b9ae;margin-right:6px;vertical-align:middle}.dot.online{background:#59a273}

/* ---------- 牌桌（固定画布 1120×600，整体缩放）---------- */
.mj-page.playing{background:#20150c}
.stage{position:fixed;top:env(safe-area-inset-top);bottom:env(safe-area-inset-bottom);left:env(safe-area-inset-left);right:env(safe-area-inset-right);z-index:10;overflow:hidden;background:radial-gradient(ellipse at 50% 40%,#4a3220,#20150c 75%)}
.canvas{--s:1;position:absolute;left:50%;top:50%;width:1120px;height:600px;transform:translate(-50%,-50%) scale(var(--s));transform-origin:center}
.stage.portrait .canvas{top:calc(140px + 300px * var(--s))}
.rotate-big{position:absolute;left:12px;right:12px;top:14px;height:112px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border-radius:14px;background:#f7eee2;color:#805134;text-align:center}
.rotate-big b{font-size:28px;line-height:1}.rotate-big span{font-size:18px;font-weight:800}.rotate-big small{font-size:12px}
.fs-gate{position:absolute;inset:0;z-index:25;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;border:0;border-radius:0;background:#0b241be6;color:#f6ead2;cursor:pointer}
.fs-gate:hover:not(:disabled){background:#0b241bf0;border:0}
.fs-gate b{font-size:46px;line-height:1;color:#e9cf86}.fs-gate span{font-size:22px;font-weight:800}.fs-gate small{font-size:13px;color:#cfd8c6}
.toast{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:30;margin:0;padding:8px 16px;border-radius:8px;background:#f9ebe5;color:#994a38;font-size:13px;box-shadow:0 6px 16px #0005;max-width:90%}

/* 左侧木牌栏 */
.rail{position:absolute;left:0;top:0;bottom:0;width:76px;display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px 6px;border-radius:14px;background:linear-gradient(180deg,#8c5c35,#6d4325 60%,#7d5030);box-shadow:inset 0 1px 0 #ffffff33,0 6px 16px #0006;color:#f6ead2}
.rail-btn{width:62px;padding:8px 2px;font-size:13px;line-height:1.3;background:#f3e3c3;color:#4a2e17;border:1px solid #c79b62;border-radius:8px;font-weight:700}
.rail-btn:hover:not(:disabled){background:#fff3dc;border-color:#c79b62}.rail-btn.fs{background:#e9cf86;border-color:#d29f41}
.rail :deep(.rules-btn){padding:6px 8px 6px 6px;background:#f3e3c3;border-color:#c79b62;color:#4a2e17}
.rail-info{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;color:#f3e3c3}.rail-info b{font-size:22px;line-height:1.1;color:#ffe7a8}.rail-info img{width:36px;height:48px;display:block}
.rail-code{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:2px;width:62px;padding:6px 2px;background:#00000026;border:1px dashed #f3e3c366;border-radius:8px;color:#f3e3c3;font-size:10px}.rail-code:hover:not(:disabled){background:#00000040;border-color:#f3e3c3aa}.rail-code code{font-size:12px;letter-spacing:1px;line-height:1.2;color:#ffe7a8}

/* 绿色桌面（木框用内阴影画，坐标从桌面外沿算） */
.felt{position:absolute;left:84px;top:0;right:0;bottom:0;border-radius:20px;color:#f2ecd9;background:radial-gradient(ellipse at 50% 42%,#33806a 0%,#226350 55%,#174636 100%);box-shadow:inset 0 0 0 10px #7a4d2b,inset 0 0 0 12px #4e2f17,inset 0 0 60px #0b241b88,0 10px 24px #0007}
.felt img{display:block}

/* 三家的立牌和吃碰杠 */
.hcol{position:absolute;display:flex;gap:6px}
.hcol .meld,.hcol .backs{display:flex}
.hcol.top{top:16px;left:50%;transform:translateX(-50%);align-items:flex-end}
.hcol.top .backs{order:-1}.hcol.top .backs img{width:30px;height:40px}.hcol.top .meld img{width:32px;height:43px}
.hcol.left,.hcol.right{top:78px;flex-direction:column}
.hcol.left{left:18px}.hcol.right{right:18px;align-items:flex-end}
.hcol.left .meld,.hcol.right .meld,.hcol.left .backs,.hcol.right .backs{flex-direction:column}
.hcol.left .backs img,.hcol.right .backs img{width:36px;height:27px}
.hcol.left .meld img,.hcol.right .meld img{width:40px;height:30px}

/* 四家牌河，都朝桌子中间摆 */
.river{position:absolute;gap:2px}
.river img{border-radius:3px}
.river img.last{outline:2px solid #f3c34a;outline-offset:1px;box-shadow:0 0 10px #f3c34a}
.river.top,.river.me{left:50%;transform:translateX(-50%);width:412px;display:flex;flex-wrap:wrap}
.river.top{top:64px}
.river.me{bottom:150px;flex-wrap:wrap-reverse}
.river.top img,.river.me img{width:32px;height:43px}
.river.left,.river.right{top:118px;display:grid;grid-auto-flow:column;grid-template-rows:repeat(8,32px);grid-auto-columns:43px}
.river.left{left:64px}.river.right{right:64px;direction:rtl}
.river.left img,.river.right img{width:43px;height:32px}

/* 头像名牌 */
.plate{position:absolute;z-index:2;display:flex;align-items:center;gap:8px;max-width:230px;padding:4px 12px 4px 4px;border-radius:999px;background:#0b241ba6;border:1px solid #ffffff22}
.plate.turn{border-color:#e9cf86;box-shadow:0 0 0 2px #e9cf8655}
.plate.left{left:18px;top:14px}.plate.top{right:18px;top:14px}.plate.right{right:66px;bottom:156px}.plate.me{left:66px;bottom:104px}
.pl-info{display:flex;flex-direction:column;gap:1px;min-width:0;line-height:1.25}
.pl-info>b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl-tags{display:flex;align-items:center;gap:6px;font-size:11px;color:#cfd8c6}
.pl-flowers{display:flex;gap:1px;margin-top:2px}.pl-flowers img{width:15px;height:20px}
.avatar{--p:0;position:relative;flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#e9cf86 calc(var(--p)*360deg),#ffffff22 0);padding:3px}
.avatar span{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:#264f40;color:#fff;font-weight:700;text-transform:uppercase}
.avatar.warn{background:conic-gradient(#f0a640 calc(var(--p)*360deg),#ffffff22 0)}.avatar.danger{background:conic-gradient(#e0533e calc(var(--p)*360deg),#ffffff22 0)}
.dealer{position:absolute;right:-6px;bottom:-4px;width:20px;height:20px}
.secs{font-size:12px;font-weight:700;color:#e9cf86}.secs.warn{color:#f0a640}.secs.danger{color:#ff7a62}
.hosted{font-style:normal;font-size:11px;color:#2b1d0e;background:#e9cf86;border-radius:99px;padding:1px 7px}

/* 桌子中间：指向当前行动的人 */
.compass{position:absolute;left:50%;top:206px;width:220px;height:96px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;border-radius:16px;background:#0b241b80;border:1px solid #e9cf8655;box-shadow:inset 0 0 20px #0005}
.compass p{margin:0}
.c-top{font-size:12px;color:#cfd8c6}.c-top b{color:#ffe7a8;font-size:15px}
.c-time{font-size:24px;font-weight:800;line-height:1;color:#e9cf86}.c-time.warn{color:#f0a640}.c-time.danger{color:#ff7a62}
.c-status{max-width:204px;max-height:34px;overflow:hidden;font-size:12px;line-height:1.4}
.arrow{position:absolute;width:0;height:0;border:12px solid transparent}
.arrow.me{left:50%;bottom:-16px;margin-left:-12px;border-top:14px solid #f0a640;border-bottom:0}
.arrow.top{left:50%;top:-16px;margin-left:-12px;border-bottom:14px solid #f0a640;border-top:0}
.arrow.left{top:50%;left:-16px;margin-top:-12px;border-right:14px solid #f0a640;border-left:0}
.arrow.right{top:50%;right:-16px;margin-top:-12px;border-left:14px solid #f0a640;border-right:0}

/* 自己：操作按钮浮在手牌上方，手牌贴桌子下沿 */
.act{position:absolute;right:66px;bottom:104px;z-index:5;display:flex;align-items:center;gap:8px}
.act button{min-width:58px;padding:9px 16px;font-size:16px;font-weight:700;border-radius:10px;box-shadow:0 4px 10px #0005}
.act .win{background:#b8262b;color:#fff;border-color:#b8262b;box-shadow:0 0 0 3px #f3c34a88,0 4px 10px #0005}.act .win:hover:not(:disabled){background:#a01f24;color:#fff}
.act .claim{background:#264f40;color:#fff;border-color:#e9cf86}.act .claim:hover:not(:disabled){background:#345e4d;color:#fff}
.act .play{background:#926741;color:#fff;border-color:#926741}.act .play:hover:not(:disabled){background:#7d5636;color:#fff}
.act .resume-btn{background:#d29f41;color:#2b1d0e;border-color:#d29f41;font-size:17px;padding:10px 22px}
.act-hint{font-size:12px;color:#f3e3c3}.host-note{font-size:13px;color:#ffe7a8}
.resp-tile img{width:34px;height:45px;filter:drop-shadow(0 0 6px #f3c34a)}
.chi-pick{position:absolute;right:0;bottom:calc(100% + 8px);display:flex;gap:8px;padding:8px;background:#fffefa;border:1px solid #d3d8cc;border-radius:10px;box-shadow:0 8px 20px #0006}.chi-pick button{display:flex;gap:0;padding:4px;min-width:0;box-shadow:none}.chi-pick img{width:30px;height:40px}
.myrow{position:absolute;left:60px;right:60px;bottom:14px;display:flex;justify-content:center;align-items:flex-end;gap:14px}
.my-melds{display:flex;gap:6px}.my-melds .meld{display:flex}.my-melds img{width:42px;height:56px}
.hand{display:flex;align-items:flex-end;gap:1px}
.mjt{padding:0;border:0;background:none;border-radius:6px;transition:transform .12s}
.mjt img{width:58px;height:77px;filter:drop-shadow(0 3px 3px #0006)}
.mjt:disabled{opacity:1;cursor:default}.mjt:not(:disabled):hover{transform:translateY(-5px);background:none}
.mjt.picked{transform:translateY(-14px)}.mjt.picked img{filter:drop-shadow(0 0 8px #f3c34a)}
.mjt.drawn{margin-left:16px}.mjt:focus-visible{outline:3px solid #d29f41;outline-offset:2px}

/* 记录抽屉 */
.log{position:fixed;right:10px;top:10px;bottom:10px;width:260px;z-index:40;overflow:auto;padding:12px 14px;background:#fffefa;color:#223b34;border:1px solid #e0e3d9;border-radius:12px;box-shadow:0 10px 30px #0006}
.log h3{margin:0 0 8px;font-size:13px;display:flex;justify-content:space-between;align-items:center}.log .close{padding:3px 8px;font-size:11px}
.log ol{list-style:none;margin:0;padding:0}.log li{padding:5px 0;border-bottom:1px dashed #e8eae2;font-size:12px;color:#4f5f55}.log .ev-win{color:#b8262b;font-weight:700}.log .ev-hosted{color:#805134}

/* ---------- 结果 ---------- */
.result{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px;background:#0b241bb3}
.result-panel{width:min(760px,100%);max-height:92dvh;overflow:auto;padding:22px 24px;border-radius:16px;background:#fffefa;text-align:center;box-shadow:0 20px 50px #0007}
.r-kicker{margin:0;font-size:11px;letter-spacing:3px;color:#7a8167}.result h2{margin:6px 0 2px;font-size:28px;color:#264f40}.result h2.me{color:#b8262b}.r-sub{margin:0;color:#69786d}
.r-patterns{display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin:12px 0 4px}.r-patterns span{padding:3px 12px;border-radius:99px;background:#b8262b;color:#fff;font-weight:700;font-size:13px}
.r-tile{display:flex;align-items:center;justify-content:center;gap:6px;margin:8px 0;color:#69786d}.r-tile img{width:30px;height:40px}
.r-hands{display:grid;gap:8px;margin:14px 0;text-align:left}.r-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-radius:10px;background:#f4f6ef}.r-row.winner{background:#fbefe6;box-shadow:inset 3px 0 #b8262b}.r-row b{min-width:84px;font-size:13px}.r-row small{margin-left:4px;font-size:10px;color:#fff;background:#926741;border-radius:4px;padding:1px 4px}.r-row small.lose{background:#69786d}
.r-tiles{display:flex;gap:0}.r-tiles img{width:24px;height:32px}.r-row .melds{--m:28px}
.end-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:8px}

/* ---------- 小屏：只影响大厅、等待页和结果弹窗（牌桌整体缩放，不需要单独适配）---------- */
@media (max-height:520px){
 nav{min-height:40px;padding:4px 14px;gap:12px}.nav-title{font-size:15px}nav :deep(.account-panel){top:38px}
 .room-bar{margin:4px 8px 0;padding:4px 10px;gap:8px;border-radius:8px}.room-bar .pill{display:none}.status-line{min-width:0;font-size:12px}.bar-actions button{padding:4px 8px}
 .waiting{grid-template-columns:1fr 1.4fr;margin:8px auto}
}
@media (max-width:600px){
 nav{gap:10px;padding:8px 12px;min-height:56px}nav :deep(.account-panel){top:52px}
 .lobby{padding:28px 18px}h1{font-size:28px}
 .room-bar{margin:8px;padding:8px 10px}.status-line{flex-basis:100%;order:3;font-size:13px}
 .waiting{grid-template-columns:1fr;margin:10px auto}
 .result-panel{padding:16px 12px}.r-row b{min-width:0;width:100%}.r-tiles img{width:calc((100vw - 64px)/14);height:calc((100vw - 64px)/14*4/3)}
 .log{left:8px;right:8px;width:auto;top:auto;max-height:55dvh}
}
</style>
