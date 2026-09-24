(function(){
  'use strict';
  document.querySelectorAll('details.acc').forEach(function(panel){
    panel.addEventListener('toggle',function(){
      if(panel.open && panel.id==='accChunks') requestAnimationFrame(function(){if(window.RC_mapDraw)window.RC_mapDraw();});
    });
  });
  var cfg=window.RC_CONFIG || {}, free=document.getElementById('freePlanLimit');
  if(free){var mb=cfg.FREE_MAX_MB || 10;if(cfg.PROMO_UNTIL && Date.now()<Date.parse(cfg.PROMO_UNTIL))mb=cfg.PROMO_MAX_MB || mb;free.textContent=mb+' MB, '+(cfg.FREE_DAILY || 2)+'/dia';}
  var input=document.getElementById('file');
  if(input) input.addEventListener('change',function(){
    if(input.files.length){var free=document.getElementById('accFree');if(free)free.open=true;}
  });
})();
