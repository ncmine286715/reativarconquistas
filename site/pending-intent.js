/* Recovery data only. All payment and operation rights are revalidated remotely. */
(function(root,factory){
  var api=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.WF_pending=api;
})(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  var TTL=2*60*60*1000,MAX=100*1024*1024,KEY='wf_pending_intent_v2';
  var fields=['reactivateAchievements','gamemode','difficulty','showcoords','keepinv','immediaterespawn','mobgriefing','naturalregeneration','daycycle','weather','wantRename','renameInput','recoverHardcore','stripPacks','wantIcon'];
  var fileFields=['file','worldFile','structureFile','packFiles','iconFile'];
  var memoryFiles={}, waiting=false, channel=null;
  function valid(r,now){return !!r && r.version===2 && /^[a-z0-9-]{16,80}$/i.test(r.id||'') && Number.isFinite(r.created_at) && r.created_at<=(now||Date.now())+60000 && (now||Date.now())-r.created_at<TTL && ['conquistas','jogador','mundo','addons','chunks','builder','studio','diagnostico','hardcore','criativo','keep-inventory','upload'].indexOf(r.tool)>=0;}
  function read(){try{var r=JSON.parse(root.sessionStorage.getItem(KEY)||'null');if(valid(r))return r;root.sessionStorage.removeItem(KEY);}catch(e){}return null;}
  function db(){return new Promise(function(resolve,reject){if(!root.indexedDB){reject(new Error('storage_unavailable'));return;}var request=root.indexedDB.open('worldify-pending-v2',1);request.onupgradeneeded=function(){request.result.createObjectStore('recovery');};request.onsuccess=function(){resolve(request.result);};request.onerror=function(){reject(request.error);};});}
  function transaction(mode,fn){return db().then(function(database){return new Promise(function(resolve,reject){var tx=database.transaction('recovery',mode),result;try{result=fn(tx.objectStore('recovery'));}catch(e){database.close();reject(e);return;}tx.oncomplete=function(){database.close();resolve(result && result.result);};tx.onerror=tx.onabort=function(){database.close();reject(tx.error||new Error('storage_failed'));};});});}
  function cleanExpired(){return transaction('readwrite',function(store){var cursor=store.openCursor();cursor.onsuccess=function(){var c=cursor.result;if(!c)return;if(!valid(c.value))c.delete();c.continue();};}).catch(function(){});}
  function capture(tool){
    if(!root)return null;
    var resolved=root.RC_toolIntents && root.RC_toolIntents.resolve(tool);
    if(!resolved)return null;
    var previous=read(), record={version:2,id:previous && previous.id || root.crypto.randomUUID(),created_at:Date.now(),tool:resolved.slug,settings:{},cached:false};
    fields.forEach(function(id){var el=root.document.getElementById(id);if(!el)return;record.settings[id]=el.type==='checkbox'?{checked:el.checked===true}:{value:String(el.value||'').slice(0,80)};});
    try{root.sessionStorage.setItem(KEY,JSON.stringify(record));}catch(e){}
    // Every checkout gets a new snapshot; previous bytes are not reused when
    // the current world exceeds the local recovery limit.
    var files={};var size=0;
    fileFields.forEach(function(id){var el=root.document.getElementById(id),list=el&&el.files&&el.files.length?Array.from(el.files):memoryFiles[id]||[];if(list.length){files[id]=list;list.forEach(function(f){size+=f.size;});}});
    if(!size || size>MAX){transaction('readwrite',function(store){store.delete(record.id);}).catch(function(){});return record;}
    transaction('readwrite',function(store){store.put(Object.assign({},record,{files:files}),record.id);}).then(function(){var current=read();if(current && current.id===record.id && current.created_at===record.created_at){current.cached=true;try{root.sessionStorage.setItem(KEY,JSON.stringify(current));}catch(e){}}}).catch(function(){});
    return record;
  }
  function recoveryMessage(text){var target=root.document.getElementById('toolIntent')||root.document.getElementById('status');if(target){target.hidden=false;target.textContent=text;}}
  async function restore(){
    var record=read();if(!record || !new URLSearchParams(root.location.search).has('resume'))return;
    // Configurations are harmless preferences, never a source of entitlement.
    fields.forEach(function(id){var saved=record.settings&&record.settings[id],el=root.document.getElementById(id);if(!saved||!el)return;if(el.type==='checkbox')el.checked=saved.checked===true;else if(typeof saved.value==='string')el.value=saved.value.slice(0,80);});
    if(record.tool==='builder'){recoveryMessage('Retomando o Construtor. Mantenha a aba original para preservar posição, pintura e histórico. Nesta aba, selecione novamente os arquivos.');return;}
    try{
      var cached=await transaction('readonly',function(store){return store.get(record.id);});
      if(!cached||!valid(cached))throw new Error('no_cached_file');
      // Packs and icon inputs restore before the world to retain normal handlers.
      ['packFiles','iconFile','file'].forEach(function(id){var el=root.document.getElementById(id),list=cached.files && cached.files[id];if(!el||!Array.isArray(list)||!list.length)return;var transfer=new DataTransfer();list.forEach(function(file){transfer.items.add(file);});el.files=transfer.files;el.dispatchEvent(new Event('change',{bubbles:true}));});
      recoveryMessage('Mundo e opções básicas recuperados deste dispositivo. Revise as escolhas antes de gerar. Seleções avançadas de jogador e chunks ficam preservadas na aba original.');
    }catch(e){recoveryMessage('Sua ferramenta e opções básicas foram recuperadas. Selecione o mundo novamente; a cópia temporária não está disponível.');}
  }
  function clear(){var r=read();try{root.sessionStorage.removeItem(KEY);}catch(e){}if(r)transaction('readwrite',function(store){store.delete(r.id);}).catch(function(){});}
  if(root && root.document){
    cleanExpired();
    root.document.addEventListener('worldify-files',function(e){memoryFiles.file=e.detail && e.detail.files || [];});
    root.document.addEventListener('change',function(e){if(e.target && fileFields.includes(e.target.id))memoryFiles[e.target.id]=Array.from(e.target.files||[]);});
    root.addEventListener('rc-context-checkout-started',function(){waiting=true;});
    if(root.BroadcastChannel){channel=new BroadcastChannel('worldify-checkout');channel.onmessage=function(e){var r=read();if(!waiting||!r||!e.data||e.data.type!=='confirmed'||e.data.id!==r.id||!root.RC_entitlements)return;root.RC_entitlements.refresh().then(function(ent){if(!ent.active)return;root.dispatchEvent(new Event('focus'));channel.postMessage({type:'original-ready',id:r.id});recoveryMessage('Pagamento confirmado pelo servidor. Seu mundo e suas escolhas continuam nesta aba. Revise e gere a nova cópia.');}).catch(function(){});};}
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',restore);else restore();
    // Explicit cleanup is also available from the account and successful flow.
    root.document.addEventListener('worldify-operation-completed',clear);
  }
  return {valid:valid,read:read,capture:capture,restore:restore,clear:clear,ttl:TTL,maxBytes:MAX};
});
