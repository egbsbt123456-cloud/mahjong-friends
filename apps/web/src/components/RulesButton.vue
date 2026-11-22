<script setup lang="ts">
import {computed,nextTick,onUnmounted,ref,watch} from 'vue';
import {GAME_RULES} from '../rules';
const props=defineProps<{game:string}>();
const rules=computed(()=>GAME_RULES[props.game]);
const open=ref(false),closeButton=ref<HTMLButtonElement>();
let opener:HTMLElement|null=null;
function show(e:MouseEvent){opener=e.currentTarget as HTMLElement;open.value=true;}
function close(){open.value=false;opener?.focus();}
function key(e:KeyboardEvent){if(e.key==='Escape'&&open.value)close();}
watch(open,v=>{if(v){window.addEventListener('keydown',key);void nextTick(()=>closeButton.value?.focus());}else window.removeEventListener('keydown',key);});
onUnmounted(()=>window.removeEventListener('keydown',key));
</script>
<template>
 <button v-if="rules" type="button" class="rules-btn" aria-haspopup="dialog" @click="show"><span aria-hidden="true">？</span>规则</button>
 <Teleport to="body">
  <div v-if="open&&rules" class="rules-backdrop" @click.self="close">
   <section class="rules-sheet" role="dialog" aria-modal="true" :aria-label="`${rules.name}规则`">
    <header><h2>{{rules.name}} · 规则</h2><button ref="closeButton" type="button" class="rules-close" aria-label="关闭规则" @click="close">×</button></header>
    <div class="rules-body">
     <section v-for="s in rules.sections" :key="s.title"><h3>{{s.title}}</h3><ul><li v-for="(item,i) in s.items" :key="i">{{item}}</li></ul></section>
    </div>
    <footer><button type="button" class="rules-ok" @click="close">知道了</button></footer>
   </section>
  </div>
 </Teleport>
</template>
<style scoped>
.rules-btn{display:inline-flex;align-items:center;gap:4px;flex:none;white-space:nowrap;cursor:pointer;font:inherit;font-size:12px;line-height:1;color:#264f40;background:#fffefa;border:1px solid #c9d2c4;border-radius:999px;padding:7px 11px 7px 8px}
.rules-btn span{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#264f40;color:#fff;font-size:10px;font-weight:700}
.rules-btn:hover{background:#edf0e6;border-color:#a4b39f}
.rules-btn:focus-visible,.rules-close:focus-visible,.rules-ok:focus-visible{outline:3px solid #d29f41;outline-offset:2px}
.rules-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:#223b3466}
.rules-sheet{display:flex;flex-direction:column;width:min(600px,100%);max-height:min(82dvh,760px);background:#fffefa;color:#223b34;border:1px solid #e0e3d9;border-radius:14px;box-shadow:0 20px 50px #223b3440;font-family:Inter,"Microsoft YaHei",sans-serif}
.rules-sheet header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid #e8eae2}
.rules-sheet h2{margin:0;font-size:18px;letter-spacing:1px}
.rules-close{width:34px;height:34px;border-radius:50%;border:1px solid #d3d8cc;background:#f8faf5;color:#264f40;font-size:20px;line-height:1;cursor:pointer}
.rules-body{overflow:auto;padding:6px 20px 12px;-webkit-overflow-scrolling:touch}
.rules-body h3{margin:16px 0 6px;font-size:14px;color:#264f40}
.rules-body ul{margin:0;padding-left:18px}
.rules-body li{margin:5px 0;font-size:13px;line-height:1.75;color:#4f5f55}
.rules-sheet footer{padding:12px 20px 16px;border-top:1px solid #e8eae2;text-align:right}
.rules-ok{border:1px solid #264f40;background:#264f40;color:#fff;border-radius:6px;padding:10px 22px;font:inherit;font-size:14px;cursor:pointer}
@media(max-width:600px){
 .rules-btn{padding:6px 9px 6px 6px;font-size:11px}
 .rules-backdrop{place-items:end stretch;padding:0}
 .rules-sheet{width:100%;max-height:86dvh;border-radius:16px 16px 0 0;border-bottom:0}
 .rules-sheet footer{padding-bottom:calc(14px + env(safe-area-inset-bottom))}
 .rules-ok{width:100%}
}
</style>
