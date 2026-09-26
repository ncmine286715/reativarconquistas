'use strict';
self.window=self;
importScripts('vendor/jszip.min.js','nbt-bedrock.js','leveldb-write.js','builder-core.js','studio-data.js','studio-core.js');
self.onmessage=async function(event){
  try{var bytes=await self.WF_Studio.exportWorld(event.data,function(percent){self.postMessage({type:'progress',percent:percent});});self.postMessage({type:'done',bytes:bytes},[bytes.buffer]);}
  catch(error){self.postMessage({type:'error',message:error.message||'Falha ao gerar mundo.'});}
};
