/*
 * Air8607 UI Studio - Lua project generator
 * Works in the browser (window.Air8607Generator) and in Node (module.exports).
 */
(function (global) {
  'use strict';

  var EXD_LUA = (typeof require === 'function')
    ? require('./exd_template.js')
    : global.EXD_LUA;

  var SCREEN_W = 1024;
  var SCREEN_H = 600;

  var DEFAULTS = {
    panel:   { w: 300, h: 180, bg: '#162235', opacity: 255, radius: 12, borderWidth: 1, borderColor: '#2A3A52' },
    label:   { w: 240, h: 32,  text: '文本', fontSize: 20, color: '#E6EEFC', align: 'left' },
    button:  { w: 140, h: 44,  text: '按钮', fontSize: 18, bg: '#1E6BFF', textColor: '#FFFFFF', radius: 8, borderWidth: 0, borderColor: '#1E6BFF', pressedBg: '#3D8BFF', action: 'none', target: '' },
    image:   { w: 80, h: 80,   src: '/luadb/logo.png', fit: 'contain', opacity: 255, radius: 0 },
    bar:     { w: 240, h: 12,  min: 0, max: 100, value: 60, track: '#26364D', indicator: '#22D3EE', radius: 6 },
    slider:  { w: 240, h: 30,  min: 0, max: 100, value: 50, track: '#26364D', indicator: '#22D3EE', knob: '#FFFFFF', radius: 15 },
    switch:  { w: 70, h: 30,   checked: true, accent: '#22C55E' },
    qrcode:  { w: 120, h: 120, data: 'https://docs.openluat.com/air8607/', dark: '#0B1524', light: '#FFFFFF', quietZone: true },
    divider: { w: 300, h: 2,   color: '#2A3A52' }
  };

  var TYPE_LABELS = {
    panel: '面板', label: '文字', button: '按钮', image: '图片',
    bar: '进度条', slider: '滑块', switch: '开关', qrcode: '二维码', divider: '分割线'
  };

  function uid(prefix) {
    return (prefix || 'w') + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function num(v, d) {
    var n = Number(v);
    if (!isFinite(n)) return d === undefined ? 0 : d;
    return Math.round(n * 10) / 10;
  }

  function int(v, d) {
    var n = Math.round(Number(v));
    return isFinite(n) ? n : (d || 0);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function normalizeWidget(w, i) {
    var type = DEFAULTS[w.type] ? w.type : 'panel';
    var d = DEFAULTS[type];
    var out = Object.assign({}, d, w);
    out.id = w.id || uid('w');
    out.type = type;
    out.name = String(w.name || (TYPE_LABELS[type] + '_' + (i + 1))).trim() || (TYPE_LABELS[type] + '_' + (i + 1));
    out.x = int(w.x, 0);
    out.y = int(w.y, 0);
    out.w = Math.max(1, int(w.w, d.w));
    out.h = Math.max(1, int(w.h, d.h));
    out.visible = w.visible !== false;
    out.locked = !!w.locked;
    if (type === 'label' || type === 'button') {
      out.text = String(w.text == null ? d.text : w.text);
      out.fontSize = clamp(int(w.fontSize, d.fontSize), 8, 96);
      out.align = ['left', 'center', 'right'].indexOf(w.align) >= 0 ? w.align : d.align;
    }
    if (type === 'button') {
      out.action = ['none', 'page', 'back'].indexOf(w.action) >= 0 ? w.action : 'none';
      out.target = String(w.target == null ? '' : w.target);
    }
    if (type === 'switch') out.checked = !!w.checked;
    if (type === 'qrcode') {
      out.data = String(w.data == null ? d.data : w.data);
      out.quietZone = w.quietZone !== false;
    }
    if (type === 'bar' || type === 'slider') {
      out.min = num(w.min, d.min);
      out.max = num(w.max, d.max);
      if (out.max <= out.min) out.max = out.min + 1;
      out.value = clamp(num(w.value, d.value), out.min, out.max);
    }
    return out;
  }

  function normalizePage(page, i) {
    var p = page && typeof page === 'object' ? clone(page) : {};
    var fallback = '页面 ' + (i + 1);
    p.id = String(p.id || uid('p'));
    p.name = String(p.name || fallback).trim().slice(0, 48) || fallback;
    p.widgets = (Array.isArray(p.widgets) ? p.widgets : []).map(normalizeWidget);
    return p;
  }

  function normalizeState(input) {
    var s = input && typeof input === 'object' ? clone(input) : {};
    s.version = 2;
    s.project = String(s.project || 'air8607_ui').trim() || 'air8607_ui';
    s.screen = Object.assign({ preset: '9', width: SCREEN_W, height: SCREEN_H, bg: '#0B1524', grid: 8 }, s.screen || {});
    s.screen.preset = String(s.screen.preset) === '10' ? '10' : '9';
    s.screen.width = SCREEN_W;
    s.screen.height = SCREEN_H;
    s.screen.grid = clamp(int(s.screen.grid, 8), 0, 64);

    // v1 设计稿只有 widgets；v2 用 pages 保存多页，每个页面各自拥有 widgets。
    var rawPages = (Array.isArray(s.pages) && s.pages.length)
      ? s.pages
      : [{ id: 'p_home', name: '页面 1', widgets: Array.isArray(s.widgets) ? s.widgets : [] }];
    var usedPageIds = {};
    s.pages = rawPages.map(function (p, i) {
      var page = normalizePage(p, i);
      if (usedPageIds[page.id]) page.id = uid('p');
      usedPageIds[page.id] = true;
      return page;
    });
    if (!s.pages.length) s.pages = [normalizePage({ name: '页面 1' }, 0)];

    var pageIds = {};
    s.pages.forEach(function (p) { pageIds[p.id] = true; });
    s.startPage = pageIds[s.startPage] ? String(s.startPage) : s.pages[0].id;
    s.activePage = pageIds[s.activePage] ? String(s.activePage) : s.startPage;

    // 删除页面后，失效的跳转目标不要留成半坏状态。
    s.pages.forEach(function (p) {
      p.widgets.forEach(function (w) {
        if (w.type === 'button' && w.action === 'page' && !pageIds[w.target]) w.target = '';
      });
    });

    delete s.widgets;
    s.assets = (s.assets && typeof s.assets === 'object') ? s.assets : {};
    return s;
  }

  function sampleProject() {
    var homeId = uid('p');
    var settingsId = uid('p');
    var w = [];
    var settings = [];
    function addTo(list, type, name, x, y, width, height, props) {
      list.push(Object.assign({ id: uid('w'), type: type, name: name, x: x, y: y, w: width, h: height, visible: true, locked: false }, props || {}));
    }
    function add(type, name, x, y, width, height, props) {
      addTo(w, type, name, x, y, width, height, props);
    }
    function addSetting(type, name, x, y, width, height, props) {
      addTo(settings, type, name, x, y, width, height, props);
    }

    add('panel', 'header', 0, 0, 1024, 64, { bg: '#0C1A2B', radius: 0, borderWidth: 0, borderColor: '#0C1A2B' });
    add('panel', 'accent', 24, 16, 6, 32, { bg: '#22D3EE', radius: 3, borderWidth: 0, borderColor: '#22D3EE' });
    add('label', 'title', 44, 11, 520, 36, { text: 'Air8607 智能控制台', fontSize: 26, color: '#E6EEFC' });
    add('label', 'subtitle', 44, 42, 520, 18, { text: 'AIR8607 · 1024×600 · LuatOS AirUI', fontSize: 14, color: '#7F98B8' });
    add('button', 'settingsBtn', 660, 16, 144, 32, { text: '更多设置 →', fontSize: 14, bg: '#12324A', textColor: '#22D3EE', radius: 6, borderWidth: 1, borderColor: '#1E4A66', pressedBg: '#1B4A66', action: 'page', target: settingsId });
    add('panel', 'statusPill', 824, 16, 176, 32, { bg: '#12324A', radius: 16, borderWidth: 1, borderColor: '#1E4A66' });
    add('label', 'status', 824, 16, 176, 32, { text: '● 设备在线', fontSize: 15, color: '#22D3EE', align: 'center' });

    add('panel', 'envPanel', 24, 88, 300, 220, { bg: '#0F1E31', radius: 12, borderWidth: 1, borderColor: '#203550' });
    add('panel', 'envAccent', 40, 104, 4, 18, { bg: '#22D3EE', radius: 2, borderWidth: 0, borderColor: '#22D3EE' });
    add('label', 'envTitle', 52, 99, 220, 24, { text: '环境监测', fontSize: 18, color: '#E6EEFC' });
    add('label', 'envTempLabel', 40, 138, 100, 18, { text: '温度', fontSize: 14, color: '#7F98B8' });
    add('label', 'envTemp', 40, 156, 180, 46, { text: '24.6°C', fontSize: 34, color: '#22D3EE' });
    add('label', 'envHumLabel', 40, 208, 100, 18, { text: '湿度', fontSize: 14, color: '#7F98B8' });
    add('label', 'envHum', 40, 226, 100, 34, { text: '58%', fontSize: 26, color: '#22C55E' });
    add('label', 'envBarLabel', 40, 264, 160, 16, { text: '舒适度', fontSize: 13, color: '#7F98B8' });
    add('bar', 'envBar', 40, 284, 260, 10, { min: 0, max: 100, value: 72, track: '#1B2B40', indicator: '#22C55E', radius: 5 });

    add('panel', 'sysPanel', 344, 88, 336, 220, { bg: '#0F1E31', radius: 12, borderWidth: 1, borderColor: '#203550' });
    add('panel', 'sysAccent', 360, 104, 4, 18, { bg: '#A78BFA', radius: 2, borderWidth: 0, borderColor: '#A78BFA' });
    add('label', 'sysTitle', 372, 99, 220, 24, { text: '系统负载', fontSize: 18, color: '#E6EEFC' });
    add('label', 'sysValue', 360, 134, 220, 56, { text: '42%', fontSize: 44, color: '#A78BFA' });
    add('label', 'sysHint', 360, 188, 240, 18, { text: 'CPU / 内存 / 存储', fontSize: 13, color: '#7F98B8' });
    add('label', 'cpuLabel', 360, 218, 58, 16, { text: 'CPU', fontSize: 13, color: '#7F98B8' });
    add('bar', 'cpuBar', 426, 221, 226, 10, { min: 0, max: 100, value: 42, track: '#1B2B40', indicator: '#A78BFA', radius: 5 });
    add('label', 'memLabel', 360, 242, 58, 16, { text: 'MEM', fontSize: 13, color: '#7F98B8' });
    add('bar', 'memBar', 426, 245, 226, 10, { min: 0, max: 100, value: 66, track: '#1B2B40', indicator: '#22D3EE', radius: 5 });
    add('label', 'diskLabel', 360, 266, 58, 16, { text: 'DISK', fontSize: 13, color: '#7F98B8' });
    add('bar', 'diskBar', 426, 269, 226, 10, { min: 0, max: 100, value: 38, track: '#1B2B40', indicator: '#22C55E', radius: 5 });

    add('panel', 'infoPanel', 704, 88, 296, 220, { bg: '#0F1E31', radius: 12, borderWidth: 1, borderColor: '#203550' });
    add('panel', 'infoAccent', 720, 104, 4, 18, { bg: '#22D3EE', radius: 2, borderWidth: 0, borderColor: '#22D3EE' });
    add('label', 'infoTitle', 732, 99, 220, 24, { text: '设备信息', fontSize: 18, color: '#E6EEFC' });
    add('qrcode', 'infoQr', 720, 132, 112, 112, { data: 'https://docs.openluat.com/air8607/', dark: '#0B1524', light: '#FFFFFF', quietZone: true });
    add('label', 'infoName', 848, 132, 136, 20, { text: 'Air8607', fontSize: 16, color: '#E6EEFC' });
    add('label', 'infoBoard', 848, 156, 136, 18, { text: 'Air1603 / 9-inch', fontSize: 13, color: '#7F98B8' });
    add('label', 'infoIp', 848, 180, 136, 18, { text: 'IP 192.168.1.20', fontSize: 13, color: '#7F98B8' });
    add('label', 'infoFw', 848, 204, 136, 18, { text: 'FW V1028', fontSize: 13, color: '#7F98B8' });
    add('button', 'infoBtn', 848, 234, 120, 32, { text: '打开文档', fontSize: 14, bg: '#12324A', textColor: '#22D3EE', radius: 6, borderWidth: 1, borderColor: '#1E4A66', pressedBg: '#1B4A66' });

    add('panel', 'ctrlPanel', 24, 328, 976, 248, { bg: '#0F1E31', radius: 12, borderWidth: 1, borderColor: '#203550' });
    add('panel', 'ctrlAccent', 40, 344, 4, 18, { bg: '#22C55E', radius: 2, borderWidth: 0, borderColor: '#22C55E' });
    add('label', 'ctrlTitle', 52, 339, 220, 24, { text: '快捷控制', fontSize: 18, color: '#E6EEFC' });
    add('button', 'lightBtn', 40, 380, 120, 44, { text: '照明', fontSize: 17, bg: '#0E3A4A', textColor: '#22D3EE', radius: 8, borderWidth: 1, borderColor: '#1E5A70', pressedBg: '#155A70' });
    add('button', 'fanBtn', 176, 380, 120, 44, { text: '通风', fontSize: 17, bg: '#103A2C', textColor: '#22C55E', radius: 8, borderWidth: 1, borderColor: '#1E5A40', pressedBg: '#176040' });
    add('button', 'waterBtn', 312, 380, 120, 44, { text: '灌溉', fontSize: 17, bg: '#3A2C10', textColor: '#F59E0B', radius: 8, borderWidth: 1, borderColor: '#5A4218', pressedBg: '#6A4E1C' });

    add('label', 'brightLabel', 40, 444, 120, 18, { text: '屏幕亮度', fontSize: 14, color: '#7F98B8' });
    add('slider', 'brightSlider', 40, 466, 300, 30, { min: 0, max: 100, value: 72, track: '#1B2B40', indicator: '#22D3EE', knob: '#FFFFFF', radius: 15 });
    add('label', 'volumeLabel', 380, 444, 120, 18, { text: '媒体音量', fontSize: 14, color: '#7F98B8' });
    add('slider', 'volumeSlider', 380, 466, 300, 30, { min: 0, max: 100, value: 45, track: '#1B2B40', indicator: '#A78BFA', knob: '#FFFFFF', radius: 15 });

    add('label', 'autoLabel', 720, 446, 100, 20, { text: '自动模式', fontSize: 15, color: '#E6EEFC' });
    add('switch', 'autoSwitch', 852, 442, 70, 30, { checked: true, accent: '#22C55E' });
    add('button', 'saveBtn', 816, 500, 150, 42, { text: '保存设置', fontSize: 16, bg: '#1E6BFF', textColor: '#FFFFFF', radius: 8, borderWidth: 0, borderColor: '#1E6BFF', pressedBg: '#3D8BFF' });

    add('divider', 'footerLine', 24, 576, 976, 1, { color: '#203550' });
    add('label', 'footer', 24, 582, 976, 16, { text: 'Air8607 UI Studio · 多页面示例 · 点击「更多设置」跳转', fontSize: 12, color: '#5F7896', align: 'left' });

    // 第二页：演示按钮跳转、返回上一页，以及每个页面独立的控件树。
    addSetting('panel', 'header', 0, 0, 1024, 64, { bg: '#0C1A2B', radius: 0, borderWidth: 0, borderColor: '#0C1A2B' });
    addSetting('panel', 'accent', 24, 16, 6, 32, { bg: '#A78BFA', radius: 3, borderWidth: 0, borderColor: '#A78BFA' });
    addSetting('label', 'title', 44, 11, 520, 36, { text: '系统设置', fontSize: 26, color: '#E6EEFC' });
    addSetting('label', 'subtitle', 44, 42, 520, 18, { text: '第二页 · 按钮跳转 / 返回上一页', fontSize: 14, color: '#7F98B8' });
    addSetting('button', 'backBtn', 824, 16, 176, 32, { text: '← 返回控制台', fontSize: 14, bg: '#12324A', textColor: '#22D3EE', radius: 6, borderWidth: 1, borderColor: '#1E4A66', pressedBg: '#1B4A66', action: 'back', target: '' });

    addSetting('panel', 'settingsPanel', 24, 88, 976, 460, { bg: '#0F1E31', radius: 12, borderWidth: 1, borderColor: '#203550' });
    addSetting('label', 'sectionTitle', 48, 112, 600, 28, { text: '界面与设备', fontSize: 22, color: '#E6EEFC' });
    addSetting('label', 'hint', 48, 148, 920, 20, { text: '同一份设计稿可以包含任意多个页面；按钮可跳转到指定页，也可以返回上一页。', fontSize: 14, color: '#7F98B8' });

    addSetting('label', 'autoStartLabel', 48, 196, 400, 22, { text: '开机自动进入控制台', fontSize: 16, color: '#E6EEFC' });
    addSetting('switch', 'autoStartSwitch', 832, 192, 70, 30, { checked: true, accent: '#22C55E' });
    addSetting('divider', 'line1', 48, 240, 928, 1, { color: '#203550' });

    addSetting('label', 'brightLabel', 48, 264, 300, 22, { text: '背光亮度', fontSize: 16, color: '#E6EEFC' });
    addSetting('slider', 'brightSlider', 48, 294, 520, 30, { min: 0, max: 100, value: 70, track: '#1B2B40', indicator: '#A78BFA', knob: '#FFFFFF', radius: 15 });
    addSetting('label', 'brightValue', 584, 298, 120, 24, { text: '70%', fontSize: 16, color: '#A78BFA' });
    addSetting('divider', 'line2', 48, 348, 928, 1, { color: '#203550' });

    addSetting('label', 'aboutTitle', 48, 372, 500, 24, { text: '关于 UI Studio', fontSize: 18, color: '#E6EEFC' });
    addSetting('label', 'about1', 48, 404, 900, 20, { text: '画布 1024×600 · AirUI · LuatOS', fontSize: 14, color: '#7F98B8' });
    addSetting('label', 'about2', 48, 430, 900, 20, { text: '导出 ZIP 后，ui_page.lua 会自动生成页面路由和按钮跳转代码。', fontSize: 14, color: '#7F98B8' });
    addSetting('button', 'homeBtn', 824, 480, 150, 42, { text: '返回控制台', fontSize: 16, bg: '#1E6BFF', textColor: '#FFFFFF', radius: 8, borderWidth: 0, borderColor: '#1E6BFF', pressedBg: '#3D8BFF', action: 'back', target: '' });

    addSetting('divider', 'footerLine', 24, 576, 976, 1, { color: '#203550' });
    addSetting('label', 'footer', 24, 582, 976, 16, { text: 'Air8607 UI Studio · 页面 2 / 2 · 返回上一页', fontSize: 12, color: '#5F7896', align: 'left' });

    return normalizeState({
      version: 2,
      project: 'air8607_dashboard',
      screen: { preset: '9', width: 1024, height: 600, bg: '#07111F', grid: 8 },
      pages: [
        { id: homeId, name: '控制台', widgets: w },
        { id: settingsId, name: '设置', widgets: settings }
      ],
      startPage: homeId,
      activePage: homeId,
      assets: {}
    });
  }

  function hexToLua(hex, fallback) {
    var h = String(hex || fallback || '#000000').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = String(fallback || '#000000').replace(/^#/, '');
    return '0x' + h.toUpperCase();
  }

  function luaStr(s) {
    return '"' + String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t') + '"';
  }

  function commentSafe(v) {
    return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/\]\]/g, '] ]');
  }

  var LUA_KEYWORDS = {
    'and': true, 'break': true, 'do': true, 'else': true, 'elseif': true,
    'end': true, 'false': true, 'for': true, 'function': true, 'goto': true,
    'if': true, 'in': true, 'local': true, 'nil': true, 'not': true,
    'or': true, 'repeat': true, 'return': true, 'then': true, 'true': true,
    'until': true, 'while': true
  };

  function luaIdent(name, fallback) {
    var s = String(name || '').trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
    if (!s) s = fallback || 'widget';
    if (!/^[A-Za-z_]/.test(s)) s = 'w_' + s;
    if (LUA_KEYWORDS[s]) s = 'x_' + s;
    if (s.length > 40) s = s.slice(0, 40);
    return s;
  }

  function uniqueNames(widgets) {
    var used = {};
    return widgets.map(function (w, i) {
      var base = luaIdent(w.name, 'widget_' + (i + 1));
      var name = base;
      var n = 2;
      while (used[name]) name = base + '_' + (n++);
      used[name] = true;
      return name;
    });
  }

  function alignLua(a) {
    if (a === 'center') return 'airui.TEXT_ALIGN_CENTER';
    if (a === 'right') return 'airui.TEXT_ALIGN_RIGHT';
    return 'airui.TEXT_ALIGN_LEFT';
  }

  function luaTable(indent, pairs) {
    var pad = new Array(indent + 1).join('  ');
    var inner = new Array(indent + 2).join('  ');
    var lines = pairs.map(function (p) { return inner + p; });
    return '{\n' + lines.join('\n') + '\n' + pad + '}';
  }

  function widgetLua(w, luaName, ctx) {
    var lines = [];
    var head = 'M.pages.' + ctx.pageKey + '.widgets.' + luaName + ' = ';
    var x = int(w.x), y = int(w.y), ww = int(w.w), hh = int(w.h);

    if (w.type === 'panel') {
      lines.push(head + 'airui.container({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + hh + ',');
      lines.push('    color = ' + hexToLua(w.bg, '#162235') + ', color_opacity = ' + int(w.opacity, 255) + ',');
      lines.push('    radius = ' + int(w.radius, 0) + ', border_color = ' + hexToLua(w.borderColor, '#2A3A52') + ', border_width = ' + int(w.borderWidth, 0) + ',');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'divider') {
      lines.push(head + 'airui.container({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + Math.max(1, hh) + ',');
      lines.push('    color = ' + hexToLua(w.color, '#2A3A52') + ', color_opacity = 255, radius = 0, border_width = 0,');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'label') {
      lines.push(head + 'airui.label({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + hh + ',');
      lines.push('    text = ' + luaStr(w.text) + ', font_size = ' + int(w.fontSize, 20) + ',');
      lines.push('    color = ' + hexToLua(w.color, '#E6EEFC') + ', align = ' + alignLua(w.align) + ',');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'button') {
      lines.push(head + 'airui.button({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + hh + ',');
      lines.push('    text = ' + luaStr(w.text) + ', font_size = ' + int(w.fontSize, 18) + ',');
      lines.push('    style = {');
      lines.push('        bg_color = ' + hexToLua(w.bg, '#1E6BFF') + ', bg_opa = 255,');
      lines.push('        text_color = ' + hexToLua(w.textColor, '#FFFFFF') + ',');
      lines.push('        radius = ' + int(w.radius, 8) + ',');
      lines.push('        border_width = ' + int(w.borderWidth, 0) + ', border_color = ' + hexToLua(w.borderColor, '#1E6BFF') + ',');
      lines.push('        pressed_bg_color = ' + hexToLua(w.pressedBg, '#3D8BFF') + ',');
      lines.push('    },');
      lines.push('    on_click = function()');
      lines.push('        log.info("ui_page", ' + luaStr(ctx.pageKey) + ', "click", ' + luaStr(w.name) + ')');
      if (w.action === 'page' && ctx.targetKeys[w.target]) {
        lines.push('        -- 跳转到页面：' + commentSafe(ctx.targetNames[w.target]));
        lines.push('        M.go(' + luaStr(ctx.targetKeys[w.target]) + ')');
      } else if (w.action === 'back') {
        lines.push('        -- 返回上一页');
        lines.push('        M.back()');
      } else {
        lines.push('        -- TODO: 在这里写按钮逻辑' + (w.action === 'page' ? '（目标页面未设置）' : ''));
      }
      lines.push('    end,');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'image') {
      var src = w.src || (w.asset ? '/luadb/' + w.asset : '/luadb/logo.png');
      lines.push(head + 'airui.image({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + hh + ',');
      lines.push('    src = ' + luaStr(src) + ', fit = ' + luaStr(w.fit || 'contain') + ', opacity = ' + int(w.opacity, 255) + ',');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'bar') {
      lines.push(head + 'airui.bar({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + hh + ',');
      lines.push('    min = ' + num(w.min, 0) + ', max = ' + num(w.max, 100) + ', value = ' + num(w.value, 0) + ',');
      lines.push('    bg_color = ' + hexToLua(w.track, '#26364D') + ', indicator_color = ' + hexToLua(w.indicator, '#22D3EE') + ', radius = ' + int(w.radius, 6) + ',');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'slider') {
      lines.push(head + 'airui.slider({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + hh + ',');
      lines.push('    min = ' + num(w.min, 0) + ', max = ' + num(w.max, 100) + ', value = ' + num(w.value, 0) + ',');
      lines.push('    style = {');
      lines.push('        bg_color = ' + hexToLua(w.track, '#26364D') + ', bg_opa = 255,');
      lines.push('        border_color = ' + hexToLua(w.track, '#26364D') + ', border_width = 0,');
      lines.push('        indicator_color = ' + hexToLua(w.indicator, '#22D3EE') + ', indicator_opa = 255,');
      lines.push('        knob_color = ' + hexToLua(w.knob, '#FFFFFF') + ', knob_opa = 255,');
      lines.push('        knob_border_color = ' + hexToLua(w.knob, '#FFFFFF') + ', knob_border_width = 0,');
      lines.push('        radius = ' + int(w.radius, Math.floor(hh / 2)) + ', pad = 3,');
      lines.push('    },');
      lines.push('    on_change = function(self)');
      lines.push('        -- TODO: 在这里处理滑块变化');
      lines.push('        log.info("ui_page", ' + luaStr(ctx.pageKey) + ', "slider", ' + luaStr(w.name) + ', self:get_value())');
      lines.push('    end,');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'switch') {
      lines.push(head + 'toggle(root, {');
      lines.push('    x = ' + x + ', y = ' + y + ', w = ' + ww + ', h = ' + hh + ',');
      lines.push('    checked = ' + (w.checked ? 'true' : 'false') + ', accent = ' + hexToLua(w.accent, '#22C55E') + ',');
      lines.push('    on_change = function(state)');
      lines.push('        -- TODO: 在这里处理开关变化');
      lines.push('        log.info("ui_page", ' + luaStr(ctx.pageKey) + ', "switch", ' + luaStr(w.name) + ', state)');
      lines.push('    end,');
      lines.push('})');
      return lines.join('\n');
    }

    if (w.type === 'qrcode') {
      var size = Math.max(32, Math.min(ww, hh));
      lines.push(head + 'airui.qrcode({');
      lines.push('    parent = root, x = ' + x + ', y = ' + y + ', size = ' + size + ',');
      lines.push('    data = ' + luaStr(w.data) + ',');
      lines.push('    dark_color = ' + hexToLua(w.dark, '#0B1524') + ', light_color = ' + hexToLua(w.light, '#FFFFFF') + ',');
      lines.push('    quiet_zone = ' + (w.quietZone ? 'true' : 'false') + ',');
      lines.push('})');
      return lines.join('\n');
    }

    return '-- unsupported widget: ' + w.type;
  }

  function generateUILua(input) {
    var s = normalizeState(input);
    var preset = s.screen.preset === '10' ? '10-inch' : '9-inch';
    var usedKeys = {};
    var keys = {};
    var metas = [];
    var hasSwitch = false;

    s.pages.forEach(function (page, i) {
      var base = luaIdent(page.name, 'page_' + (i + 1));
      var key = base;
      var n = 2;
      while (usedKeys[key]) key = base + '_' + (n++);
      usedKeys[key] = true;
      keys[page.id] = key;

      var visible = page.widgets.filter(function (w) { return w.visible !== false; });
      if (visible.some(function (w) { return w.type === 'switch'; })) hasSwitch = true;
      metas.push({ page: page, key: key, visible: visible, names: uniqueNames(visible) });
    });

    var targetKeys = {};
    var targetNames = {};
    s.pages.forEach(function (page) {
      targetKeys[page.id] = keys[page.id];
      targetNames[page.id] = page.name;
    });
    var startKey = keys[s.startPage] || metas[0].key;
    var out = [];

    out.push('--[[');
    out.push('@module  ui_page');
    out.push('@summary ' + commentSafe(s.project) + ' - AirUI multi-page UI generated by Air8607 UI Studio');
    out.push('@screen  ' + SCREEN_W + 'x' + SCREEN_H + ' ' + preset);
    out.push('@note    控件坐标均为 1024x600 画布绝对坐标；每个页面独立构建，切页用 set_hidden，不销毁对象。');
    out.push('@note    页面路由：M.go("page_key") 跳转，M.back() 返回上一页，M.show("page_key") 直接切换。');
    out.push(']]');
    out.push('local M = {}');
    out.push('M.widgets = {}       -- 当前页控件，M.build 后指向启动页');
    out.push('M.pages = {}         -- 页面元数据 + 各页控件表');
    out.push('M.current = nil      -- 当前页面 key');
    out.push('M.root = nil         -- 当前页面 root 容器');
    out.push('M.parent = nil');
    out.push('M.startPage = ' + luaStr(startKey));
    out.push('M.pageOrder = {');
    metas.forEach(function (m, i) {
      out.push('    ' + luaStr(m.key) + (i < metas.length - 1 ? ',' : ''));
    });
    out.push('}');
    out.push('');

    if (hasSwitch) {
      out.push('--[[轻量开关：用两个 container 画轨道和滑块，颜色可控，');
      out.push('回调 on_change(state) 返回 boolean。]]');
      out.push('local function toggle(parent, o)');
      out.push('    local w, h = o.w or 70, o.h or 30');
      out.push('    local pad = math.max(2, math.floor(h * 0.14))');
      out.push('    local kd = h - pad * 2');
      out.push('    local state = o.checked and true or false');
      out.push('    local track, knob');
      out.push('    local function apply()');
      out.push('        local c = state and (o.accent or 0x22C55E) or 0x26364D');
      out.push('        track:set_color(c, 255)');
      out.push('        track:set_border_color(c, 1)');
      out.push('        knob:set_pos(state and (w - pad - kd) or pad, pad)');
      out.push('    end');
      out.push('    local function do_toggle()');
      out.push('        state = not state');
      out.push('        apply()');
      out.push('        if o.on_change then o.on_change(state) end');
      out.push('    end');
      out.push('    track = airui.container({');
      out.push('        parent = parent, x = o.x or 0, y = o.y or 0, w = w, h = h,');
      out.push('        color = 0x26364D, color_opacity = 255, radius = math.floor(h / 2),');
      out.push('        border_color = 0x26364D, border_width = 1, on_click = do_toggle,');
      out.push('    })');
      out.push('    knob = airui.container({');
      out.push('        parent = track, x = pad, y = pad, w = kd, h = kd,');
      out.push('        color = 0xFFFFFF, color_opacity = 255, radius = math.floor(kd / 2), on_click = do_toggle,');
      out.push('    })');
      out.push('    local handle = { track = track, knob = knob }');
      out.push('    function handle:get_state() return state end');
      out.push('    function handle:set_state(v) state = v and true or false; apply() end');
      out.push('    apply()');
      out.push('    return handle');
      out.push('end');
      out.push('');
    }

    metas.forEach(function (m) {
      out.push('-- 页面：' + commentSafe(m.page.name));
      out.push('M.pages.' + m.key + ' = {');
      out.push('    key = ' + luaStr(m.key) + ',');
      out.push('    name = ' + luaStr(m.page.name) + ',');
      out.push('    widgets = {},');
      out.push('}');
      out.push('');
    });

    metas.forEach(function (m) {
      out.push('--[[构建页面：' + commentSafe(m.page.name) + ']]');
      out.push('local function build_' + m.key + '(root)');
      m.visible.forEach(function (w, i) {
        out.push('    -- ' + commentSafe(w.name || w.type) + ' (' + w.type + ')');
        var ctx = { pageKey: m.key, targetKeys: targetKeys, targetNames: targetNames };
        var block = widgetLua(w, m.names[i], ctx);
        block.split('\n').forEach(function (line) { out.push('    ' + line); });
        out.push('');
      });
      out.push('end');
      out.push('M.pages.' + m.key + '.build = build_' + m.key);
      out.push('');
    });

    out.push('local roots = {}       -- page key -> 已构建的全屏 root');
    out.push('local history = {}     -- 返回栈');
    out.push('local current = nil    -- 当前 page key');
    out.push('');
    out.push('local function ensure_page(page)');
    out.push('    local root = roots[page.key]');
    out.push('    if root then return root end');
    out.push('    root = airui.container({');
    out.push('        parent = M.parent, x = 0, y = 0, w = ' + SCREEN_W + ', h = ' + SCREEN_H + ',');
    out.push('        color = ' + hexToLua(s.screen.bg, '#0B1524') + ', color_opacity = 255, radius = 0, border_width = 0,');
    out.push('    })');
    out.push('    roots[page.key] = root');
    out.push('    page.build(root)');
    out.push('    root:set_hidden(true)');
    out.push('    log.info("ui_page", "page built:", page.key, page.name)');
    out.push('    return root');
    out.push('end');
    out.push('');
    out.push('--[[跳转到指定页面');
    out.push('@param string key 页面 key（见 M.pageOrder）');
    out.push('@param table|nil opts { replace = true } 时压栈行为关闭');
    out.push('@return boolean 是否切换成功');
    out.push(']]');
    out.push('function M.go(key, opts)');
    out.push('    local page = M.pages[key]');
    out.push('    if not page then');
    out.push('        log.warn("ui_page", "page not found:", key)');
    out.push('        return false');
    out.push('    end');
    out.push('    if current == key and roots[key] then return true end');
    out.push('    local root = ensure_page(page)');
    out.push('    if current and roots[current] then roots[current]:set_hidden(true) end');
    out.push('    root:set_hidden(false)');
    out.push('    if current and current ~= key and not (opts and opts.replace) then');
    out.push('        history[#history + 1] = current');
    out.push('        if #history > 32 then table.remove(history, 1) end');
    out.push('    end');
    out.push('    current = key');
    out.push('    M.current = key');
    out.push('    M.root = root');
    out.push('    M.widgets = page.widgets');
    out.push('    log.info("ui_page", "page:", key, page.name)');
    out.push('    return true');
    out.push('end');
    out.push('');
    out.push('--[[返回上一页（按钮动作选「返回上一页」时调用）]]');
    out.push('function M.back()');
    out.push('    local key = table.remove(history)');
    out.push('    if not key then');
    out.push('        log.warn("ui_page", "no page history")');
    out.push('        return false');
    out.push('    end');
    out.push('    return M.go(key, { replace = true })');
    out.push('end');
    out.push('');
    out.push('--[[直接切换页面，不压入返回栈]]');
    out.push('function M.show(key)');
    out.push('    return M.go(key, { replace = true })');
    out.push('end');
    out.push('');
    out.push('--[[构建并进入启动页；在 airui.init + font_load 之后调用');
    out.push('@param table|nil parent 父容器，nil 表示屏幕根节点');
    out.push('@return table|nil root 启动页 root');
    out.push(']]');
    out.push('function M.build(parent)');
    out.push('    M.parent = parent');
    out.push('    M.go(M.startPage)');
    out.push('    return M.root');
    out.push('end');
    out.push('');
    out.push('return M');
    out.push('');
    return out.join('\n');
  }

  function projectSlug(name) {
    var s = String(name || 'air8607_ui').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = 'air8607_ui';
    if (!/^[A-Za-z_]/.test(s)) s = 'ui_' + s;
    return s.slice(0, 40);
  }

  function generateMainLua(input) {
    var s = normalizeState(input);
    var project = projectSlug(s.project);
    var size = s.screen.preset === '10' ? 10 : 9;
    var out = [];
    out.push('--[[');
    out.push('@module  main');
    out.push('@summary ' + commentSafe(s.project) + ' - AirUI page for Air8607');
    out.push('@board   Air8607 + ' + size + '寸 RGB 1024x600 + GT911');
    out.push('@note    由 Air8607 UI Studio 生成；显示/触摸/背光引脚与官方 factory 工程一致。');
    out.push(']]');
    out.push('PROJECT = ' + luaStr(project));
    out.push('VERSION = "1.0.0"');
    out.push('');
    out.push('local exd = require "exd_air8607_rgb"');
    out.push('local ui = require "ui_page"');
    out.push('');
    out.push('local SCREEN_W, SCREEN_H = ' + SCREEN_W + ', ' + SCREEN_H);
    out.push('local SCREEN_SIZE = ' + size + '       -- 物理尺寸：9 或 10 英寸');
    out.push('local LCD_PIN_RST = 15');
    out.push('local TP_PIN_RST = 14');
    out.push('local TP_PIN_INT = 51');
    out.push('');
    out.push('local function power_on()');
    out.push('    pwm.setup(3, 1000, 0)       -- 背光 PWM3 先关，防开机花屏');
    out.push('    pwm.start(3)');
    out.push('    gpio.setup(17, 0)           -- LCD 供电使能');
    out.push('    gpio.setup(LCD_PIN_RST, 1)  -- LCD 复位/显示使能');
    out.push('    i2c.setup(1, i2c.FAST)      -- GT911 触摸 I2C1 400kHz');
    out.push('    sys.wait(100)');
    out.push('end');
    out.push('');
    out.push('local function backlight_on()');
    out.push('    if pwm.setup(3, 1000, 100) then');
    out.push('        pwm.start(3)');
    out.push('        log.info("main", "backlight on")');
    out.push('    else');
    out.push('        log.error("main", "backlight init failed")');
    out.push('    end');
    out.push('end');
    out.push('');
    out.push('local function touch_init()');
    out.push('    local dev = tp.init("gt911", {');
    out.push('        port = 1, pin_rst = TP_PIN_RST, pin_int = TP_PIN_INT,');
    out.push('        int_type = tp.FALLING, w = SCREEN_W, h = SCREEN_H,');
    out.push('    })');
    out.push('    if dev then');
    out.push('        airui.device_bind_touch(dev)');
    out.push('        log.info("main", "GT911 touch ready")');
    out.push('        return true');
    out.push('    end');
    out.push('    log.error("main", "GT911 touch init failed")');
    out.push('    return false');
    out.push('end');
    out.push('');
    out.push('sys.taskInit(function()');
    out.push('    power_on()');
    out.push('');
    out.push('    local ok, info = exd.setup({ pin_rst = LCD_PIN_RST, screen_size = SCREEN_SIZE })');
    out.push('    if not ok then');
    out.push('        log.error("main", "display init failed", info)');
    out.push('        return');
    out.push('    end');
    out.push('    log.info("main", "display ready", info.backend, info.w, info.h)');
    out.push('');
    out.push('    airui.init(SCREEN_W, SCREEN_H)');
    out.push('    airui.set_rotation(0)');
    out.push('    airui.font_load({ type = "hzfont", size = 16, cache_size = 2048, antialias = 1 })');
    out.push('');
    out.push('    ui.build()');
    out.push('    touch_init()');
    out.push('    backlight_on()');
    out.push('    log.info("main", "AirUI page ready:", PROJECT)');
    out.push('end)');
    out.push('');
    out.push('sys.run()');
    out.push('');
    return out.join('\n');
  }

  function generateReadme(input) {
    var s = normalizeState(input);
    var size = s.screen.preset === '10' ? '10 英寸' : '9 英寸';
    var startPage = s.pages.filter(function (p) { return p.id === s.startPage; })[0] || s.pages[0];
    var pageLines = s.pages.map(function (p, i) {
      return (i + 1) + '. **' + p.name + '** · ' + p.widgets.length + ' 个控件' +
        (p.id === s.startPage ? ' · 启动页' : '');
    }).join('\n');
    return [
      '# ' + s.project,
      '',
      '由 **Air8607 UI Studio** 生成，可直接烧录到 Air8607（Air1603 / Air1101）开发板。',
      '',
      '- 屏幕：' + size + ' RGB 1024×600（免序列）',
      '- 触摸：GT911（I2C1，RST=GPIO14，INT=GPIO51）',
      '- 显示：LCD_RST=GPIO15，背光 PWM3（GPIO13），LCD 供电 GPIO17',
      '- UI：LuatOS AirUI，多页面（' + s.pages.length + ' 页）',
      '- 启动页：' + startPage.name,
      '',
      '## 页面',
      '',
      pageLines,
      '',
      '按钮动作在 UI Studio 里配置为「跳转页面」或「返回上一页」，生成的代码分别调用 `M.go("page_key")` / `M.back()`。',
      '所有访问过的页面会保留在内存中，用 `set_hidden` 切换，避免反复创建/销毁 LVGL 对象。',
      '',
      '## 文件',
      '',
      '| 文件 | 说明 |',
      '| --- | --- |',
      '| `main.lua` | 入口：显示、触摸、背光、AirUI 初始化 |',
      '| `ui_page.lua` | 多页面 UI、页面路由、按钮跳转；按钮/滑块/开关事件在 TODO 处修改 |',
      '| `exd_air8607_rgb.lua` | Air8607 RGB 屏初始化扩展库 |',
      '| `flash.sh` | Mac/Linux 烧录脚本 |',
      '| `design.json` | 设计稿，可重新导入 UI Studio 修改 |',
      '',
      '## 烧录',
      '',
      '需要先安装合宙 `luatos-cli`，并准备 `LuatOS-SoC_V1028_Air1603_102.soc`。',
      '把 `.soc` 放到本目录，或者用 `SOC=/path/to/LuatOS-SoC_V1028_Air1603_102.soc` 指定；烧录脚本会自动跳过 `.soc`，不会把它打进 LuaDB。',
      '',
      '```bash',
      'chmod +x flash.sh   # 从 ZIP 解压后如果脚本没有执行权限',
      '',
      '# 首次：全量刷内核 + 本项目（会自动平铺文件，适配 LuaDB 文件名限制）',
      './flash.sh /dev/cu.usbmodemXXXX full',
      '',
      '# 以后只改 UI：只刷脚本区',
      './flash.sh /dev/cu.usbmodemXXXX script',
      '```',
      '',
      '也可以使用 Air8607 仓库根目录的 `flash_project.sh`。',
      '',
      '## 修改事件',
      '',
      '打开 `ui_page.lua`，搜索 `TODO`：',
      '',
      '- 按钮：`on_click = function() ... end`，跳页代码由生成器写入 `M.go("page_key")`',
      '- 滑块：`on_change = function(self) local v = self:get_value() ... end`',
      '- 开关：`on_change = function(state) ... end`',
      '',
      '页面路由 API：',
      '',
      '- `M.go("page_key")`：跳转并把当前页压入返回栈',
      '- `M.back()`：返回上一页',
      '- `M.show("page_key")`：直接切换，不压返回栈',
      '- `M.pageOrder` / `M.pages`：页面 key 和元数据',
      '',
      '## 注意',
      '',
      '- 生成的控件坐标基于 1024×600 画布。',
      '- 图片控件默认引用 `/luadb/<文件名>`；上传的图片会放在 `res/`，烧录脚本会平铺到 `/luadb/`。',
      '- Air8607 无 WiFi/4G，网络相关功能需要 Air8603 或外接模块。',
      ''
    ].join('\n');
  }

  function generateFlashScript(input) {
    var s = normalizeState(input);
    return [
      '#!/usr/bin/env bash',
      '# ' + s.project + ' - Air8607 烧录脚本',
      '# 依赖：luatos-cli；同目录或指定路径下要有 LuatOS-SoC_V1028_Air1603_102.soc',
      'set -euo pipefail',
      '',
      'ROOT="$(cd "$(dirname "$0")" && pwd)"',
      'CLI="${LUATOS_CLI:-luatos-cli}"',
      'SOC="${SOC:-$ROOT/LuatOS-SoC_V1028_Air1603_102.soc}"',
      'PORT="${1:-}"',
      'MODE="${2:-script}"',
      '',
      'if ! command -v "$CLI" >/dev/null 2>&1; then',
      '  echo "找不到 luatos-cli，请先安装或设置 LUATOS_CLI" >&2',
      '  exit 1',
      'fi',
      'if [[ ! -f "$SOC" ]]; then',
      '  echo "缺少固件: $SOC" >&2',
      '  echo "下载: https://docs.openluat.com/air8607/software/debug/" >&2',
      '  exit 1',
      'fi',
      'if [[ -z "$PORT" ]]; then',
      '  PORT="$(ls /dev/cu.usbmodem* /dev/cu.wchusbserial* /dev/cu.usbserial* 2>/dev/null | head -n1 || true)"',
      'fi',
      'if [[ -z "$PORT" ]]; then',
      '  echo "用法: ./flash.sh <串口> [script|full]" >&2',
      '  echo "可用串口:" >&2',
      '  "$CLI" serial list >&2 || true',
      '  exit 1',
      'fi',
      '',
      'FLAT="$(mktemp -d "${TMPDIR:-/tmp}/air8607-ui.XXXXXX")"',
      'trap \'rm -rf "$FLAT"\' EXIT',
      'dupes="$(cd "$ROOT" && find . -type f ! -name ".DS_Store" ! -name "*.soc" -exec basename {} \\; | sort | uniq -d)"',
      'if [[ -n "$dupes" ]]; then',
      '  echo "文件名冲突，无法平铺:" >&2',
      '  echo "$dupes" >&2',
      '  exit 1',
      'fi',
      'find "$ROOT" -type f ! -name ".DS_Store" ! -name "flash.sh" ! -name "*.soc" -exec cp {} "$FLAT/" \\;',
      '',
      'if [[ "$MODE" == "full" ]]; then',
      '  "$CLI" flash run --soc "$SOC" --port "$PORT" --script "$FLAT" --tail-log-secs 20',
      'else',
      '  "$CLI" flash script --soc "$SOC" --port "$PORT" --script "$FLAT"',
      'fi',
      ''
    ].join('\n');
  }

  function dataUrlToBytes(dataUrl) {
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl || ''));
    if (!m) return new Uint8Array(0);
    var body = m[3];
    if (m[2]) {
      if (typeof atob === 'function') {
        var bin = atob(body);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
      }
      return new Uint8Array(Buffer.from(body, 'base64'));
    }
    var text = decodeURIComponent(body);
    return utf8Bytes(text);
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  function generateProject(input) {
    var s = normalizeState(input);
    var files = {};
    files['main.lua'] = generateMainLua(s);
    files['ui_page.lua'] = generateUILua(s);
    files['exd_air8607_rgb.lua'] = EXD_LUA;
    files['README.md'] = generateReadme(s);
    files['flash.sh'] = { text: generateFlashScript(s), mode: 0o755 };
    files['design.json'] = JSON.stringify(s, null, 2);

    Object.keys(s.assets || {}).forEach(function (name) {
      var data = s.assets[name];
      if (!data) return;
      files['res/' + name] = { bytes: dataUrlToBytes(data) };
    });

    return {
      files: files,
      zipName: projectSlug(s.project) + '-air8607.zip',
      state: s
    };
  }

  // ---------------- minimal ZIP (store) ----------------
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function putU16(a, o, v) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; }
  function putU32(a, o, v) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; a[o + 2] = (v >>> 16) & 255; a[o + 3] = (v >>> 24) & 255; }

  function zipStore(files) {
    var entries = [];
    var now = new Date();
    var dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((Math.floor(now.getSeconds() / 2)) & 31);
    var dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

    Object.keys(files).forEach(function (name) {
      var f = files[name];
      var bytes, mode = 0;
      if (typeof f === 'string') bytes = utf8Bytes(f);
      else if (f && f.bytes) bytes = f.bytes;
      else if (f && typeof f.text === 'string') { bytes = utf8Bytes(f.text); mode = f.mode || 0; }
      else if (f && typeof f.data === 'string') { bytes = utf8Bytes(f.data); mode = f.mode || 0; }
      else bytes = utf8Bytes(String(f == null ? '' : f));
      entries.push({ name: name, bytes: bytes, mode: mode });
    });

    var chunks = [];
    var central = [];
    var offset = 0;
    var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

    entries.forEach(function (e) {
      var nameBytes = encoder ? encoder.encode(e.name) : new Uint8Array(Buffer.from(e.name, 'utf8'));
      var crc = crc32(e.bytes);
      var local = new Uint8Array(30 + nameBytes.length);
      putU32(local, 0, 0x04034b50);
      putU16(local, 4, 20);
      putU16(local, 6, 0x0800);
      putU16(local, 8, 0);
      putU16(local, 10, dosTime);
      putU16(local, 12, dosDate);
      putU32(local, 14, crc);
      putU32(local, 18, e.bytes.length);
      putU32(local, 22, e.bytes.length);
      putU16(local, 26, nameBytes.length);
      putU16(local, 28, 0);
      local.set(nameBytes, 30);
      chunks.push(local, e.bytes);

      var cd = new Uint8Array(46 + nameBytes.length);
      putU32(cd, 0, 0x02014b50);
      putU16(cd, 4, 20);
      putU16(cd, 6, 20);
      putU16(cd, 8, 0x0800);
      putU16(cd, 10, 0);
      putU16(cd, 12, dosTime);
      putU16(cd, 14, dosDate);
      putU32(cd, 16, crc);
      putU32(cd, 20, e.bytes.length);
      putU32(cd, 24, e.bytes.length);
      putU16(cd, 28, nameBytes.length);
      putU16(cd, 30, 0);
      putU16(cd, 32, 0);
      putU16(cd, 34, 0);
      putU16(cd, 36, 0);
      putU32(cd, 38, e.mode ? ((e.mode & 0xFFFF) << 16) : 0);
      putU32(cd, 42, offset);
      cd.set(nameBytes, 46);
      central.push(cd);
      offset += local.length + e.bytes.length;
    });

    var cdStart = offset;
    var cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array(22);
    putU32(end, 0, 0x06054b50);
    putU16(end, 4, 0);
    putU16(end, 6, 0);
    putU16(end, 8, entries.length);
    putU16(end, 10, entries.length);
    putU32(end, 12, cdSize);
    putU32(end, 16, cdStart);
    putU16(end, 20, 0);

    var total = cdStart + cdSize + end.length;
    var out = new Uint8Array(total);
    var pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    central.forEach(function (c) { out.set(c, pos); pos += c.length; });
    out.set(end, pos);
    return out;
  }

  var api = {
    SCREEN_W: SCREEN_W,
    SCREEN_H: SCREEN_H,
    DEFAULTS: DEFAULTS,
    TYPE_LABELS: TYPE_LABELS,
    uid: uid,
    normalizeState: normalizeState,
    sampleProject: sampleProject,
    generateUILua: generateUILua,
    generateMainLua: generateMainLua,
    generateReadme: generateReadme,
    generateFlashScript: generateFlashScript,
    generateProject: generateProject,
    zipStore: zipStore,
    dataUrlToBytes: dataUrlToBytes,
    hexToLua: hexToLua,
    luaStr: luaStr
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Air8607Generator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
