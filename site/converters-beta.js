/* Local, bounded beta conversions. Never claims eligibility on behalf of Minecraft. */
(function(){'use strict';
 var MAX=32*1024*1024;
 function download(blob,name){var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},30000);}
 function boundedZip(zip,budget){zip.forEach(function(name,entry){var original=String(entry.unsafeOriginalName||name).replace(/\\/g,'/');if(original.charAt(0)==='/'||original.split('/').some(function(p){return p==='..';}))throw Error('O pacote contém um caminho inválido.');if(entry.dir)return;budget.files++;budget.bytes+=entry._data&&entry._data.uncompressedSize||0;});if(budget.files>5000||budget.bytes>64*1024*1024)throw Error('Este beta aceita até 5.000 arquivos e 64 MB descompactados, incluindo pacotes internos.');}
 async function prepareAddon(file){
  if(!file||file.size>MAX)throw Error('Escolha um addon de até 32 MB.');
  var root=await JSZip.loadAsync(await file.arrayBuffer()),budget={bytes:0,files:0};var manifests=[],warnings=[],packCount=0;
  async function convert(zip,depth){
   boundedZip(zip,budget);var names=Object.keys(zip.files);
   for(var i=0;i<names.length;i++){
    var name=names[i],entry=zip.files[name];if(entry.dir)continue;
    if(/(^|\/)manifest\.json$/i.test(name)){
     var manifest;try{manifest=JSON.parse((await entry.async('string')).replace(/^\uFEFF/,''));}catch(e){throw Error('Manifest inválido: '+name);}
     if(!manifest.header||!manifest.header.uuid||!Array.isArray(manifest.modules)||!manifest.modules.length)throw Error('Manifest incompleto: '+name);
     if(manifest.format_version!==2)throw Error('Este beta aceita manifests de versão 2.');
     if(manifest.metadata&&(typeof manifest.metadata!=='object'||Array.isArray(manifest.metadata)))throw Error('Metadata inválida: '+name);
     manifest.metadata=manifest.metadata||{};manifest.metadata.product_type='addon';
     zip.file(name,JSON.stringify(manifest,null,2));manifests.push(name);packCount++;
     if(manifest.modules.some(function(m){return m.type==='script';}))warnings.push('Há scripts. APIs beta e experimentos podem impedir conquistas.');
     if(manifest.capabilities&&manifest.capabilities.length)warnings.push('Há recursos especiais no manifest. Confira os requisitos dentro do jogo.');
    }else if(/\.(mcpack|mcaddon)$/i.test(name)){
     if(depth>=2)throw Error('Pacotes aninhados demais para este beta.');
     var nested=await JSZip.loadAsync(await entry.async('uint8array'));await convert(nested,depth+1);zip.file(name,await nested.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:1}}));
    }
   }
  }
  await convert(root,0);if(!packCount)throw Error('Nenhum manifest de addon encontrado.');
  return {blob:await root.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:1},streamFiles:true}),name:file.name.replace(/\.(mcpack|mcaddon|zip)$/i,'')+'-worldify.'+(/\.mcpack$/i.test(file.name)?'mcpack':'mcaddon'),count:packCount,warnings:Array.from(new Set(warnings))};
 }
 function encodeStructure(model){
  var N=window.RC_nbt2,size=model.size,indices=Array(model.volume).fill(-1),empty=Array(model.volume).fill(-1);
  model.blocks.forEach(function(b){indices[(b.x*size[1]+b.y)*size[2]+b.z]=model.palette.indexOf(b.block);});
  function tag(t,name,v){return N.N(t,name,v);}function compound(name,map){return tag(N.T_COMPOUND,name,N.compound(map));}function ints(name,values){return tag(N.T_LIST,name,N.listOf(N.T_INT,values.map(function(n){return tag(N.T_INT,'',n);})))}
  var entries=model.palette.map(function(p){return N.parse(p.raw).root;});
  return N.encode(compound('',{format_version:tag(N.T_INT,'format_version',1),size:ints('size',size),structure_world_origin:ints('structure_world_origin',[0,0,0]),structure:compound('structure',{block_indices:tag(N.T_LIST,'block_indices',N.listOf(N.T_LIST,[ints('',indices),ints('',empty)])),entities:tag(N.T_LIST,'entities',N.listOf(N.T_COMPOUND,[])),palette:compound('palette',{default:compound('default',{block_palette:tag(N.T_LIST,'block_palette',N.listOf(N.T_COMPOUND,entries)),block_position_data:compound('block_position_data',{})})})})}));
 }
 var dependencies;
 function loadStructure(){if(dependencies)return dependencies;dependencies=window.WF_loadScript('builder-config.js?v=1').then(function(){return window.WF_loadScript('java-structure.js?v=20260930');});return dependencies;}
 function wire(){
  var addon=document.getElementById('wfAddonConvert'),structure=document.getElementById('wfLitematicConvert');
  addon.onclick=async function(){var output=document.getElementById('wfAddonResult');addon.disabled=true;output.textContent='Analisando o pacote no seu aparelho…';try{var r=await prepareAddon(document.getElementById('wfAddonFile').files[0]);download(r.blob,r.name);output.textContent=r.count+' manifest(s) preparado(s). Teste em uma cópia do mundo.\n'+r.warnings.join('\n')+'\nA compatibilidade com conquistas não é garantida.';}catch(e){output.textContent=e.message;}finally{addon.disabled=false;}};
  structure.onclick=async function(){var output=document.getElementById('wfLitematicResult');structure.disabled=true;output.textContent='Lendo a estrutura…';try{var file=document.getElementById('wfLitematicFile').files[0];if(!file||file.size>MAX)throw Error('Escolha um .litematic de até 32 MB.');if(!window.BigInt||!DataView.prototype.getBigInt64)throw Error('Esta conversão precisa de um navegador com suporte a BigInt.');await loadStructure();var model=await window.RC_javaStructure.parse(file),bytes=encodeStructure(model);download(new Blob([bytes],{type:'application/octet-stream'}),file.name.replace(/\.litematic$/i,'')+'-worldify.mcstructure');output.textContent='Estrutura convertida: '+model.size.join(' × ')+' blocos. Importe com um bloco de estrutura ou no Construtor 3D.';}catch(e){output.textContent=e.message;}finally{structure.disabled=false;}};
 }
 window.WF_converters={prepareAddon:prepareAddon,encodeStructure:encodeStructure,wire:wire};
})();
