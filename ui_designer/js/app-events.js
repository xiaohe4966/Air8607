/*
 * Air8607 UI Studio - DOM bindings, canvas drag/resize and initialization.
 * Depends on app-core.js and app-ui.js.
 */
(function () {
  'use strict';

  var UI = window.UI;
  var G = window.Air8607Generator;
  var W = UI.W;
  var H = UI.H;

  UI.initEls = function () {
    var e = UI.el;
    e.canvas = document.getElementById('canvas');
    e.canvasWrap = document.getElementById('canvasWrap');
    e.canvasScroll = document.getElementById('canvasScroll');
    e.canvasEmpty = document.getElementById('canvasEmpty');
    e.projectName = document.getElementById('projectName');
    e.screenPreset = document.getElementById('screenPreset');
    e.screenChip = document.getElementById('screenChip');
    e.palette = document.getElementById('palette');
    e.inspector = document.getElementById('inspector');
    e.inspectorTitle = document.getElementById('inspectorTitle');
    e.inspectorSub = document.getElementById('inspectorSub');
    e.inspectorQuickActions = document.getElementById('inspectorQuickActions');
    e.pageTabs = document.getElementById('pageTabs');
    e.addPageBtn = document.getElementById('addPageBtn');
    e.layers = document.getElementById('layers');
    e.canvasBgColor = document.getElementById('canvasBgColor');
    e.canvasBgHex = document.getElementById('canvasBgHex');
    e.gridSize = document.getElementById('gridSize');
    e.showGrid = document.getElementById('showGrid');
    e.statusText = document.getElementById('statusText');
    e.coordText = document.getElementById('coordText');
    e.zoomText = document.getElementById('zoomText');
    e.widgetCount = document.getElementById('widgetCount');
    e.selectionInfo = document.getElementById('selectionInfo');
    e.toast = document.getElementById('toast');
    e.modal = document.getElementById('modal');
    e.modalTitle = document.getElementById('modalTitle');
    e.modalBody = document.getElementById('modalBody');
    e.modalCloseBtn = document.getElementById('modalCloseBtn');
    e.importFile = document.getElementById('importFile');
    e.imageFile = document.getElementById('imageFile');
    e.undoBtn = document.getElementById('undoBtn');
    e.redoBtn = document.getElementById('redoBtn');
    e.exportZipBtn = document.getElementById('exportZipBtn');
    e.exportJsonBtn = document.getElementById('exportJsonBtn');
    e.codeBtn = document.getElementById('codeBtn');
    e.importBtn = document.getElementById('importBtn');
    e.previewBtn = document.getElementById('previewBtn');
    e.helpBtn = document.getElementById('helpBtn');
    e.githubLink = document.getElementById('githubLink');
    e.sampleBtn = document.getElementById('sampleBtn');
    e.newBtn = document.getElementById('newBtn');
    e.zoomInBtn = document.getElementById('zoomInBtn');
    e.zoomOutBtn = document.getElementById('zoomOutBtn');
    e.zoomFitBtn = document.getElementById('zoomFitBtn');
    e.gridToggleBtn = document.getElementById('gridToggleBtn');
  };

  /* ---------------- top bar ---------------- */
  UI.bindTopbar = function () {
    var e = UI.el;

    e.undoBtn.addEventListener('click', function () {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      UI.undo();
    });
    e.redoBtn.addEventListener('click', function () {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      UI.redo();
    });

    e.importBtn.addEventListener('click', function () { e.importFile.click(); });
    e.importFile.addEventListener('change', function () {
      var f = e.importFile.files && e.importFile.files[0];
      e.importFile.value = '';
      if (f) UI.importJsonFile(f);
    });

    e.exportJsonBtn.addEventListener('click', UI.exportJson);
    if (e.codeBtn) e.codeBtn.addEventListener('click', UI.previewCode);
    e.exportZipBtn.addEventListener('click', UI.exportZip);
    e.previewBtn.addEventListener('click', UI.togglePreview);
    e.helpBtn.addEventListener('click', UI.showHelp);

    e.githubLink.href = 'https://github.com/xiaohe4966/Air8607';
    e.githubLink.target = '_blank';
    e.githubLink.rel = 'noopener';

    e.projectName.addEventListener('focus', UI.beginEdit);
    e.projectName.addEventListener('input', function () {
      UI.beginEdit();
      UI.design.project = this.value;
      UI.scheduleSave();
    });
    e.projectName.addEventListener('change', UI.commitEdit);
    e.projectName.addEventListener('blur', UI.commitEdit);

    e.screenPreset.addEventListener('change', function () {
      UI.setScreenPreset(this.value);
    });
  };

  /* ---------------- left sidebar ---------------- */
  UI.bindSidebar = function () {
    var e = UI.el;

    e.palette.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-type]');
      if (btn) UI.addWidget(btn.getAttribute('data-type'));
    });

    if (e.pageTabs) {
      e.pageTabs.addEventListener('click', function (ev) {
        var tab = ev.target.closest('[data-page-id]');
        if (!tab) return;
        if (ev.target.closest('[data-tab-action="duplicate"]')) {
          UI.duplicatePage(tab.getAttribute('data-page-id'));
          return;
        }
        UI.switchPage(tab.getAttribute('data-page-id'));
      });
      e.pageTabs.addEventListener('dblclick', function (ev) {
        var tab = ev.target.closest('[data-page-id]');
        if (!tab) return;
        UI.switchPage(tab.getAttribute('data-page-id'));
        setTimeout(function () {
          var input = UI.el.inspector.querySelector('[data-scope="page"][data-prop="name"]');
          if (input) {
            input.focus();
            if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length);
          }
        }, 20);
      });
    }
    if (e.addPageBtn) e.addPageBtn.addEventListener('click', function () { UI.addPage(); });

    e.canvasBgColor.addEventListener('focus', UI.beginEdit);
    e.canvasBgColor.addEventListener('input', function () {
      UI.beginEdit();
      UI.setScreenBg(this.value);
      if (e.canvasBgHex) e.canvasBgHex.value = UI.normHex(this.value);
    });
    e.canvasBgColor.addEventListener('change', UI.commitEdit);
    e.canvasBgColor.addEventListener('blur', UI.commitEdit);

    e.canvasBgHex.addEventListener('focus', UI.beginEdit);
    e.canvasBgHex.addEventListener('input', function () {
      var v = UI.normHex(this.value, null);
      if (!v) return;
      UI.beginEdit();
      UI.setScreenBg(v);
      if (e.canvasBgColor) e.canvasBgColor.value = v;
    });
    e.canvasBgHex.addEventListener('change', function () {
      if (!UI.normHex(this.value, null)) this.value = UI.normHex(UI.design.screen.bg);
      UI.commitEdit();
    });
    e.canvasBgHex.addEventListener('blur', function () {
      if (!UI.normHex(this.value, null)) this.value = UI.normHex(UI.design.screen.bg);
      UI.commitEdit();
    });

    e.gridSize.addEventListener('focus', UI.beginEdit);
    e.gridSize.addEventListener('input', function () {
      UI.beginEdit();
      var n = UI.clamp(Math.round(UI.num(this.value, 8)), 0, 64);
      UI.design.screen.grid = n;
      UI.el.canvas.style.setProperty('--grid-size', Math.max(1, n) + 'px');
      UI.renderCanvas();
      UI.scheduleSave();
    });
    e.gridSize.addEventListener('change', UI.commitEdit);
    e.gridSize.addEventListener('blur', UI.commitEdit);

    e.showGrid.addEventListener('change', function () {
      UI.view.showGrid = !!this.checked;
      UI.renderCanvas();
      UI.scheduleSave();
    });

    e.sampleBtn.addEventListener('click', UI.loadSample);
    e.newBtn.addEventListener('click', UI.clearCanvas);

    e.gridToggleBtn.addEventListener('click', function () {
      UI.view.showGrid = !UI.view.showGrid;
      e.showGrid.checked = UI.view.showGrid;
      UI.renderCanvas();
      UI.scheduleSave();
    });

    e.zoomInBtn.addEventListener('click', function () {
      UI.view.zoomFactor = UI.clamp(UI.view.zoomFactor + 0.1, 0.5, 2.5);
      UI.applyZoom();
    });
    e.zoomOutBtn.addEventListener('click', function () {
      UI.view.zoomFactor = UI.clamp(UI.view.zoomFactor - 0.1, 0.5, 2.5);
      UI.applyZoom();
    });
    e.zoomFitBtn.addEventListener('click', function () {
      UI.view.zoomFactor = 1;
      UI.applyZoom();
    });
  };

  /* ---------------- canvas ---------------- */
  UI.bindCanvas = function () {
    var c = UI.el.canvas;

    c.addEventListener('pointermove', function (ev) {
      var p = UI.canvasPoint(ev);
      if (UI.el.coordText) UI.el.coordText.textContent = 'x ' + Math.round(p.x) + ' · y ' + Math.round(p.y);
    });
    c.addEventListener('pointerleave', function () {
      if (UI.el.coordText) UI.el.coordText.textContent = 'x 0 · y 0';
    });

    c.addEventListener('pointerdown', UI.onCanvasPointerDown);
    c.addEventListener('dblclick', function (ev) {
      var el = ev.target.closest('.widget');
      if (!el) return;
      var w = UI.findWidget(el.getAttribute('data-id'));
      if (!w) return;
      UI.selectWidget(w.id);
      if (w.type === 'label' || w.type === 'button') {
        setTimeout(function () {
          var input = UI.el.inspector.querySelector('[data-prop="text"]');
          if (input) {
            input.focus();
            if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length);
          }
        }, 20);
      }
    });
  };

  UI.onCanvasPointerDown = function (ev) {
    if (ev.button !== 0) return;

    if (UI.view.preview) {
      var previewEl = ev.target.closest('.widget');
      if (!previewEl) return;
      var pw = UI.findWidget(previewEl.getAttribute('data-id'));
      if (!pw) return;
      if (pw.type === 'button') {
        if (pw.action === 'page') {
          var target = UI.findPage(pw.target);
          if (target) {
            if (target.id === UI.design.activePage) UI.toast('已在该页面：' + target.name);
            else UI.previewGo(target.id);
          } else {
            UI.toast('按钮「' + (pw.name || pw.text || '') + '」还没有设置目标页面', 'error');
          }
        } else if (pw.action === 'back') {
          UI.previewBack();
        } else {
          UI.toast('按钮点击：' + (pw.name || pw.text || 'button'));
        }
      } else if (pw.type === 'switch') {
        var cur = Object.prototype.hasOwnProperty.call(UI.previewSwitches, pw.id) ? !!UI.previewSwitches[pw.id] : !!pw.checked;
        UI.previewSwitches[pw.id] = !cur;
        UI.renderCanvas();
        UI.toast('开关：' + (pw.name || 'switch') + ' → ' + (!cur ? '开' : '关'));
      } else {
        UI.toast((G.TYPE_LABELS[pw.type] || pw.type) + '：' + (pw.name || ''));
      }
      return;
    }

    var handleEl = ev.target.closest('.resize-handle');
    var handle = handleEl ? handleEl.getAttribute('data-handle') : null;
    var widgetEl = ev.target.closest('.widget');

    if (!widgetEl) {
      UI.selectWidget(null);
      return;
    }

    var w = UI.findWidget(widgetEl.getAttribute('data-id'));
    if (!w) return;
    UI.selectWidget(w.id);

    if (w.locked) {
      UI.setStatus('控件已锁定，请在图层列表解锁');
      return;
    }

    var p = UI.canvasPoint(ev);
    UI.drag = {
      id: w.id,
      mode: handle ? 'resize' : 'move',
      handle: handle,
      startX: p.x,
      startY: p.y,
      orig: { x: UI.num(w.x, 0), y: UI.num(w.y, 0), w: UI.num(w.w, 1), h: UI.num(w.h, 1) },
      snapshot: JSON.stringify(UI.design),
      moved: false
    };
    window.addEventListener('pointermove', UI.onDragMove, { passive: false });
    window.addEventListener('pointerup', UI.onDragEnd);
    window.addEventListener('pointercancel', UI.onDragEnd);
    ev.preventDefault();
    ev.stopPropagation();
  };

  UI.onDragMove = function (ev) {
    var drag = UI.drag;
    if (!drag) return;
    var w = UI.findWidget(drag.id);
    if (!w) return;

    var p = UI.canvasPoint(ev);
    var dx = p.x - drag.startX;
    var dy = p.y - drag.startY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;

    var grid = UI.num(UI.design.screen.grid, 8);
    function snap(v) {
      if (!ev.altKey && grid > 0) return Math.round(v / grid) * grid;
      return Math.round(v);
    }

    if (drag.mode === 'move') {
      var nx = drag.orig.x + dx;
      var ny = drag.orig.y + dy;
      if (ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) ny = drag.orig.y;
        else nx = drag.orig.x;
      }
      w.x = UI.clamp(snap(nx), 0, Math.max(0, W - drag.orig.w));
      w.y = UI.clamp(snap(ny), 0, Math.max(0, H - drag.orig.h));
      w.w = drag.orig.w;
      w.h = drag.orig.h;
    } else {
      var h = drag.handle || 'se';
      var left = drag.orig.x;
      var top = drag.orig.y;
      var right = drag.orig.x + drag.orig.w;
      var bottom = drag.orig.y + drag.orig.h;

      if (h.indexOf('e') >= 0) right = snap(drag.orig.x + drag.orig.w + dx);
      if (h.indexOf('s') >= 0) bottom = snap(drag.orig.y + drag.orig.h + dy);
      if (h.indexOf('w') >= 0) left = snap(drag.orig.x + dx);
      if (h.indexOf('n') >= 0) top = snap(drag.orig.y + dy);

      var ms = UI.minSize(w);
      left = UI.clamp(left, 0, W - ms.w);
      top = UI.clamp(top, 0, H - ms.h);
      right = UI.clamp(right, 0, W);
      bottom = UI.clamp(bottom, 0, H);

      if (right < left + ms.w) {
        if (h.indexOf('w') >= 0) left = right - ms.w;
        else right = left + ms.w;
      }
      if (bottom < top + ms.h) {
        if (h.indexOf('n') >= 0) top = bottom - ms.h;
        else bottom = top + ms.h;
      }

      left = UI.clamp(left, 0, W - ms.w);
      top = UI.clamp(top, 0, H - ms.h);
      right = UI.clamp(right, left + ms.w, W);
      bottom = UI.clamp(bottom, top + ms.h, H);

      w.x = Math.round(left);
      w.y = Math.round(top);
      w.w = Math.max(ms.w, Math.round(right - left));
      w.h = Math.max(ms.h, Math.round(bottom - top));
    }

    var safeId = (window.CSS && window.CSS.escape) ? window.CSS.escape(w.id) : w.id;
    var el = UI.el.canvas.querySelector('.widget[data-id="' + safeId + '"]');
    if (el) {
      el.style.left = UI.num(w.x, 0) + 'px';
      el.style.top = UI.num(w.y, 0) + 'px';
      el.style.width = Math.max(1, UI.num(w.w, 1)) + 'px';
      el.style.height = Math.max(1, UI.num(w.h, 1)) + 'px';
    }

    UI.syncInspectorGeometry(w);
    UI.updateSelectionInfo();
    UI.scheduleSave();
    if (ev.cancelable) ev.preventDefault();
  };

  UI.onDragEnd = function () {
    window.removeEventListener('pointermove', UI.onDragMove);
    window.removeEventListener('pointerup', UI.onDragEnd);
    window.removeEventListener('pointercancel', UI.onDragEnd);
    var drag = UI.drag;
    UI.drag = null;
    if (!drag) return;
    if (drag.moved) {
      UI.pushHistory(drag.snapshot);
      UI.saveNow();
      UI.renderCanvas();
      UI.updateSelectionInfo();
      UI.setStatus('已移动/缩放控件');
    }
  };

  /* ---------------- inspector / layers ---------------- */
  UI.bindInspector = function () {
    var ins = UI.el.inspector;

    ins.addEventListener('focusin', function (ev) {
      if (ev.target.matches && ev.target.matches('input, textarea, select')) UI.beginEdit();
    });
    ins.addEventListener('input', UI.onInspectorInput);
    ins.addEventListener('change', function (ev) {
      UI.onInspectorInput(ev);
      UI.commitEdit();
    });
    ins.addEventListener('focusout', function (ev) {
      if (!ins.contains(ev.relatedTarget)) UI.commitEdit();
    });
    ins.addEventListener('click', UI.onInspectorClick);

    if (UI.el.inspectorQuickActions) {
      UI.el.inspectorQuickActions.addEventListener('click', UI.onInspectorClick);
    }

    UI.el.layers.addEventListener('click', UI.onLayersClick);

    UI.el.imageFile.addEventListener('change', UI.handleImageUpload);
  };

  /* ---------------- keyboard ---------------- */
  UI.bindKeyboard = function () {
    document.addEventListener('keydown', function (ev) {
      var target = ev.target;
      var editing = target && (target.matches && target.matches('input, textarea, select') || target.isContentEditable);
      var meta = ev.metaKey || ev.ctrlKey;
      var key = String(ev.key || '').toLowerCase();

      if (meta && key === 's') {
        ev.preventDefault();
        UI.saveNow();
        UI.toast('设计已保存到浏览器本地');
        return;
      }

      if (meta && key === 'z') {
        if (editing) return;
        ev.preventDefault();
        if (ev.shiftKey) UI.redo();
        else UI.undo();
        return;
      }
      if (meta && key === 'y') {
        if (editing) return;
        ev.preventDefault();
        UI.redo();
        return;
      }
      if (meta && key === 'd') {
        if (editing) return;
        ev.preventDefault();
        if (ev.shiftKey || !UI.selectedId) UI.duplicatePage();
        else UI.duplicateSelected();
        return;
      }
      if (meta && (key === 'c' || key === 'v')) {
        if (editing) return;
        if (UI.el.modal && !UI.el.modal.classList.contains('hidden')) return;
        ev.preventDefault();
        if (key === 'c') UI.copySelected();
        else UI.pasteWidget();
        return;
      }

      if (key === 'escape') {
        if (UI.el.modal && !UI.el.modal.classList.contains('hidden')) {
          UI.closeModal();
        } else if (UI.view.preview) {
          UI.togglePreview();
        } else if (UI.selectedId) {
          UI.selectWidget(null);
        }
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        if (editing) return;
        if (!UI.selectedId) return;
        ev.preventDefault();
        UI.deleteSelected();
        return;
      }

      if (key.indexOf('arrow') === 0) {
        if (editing || !UI.selectedId) return;
        ev.preventDefault();
        var step = ev.shiftKey ? 10 : 1;
        if (key === 'arrowleft') UI.moveSelectedBy(-step, 0);
        else if (key === 'arrowright') UI.moveSelectedBy(step, 0);
        else if (key === 'arrowup') UI.moveSelectedBy(0, -step);
        else if (key === 'arrowdown') UI.moveSelectedBy(0, step);
        return;
      }

      if (key === '?' && !editing) {
        UI.showHelp();
      }
    });
  };

  /* ---------------- modal ---------------- */
  UI.bindModal = function () {
    if (UI.el.modalCloseBtn) UI.el.modalCloseBtn.addEventListener('click', UI.closeModal);
    if (UI.el.modal) {
      UI.el.modal.addEventListener('click', function (ev) {
        if (ev.target === UI.el.modal) UI.closeModal();
      });
    }
    if (UI.el.modalBody) {
      UI.el.modalBody.addEventListener('click', function (ev) {
        var tab = ev.target.closest('[data-code-file]');
        if (tab) {
          UI.renderCodePreview(tab.getAttribute('data-code-file'));
          return;
        }
        if (ev.target.closest('#codeCopyBtn')) UI.copyCodeFile();
      });
    }
  };

  /* ---------------- init ---------------- */
  UI.init = function () {
    UI.initEls();
    UI.buildPalette();
    UI.loadSaved();
    UI.bindTopbar();
    UI.bindSidebar();
    UI.bindCanvas();
    UI.bindInspector();
    UI.bindKeyboard();
    UI.bindModal();
    UI.renderAll();
    UI.applyZoom();
    requestAnimationFrame(function () { UI.applyZoom(); });
    setTimeout(function () { UI.applyZoom(); }, 80);

    if (window.ResizeObserver && UI.el.canvasScroll) {
      var ro = new ResizeObserver(function () { UI.applyZoom(); });
      ro.observe(UI.el.canvasScroll);
    } else {
      window.addEventListener('resize', UI.applyZoom);
    }

    window.addEventListener('beforeunload', UI.saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) UI.saveNow();
    });

    UI.el.githubLink.href = 'https://github.com/xiaohe4966/Air8607';
    UI.setStatus('Air8607 UI Studio 就绪');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', UI.init);
  } else {
    UI.init();
  }
})();
