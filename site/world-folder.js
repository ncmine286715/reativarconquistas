(function(){'use strict';
 var input=document.getElementById('wfFolder'),main=document.getElementById('file'),status=document.getElementById('wfFolderStatus');if(!input||!main)return;
 if(!('webkitdirectory' in input)||!window.DataTransfer){input.closest('details').hidden=true;return;}
 input.addEventListener('change',async function(){
  var files=Array.prototype.slice.call(input.files||[]);if(!files.length)return;input.disabled=true;status.textContent='Preparando a pasta no seu aparelho…';
  try{var total=files.reduce(function(n,f){return n+f.size;},0),maxMb=document.documentElement.getAttribute('data-light-mode')==='true'?32:256;if(files.length>5000||total>maxMb*1024*1024)throw Error('Neste aparelho, a pasta precisa ter até 5.000 arquivos e '+maxMb+' MB. Para mundos maiores, exporte .mcworld no Minecraft.');
   var levels=files.filter(function(f){return /(^|\/)level\.dat$/i.test(f.webkitRelativePath);});if(levels.length!==1)throw Error('Selecione apenas a pasta de um mundo, contendo level.dat e db.');
   var prefix=levels[0].webkitRelativePath.slice(0,-9),zip=new JSZip(),hasDb=false;
   for(var i=0;i<files.length;i++){var f=files[i],relative=f.webkitRelativePath;if(relative.indexOf(prefix)!==0)continue;relative=relative.slice(prefix.length);if(relative.split('/').some(function(p){return !p||p==='.'||p==='..';}))throw Error('A pasta contém um caminho inválido.');if(relative.indexOf('db/')===0)hasDb=true;zip.file(relative,await f.arrayBuffer());}
   if(!hasDb)throw Error('A pasta db não foi encontrada. level.dat sozinho não é um mundo completo.');
   var blob=await zip.generateAsync({type:'blob',compression:'STORE',streamFiles:true}),file=new File([blob],prefix.split('/').filter(Boolean).pop()+'.mcworld',{type:'application/octet-stream'}),transfer=new DataTransfer();transfer.items.add(file);main.files=transfer.files;main.dispatchEvent(new Event('change',{bubbles:true}));status.textContent='Pasta preparada. Confira o diagnóstico antes de exportar.';
  }catch(e){status.textContent=e.message;}finally{input.disabled=false;input.value='';}
 });
})();
