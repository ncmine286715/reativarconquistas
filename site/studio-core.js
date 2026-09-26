/* World Studio: deterministic terrain shared by preview and native Bedrock export.
   This is a custom landscape generator, not Mojang's seed generator. */
(function (root) {
  'use strict';
  var D=root.WF_STUDIO_DATA, VOID=65535, SEA=62, CELL=4;
  var byId={};D.biomes.forEach(function(b){byId[b.id]=b;});
  function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
  function seedNumber(s){var h=2166136261;for(var i=0;i<String(s).length;i++)h=Math.imul(h^String(s).charCodeAt(i),16777619);return h>>>0;}
  function hash(x,z,seed){var h=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;}
  function noise(x,z,scale,seed){var a=Math.floor(x/scale),b=Math.floor(z/scale),u=x/scale-a,v=z/scale-b;u=u*u*(3-2*u);v=v*v*(3-2*v);return (hash(a,b,seed)*(1-u)+hash(a+1,b,seed)*u)*(1-v)+(hash(a,b+1,seed)*(1-u)+hash(a+1,b+1,seed)*u)*v;}
  function profile(id){
    if(id===VOID)return {name:'void',label:'Vazio',color:'#172335',top:'air',base:'air',height:-65,relief:0,tree:0};
    var b=byId[id];if(!b)throw Error('Bioma desconhecido: '+id);var n=b.name;
    var p={name:n,label:b.label,color:'#83ab50',top:'grass_block',base:'stone',height:68,relief:7,tree:/plains/.test(n)?.004:0,log:'oak_log',leaves:'oak_leaves'};
    if(/ocean|river/.test(n))Object.assign(p,{color:/frozen/.test(n)?'#91bdcc':'#347fab',top:'sand',height:/deep/.test(n)?32:/river/.test(n)?56:44,relief:4,water:true,frozen:/frozen/.test(n)});
    else if(/beach/.test(n))Object.assign(p,{color:'#d4c58e',top:/stone/.test(n)?'gravel':'sand',height:64,relief:2});
    else if(/desert/.test(n))Object.assign(p,{color:'#d9c789',top:'sand',base:'sandstone',height:69,relief:6,tree:.012});
    else if(/mesa/.test(n))Object.assign(p,{color:'#ba7045',top:'red_sand',base:'hardened_clay',height:81,relief:22});
    else if(/mushroom/.test(n))Object.assign(p,{color:'#a588a4',top:'mycelium',height:71,relief:9});
    else if(/swamp/.test(n))Object.assign(p,{color:'#537b59',top:/mangrove/.test(n)?'mud':'grass_block',height:63,relief:4,water:true,tree:.008,log:/mangrove/.test(n)?'mangrove_log':'oak_log',leaves:/mangrove/.test(n)?'mangrove_leaves':'oak_leaves'});
    else if(n==='hell')Object.assign(p,{color:'#94564d',top:'netherrack',base:'netherrack',height:70,relief:14});
    else if(n==='soulsand_valley')Object.assign(p,{color:'#816857',top:'soul_sand',base:'netherrack',height:67,relief:12});
    else if(n==='crimson_forest'||n==='warped_forest')Object.assign(p,{color:n==='crimson_forest'?'#9c435b':'#39968c',top:n==='crimson_forest'?'crimson_nylium':'warped_nylium',base:'netherrack',height:72,relief:10});
    else if(n==='basalt_deltas')Object.assign(p,{color:'#696a72',top:'basalt',base:'blackstone',height:75,relief:19});
    else if(n==='the_end')Object.assign(p,{color:'#cfca91',top:'end_stone',base:'end_stone',height:70,relief:14});
    else if(/caves|deep_dark/.test(n))Object.assign(p,{color:n==='lush_caves'?'#648851':n==='sulfur_caves'?'#c5b560':'#354749',top:n==='lush_caves'?'moss_block':n==='deep_dark'?'sculk':n==='sulfur_caves'?'sulfur':'stone',height:68,relief:8,caves:true});
    else if(/snow|ice|frozen|cold_taiga|grove$/.test(n)&&n!=='cherry_grove')Object.assign(p,{color:'#c4d4d8',top:'snow',height:/peaks|mountains/.test(n)?111:75,relief:/peaks|slopes/.test(n)?32:10,tree:/taiga|grove/.test(n)?.007:0,log:'spruce_log',leaves:'spruce_leaves'});
    else if(/peaks|extreme_hills/.test(n))Object.assign(p,{color:'#919a88',top:'stone',height:106,relief:34,tree:/trees/.test(n)?.003:0});
    else if(/forest|jungle|taiga|garden|cherry/.test(n)){
      Object.assign(p,{color:/cherry/.test(n)?'#dfb0be':/pale/.test(n)?'#a5afa0':/taiga/.test(n)?'#5a8264':'#4e8855',height:72,relief:12,tree:/jungle|roofed/.test(n)?.03:.02});
      if(/taiga/.test(n)){p.log='spruce_log';p.leaves='spruce_leaves';p.top='podzol';}
      if(/jungle/.test(n)){p.log='jungle_log';p.leaves='jungle_leaves';}
      if(/birch/.test(n)){p.log='birch_log';p.leaves='birch_leaves';}
      if(/cherry/.test(n)){p.log='cherry_log';p.leaves='cherry_leaves';}
      if(/pale/.test(n)){p.log='pale_oak_log';p.leaves='pale_oak_leaves';}
    }else if(/savanna/.test(n))Object.assign(p,{color:'#aeb05e',height:76,relief:12,tree:.005,log:'acacia_log',leaves:'acacia_leaves'});
    if(/hills|plateau/.test(n)){p.height+=10;p.relief+=7;}
    return p;
  }
  var profiles={};D.biomes.forEach(function(b){profiles[b.id]=profile(b.id);});profiles[VOID]=profile(VOID);
  function create(size,preset,seed){
    size=[64,128,256].includes(+size)?+size:128;var n=size/CELL,base=preset==='void'?VOID:preset==='ocean'||preset==='island'?0:1;
    var m={version:1,size:size,preset:preset||'island',seed:String(seed||'Worldify'),name:'Meu mundo Worldify',underground:'simple',biomes:Array(n*n).fill(base),elevation:Array(n*n).fill(0),structures:[],spawn:{x:Math.floor(size/2),z:Math.floor(size/2)},platform:true,trees:true};
    if(preset==='island')for(var z=0;z<n;z++)for(var x=0;x<n;x++){var d=Math.hypot((x-n/2)/(n*.37),(z-n/2)/(n*.32));m.biomes[z*n+x]=d<.72?4:d<.85?1:d<1.1?16:0;}
    return m;
  }
  function validate(m){
    if(!m||m.version!==1||![64,128,256].includes(m.size))throw Error('Projeto incompatível.');var n=m.size/CELL,total=n*n;
    if(!Array.isArray(m.biomes)||m.biomes.length!==total||m.biomes.some(function(id){return !profiles[id];}))throw Error('Paleta de biomas inválida.');
    if(!Array.isArray(m.elevation)||m.elevation.length!==total||m.elevation.some(function(v){return !Number.isInteger(v)||v < -96||v>144;}))throw Error('Relevo inválido.');
    if(!Array.isArray(m.structures)||m.structures.length>100)throw Error('Limite de 100 estruturas.');
    if(!['void','ocean','grass','island'].includes(m.preset))throw Error('Base inválida.');
    if(m.underground===undefined)m.underground='simple';if(m.underground!=='simple'&&m.underground!=='full')throw Error('Subsolo inválido.');
    if(typeof m.seed!=='string'||m.seed.length>80||typeof m.name!=='string'||m.name.length>80)throw Error('Nome ou seed inválido.');
    if(!m.spawn||!Number.isInteger(m.spawn.x)||!Number.isInteger(m.spawn.z)||m.spawn.x<3||m.spawn.z<3||m.spawn.x>=m.size-3||m.spawn.z>=m.size-3)throw Error('Spawn fora da área.');
    var importedBlocks=0;for(var s of m.structures){if(!s||!Number.isInteger(s.x)||!Number.isInteger(s.z)||s.x<0||s.z<0||s.x>=m.size||s.z>=m.size||!['tree','cabin','tower','well','custom'].includes(s.kind))throw Error('Estrutura inválida.');if(s.kind==='custom'){validateCustom(s.custom);importedBlocks+=s.custom.blocks.length;if(importedBlocks>300000)throw Error('Limite de 300 mil blocos importados por projeto.');}}
    if(JSON.stringify(m).length>8*1024*1024)throw Error('Limite de 8 MB por projeto.');
    return m;
  }
  function validateCustom(c){if(!c||!Array.isArray(c.size)||c.size.length!==3||c.size.some(function(n){return !Number.isInteger(n)||n<1||n>64;})||c.size.reduce(function(a,b){return a*b;},1)>120000||!Array.isArray(c.blocks)||c.blocks.length!==c.size.reduce(function(a,b){return a*b;},1)||!Array.isArray(c.palette)||!c.palette.length||c.palette.length>4096||c.palette.some(function(p){return !p||!/^minecraft:[a-z0-9_]+$/.test(p.name)||!Array.isArray(p.raw)||p.raw.length>8192||p.raw.some(function(b){return !Number.isInteger(b)||b<0||b>255;});})||c.blocks.some(function(i){return !Number.isInteger(i)||i < -1||i>=c.palette.length;}))throw Error('Estrutura importada inválida.');}
  function sstep(a,b,t){var u=clamp((t-a)/(b-a),0,1);return u*u*(3-2*u);}
  function cellNode(m,n,cx,cz,seed){if(cx<0)cx=0;if(cz<0)cz=0;if(cx>=n)cx=n-1;if(cz>=n)cz=n-1;var id=m.biomes[cz*n+cx];if(id===VOID)return null;var h=profiles[id].height+m.elevation[cz*n+cx],r=profiles[id].relief;if(m.preset==='island'){var bx=cx*CELL+2,bz=cz*CELL+2,ix=(bx-m.size/2)/(m.size*.37),iz=(bz-m.size/2)/(m.size*.32),dd=Math.sqrt(ix*ix+iz*iz),mask=1-sstep(.85,1.3,dd),floor=40+8*(1-sstep(1.0,1.6,dd))+(noise(bx,bz,24,seed^917)-.5)*6;h=floor+(h-floor)*mask;r=r*(0.35+0.65*mask);}return {h:h,r:r};}
  function sample(m,x,z){var n=m.size/CELL,seed=seedNumber(m.seed),gx=x/CELL-0.5,gz=z/CELL-0.5,cx0=Math.floor(gx),cz0=Math.floor(gz),tx=gx-cx0,tz=gz-cz0,ccx=clamp(Math.round(gx),0,n-1),ccz=clamp(Math.round(gz),0,n-1),ci=ccz*n+ccx,id=m.biomes[ci],p=profiles[id];if(id===VOID)return {id:id,p:p,y:-65,color:p.color,water:false};var cb=cellNode(m,n,ccx,ccz,seed)||{h:profiles[id].height+m.elevation[ci],r:p.relief},n00=cellNode(m,n,cx0,cz0,seed)||cb,n10=cellNode(m,n,cx0+1,cz0,seed)||cb,n01=cellNode(m,n,cx0,cz0+1,seed)||cb,n11=cellNode(m,n,cx0+1,cz0+1,seed)||cb,base=(n00.h*(1-tx)+n10.h*tx)*(1-tz)+(n01.h*(1-tx)+n11.h*tx)*tz,rel=(n00.r*(1-tx)+n10.r*tx)*(1-tz)+(n01.r*(1-tx)+n11.r*tx)*tz,h=base+(noise(x,z,32,seed)-.5)*rel+(noise(x,z,9,seed^237)-.5)*rel*.35;return {id:id,p:p,y:clamp(Math.round(h),-60,222),water:p.water&&h<SEA,color:p.color};}
  function surfaceTop(s){if(s.id===VOID)return 'air';if(s.water||s.p.top==='sand'||s.p.top==='gravel')return s.p.top;if(s.y<=SEA+1&&s.y>=SEA-6&&/grass_block|dirt|podzol|mycelium|snow|moss_block/.test(s.p.top))return 'sand';return s.p.top;}
  function paint(m,x,z,radius,tool,biome){var n=m.size/CELL,cx=Math.floor(x/CELL),cz=Math.floor(z/CELL),r=Math.max(1,+radius||1),old=m.elevation.slice();for(var j=Math.max(0,cz-r);j<Math.min(n,cz+r+1);j++)for(var i=Math.max(0,cx-r);i<Math.min(n,cx+r+1);i++){if(Math.hypot(i-cx,j-cz)>r)continue;var at=j*n+i;if(tool==='biome')m.biomes[at]=+biome;else if(tool==='raise')m.elevation[at]=clamp(m.elevation[at]+2,-96,144);else if(tool==='lower')m.elevation[at]=clamp(m.elevation[at]-2,-96,144);else if(tool==='smooth'){var sum=0,count=0;for(var dz=-1;dz<=1;dz++)for(var dx=-1;dx<=1;dx++){var xx=i+dx,zz=j+dz;if(xx>=0&&xx<n&&zz>=0&&zz<n){sum+=old[zz*n+xx];count++;}}m.elevation[at]=Math.round(sum/count);}}}
  function structure(kind){var blocks=[],size=[1,1,1];function put(x,y,z,b){blocks.push({x:x,y:y,z:z,name:b});}
    if(kind==='tree'){size=[5,8,5];for(var y=0;y<6;y++)put(2,y,2,'oak_log');for(var y=4;y<8;y++)for(var x=0;x<5;x++)for(var z=0;z<5;z++)if((x!==2||z!==2||y>=6)&&Math.abs(x-2)+Math.abs(z-2)<(y===7?3:5))put(x,y,z,'oak_leaves');}
    if(kind==='cabin'){size=[9,8,9];for(var x=0;x<9;x++)for(var z=0;z<9;z++){put(x,0,z,'cobblestone');for(var y=1;y<=5;y++)if(x===0||x===8||z===0||z===8){if(z===0&&x===4&&y<4)continue;put(x,y,z,(x===0||x===8)&&(z===0||z===8)?'oak_log':(y===3&&(x===4||z===4)?'glass':'oak_planks'));}put(x,6,z,'oak_planks');if(x>0&&x<8)put(x,7,z,'oak_planks');}put(4,5,4,'glowstone');}
    if(kind==='tower'){size=[7,16,7];for(var y=0;y<16;y++)for(var x=0;x<7;x++)for(var z=0;z<7;z++)if(y===0||y===12||x===0||x===6||z===0||z===6){if(y===15&&(x+z)%2)continue;if(z===0&&x===3&&y>0&&y<4)continue;put(x,y,z,'cobblestone');}}
    if(kind==='well'){size=[7,7,7];for(var x=0;x<7;x++)for(var z=0;z<7;z++){put(x,0,z,'cobblestone');if(x>0&&x<6&&z>0&&z<6)put(x,1,z,'water');else put(x,1,z,'cobblestone');put(x,6,z,'oak_planks');}for(var y=2;y<6;y++)for(var x of [0,6])for(var z of [0,6])put(x,y,z,'oak_log');}
    return {size:size,blocks:blocks};
  }
  function placement(s){return s.kind==='custom'?{size:s.custom.size}:structure(s.kind);}
  function positions(s,fn){if(s.kind!=='custom'){structure(s.kind).blocks.forEach(function(b){fn(b.x,b.y,b.z,b.name);});return;}var c=s.custom,sy=c.size[1],sz=c.size[2];for(var i=0;i<c.blocks.length;i++){var p=c.blocks[i];if(p<0||c.palette[p].name==='minecraft:air')continue;fn(Math.floor(i/(sy*sz)),Math.floor(i/sz)%sy,i%sz,null,c.palette[p]);}}
  function treeKind(p){var n=p.name;if(n==='desert'||n==='desert_hills'||n==='desert_mutated')return 'cactus';if(/savanna/.test(n))return 'acacia';if(/jungle/.test(n))return 'jungle';if(/mangrove/.test(n))return 'mangrove';if(/mushroom/.test(n))return null;if(p.log==='spruce_log')return 'spruce';if(p.log==='birch_log')return 'birch';if(p.log==='cherry_log')return 'cherry';if(p.log==='pale_oak_log')return 'pale';return p.tree?'oak':null;}
  function oreAt(x,y,z,s,seed){if(s.p.base!=='stone')return null;if(y>=s.y-3||y<-62)return null;var deep=y<0,r=hash(x+y*7,z-y*13,seed^937);function pick(a,b){return deep?b:a;}
    if(/peaks|mountain|extreme/.test(s.p.name)&&y>90&&r<0.073)return 'emerald_ore';
    if(y<=16&&r<0.004+(y<-48?0.004:0))return pick('diamond_ore','deepslate_diamond_ore');
    if(y<=16&&r<0.012)return pick('redstone_ore','deepslate_redstone_ore');
    if(y<=64&&r<0.017)return pick('lapis_ore','deepslate_lapis_ore');
    if(y<=32&&r<0.023)return pick('gold_ore','deepslate_gold_ore');
    if(y<=96&&r<0.035)return pick('copper_ore','deepslate_copper_ore');
    if(y>=-24&&r<0.05)return pick('iron_ore','deepslate_iron_ore');
    if(r<0.07)return pick('coal_ore','deepslate_coal_ore');
    return null;}
  function treeAt(m,x,z,s){if(m.trees===false||!s.p.tree||!treeKind(s.p)||s.water||s.y<=SEA+1)return false;if(x<=4||z<=4||x>=m.size-5||z>=m.size-5)return false;var seed=seedNumber(m.seed),h=hash(x,z,seed^821);if(h>=s.p.tree)return false;var kind=treeKind(s.p),lim=kind==='cactus'?2:3;for(var dz=-2;dz<=2;dz++)for(var dx=-2;dx<=2;dx++){if(!dx&&!dz)continue;var nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=m.size||nz>=m.size)continue;var ns=sample(m,nx,nz);if(!ns.p.tree||!treeKind(ns.p)||ns.water||ns.y<=SEA+1)continue;if(Math.abs(ns.y-s.y)>lim)return false;var nh=hash(nx,nz,seed^821);if(nh<ns.p.tree&&nh<h)return false;}return true;}
  function canopy5(B,y,log,leaves,r,full){for(var x=-2;x<=2;x++)for(var z=-2;z<=2;z++){if(Math.abs(x)===2&&Math.abs(z)===2&&((x*z+r)&3)===0&&!full)continue;if(x===0&&z===0)continue;B.push({x:x,y:y,z:z,name:leaves});}}
  function canopy3(B,y,log,leaves,r){for(var x=-1;x<=1;x++)for(var z=-1;z<=1;z++){if(Math.abs(x)===1&&Math.abs(z)===1&&((x*z+r)&1)===0)continue;if(x===0&&z===0)continue;B.push({x:x,y:y,z:z,name:leaves});}}
  function canopyPlus(B,y,log,leaves){B.push({x:0,y:y,z:0,name:leaves});B.push({x:1,y:y,z:0,name:leaves});B.push({x:-1,y:y,z:0,name:leaves});B.push({x:0,y:y,z:1,name:leaves});B.push({x:0,y:y,z:-1,name:leaves});}
  function trunk(B,log,h){for(var y=0;y<h;y++)B.push({x:0,y:y,z:0,name:log});return h;}
  function buildTree(kind,log,leaves,r1,r2){var B=[],t;
    if(kind==='cactus'){var ch=2+(r1%2);for(var y=0;y<ch;y++)B.push({x:0,y:y,z:0,name:'cactus'});return B;}
    if(kind==='spruce'){t=7+(r1%3);trunk(B,log,t);for(var y=2;y<t;y++){var d=t-1-y,rr=d>=4?2:(d>=2?1:0);if(!rr)continue;for(var x=-rr;x<=rr;x++)for(var z=-rr;z<=rr;z++){if(Math.abs(x)===rr&&Math.abs(z)===rr&&((x+z+y+r2)&1)===0)continue;if(x===0&&z===0)continue;B.push({x:x,y:y,z:z,name:leaves});}}B.push({x:0,y:t,z:0,name:leaves});return B;}
    if(kind==='birch'){t=6+(r1%2);trunk(B,log,t);canopy3(B,t-2,log,leaves,r2);canopy3(B,t-1,log,leaves,r2+1);canopyPlus(B,t,log,leaves);return B;}
    if(kind==='jungle'){t=8+(r1%4);trunk(B,log,t);B.push({x:1,y:0,z:0,name:log});B.push({x:-1,y:0,z:0,name:log});B.push({x:0,y:0,z:1,name:log});B.push({x:0,y:0,z:-1,name:log});canopy5(B,t-2,log,leaves,r2);canopy5(B,t-1,log,leaves,r2+1);canopy5(B,t,log,leaves,r2+2);canopy3(B,t+1,log,leaves,r2);canopyPlus(B,t+2,log,leaves);return B;}
    if(kind==='acacia'){t=5+(r1%2);trunk(B,log,t);canopy5(B,t,log,leaves,r2,true);canopy3(B,t+1,log,leaves,r2);return B;}
    if(kind==='mangrove'){t=4+(r1%2);trunk(B,log,t);for(var rx=-1;rx<=1;rx++)for(var rz=-1;rz<=1;rz++){if(!rx&&!rz)continue;B.push({x:rx,y:0,z:rz,name:log});}canopy5(B,t-1,log,leaves,r2);canopy5(B,t,log,leaves,r2+1);canopyPlus(B,t+1,log,leaves);return B;}
    t=5+(r1%2);trunk(B,log,t);canopy5(B,t-2,log,leaves,r2);canopy5(B,t-1,log,leaves,r2+1);canopy3(B,t,log,leaves,r2);canopy3(B,t+1,log,leaves,r2+1);canopyPlus(B,t+2,log,leaves);return B;}
  function exportWorld(m,progress){
    validate(m);var N=root.RC_nbt2,C=root.RC_builderCore,L=root.RC_ldbw;if(!N||!C||!L||!root.JSZip)throw Error('Módulos de exportação ausentes.');
    var seed=seedNumber(m.seed),full=m.underground==='full';
    var globalPalette=[],ids={},chunks={},heights=new Int16Array(m.size*m.size);heights.fill(-65);var size=m.size,half=size/2;
    function blockId(name,custom){var key=custom?'custom:'+JSON.stringify(custom.raw):name;if(ids[key]!==undefined)return ids[key];var raw,fullName;
      if(custom){var node=N.parse(Uint8Array.from(custom.raw)).root;if(node.t!==10||!node.v.map.name||node.v.map.name.v!==custom.name)throw Error('Paleta da estrutura inconsistente.');raw=Uint8Array.from(custom.raw);fullName=custom.name;}
      else {var def=D.blocks[name];if(!def)throw Error('Bloco sem estado canônico: '+name);var states={};Object.keys(def.states).forEach(function(k){states[k]=N.N(def.states[k].t,k,def.states[k].v);});raw=N.encode({t:10,n:'',v:N.compound({name:N.N(8,'name',def.name),states:N.N(10,'states',N.compound(states)),version:N.N(3,'version',def.version)})});fullName=def.name;}
      var id=globalPalette.length;globalPalette.push({raw:raw,name:fullName});ids[key]=id;return id;
    }
    blockId('air');
    function put(x,y,z,name,custom){if(x<0||z<0||x>=size||z>=size||y < -64||y>319)return;var cx=Math.floor(x/16),cz=Math.floor(z/16),key=cx+','+cz,ch=chunks[key]||(chunks[key]={cx:cx-half/16,cz:cz-half/16,subs:{}}),sy=Math.floor(y/16),sub=ch.subs[sy]||(ch.subs[sy]=new Uint16Array(4096));sub[C.storageIndex(x%16,((y%16)+16)%16,z%16)]=blockId(name,custom);if(name!=='air'&&y>heights[z*size+x])heights[z*size+x]=y;}
    for(var cz=0;cz<size/16;cz++)for(var cx=0;cx<size/16;cx++){
      chunks[cx+','+cz]={cx:cx-half/16,cz:cz-half/16,subs:{}};
      for(var x=cx*16;x<cx*16+16;x++)for(var z=cz*16;z<cz*16+16;z++){
        var s=sample(m,x,z);if(s.id===VOID)continue;var p=s.p;
        for(var y=-64;y<=s.y;y++){
          if(y===-64){put(x,y,z,'bedrock');continue;}
          if(full&&y===-63&&hash(x,z,seed^919)<.5){put(x,y,z,'bedrock');continue;}
          if(full&&p.base==='stone'&&y<s.y-4&&y>-60&&!s.water&&s.y>SEA+1){
            if(y<s.y-6&&noise(x+y*2,z-y,14,seed^913)>.74){put(x,y,z,'air');continue;}
            var ore=oreAt(x,y,z,s,seed);
            if(ore){put(x,y,z,ore);continue;}
          }
          if(p.caves&&y>0&&y<s.y-9&&noise(x+y,z-y,14,seed)>.66)continue;
          put(x,y,z,y===s.y?surfaceTop(s):y>s.y-4?(/sand|snow/.test(p.top)?p.top:'dirt'):full&&y<0&&p.base==='stone'?'deepslate':p.base);
        }
        if(s.id!==VOID)for(var y=s.y+1;y<=SEA;y++)put(x,y,z,p.frozen&&y===SEA?'ice':'water');
      }
      if(progress)progress(Math.round((cz*size/16+cx+1)/(size*size/256)*65));
    }
    for(var x=0;x<size;x++)for(var z=0;z<size;z++){var s=sample(m,x,z);if(!treeAt(m,x,z,s))continue;var kind=treeKind(s.p),tseed=seedNumber(m.seed),tb=buildTree(kind,s.p.log,s.p.leaves,Math.floor(hash(x,z,tseed^822)*1024),Math.floor(hash(x,z,tseed^833)*1024));tb.forEach(function(b){put(x+b.x,s.y+1+b.y,z+b.z,b.name);});}
    for(var st of m.structures){var dims=placement(st).size;if(st.x+dims[0]>size||st.z+dims[2]>size)throw Error('Uma estrutura ultrapassa a área pintada.');var surface=sample(m,st.x+Math.floor(dims[0]/2),st.z+Math.floor(dims[2]/2)),ground=surface.id===VOID?64:Math.max(surface.y,surface.water?SEA:surface.y)+1;positions(st,function(x,y,z,name,custom){put(st.x+x,ground+y,st.z+z,name,custom);});}
    var spawnX=m.spawn.x,spawnZ=m.spawn.z,spawnY=Math.max(65,heights[spawnZ*size+spawnX]+2);
    if(m.platform!==false){for(var dx=-2;dx<=2;dx++)for(var dz=-2;dz<=2;dz++)put(spawnX+dx,spawnY-1,spawnZ+dz,'glass');}
    var ops=[];function key(cx,cz,tag){var b=new Uint8Array(9),v=new DataView(b.buffer);v.setInt32(0,cx,true);v.setInt32(4,cz,true);b[8]=tag;return b;}
    function int(n){var b=new Uint8Array(4);new DataView(b.buffer).setInt32(0,n,true);return b;}
    var per={1:32,2:16,3:10,4:8,5:6,6:5,8:4,16:2};
    function biomeStorage(cx,cz){var pal=[],indices=new Uint16Array(4096);for(var x=0;x<16;x++)for(var z=0;z<16;z++){var id=sample(m,cx*16+x,cz*16+z).id;if(id===VOID)id=1;var pi=pal.indexOf(id);if(pi<0){pi=pal.length;pal.push(id);}for(var y=0;y<16;y++)indices[C.storageIndex(x,y,z)]=pi;}
      if(pal.length===1){var simple=new Uint8Array(5);simple[0]=1;new DataView(simple.buffer).setInt32(1,pal[0],true);return simple;}
      var bits=[1,2,3,4,5,6,8,16].find(function(b){return (1<<b)>=pal.length;}),count=Math.ceil(4096/per[bits]),out=new Uint8Array(1+count*4+4+pal.length*4),v=new DataView(out.buffer);out[0]=(bits<<1)|1;for(var i=0;i<4096;i++){var o=1+Math.floor(i/per[bits])*4;v.setUint32(o,v.getUint32(o,true)|(indices[i]<<((i%per[bits])*bits)),true);}v.setInt32(1+count*4,pal.length,true);pal.forEach(function(id,i){v.setInt32(5+count*4+i*4,id,true);});return out;
    }
    Object.keys(chunks).forEach(function(k,ci){var ch=chunks[k],coords=k.split(',').map(Number),biomes=biomeStorage(coords[0],coords[1]),data=new Uint8Array(512+biomes.length+24),dv=new DataView(data.buffer);for(var x=0;x<16;x++)for(var z=0;z<16;z++)dv.setInt16((z*16+x)*2,Math.max(0,heights[(coords[1]*16+z)*size+coords[0]*16+x]+65),true);data.set(biomes,512);data.fill(255,512+biomes.length);
      ops.push({t:'put',k:key(ch.cx,ch.cz,43),v:data},{t:'put',k:key(ch.cx,ch.cz,44),v:Uint8Array.of(40)},{t:'put',k:key(ch.cx,ch.cz,54),v:int(2)});
      for(var sy=-4;sy<20;sy++){var source=ch.subs[sy]||new Uint16Array(4096),palette=[],lookup={},idx=new Uint16Array(4096);for(var i=0;i<4096;i++){var gid=source[i];if(lookup[gid]===undefined){lookup[gid]=palette.length;palette.push(globalPalette[gid]);}idx[i]=lookup[gid];}ops.push({t:'put',k:C.subKey(ch.cx,ch.cz,sy),v:C.encodeSubchunk({version:9,prefix:Uint8Array.of(9,1,sy&255),primary:{idx:idx,palette:palette},secondary:null})});}
      if(progress)progress(65+Math.round((ci+1)/Object.keys(chunks).length*25));
    });
    var fields={};function tag(t,k,v){fields[k]=N.N(t,k,v);}function ints(k,v){tag(9,k,N.listOf(3,v));}
    tag(3,'StorageVersion',10);tag(3,'Generator',2);tag(8,'LevelName',m.name);tag(4,'RandomSeed',(/^-?\d+$/.test(m.seed)?BigInt.asIntN(64,BigInt(m.seed)):BigInt(seedNumber(m.seed))));tag(4,'LastPlayed',BigInt(Math.floor(Date.now()/1000)));tag(4,'Time',6000n);
    tag(3,'GameType',1);tag(3,'Difficulty',1);tag(3,'SpawnX',spawnX-half);tag(3,'SpawnY',spawnY);tag(3,'SpawnZ',spawnZ-half);tag(1,'cheatsEnabled',1);tag(1,'hasBeenLoadedInCreative',1);tag(1,'commandsEnabled',1);tag(1,'showcoordinates',1);tag(1,'doimmediaterespawn',1);tag(1,'dodaylightcycle',0);tag(1,'doweathercycle',0);tag(1,'spawnMobs',0);tag(3,'WorldVersion',1);tag(3,'NetherScale',8);tag(3,'worldStartCount',1);
    ints('lastOpenedWithVersion',D.version);ints('MinimumCompatibleClientVersion',D.version);
    var layers=m.preset==='void'?[{block_name:'minecraft:air',count:1}]:[{block_name:'minecraft:bedrock',count:1},{block_name:'minecraft:stone',count:m.preset==='ocean'||m.preset==='island'?103:127},{block_name:m.preset==='ocean'||m.preset==='island'?'minecraft:sand':'minecraft:dirt',count:3},{block_name:m.preset==='ocean'||m.preset==='island'?'minecraft:water':'minecraft:grass_block',count:m.preset==='ocean'||m.preset==='island'?20:1}];
    tag(8,'FlatWorldLayers',JSON.stringify({biome_id:m.preset==='ocean'||m.preset==='island'?0:1,block_layers:layers,encoding_version:6,structure_options:null,world_version:'version.post_1_18'}));
    var body=N.encode({t:10,n:'',v:N.compound(fields)}),level=new Uint8Array(body.length+8),lv=new DataView(level.buffer);lv.setInt32(0,10,true);lv.setInt32(4,body.length,true);level.set(body,8);
    var comparator=new TextEncoder().encode('leveldb.BytewiseComparator'),manifestData=Uint8Array.from([1,...L.encVarint(comparator.length),...comparator,2,2,3,3,4,...L.encVarint(ops.length)]),manifest=L.framePayload(manifestData,0).bytes;
    var zip=new root.JSZip();zip.file('level.dat',level);zip.file('level.dat_old',level);zip.file('levelname.txt',m.name);zip.file('db/CURRENT','MANIFEST-000001\n');zip.file('db/MANIFEST-000001',manifest);zip.file('db/000002.log',L.framePayload(L.buildBatch(ops,1),0).bytes);
    zip.file('worldify-studio.json',JSON.stringify({generator:'Worldify Studio',version:1,profile:D.version,size:size,seed:m.seed,base:m.preset,createdAt:new Date().toISOString()}));
    return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}},function(meta){if(progress)progress(90+Math.round(meta.percent*.1));});
  }
  root.WF_Studio={VOID:VOID,CELL:CELL,SEA:SEA,profiles:profiles,create:create,validate:validate,validateCustom:validateCustom,sample:sample,paint:paint,structure:structure,placement:placement,positions:positions,treeAt:treeAt,seedNumber:seedNumber,exportWorld:exportWorld};
})(typeof window!=='undefined'?window:self);
