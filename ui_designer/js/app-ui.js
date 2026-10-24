/*
 * Air8607 UI Studio - palette, inspector and layer UI.
 * Depends on app-core.js.
 */
(function () {
  'use strict';

  var G = window.Air8607Generator;
  var UI = window.UI;
  var W = UI.W;
  var H = UI.H;

  var ICONS = {
    panel: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 9h18"></path></svg>',
    label: '<svg viewBox="0 0 24 24"><path d="M4 6h16M8 12h12M8 18h8"></path></svg>',
    button: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="3"></rect><path d="M9 12h6"></path></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>',
    bar: '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="6" rx="3"></rect><path d="M3 12h10"></path></svg>',
    slider: '<svg viewBox="0 0 24 24"><path d="M3 12h18"></path><circle cx="14" cy="12" r="3"></circle></svg>',
    switch: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="5"></rect><circle cx="16" cy="12" r="3"></circle></svg>',
    qrcode: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"></path></svg>',
    divider: '<svg viewBox="0 0 24 24"><path d="M3 12h18"></path></svg>'
  };

  var DESC = {
    panel: '背景 / 卡片',
    label: '文本',
    button: '可点击',
    image: 'PNG / JPG',
    bar: '进度值',
    slider: '可拖动',
    switch: '开关',
    qrcode: '二维码',
    divider: '分割线'
  };

  var TYPES = ['panel', 'label', 'button', 'image', 'bar', 'slider', 'switch', 'qrcode', 'divider'];

  var TYPE_SHORT = {
    panel: 'P', label: 'T', button: 'B', image: 'I', bar: '▰',
    slider: '◉', switch: '◐', qrcode: '▦', divider: '—'
  };

  function esc(v) { return UI.esc(v); }
  function normHex(v) { return UI.normHex(v); }
  function num(v, d) { return UI.num(v, d); }

  UI.buildPalette = function () {
    if (!UI.el.palette) return;
    UI.el.palette.innerHTML = TYPES.map(function (type) {
      return '<button class="palette-item" data-type="' + type + '" title="添加' + (G.TYPE_LABELS[type] || type) + '">' +
        ICONS[type] +
        '<span>' + (G.TYPE_LABELS[type] || type) + '</span>' +
        '<small>' + DESC[type] + '</small>' +
        '</button>';
    }).join('');
  };

  function field(label, control, full) {
    return '<div class="inspector-field' + (full ? ' full' : '') + '"><label>' + label + '</label>' + control + '</div>';
  }

  function scopeAttr(scope) {
    if (scope === 'screen') return ' data-scope="screen"';
    if (scope === 'page') return ' data-scope="page"';
    return ' data-scope="widget"';
  }

  function textInput(prop, value, opts) {
    opts = opts || {};
    return '<input type="text"' + scopeAttr(opts.scope) + ' data-prop="' + prop + '" data-kind="text" value="' +
      esc(value == null ? '' : value) + '"' +
      (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      ' spellcheck="false">';
  }

  function textArea(prop, value, opts) {
    opts = opts || {};
    return '<textarea' + scopeAttr(opts.scope) + ' data-prop="' + prop + '" data-kind="text"' +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      ' spellcheck="false">' + esc(value == null ? '' : value) + '</textarea>';
  }

  function numInput(prop, value, opts) {
    opts = opts || {};
    return '<input type="number"' + scopeAttr(opts.scope) + ' data-prop="' + prop + '" data-kind="number" value="' +
      esc(num(value, 0)) + '"' +
      (opts.min !== undefined ? ' min="' + opts.min + '"' : '') +
      (opts.max !== undefined ? ' max="' + opts.max + '"' : '') +
      ' step="' + (opts.step === undefined ? 1 : opts.step) + '">';
  }

  function colorInput(prop, value, opts) {
    opts = opts || {};
    var v = normHex(value);
    return '<div class="color-pair">' +
      '<input type="color"' + scopeAttr(opts.scope) + ' data-prop="' + prop + '" data-kind="color" value="' + v + '">' +
      '<input type="text"' + scopeAttr(opts.scope) + ' data-prop="' + prop + '" data-kind="colorhex" value="' + v + '" spellcheck="false">' +
      '</div>';
  }

  function selectInput(prop, value, options, opts) {
    opts = opts || {};
    var html = '<select' + scopeAttr(opts.scope) + ' data-prop="' + prop + '" data-kind="select">';
    options.forEach(function (o) {
      html += '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    });
    return html + '</select>';
  }

  function checkInput(prop, checked, label, opts) {
    opts = opts || {};
    return '<label class="inspector-check"><input type="checkbox"' + scopeAttr(opts.scope) +
      ' data-prop="' + prop + '" data-kind="bool"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
  }

  function section(title, body) {
    return '<div class="inspector-section"><div class="inspector-section-title">' + title + '</div>' + body + '</div>';
  }

  function grid(body) {
    return '<div class="inspector-grid">' + body + '</div>';
  }

  UI.renderInspector = function () {
    if (!UI.el.inspector) return;
    var w = UI.selectedId ? UI.findWidget(UI.selectedId) : null;
    if (!w) {
      renderPageInspector();
      return;
    }

    UI.el.inspectorTitle.textContent = (G.TYPE_LABELS[w.type] || w.type) + ' · ' + (w.name || '');
    UI.el.inspectorSub.textContent = '#' + w.id;
    UI.el.inspectorQuickActions.innerHTML =
      '<button class="icon-btn" data-action="duplicate" title="复制 (⌘D)">⧉</button>' +
      '<button class="icon-btn" data-action="delete" title="删除 (Delete)">✕</button>';

    var html = '';

    html += section('基本', grid(
      field('名称', textInput('name', w.name, { maxlength: 48 }), true) +
      field('X', numInput('x', w.x, { min: 0, max: W - 1 })) +
      field('Y', numInput('y', w.y, { min: 0, max: H - 1 })) +
      field('宽度', numInput('w', w.w, { min: 1, max: W })) +
      field('高度', numInput('h', w.h, { min: 1, max: H })) +
      '<div class="inspector-field full"><div class="inspector-grid">' +
        checkInput('visible', w.visible !== false, '显示') +
        checkInput('locked', !!w.locked, '锁定') +
      '</div></div>'
    ));

    if (w.type === 'panel') {
      html += section('面板样式', grid(
        field('背景色', colorInput('bg', w.bg), true) +
        field('不透明度', numInput('opacity', w.opacity, { min: 0, max: 255 })) +
        field('圆角', numInput('radius', w.radius, { min: 0, max: 200 })) +
        field('边框宽度', numInput('borderWidth', w.borderWidth, { min: 0, max: 20 })) +
        field('边框颜色', colorInput('borderColor', w.borderColor), true)
      ));
    } else if (w.type === 'label') {
      html += section('文字', grid(
        field('内容', textArea('text', w.text), true) +
        field('字号', numInput('fontSize', w.fontSize, { min: 8, max: 96 })) +
        field('颜色', colorInput('color', w.color), true) +
        field('对齐', selectInput('align', w.align, [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']]), true)
      ));
    } else if (w.type === 'button') {
      html += section('按钮', grid(
        field('文字', textArea('text', w.text), true) +
        field('字号', numInput('fontSize', w.fontSize, { min: 8, max: 72 })) +
        field('文字颜色', colorInput('textColor', w.textColor), true) +
        field('背景色', colorInput('bg', w.bg), true) +
        field('圆角', numInput('radius', w.radius, { min: 0, max: 100 })) +
        field('边框宽度', numInput('borderWidth', w.borderWidth, { min: 0, max: 20 })) +
        field('边框颜色', colorInput('borderColor', w.borderColor), true) +
        field('按下背景', colorInput('pressedBg', w.pressedBg), true)
      ));

      var pageOpts = [['', '选择目标页面']];
      UI.design.pages.forEach(function (p) { pageOpts.push([p.id, p.name]); });
      html += section('点击动作', grid(
        field('动作', selectInput('action', w.action || 'none', [
          ['none', '无（只生成 TODO）'],
          ['page', '跳转页面'],
          ['back', '返回上一页']
        ]), true) +
        (w.action === 'page'
          ? field('目标页面', selectInput('target', w.target || '', pageOpts), true)
          : '') +
        '<div class="inspector-field full"><p class="inspector-note">跳转页面会生成 <code>M.go("page_key")</code>；返回上一页生成 <code>M.back()</code>。预览模式下可以直接点击测试。</p></div>'
      ));
    } else if (w.type === 'image') {
      var asset = w.asset && UI.design.assets[w.asset];
      html += section('图片', grid(
        field('图片路径', textInput('src', w.src, { placeholder: '/luadb/logo.png' }), true) +
        '<div class="inspector-field full"><label>上传到工程</label><button class="ghost-btn" data-action="upload-image" style="width:100%">选择 PNG / JPG</button></div>' +
        field('填充方式', selectInput('fit', w.fit, [['contain', '完整显示'], ['cover', '裁剪填满'], ['fill', '拉伸']]), true) +
        field('不透明度', numInput('opacity', w.opacity, { min: 0, max: 255 })) +
        field('圆角', numInput('radius', w.radius, { min: 0, max: 200 })) +
        '<div class="inspector-field full"><label>预览</label><div class="image-preview">' +
          (asset ? '<img src="' + asset + '" alt="">' : '<span class="muted">未上传图片，烧录时需把文件放到 /luadb/</span>') +
        '</div></div>'
      ));
    } else if (w.type === 'bar') {
      html += section('进度条', grid(
        field('最小值', numInput('min', w.min, { step: 1 })) +
        field('最大值', numInput('max', w.max, { step: 1 })) +
        field('当前值', numInput('value', w.value, { step: 1 })) +
        field('圆角', numInput('radius', w.radius, { min: 0, max: 100 })) +
        field('轨道颜色', colorInput('track', w.track), true) +
        field('指示条颜色', colorInput('indicator', w.indicator), true)
      ));
    } else if (w.type === 'slider') {
      html += section('滑块', grid(
        field('最小值', numInput('min', w.min, { step: 1 })) +
        field('最大值', numInput('max', w.max, { step: 1 })) +
        field('当前值', numInput('value', w.value, { step: 1 })) +
        field('圆角', numInput('radius', w.radius, { min: 0, max: 100 })) +
        field('轨道颜色', colorInput('track', w.track), true) +
        field('指示条颜色', colorInput('indicator', w.indicator), true) +
        field('滑块颜色', colorInput('knob', w.knob), true)
      ));
    } else if (w.type === 'switch') {
      html += section('开关', grid(
        '<div class="inspector-field full">' + checkInput('checked', !!w.checked, '默认开启') + '</div>' +
        field('开启颜色', colorInput('accent', w.accent), true)
      ));
    } else if (w.type === 'qrcode') {
      html += section('二维码', grid(
        field('内容', textArea('data', w.data, { placeholder: 'https://...' }), true) +
        field('深色', colorInput('dark', w.dark), true) +
        field('浅色', colorInput('light', w.light), true) +
        '<div class="inspector-field full">' + checkInput('quietZone', w.quietZone !== false, '保留静区') + '</div>' +
        '<p class="inspector-note">预览为示意图；烧录后由 AirUI 生成真实二维码。二维码尺寸取宽高较小值。</p>'
      ));
    } else if (w.type === 'divider') {
      html += section('分割线', grid(
        field('颜色', colorInput('color', w.color), true) +
        field('粗细', numInput('h', w.h, { min: 1, max: 20 }))
      ));
    }

    html += section('层级', '<div class="inspector-actions-row">' +
      '<button class="ghost-btn" data-action="layer-front">置顶</button>' +
      '<button class="ghost-btn" data-action="layer-up">上移</button>' +
      '<button class="ghost-btn" data-action="layer-down">下移</button>' +
      '<button class="ghost-btn" data-action="layer-back">置底</button>' +
      '</div>');

    html += section('事件', '<p class="inspector-note">导出后在 <code>ui_page.lua</code> 搜索 <code>TODO</code>，即可填写按钮点击、滑块变化、开关切换逻辑。</p>');

    UI.el.inspector.innerHTML = html;
    UI.el.inspector.scrollTop = 0;
  };

  function renderPageInspector() {
    var page = UI.currentPage();
    var idx = UI.design.pages.indexOf(page) + 1;
    var isStart = page.id === UI.design.startPage;
    UI.el.inspectorTitle.textContent = '页面设置';
    UI.el.inspectorSub.textContent = '第 ' + idx + ' / ' + UI.design.pages.length + ' 页 · 未选择控件';
    UI.el.inspectorQuickActions.innerHTML = '';

    var s = UI.design.screen;
    var size = s.preset === '10' ? '10 英寸' : '9 英寸';
    var html = '';

    html += '<div class="page-hero"><b>' + esc(UI.design.project) + '</b>' +
      '<p>' + size + ' · 1024 × 600 · ' + page.widgets.length + ' 个控件 · 共 ' + UI.design.pages.length + ' 页<br>' +
      '上方页面标签可切换；★ 表示启动页。</p></div>';

    html += section('当前页面', grid(
      field('页面名称', textInput('name', page.name, { scope: 'page', maxlength: 48 }), true) +
      '<div class="inspector-field"><label>控件数</label><div class="inspector-check">' + page.widgets.length + ' 个</div></div>' +
      '<div class="inspector-field"><label>启动页</label><div class="inspector-check">' + (isStart ? '★ 是' : '否') + '</div></div>' +
      '<div class="inspector-field full"><div class="inspector-actions-row">' +
        (isStart ? '' : '<button class="ghost-btn" data-action="set-start">设为启动页</button>') +
        '<button class="ghost-btn" data-action="add-page">新建页面</button>' +
        '<button class="ghost-btn" data-action="duplicate-page">复制页面</button>' +
        '<button class="ghost-btn danger-ghost" data-action="delete-page">删除页面</button>' +
      '</div></div>'
    ));

    html += section('画布', grid(
      '<div class="inspector-field"><label>宽度</label><div class="inspector-check">1024 px</div></div>' +
      '<div class="inspector-field"><label>高度</label><div class="inspector-check">600 px</div></div>' +
      field('背景色', colorInput('bg', s.bg, { scope: 'screen' }), true) +
      field('网格大小', numInput('grid', s.grid, { scope: 'screen', min: 0, max: 64 })) +
      '<div class="inspector-field"><label>网格显示</label><label class="inspector-check"><input type="checkbox" data-view="showGrid"' + (UI.view.showGrid ? ' checked' : '') + '> 显示</label></div>'
    ));

    html += section('快捷操作', '<div class="inspector-actions-row">' +
      '<button class="ghost-btn" data-action="sample">载入多页示例</button>' +
      '<button class="ghost-btn danger-ghost" data-action="clear">清空当前页</button>' +
      '<button class="ghost-btn" data-action="export-zip">导出工程 ZIP</button>' +
      '</div>');

    html += section('输出文件', '<p class="inspector-note">' +
      '<code>main.lua</code> 显示/触摸/背光初始化<br>' +
      '<code>ui_page.lua</code> 多页面 AirUI 界面 + 页面路由<br>' +
      '<code>exd_air8607_rgb.lua</code> 屏幕驱动<br>' +
      '<code>flash.sh</code> 平铺文件并烧录<br>' +
      '<code>res/</code> 上传的图片资源</p>');

    html += section('烧录提示', '<p class="inspector-note">' +
      '首次用 <code>./flash.sh &lt;串口&gt; full</code> 全量刷内核和 UI；之后只改界面用 <code>script</code> 模式。' +
      '固件使用 <code>LuatOS-SoC_V1028_Air1603_102.soc</code>。</p>');

    UI.el.inspector.innerHTML = html;
    UI.el.inspector.scrollTop = 0;
  }

  UI.renderPageTabs = function () {
    if (!UI.el.pageTabs || !UI.design) return;
    var active = UI.currentPage();
    var html = UI.design.pages.map(function (p) {
      var isStart = p.id === UI.design.startPage;
      return '<button class="page-tab' + (p.id === active.id ? ' active' : '') + '" data-page-id="' + esc(p.id) + '"' +
        ' title="' + esc(p.name) + (isStart ? ' · 启动页' : '') + '">' +
        '<span class="page-tab-star' + (isStart ? ' on' : '') + '">' + (isStart ? '★' : '') + '</span>' +
        '<span class="page-tab-name">' + esc(p.name) + '</span>' +
        '<span class="page-tab-count">' + p.widgets.length + '</span>' +
        '</button>';
    }).join('');
    UI.el.pageTabs.innerHTML = html;
  };

  UI.renderLayers = function () {
    if (!UI.el.layers || !UI.design) return;
    var widgets = UI.currentWidgets();
    if (!widgets.length) {
      UI.el.layers.innerHTML = '<div class="inspector-note" style="padding:6px 8px">当前页面暂无控件，从左侧组件面板添加。</div>';
      return;
    }
    var html = '';
    widgets.slice().reverse().forEach(function (w) {
      html += '<div class="layer-row' + (w.id === UI.selectedId ? ' active' : '') + (w.visible === false ? ' is-hidden' : '') + '" data-id="' + esc(w.id) + '">' +
        '<span class="layer-type">' + (TYPE_SHORT[w.type] || '?') + '</span>' +
        '<span class="layer-name">' + esc(w.name || w.type) + '</span>' +
        '<button class="layer-btn' + (w.visible === false ? ' off' : '') + '" data-layer-action="visible" title="显示/隐藏">' + (w.visible === false ? '○' : '◉') + '</button>' +
        '<button class="layer-btn' + (w.locked ? '' : ' off') + '" data-layer-action="locked" title="锁定/解锁">' + (w.locked ? '▣' : '□') + '</button>' +
        '</div>';
    });
    UI.el.layers.innerHTML = html;
  };

  /* ---------------- inspector input handling ---------------- */
  UI.onInspectorInput = function (e) {
    var el = e.target;
    if (!el || !el.matches) return;

    UI.beginEdit();

    var viewProp = el.getAttribute('data-view');
    if (viewProp === 'showGrid') {
      UI.view.showGrid = !!el.checked;
      UI.renderCanvas();
      UI.scheduleSave();
      return;
    }

    var prop = el.getAttribute('data-prop');
    if (!prop) return;
    var kind = el.getAttribute('data-kind') || 'text';
    var scope = el.getAttribute('data-scope') || 'widget';

    if (scope === 'screen') {
      if (prop === 'bg') {
        UI.design.screen.bg = normHex(el.value, UI.design.screen.bg);
        UI.syncCanvasControls();
        UI.renderCanvas();
        UI.scheduleSave();
      } else if (prop === 'grid') {
        UI.design.screen.grid = UI.clamp(Math.round(num(el.value, 8)), 0, 64);
        UI.syncCanvasControls();
        UI.renderCanvas();
        UI.scheduleSave();
      }
      return;
    }

    if (scope === 'page') {
      var page = UI.currentPage();
      if (prop === 'name') {
        page.name = el.value;
        if (e.type === 'change' && !String(page.name).trim()) {
          page.name = '页面 ' + (UI.design.pages.indexOf(page) + 1);
          el.value = page.name;
        }
        UI.renderPageTabs();
        UI.scheduleSave();
      }
      return;
    }

    var w = UI.findWidget(UI.selectedId);
    if (!w) return;

    if (kind === 'number') {
      if (el.value === '') return;
      var n = Number(el.value);
      if (!isFinite(n)) return;
      n = Math.round(n * 10) / 10;
      if (prop === 'x' || prop === 'y' || prop === 'w' || prop === 'h') {
        w[prop] = Math.round(n);
        w.x = UI.clamp(w.x, 0, W - 1);
        w.y = UI.clamp(w.y, 0, H - 1);
        w.w = UI.clamp(w.w, 1, W - w.x);
        w.h = UI.clamp(w.h, 1, H - w.y);
        UI.syncInspectorGeometry(w);
      } else if (prop === 'min') {
        w.min = n;
        if (w.max <= w.min) w.max = w.min + 1;
        w.value = UI.clamp(w.value, w.min, w.max);
        UI.syncInspectorNumbers(w, ['min', 'max', 'value']);
      } else if (prop === 'max') {
        w.max = n;
        if (w.max <= w.min) w.min = w.max - 1;
        w.value = UI.clamp(w.value, w.min, w.max);
        UI.syncInspectorNumbers(w, ['min', 'max', 'value']);
      } else if (prop === 'value') {
        if (w.type === 'bar' || w.type === 'slider') {
          w.value = UI.clamp(n, num(w.min, 0), num(w.max, 100));
        } else {
          w.value = n;
        }
        UI.syncInspectorNumbers(w, ['value']);
      } else if (prop === 'opacity') {
        w.opacity = UI.clamp(Math.round(n), 0, 255);
      } else if (prop === 'fontSize') {
        w.fontSize = UI.clamp(Math.round(n), 8, 96);
      } else if (prop === 'radius') {
        w.radius = UI.clamp(Math.round(n), 0, 200);
      } else if (prop === 'borderWidth') {
        w.borderWidth = UI.clamp(Math.round(n), 0, 20);
      } else {
        w[prop] = n;
      }
    } else if (kind === 'bool') {
      w[prop] = !!el.checked;
      if (prop === 'visible' || prop === 'locked') UI.renderLayers();
    } else if (kind === 'color' || kind === 'colorhex') {
      var v = normHex(el.value, null);
      if (!v) return;
      w[prop] = v;
      var pair = el.closest('.color-pair');
      if (pair) {
        var other = pair.querySelector(kind === 'color' ? '[data-kind="colorhex"]' : '[data-kind="color"]');
        if (other) other.value = v;
      }
    } else {
      w[prop] = el.value;
      if (prop === 'name') {
        UI.el.inspectorTitle.textContent = (G.TYPE_LABELS[w.type] || w.type) + ' · ' + w.name;
        UI.renderLayers();
      }
      if (prop === 'action' && w.type === 'button') {
        if (w.action === 'page' && !UI.findPage(w.target)) {
          var other = UI.design.pages.filter(function (p) { return p.id !== UI.design.activePage; })[0] || UI.design.pages[0];
          w.target = other ? other.id : '';
        }
        if (e.type === 'change') UI.renderInspector();
      }
    }

    UI.renderCanvas();
    UI.updateSelectionInfo();
    UI.scheduleSave();
  };

  /* ---------------- inspector actions ---------------- */
  UI.onInspectorClick = function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'duplicate') UI.duplicateSelected();
    else if (action === 'delete') UI.deleteSelected();
    else if (action === 'layer-front') UI.moveLayer('front');
    else if (action === 'layer-up') UI.moveLayer('up');
    else if (action === 'layer-down') UI.moveLayer('down');
    else if (action === 'layer-back') UI.moveLayer('back');
    else if (action === 'upload-image') {
      UI.pendingImageId = UI.selectedId;
      if (UI.el.imageFile) {
        UI.el.imageFile.value = '';
        UI.el.imageFile.click();
      }
    } else if (action === 'set-start') UI.setStartPage(UI.design.activePage);
    else if (action === 'add-page') UI.addPage();
    else if (action === 'duplicate-page') UI.duplicatePage(UI.design.activePage);
    else if (action === 'delete-page') UI.deletePage(UI.design.activePage);
    else if (action === 'sample') UI.loadSample();
    else if (action === 'clear') UI.clearCanvas();
    else if (action === 'export-zip') UI.exportZip();
  };

  /* ---------------- layers ---------------- */
  UI.onLayersClick = function (e) {
    var row = e.target.closest('.layer-row');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var w = UI.findWidget(id);
    if (!w) return;
    var btn = e.target.closest('[data-layer-action]');
    if (btn) {
      var action = btn.getAttribute('data-layer-action');
      UI.pushHistory();
      if (action === 'visible') w.visible = w.visible === false;
      else if (action === 'locked') w.locked = !w.locked;
      UI.renderAll();
      UI.saveNow();
      return;
    }
    UI.selectWidget(id);
  };

  /* ---------------- image upload ---------------- */
  UI.handleImageUpload = async function () {
    var fileInput = UI.el.imageFile;
    if (!fileInput || !fileInput.files || !fileInput.files.length) return;
    var file = fileInput.files[0];
    fileInput.value = '';
    var id = UI.pendingImageId || UI.selectedId;
    UI.pendingImageId = null;
    var w = UI.findWidget(id);
    if (!w || w.type !== 'image') {
      UI.toast('请先选中一个图片控件', 'error');
      return;
    }
    if (!/^image\//.test(file.type || '')) {
      UI.toast('请选择图片文件', 'error');
      return;
    }
    if (file.size > 800 * 1024) {
      UI.toast('图片较大（' + Math.round(file.size / 1024) + ' KB），可能超出脚本区容量', 'error');
    }
    try {
      var dataUrl = await UI.readFileAsDataURL(file);
      var base = String(file.name || 'image')
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'image';
      var extMatch = String(file.name || '').match(/\.[A-Za-z0-9]+$/);
      var ext = extMatch ? extMatch[0].toLowerCase() : '.png';
      if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') ext = '.png';
      var name = base + ext;
      var n = 2;
      while (UI.design.assets[name] && UI.design.assets[name] !== dataUrl) {
        name = base + '-' + n + ext;
        n++;
      }
      UI.pushHistory();
      UI.design.assets[name] = dataUrl;
      w.asset = name;
      w.src = '/luadb/' + name;
      UI.renderAll();
      UI.saveNow();
      UI.toast('图片已加入工程：' + name + '（导出时放在 res/）');
    } catch (err) {
      UI.toast('读取图片失败：' + (err.message || err), 'error');
    }
  };

  /* ---------------- modal / help ---------------- */
  UI.openModal = function (title, html) {
    if (!UI.el.modal) return;
    UI.el.modalTitle.textContent = title;
    UI.el.modalBody.innerHTML = html;
    UI.el.modal.classList.remove('hidden');
  };

  UI.closeModal = function () {
    if (UI.el.modal) UI.el.modal.classList.add('hidden');
  };

  UI.showHelp = function () {
    UI.openModal('使用说明', [
      '<h3>1. 设计</h3>',
      '<ul>',
      '<li>从左侧点击组件添加；拖动移动，拖 8 个控制点缩放。</li>',
      '<li>画布上方是页面标签：点击切换，★ 表示启动页，双击可改名；<b>＋ 新建</b> 添加页面。</li>',
      '<li>没选中控件时，右侧“页面设置”可以改名、设为启动页、复制/删除页面。</li>',
      '<li>按钮属性里的 <b>点击动作</b> 可以选择“跳转页面 / 返回上一页”。</li>',
      '<li>右侧属性面板修改文字、颜色、圆角、数值；图层列表可显示/隐藏、锁定、调整层级。</li>',
      '<li>“预览”会隐藏选择框；按钮可以跳页，开关可以点击测试。</li>',
      '</ul>',
      '<h3>2. 导出</h3>',
      '<p>点击 <b>导出工程 ZIP</b>，会得到完整可烧录工程。多页面会生成页面路由和按钮跳转代码：</p>',
      '<pre>main.lua\nui_page.lua\nexd_air8607_rgb.lua\nflash.sh\nREADME.md\ndesign.json\nres/          # 上传的图片</pre>',
      '<h3>3. 烧录</h3>',
      '<p>需要合宙 <code>luatos-cli</code> 和 <code>LuatOS-SoC_V1028_Air1603_102.soc</code>。解压 ZIP 后：</p>',
      '<pre>chmod +x flash.sh\n./flash.sh /dev/cu.usbmodemXXXX full     # 首次全量\n./flash.sh /dev/cu.usbmodemXXXX script   # 以后只刷 UI</pre>',
      '<p>也可以使用仓库根目录的 <code>flash_project.sh</code>。脚本会自动平铺文件，避免 LuaDB 27 字节文件名限制。</p>',
      '<h3>4. 快捷键</h3>',
      '<ul>',
      '<li><code>Delete</code> 删除，<code>⌘/Ctrl + D</code> 复制</li>',
      '<li><code>⌘/Ctrl + Z</code> 撤销，<code>Shift + ⌘/Ctrl + Z</code> 重做</li>',
      '<li>方向键移动 1px，<code>Shift + 方向键</code> 移动 10px</li>',
      '<li><code>Esc</code> 取消选择 / 退出预览</li>',
      '</ul>',
      '<h3>5. 注意</h3>',
      '<ul>',
      '<li>9 寸和 10 寸都是 1024×600，生成代码里 <code>SCREEN_SIZE</code> 不同。</li>',
      '<li>Air8607 无 WiFi/4G；联网需要 Air8603 或外接模块。</li>',
      '<li>如果显示或触摸异常，优先核对屏幕排线、面板驱动 IC 和卖家给的 9 寸配置。</li>',
      '</ul>'
    ].join(''));
  };
})();
