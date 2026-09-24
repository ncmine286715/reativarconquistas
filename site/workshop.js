(function(){
  'use strict';
  document.querySelectorAll('details.acc').forEach(function(panel){
    panel.addEventListener('toggle',function(){
      if(panel.open && panel.id==='accChunks') requestAnimationFrame(function(){if(window.RC_mapDraw)window.RC_mapDraw();});
    });
  });
  var free=document.getElementById('freePlanLimit');
  function paintPlan(ent){
    if(!free)return;
    if(!ent || (ent.status!=='ready' && ent.status!=='unauthenticated')){free.textContent='Verificando seu plano...';return;}
    if(ent.plan==='free'){
      var daily=ent.capabilities&&ent.capabilities.convert&&ent.capabilities.convert.daily_operations;
      free.textContent=ent.max_file_mb+' MB, '+(daily||0)+'/dia';
    }else{
      free.textContent=(ent.plan_label||ent.plan)+' · '+(ent.max_file_mb===null?'sem limite comercial':ent.max_file_mb+' MB');
    }
  }
  if(free && window.RC_entitlements){
    paintPlan(window.RC_entitlements.state());
    window.RC_entitlements.subscribe(paintPlan);
    window.RC_entitlements.load().then(paintPlan).catch(function(){paintPlan(window.RC_entitlements.state());});
  }
  var input=document.getElementById('file');
  if(input) input.addEventListener('change',function(){
    if(input.files.length){var free=document.getElementById('accFree');if(free)free.open=true;}
  });
})();
