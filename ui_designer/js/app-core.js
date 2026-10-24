/*
 * Air8607 UI Studio - core state, history, rendering and export.
 * Loaded after generator.js and before app-ui.js / app-events.js.
 */
(function () {
  'use strict';

  var G = window.Air8607Generator;
  var UI = window.UI = window.UI || {};
  var W = 1024;
  var H = 600;
  var STORAGE_KEY = 'air8607-ui-studio-v1';

  UI.W = W;
  UI.H = H;
  UI.G = G;
  UI.design = null;
  UI.selectedId = null;
  UI.view = { zoom: 1, zoomFactor: 1, showGrid: true, preview: false };
  UI.history = { undo: [], redo: [] };
  UI.editSnapshot = null;
  UI.drag = null;
  UI.previewSwitches = {};
  UI.saveTimer = null;
  UI.pendingImageId = null;
  UI.toastTimer = null;
  UI.el = {};

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  UI.$ = $;
  UI.$$ = $$;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  UI.esc = esc;
  UI.escAttr = esc;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  UI.clamp = clamp;

  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }
  UI.num = num;

  function normHex(v, fallback) {
    var h = String(v == null ? '' : v).trim();
    if (h.charAt(0) !== '#') h = '#' + h;
    if (/^#[0-9a-fA-F]{3}$/.test(h)) {
      h = '#' + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) + h.charAt(3) + h.charAt(3);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) return fallback || '#000000';
    return h.toUpperCase();
  }
  UI.normHex = normHex;

  function rgba(hex, opacity) {
    var h = normHex(hex).slice(1);
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    var a = clamp(num(opacity, 255), 0, 255) / 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  UI.rgba = rgba;

  function hexToRgba(hex, alpha255) { return rgba(hex, alpha255); }
  UI.hexToRgba = hexToRgba;

  function div(cls) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    return d;
  }
  UI.div = div;

  UI.toast = function (msg, type) {
    if (!UI.el.toast) return;
    UI.el.toast.textContent = msg;
    UI.el.toast.className = 'toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(UI.toastTimer);
    UI.toastTimer = setTimeout(function () {
      if (UI.el.toast) UI.el.toast.className = 'toast' + (type === 'error' ? ' error' : '');
    }, 2400);
  };

  UI.setStatus = function (msg) {
    if (UI.el.statusText) UI.el.statusText.textContent = msg;
  };

  UI.findWidget = function (id) {
    if (!UI.design || !id) return null;
    for (var i = 0; i < UI.design.widgets.length; i++) {
      if (UI.design.widgets[i].id === id) return UI.design.widgets[i];
    }
    return null;
  };

  UI.widgetIndex = function (id) {
    if (!UI.design) return -1;
    for (var i = 0; i < UI.design.widgets.length; i++) {
      if (UI.design.widgets[i].id === id) return i;
    }
    return -1;
  };

  UI.canvasPoint = function (e) {
    var rect = UI.el.canvas.getBoundingClientRect();
    var scale = rect.width / W;
    return {
      x: (e.clientX - rect.left) / (scale || 1),
      y: (e.clientY - rect.top) / (scale || 1)
    };
  };

  UI.minSize = function (w) {
    if (!w) return { w: 8, h: 8 };
    if (w.type === 'divider') return { w: 10, h: 1 };
    if (w.type === 'qrcode') return { w: 32, h: 32 };
    if (w.type === 'switch') return { w: 40, h: 20 };
    if (w.type === 'slider') return { w: 40, h: 16 };
    if (w.type === 'bar') return { w: 20, h: 2 };
    if (w.type === 'button') return { w: 30, h: 20 };
    return { w: 8, h: 8 };
  };

  UI.uniqueWidgetName = function (base) {
    var b = String(base || 'widget').replace(/[^A-Za-z0-9_]/g, '_') || 'widget';
    var n = 1;
    var name = b + '_' + n;
    var used = {};
    (UI.design.widgets || []).forEach(function (w) { used[w.name] = true; });
    while (used[name]) { n++; name = b + '_' + n; }
    return name;
  };

  UI.loadSaved = function () {
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { stored = null; }
    var data = null;
    if (stored) {
      try {
        var parsed = JSON.parse(stored);
        if (parsed && parsed.design) {
          data = parsed.design;
          if (parsed.view && typeof parsed.view.showGrid === 'boolean') UI.view.showGrid = parsed.view.showGrid;
        } else if (parsed && Array.isArray(parsed.widgets)) {
          data = parsed;
        }
      } catch (e) { data = null; }
    }
    if (!data) data = G.sampleProject();
    UI.design = G.normalizeState(data);
  };

  UI.saveNow = function () {
    if (!UI.design) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        design: UI.design,
        view: { showGrid: UI.view.showGrid }
      }));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        UI.toast('设计太大，浏览器本地保存失败；请导出 JSON 备份', 'error');
      }
    }
  };

  UI.scheduleSave = function () {
    clearTimeout(UI.saveTimer);
    UI.saveTimer = setTimeout(UI.saveNow, 350);
  };

  /* ---------------- history ---------------- */
  UI.updateHistoryButtons = function () {
    if (UI.el.undoBtn) UI.el.undoBtn.disabled = !UI.history.undo.length;
    if (UI.el.redoBtn) UI.el.redoBtn.disabled = !UI.history.redo.length;
  };

  UI.pushHistory = function (snapshot) {
    var s = snapshot || JSON.stringify(UI.design);
    var undo = UI.history.undo;
    if (undo.length && undo[undo.length - 1] === s) {
      UI.history.redo = [];
      UI.updateHistoryButtons();
      return;
    }
    undo.push(s);
    if (undo.length > 80) undo.shift();
    UI.history.redo = [];
    UI.updateHistoryButtons();
  };

  UI.beginEdit = function () {
    if (UI.editSnapshot === null) UI.editSnapshot = JSON.stringify(UI.design);
  };

  UI.commitEdit = function () {
    if (UI.editSnapshot !== null && UI.editSnapshot !== JSON.stringify(UI.design)) {
      UI.history.undo.push(UI.editSnapshot);
      if (UI.history.undo.length > 80) UI.history.undo.shift();
      UI.history.redo = [];
    }
    UI.editSnapshot = null;
    UI.updateHistoryButtons();
  };

  UI.undo = function () {
    UI.commitEdit();
    if (!UI.history.undo.length) return;
    var current = JSON.stringify(UI.design);
    var prev = UI.history.undo.pop();
    UI.history.redo.push(current);
    try { UI.design = G.normalizeState(JSON.parse(prev)); }
    catch (e) { UI.toast('撤销失败', 'error'); return; }
    if (UI.selectedId && !UI.findWidget(UI.selectedId)) UI.selectedId = null;
    UI.renderAll();
    UI.saveNow();
    UI.setStatus('已撤销');
  };

  UI.redo = function () {
    UI.commitEdit();
    if (!UI.history.redo.length) return;
    var current = JSON.stringify(UI.design);
    var next = UI.history.redo.pop();
    UI.history.undo.push(current);
    try { UI.design = G.normalizeState(JSON.parse(next)); }
    catch (e) { UI.toast('重做失败', 'error'); return; }
    if (UI.selectedId && !UI.findWidget(UI.selectedId)) UI.selectedId = null;
    UI.renderAll();
    UI.saveNow();
    UI.setStatus('已重做');
  };

  UI.withHistory = function (fn) {
    var before = JSON.stringify(UI.design);
    fn();
    UI.design = G.normalizeState(UI.design);
    if (before !== JSON.stringify(UI.design)) {
      UI.pushHistory(before);
      UI.scheduleSave();
    }
    UI.renderAll();
  };

  /* ---------------- toolbar / screen sync ---------------- */
  UI.syncScreenLabels = function () {
    var preset = UI.design.screen.preset === '10' ? '10' : '9';
    if (UI.el.screenChip) UI.el.screenChip.textContent = preset + ' 寸 · 1024×600';
    if (UI.el.screenPreset && document.activeElement !== UI.el.screenPreset) {
      UI.el.screenPreset.value = preset;
    }
  };

  UI.syncCanvasControls = function () {
    var s = UI.design.screen;
    if (UI.el.canvasBgColor && document.activeElement !== UI.el.canvasBgColor) UI.el.canvasBgColor.value = normHex(s.bg);
    if (UI.el.canvasBgHex && document.activeElement !== UI.el.canvasBgHex) UI.el.canvasBgHex.value = normHex(s.bg);
    if (UI.el.gridSize && document.activeElement !== UI.el.gridSize) UI.el.gridSize.value = String(s.grid);
    if (UI.el.showGrid) UI.el.showGrid.checked = !!UI.view.showGrid;
  };

  UI.syncToolbar = function () {
    if (!UI.design) return;
    if (UI.el.projectName && document.activeElement !== UI.el.projectName) UI.el.projectName.value = UI.design.project;
    UI.syncScreenLabels();
    UI.syncCanvasControls();
    UI.updateHistoryButtons();
    if (UI.el.previewBtn) UI.el.previewBtn.textContent = UI.view.preview ? '退出预览' : '预览';
    if (UI.el.widgetCount) UI.el.widgetCount.textContent = UI.design.widgets.length + ' 个控件';
    if (UI.el.zoomText) UI.el.zoomText.textContent = Math.round(UI.view.zoom * 100) + '%';
    if (UI.el.zoomFitBtn) UI.el.zoomFitBtn.textContent = Math.round(UI.view.zoom * 100) + '%';
  };

  /* ---------------- rendering ---------------- */
  function pct(w) {
    var min = num(w.min, 0);
    var max = num(w.max, 100);
    if (max <= min) return 0;
    return clamp(((num(w.value, 0) - min) / (max - min)) * 100, 0, 100);
  }

  UI.drawFakeQR = function (canvas, data, dark, light, quietZone) {
    var n = 29;
    var q = quietZone ? 2 : 0;
    var total = n + q * 2;
    var cell = canvas.width / total;
    var ctx = canvas.getContext('2d');
    var d = normHex(dark, '#0B1524');
    var l = normHex(light, '#FFFFFF');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = l;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = d;

    var text = String(data == null ? '' : data);
    var seed = 2166136261;
    for (var i = 0; i < text.length; i++) {
      seed ^= text.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    function rand() {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) / 4294967296);
    }
    function inFinder(r, c) {
      return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    }
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (inFinder(r, c)) continue;
        if (rand() > 0.52) {
          ctx.fillRect((q + c) * cell, (q + r) * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
    function finder(fr, fc) {
      for (var rr = 0; rr < 7; rr++) {
        for (var cc = 0; cc < 7; cc++) {
          var on = rr === 0 || rr === 6 || cc === 0 || cc === 6 ||
            (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4);
          if (on) {
            ctx.fillStyle = d;
            ctx.fillRect((q + fc + cc) * cell, (q + fr + rr) * cell, Math.ceil(cell), Math.ceil(cell));
          } else {
            ctx.fillStyle = l;
            ctx.fillRect((q + fc + cc) * cell, (q + fr + rr) * cell, Math.ceil(cell), Math.ceil(cell));
          }
        }
      }
    }
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
  };

  UI.renderWidget = function (w) {
    var isPreview = UI.view.preview;
    var selected = UI.selectedId === w.id && !isPreview;
    var el = div('widget widget-' + w.type +
      (selected ? ' selected' : '') +
      (w.visible === false ? ' is-hidden' : '') +
      (w.locked ? ' locked' : ''));
    el.dataset.id = w.id;
    el.dataset.type = w.type;
    el.style.left = num(w.x, 0) + 'px';
    el.style.top = num(w.y, 0) + 'px';
    el.style.width = Math.max(1, num(w.w, 1)) + 'px';
    el.style.height = Math.max(1, num(w.h, 1)) + 'px';
    el.title = w.name || w.type;

    var content = div('content');

    if (w.type === 'panel') {
      content.style.background = rgba(w.bg, w.opacity);
      content.style.border = num(w.borderWidth, 0) + 'px solid ' + normHex(w.borderColor, '#2A3A52');
      content.style.borderRadius = num(w.radius, 0) + 'px';
      content.style.boxSizing = 'border-box';
    } else if (w.type === 'divider') {
      content.style.display = 'flex';
      content.style.alignItems = 'center';
      var line = div('ui-divider');
      line.style.height = Math.max(1, num(w.h, 1)) + 'px';
      line.style.background = normHex(w.color, '#2A3A52');
      content.appendChild(line);
    } else if (w.type === 'label') {
      content.className = 'content ui-label';
      content.style.fontSize = num(w.fontSize, 20) + 'px';
      content.style.color = normHex(w.color, '#E6EEFC');
      content.style.justifyContent = w.align === 'center' ? 'center' : (w.align === 'right' ? 'flex-end' : 'flex-start');
      content.style.textAlign = w.align || 'left';
      content.textContent = w.text == null ? '' : String(w.text);
    } else if (w.type === 'button') {
      var btn = div('ui-button');
      btn.style.background = rgba(w.bg, 255);
      btn.style.color = normHex(w.textColor, '#FFFFFF');
      btn.style.border = num(w.borderWidth, 0) + 'px solid ' + normHex(w.borderColor, w.bg);
      btn.style.borderRadius = num(w.radius, 8) + 'px';
      btn.textContent = w.text == null ? '' : String(w.text);
      content.appendChild(btn);
    } else if (w.type === 'image') {
      content.style.opacity = clamp(num(w.opacity, 255), 0, 255) / 255;
      var asset = w.asset && UI.design.assets[w.asset];
      if (asset) {
        var img = document.createElement('img');
        img.className = 'ui-image';
        img.src = asset;
        img.alt = '';
        img.style.objectFit = w.fit || 'contain';
        img.style.borderRadius = num(w.radius, 0) + 'px';
        content.appendChild(img);
      } else {
        var ph = div('ui-image-placeholder');
        ph.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>';
        var label = document.createElement('span');
        var src = String(w.src || '未设置图片').split('/').pop();
        label.textContent = src || '未设置图片';
        ph.appendChild(label);
        content.appendChild(ph);
      }
    } else if (w.type === 'bar') {
      var track = div('ui-bar-track');
      track.style.background = normHex(w.track, '#26364D');
      track.style.borderRadius = num(w.radius, 6) + 'px';
      var fill = div('ui-bar-fill');
      fill.style.width = pct(w) + '%';
      fill.style.background = normHex(w.indicator, '#22D3EE');
      fill.style.borderRadius = num(w.radius, 6) + 'px';
      track.appendChild(fill);
      content.appendChild(track);
    } else if (w.type === 'slider') {
      var wrap = div('ui-slider');
      var h = Math.max(16, num(w.h, 30));
      var trackH = Math.max(4, Math.round(h * 0.26));
      var tr = div('ui-slider-track');
      tr.style.height = trackH + 'px';
      tr.style.background = normHex(w.track, '#26364D');
      tr.style.borderRadius = (trackH / 2) + 'px';
      var fl = div('ui-slider-fill');
      fl.style.width = pct(w) + '%';
      fl.style.background = normHex(w.indicator, '#22D3EE');
      tr.appendChild(fl);
      var knob = div('ui-slider-knob');
      knob.style.width = h + 'px';
      knob.style.height = h + 'px';
      knob.style.background = normHex(w.knob, '#FFFFFF');
      knob.style.borderRadius = '50%';
      knob.style.left = pct(w) + '%';
      wrap.appendChild(tr);
      wrap.appendChild(knob);
      content.appendChild(wrap);
    } else if (w.type === 'switch') {
      var checked = !!w.checked;
      if (isPreview && Object.prototype.hasOwnProperty.call(UI.previewSwitches, w.id)) {
        checked = !!UI.previewSwitches[w.id];
      }
      var sw = div('ui-switch');
      var sh = Math.max(20, num(w.h, 30));
      var swW = Math.max(40, num(w.w, 70));
      var pad = Math.max(2, Math.round(sh * 0.14));
      var kd = Math.max(4, sh - pad * 2);
      var swTrack = div('ui-switch-track');
      var accent = normHex(w.accent, '#22C55E');
      swTrack.style.background = checked ? accent : '#26364D';
      swTrack.style.borderColor = checked ? accent : '#26364D';
      swTrack.style.borderRadius = (sh / 2) + 'px';
      var swKnob = div('ui-switch-knob');
      swKnob.style.width = kd + 'px';
      swKnob.style.height = kd + 'px';
      swKnob.style.top = pad + 'px';
      swKnob.style.left = (checked ? (swW - pad - kd) : pad) + 'px';
      sw.appendChild(swTrack);
      sw.appendChild(swKnob);
      content.appendChild(sw);
    } else if (w.type === 'qrcode') {
      var qrWrap = div('ui-qr-wrap');
      var size = Math.max(32, Math.min(num(w.w, 120), num(w.h, 120)));
      var cv = document.createElement('canvas');
      cv.className = 'ui-qr';
      cv.style.width = size + 'px';
      cv.style.height = size + 'px';
      cv.width = Math.max(120, size * 2);
      cv.height = Math.max(120, size * 2);
      UI.drawFakeQR(cv, w.data, w.dark, w.light, w.quietZone !== false);
      qrWrap.appendChild(cv);
      content.appendChild(qrWrap);
    } else {
      content.textContent = w.type;
    }

    el.appendChild(content);
    if (selected && !w.locked) UI.addHandles(el);
    return el;
  };

  UI.addHandles = function (el) {
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'resize-handle h-' + h;
      d.dataset.handle = h;
      el.appendChild(d);
    });
  };

  UI.renderCanvas = function () {
    var canvas = UI.el.canvas;
    if (!canvas || !UI.design) return;
    canvas.style.backgroundColor = normHex(UI.design.screen.bg, '#07111F');
    canvas.style.setProperty('--grid-size', Math.max(1, num(UI.design.screen.grid, 8)) + 'px');
    canvas.classList.toggle('grid', !!UI.view.showGrid && !UI.view.preview);
    canvas.classList.toggle('preview-mode', !!UI.view.preview);

    $$('.widget', canvas).forEach(function (el) { el.remove(); });
    var widgets = UI.design.widgets || [];
    if (UI.el.canvasEmpty) UI.el.canvasEmpty.style.display = (widgets.length === 0 && !UI.view.preview) ? 'grid' : 'none';

    widgets.forEach(function (w) {
      if (UI.view.preview && w.visible === false) return;
      canvas.appendChild(UI.renderWidget(w));
    });
  };

  UI.renderAll = function () {
    if (!UI.design) return;
    UI.syncToolbar();
    UI.renderCanvas();
    UI.renderLayers();
    UI.renderInspector();
    UI.updateSelectionInfo();
  };

  UI.updateSelectionInfo = function () {
    var w = UI.selectedId ? UI.findWidget(UI.selectedId) : null;
    if (UI.el.selectionInfo) {
      UI.el.selectionInfo.textContent = w
        ? (G.TYPE_LABELS[w.type] || w.type) + ' · ' + (w.name || '') + '  ' + Math.round(w.x) + ',' + Math.round(w.y) + '  ' + Math.round(w.w) + '×' + Math.round(w.h)
        : '未选择控件';
    }
    if (UI.el.widgetCount) UI.el.widgetCount.textContent = UI.design.widgets.length + ' 个控件';
    if (UI.el.zoomText) UI.el.zoomText.textContent = Math.round(UI.view.zoom * 100) + '%';
    if (UI.el.zoomFitBtn) UI.el.zoomFitBtn.textContent = Math.round(UI.view.zoom * 100) + '%';
  };

  UI.applyZoom = function () {
    var scroll = UI.el.canvasScroll;
    var canvas = UI.el.canvas;
    var wrap = UI.el.canvasWrap;
    if (!scroll || !canvas || !wrap) return;
    var pad = 72;
    var fit = Math.max(0.2, Math.min((scroll.clientWidth - pad) / W, (scroll.clientHeight - pad) / H, 1));
    var zoom = clamp(fit * UI.view.zoomFactor, 0.2, 2.2);
    UI.view.zoom = zoom;
    canvas.style.transform = 'scale(' + zoom + ')';
    wrap.style.width = (W * zoom) + 'px';
    wrap.style.height = (H * zoom) + 'px';
    if (UI.el.zoomText) UI.el.zoomText.textContent = Math.round(zoom * 100) + '%';
    if (UI.el.zoomFitBtn) UI.el.zoomFitBtn.textContent = Math.round(zoom * 100) + '%';
  };

  /* ---------------- selection ---------------- */
  UI.selectWidget = function (id) {
    UI.commitEdit();
    if (id && !UI.findWidget(id)) id = null;
    UI.selectedId = id || null;
    UI.renderCanvas();
    UI.renderLayers();
    UI.renderInspector();
    UI.updateSelectionInfo();
  };

  /* ---------------- widget operations ---------------- */
  UI.addWidget = function (type) {
    var d = G.DEFAULTS[type];
    if (!d) return;
    UI.pushHistory();
    var count = UI.design.widgets.length;
    var id = G.uid('w');
    var offset = (count % 8) * 14;
    var x = clamp(Math.round((W - d.w) / 2 + offset), 0, Math.max(0, W - d.w));
    var y = clamp(Math.round((H - d.h) / 2 + offset), 0, Math.max(0, H - d.h));
    var widget = Object.assign({}, d, {
      id: id,
      type: type,
      name: UI.uniqueWidgetName(type),
      x: x,
      y: y,
      visible: true,
      locked: false
    });
    UI.design.widgets.push(widget);
    UI.design = G.normalizeState(UI.design);
    UI.selectedId = id;
    UI.renderAll();
    UI.saveNow();
    UI.toast('已添加 ' + (G.TYPE_LABELS[type] || type));
  };

  UI.duplicateSelected = function () {
    var w = UI.findWidget(UI.selectedId);
    if (!w) return;
    UI.pushHistory();
    var copy = JSON.parse(JSON.stringify(w));
    copy.id = G.uid('w');
    copy.name = UI.uniqueWidgetName(String(w.name || w.type) + '_copy');
    copy.x = clamp(num(w.x, 0) + 16, 0, Math.max(0, W - num(w.w, 1)));
    copy.y = clamp(num(w.y, 0) + 16, 0, Math.max(0, H - num(w.h, 1)));
    var idx = UI.widgetIndex(w.id);
    UI.design.widgets.splice(idx + 1, 0, copy);
    UI.design = G.normalizeState(UI.design);
    UI.selectedId = copy.id;
    UI.renderAll();
    UI.saveNow();
    UI.toast('已复制控件');
  };

  UI.deleteSelected = function () {
    var w = UI.findWidget(UI.selectedId);
    if (!w) return;
    UI.pushHistory();
    var idx = UI.widgetIndex(w.id);
    UI.design.widgets.splice(idx, 1);
    UI.selectedId = null;
    UI.renderAll();
    UI.saveNow();
    UI.toast('已删除控件');
  };

  UI.moveLayer = function (action) {
    var w = UI.findWidget(UI.selectedId);
    if (!w) return;
    var idx = UI.widgetIndex(w.id);
    var arr = UI.design.widgets;
    if (action === 'front' && idx < arr.length - 1) {
      UI.pushHistory();
      arr.splice(idx, 1);
      arr.push(w);
    } else if (action === 'back' && idx > 0) {
      UI.pushHistory();
      arr.splice(idx, 1);
      arr.unshift(w);
    } else if (action === 'up' && idx < arr.length - 1) {
      UI.pushHistory();
      arr.splice(idx, 1);
      arr.splice(idx + 1, 0, w);
    } else if (action === 'down' && idx > 0) {
      UI.pushHistory();
      arr.splice(idx, 1);
      arr.splice(idx - 1, 0, w);
    } else {
      return;
    }
    UI.renderAll();
    UI.saveNow();
  };

  UI.moveSelectedBy = function (dx, dy) {
    var w = UI.findWidget(UI.selectedId);
    if (!w) return;
    UI.pushHistory();
    w.x = clamp(num(w.x, 0) + dx, 0, Math.max(0, W - num(w.w, 1)));
    w.y = clamp(num(w.y, 0) + dy, 0, Math.max(0, H - num(w.h, 1)));
    UI.renderCanvas();
    UI.syncInspectorGeometry(w);
    UI.updateSelectionInfo();
    UI.scheduleSave();
  };

  UI.setScreenPreset = function (preset) {
    if (!UI.design) return;
    var p = String(preset) === '10' ? '10' : '9';
    if (UI.design.screen.preset === p) return;
    UI.pushHistory();
    UI.design.screen.preset = p;
    UI.syncScreenLabels();
    if (UI.el.screenPreset) UI.el.screenPreset.value = p;
    UI.renderCanvas();
    UI.renderInspector();
    UI.saveNow();
    UI.toast('已切换到 ' + p + ' 寸配置');
  };

  UI.setScreenBg = function (hex) {
    if (!UI.design) return;
    UI.design.screen.bg = normHex(hex, UI.design.screen.bg);
    UI.syncCanvasControls();
    UI.renderCanvas();
    UI.scheduleSave();
  };

  UI.loadSample = function () {
    if (UI.design.widgets.length && !window.confirm('载入示例会替换当前画布，继续？')) return;
    UI.pushHistory();
    UI.design = G.sampleProject();
    UI.selectedId = null;
    UI.view.preview = false;
    UI.previewSwitches = {};
    UI.renderAll();
    UI.applyZoom();
    UI.saveNow();
    UI.toast('已载入示例');
  };

  UI.clearCanvas = function () {
    if (!UI.design.widgets.length) return;
    if (!window.confirm('清空当前画布？此操作可以撤销。')) return;
    UI.pushHistory();
    UI.design.widgets = [];
    UI.selectedId = null;
    UI.renderAll();
    UI.saveNow();
    UI.toast('画布已清空');
  };

  UI.togglePreview = function () {
    UI.commitEdit();
    UI.view.preview = !UI.view.preview;
    UI.previewSwitches = {};
    UI.renderCanvas();
    UI.syncToolbar();
    UI.updateSelectionInfo();
    UI.toast(UI.view.preview ? '预览模式：点击按钮/开关可测试' : '已退出预览');
  };

  /* ---------------- export / import ---------------- */
  UI.downloadBlob = function (blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  };

  UI.exportZip = function () {
    try {
      UI.commitEdit();
      UI.design = G.normalizeState(UI.design);
      var out = G.generateProject(UI.design);
      var bytes = G.zipStore(out.files);
      UI.downloadBlob(new Blob([bytes], { type: 'application/zip' }), out.zipName);
      UI.toast('已导出 ' + Object.keys(out.files).length + ' 个文件：' + out.zipName);
    } catch (e) {
      console.error(e);
      UI.toast('导出失败：' + (e.message || e), 'error');
    }
  };

  UI.exportJson = function () {
    try {
      UI.commitEdit();
      var name = String(UI.design.project || 'air8607_ui').replace(/[^A-Za-z0-9._-]+/g, '_') || 'air8607_ui';
      UI.downloadBlob(new Blob([JSON.stringify(UI.design, null, 2)], { type: 'application/json' }), name + '.json');
      UI.toast('设计稿 JSON 已导出');
    } catch (e) {
      UI.toast('导出 JSON 失败', 'error');
    }
  };

  UI.importJsonFile = async function (file) {
    if (!file) return;
    try {
      var text = await file.text();
      var parsed = JSON.parse(text);
      var data = parsed && parsed.design ? parsed.design : parsed;
      if (!data || !Array.isArray(data.widgets)) throw new Error('不是有效的设计稿：缺少 widgets 数组');
      UI.pushHistory();
      UI.design = G.normalizeState(data);
      if (parsed && parsed.view && typeof parsed.view.showGrid === 'boolean') UI.view.showGrid = parsed.view.showGrid;
      UI.selectedId = null;
      UI.view.preview = false;
      UI.previewSwitches = {};
      UI.renderAll();
      UI.applyZoom();
      UI.saveNow();
      UI.toast('已导入 ' + UI.design.widgets.length + ' 个控件');
    } catch (e) {
      UI.toast('导入失败：' + (e.message || e), 'error');
    }
  };

  UI.readFileAsDataURL = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('读取失败')); };
      reader.readAsDataURL(file);
    });
  };

  UI.syncInspectorGeometry = function (w) {
    if (!w || !UI.el.inspector) return;
    ['x', 'y', 'w', 'h'].forEach(function (key) {
      var input = UI.el.inspector.querySelector('[data-scope="widget"][data-prop="' + key + '"]');
      if (input && document.activeElement !== input) input.value = Math.round(num(w[key], 0));
    });
  };

  UI.syncInspectorNumbers = function (w, keys) {
    if (!w || !UI.el.inspector) return;
    keys.forEach(function (key) {
      var input = UI.el.inspector.querySelector('[data-scope="widget"][data-prop="' + key + '"]');
      if (input && document.activeElement !== input) input.value = num(w[key], 0);
    });
  };
})();
