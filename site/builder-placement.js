(function () {
  'use strict';
  function normalize(p) {
    var result = {};
    ['x', 'y', 'z'].forEach(function (axis) {
      var n = Number(p[axis]);
      if (!Number.isFinite(n) || !Number.isInteger(n) || Math.abs(n) > 30000000) throw new Error('Informe coordenadas inteiras válidas.');
      result[axis] = n;
    });
    result.rotation = window.RC_builderTransform.turns(p.rotation) * 90;
    return result;
  }
  // Transform block centers, including the half-block offset, as one GPU group.
  // Identical bounding-box origin to RC_builderTransform.world().
  function groupTransform(size, p) {
    var t = window.RC_builderTransform.turns(p.rotation);
    return { x: p.x + (t === 1 ? size[2] : t === 2 ? size[0] : 0), y: p.y,
      z: p.z + (t === 2 ? size[2] : t === 3 ? size[0] : 0), angle: -t * Math.PI / 2 };
  }
  function History(limit) { this.limit = limit || 60; this.items = []; this.index = -1; }
  History.prototype.push = function (position) {
    var p = normalize(position);
    if (JSON.stringify(p) === JSON.stringify(this.items[this.index])) return;
    this.items.splice(this.index + 1); this.items.push(p);
    if (this.items.length > this.limit) this.items.shift();
    this.index = this.items.length - 1;
  };
  History.prototype.move = function (delta) {
    var i = this.index + delta;
    if (i < 0 || i >= this.items.length) return null;
    this.index = i; return Object.assign({}, this.items[i]);
  };
  window.RC_Placement = { normalize: normalize, groupTransform: groupTransform, History: History };
})();
