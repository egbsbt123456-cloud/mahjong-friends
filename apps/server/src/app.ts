import Fastify from 'fastify';
import {openDatabase} from './database/index.js';
import {registerAuth} from './auth/index.js';
import {registerMahjong} from './games/mahjong-gd.js';
import {RoomPresence,cleanupRooms,CLEANUP_INTERVAL_MS} from './rooms/cleanup.js';
export function createApp(options:{databasePath:string;origin:string;logger?:boolean;production?:boolean;mahjongClock?:()=>number;mahjongRandom?:(max:number)=>number}){
 const app=Fastify({logger:options.logger??true,bodyLimit:16384,trustProxy:'127.0.0.1'});
 const {sqlite}=openDatabase(options.databasePath);
 app.addHook('onRequest',async(_req,reply)=>{reply.header('Cache-Control','no-store');});
 const presence=new RoomPresence();
 app.addHook('onResponse',async(req,reply)=>{presence.record(req.method,req.url,reply.statusCode,Date.now());});
 const runCleanup=(now=Date.now())=>{const result=cleanupRooms(sqlite,now,presence);if(result.cancelledWaiting||result.purged)app.log.info(result,'房间清理');return result;};
 const safeCleanup=()=>{try{runCleanup();}catch(error){app.log.error(error,'房间清理失败');}};
 const cleanupStart=setTimeout(safeCleanup,5000);cleanupStart.unref();
 const cleanupTimer=setInterval(safeCleanup,CLEANUP_INTERVAL_MS);cleanupTimer.unref();
 registerAuth(app,sqlite,options.origin,options.production??false);
 registerMahjong(app,sqlite,options.origin,options.production??false,options.mahjongClock,options.mahjongRandom);
 app.get('/api/health',(_req,reply)=>{try{
  if(!sqlite.prepare('SELECT version FROM schema_migrations WHERE version=1').get())throw new Error('Migration required');
  return {status:'ok',database:'ready'};
 }catch{return reply.code(503).send({status:'unavailable',database:'migration_required'});}});
 app.addHook('onClose',async()=>{clearTimeout(cleanupStart);clearInterval(cleanupTimer);sqlite.close();});
 return {app,cleanupRooms:runCleanup,presence};
}
