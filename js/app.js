/**
 * 三角洲帧率优化助手 —— 页面交互逻辑（演示版）
 * 依赖：js/hwdb.js（先加载）
 * 说明：所有检测数据仅在浏览器本地使用，不上传服务器。
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var DB = window.DFOPT;
  function $(id) { return document.getElementById(id); }

  /* ============ 状态 ============ */
  var state = {
    gpuIdx: -1,
    cpuIdx: -1,
    ramGb: 16,
    disk: 'nvme',
    res: '1080p',
    laptop: false,
    detected: false
  };
  var DATA_SEED = 12847; // 演示数据基数
  var fsCount = getCount();

  function getCount() {
    return DATA_SEED + parseInt(localStorage.getItem('dfopt_fps_count') || '0', 10);
  }

  /* ============ 工具 ============ */
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }
  function openModal(title, html) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modalMask').hidden = false;
  }
  function closeModal() { $('modalMask').hidden = true; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ============ 下拉框填充 ============ */
  var GPU_GROUPS = ['NVIDIA', 'AMD', 'Intel Arc', '核显'];
  var CPU_BRANDS = ['Intel', 'AMD'];

  function fillSelects() {
    var g = $('selGpu'), c = $('selCpu'), r = $('selRam');
    var gGroups = [[], [], [], []];
    DB.GPUS.forEach(function (gpu, i) { gGroups[gpu[2]].push(gpu); });
    g.innerHTML = '';
    gGroups.forEach(function (list, gi) {
      if (!list.length) return;
      var og = document.createElement('optgroup');
      og.label = GPU_GROUPS[gi];
      list.forEach(function (gpu) {
        var o = document.createElement('option');
        o.value = DB.GPUS.indexOf(gpu);
        o.textContent = gpu[0];
        og.appendChild(o);
      });
      g.appendChild(og);
    });
    c.innerHTML = '';
    [0, 1].forEach(function (b) {
      var og = document.createElement('optgroup');
      og.label = CPU_BRANDS[b];
      DB.CPUS.forEach(function (cpu) {
        if (cpu[2] !== b) return;
        var o = document.createElement('option');
        o.value = DB.CPUS.indexOf(cpu);
        o.textContent = cpu[0];
        og.appendChild(o);
      });
      c.appendChild(og);
    });
    r.innerHTML = '';
    DB.RAM_OPTIONS.forEach(function (gb) {
      var o = document.createElement('option');
      o.value = gb;
      o.textContent = gb + ' GB';
      r.appendChild(o);
    });
    r.value = '16';
    $('selDisk').value = 'nvme';
    $('selRes').value = '1080p';
  }

  /* ============ 硬件检测 ============ */
  function normalizeRenderer(s) {
    return s.toLowerCase()
      .replace(/\((r|tm|c)\)/g, '')
      .replace(/\(/g, ' ').replace(/\)/g, ' ')
      .replace(/\s+/g, ' ');
  }

  var SPECIAL_GPU = [
    [/uhd graphics 630/, 'UHD 630 核显'],
    [/uhd graphics 730|uhd 750/, 'UHD 730/750 核显'],
    [/iris xe/, 'Iris Xe 核显'],
    [/radeon 780m|780m graphics/, 'Radeon 780M 核显'],
    [/radeon graphics/, 'Vega 8 核显']
  ];

  function matchGpu(renderer) {
    if (!renderer) return { entry: null, note: '未获取到 GPU 信息' };
    var r = normalizeRenderer(renderer);
    for (var i = 0; i < SPECIAL_GPU.length; i++) {
      if (SPECIAL_GPU[i][0].test(r)) {
        var sp = DB.GPUS.find(function (g) { return g[0] === SPECIAL_GPU[i][1]; });
        return { entry: sp, note: '核显型号为近似匹配，请手动确认' };
      }
    }
    var cands = DB.GPUS.slice().sort(function (a, b) { return b[0].length - a[0].length; });
    for (var j = 0; j < cands.length; j++) {
      if (r.indexOf(cands[j][0].toLowerCase()) !== -1) return { entry: cands[j], note: '' };
    }
    return { entry: null, note: '未能识别显卡型号，请手动选择' };
  }

  function detectOs() {
    var ua = navigator.userAgent;
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows NT 6/.test(ua)) return 'Windows 7/8（较老系统）';
    if (/Mac OS X/.test(ua)) return 'macOS（演示模型按 Windows 估算）';
    if (/Android/.test(ua)) return 'Android（移动端请使用 PC 玩三角洲）';
    if (/iPhone|iPad/.test(ua)) return 'iOS（移动端请使用 PC 玩三角洲）';
    return '未知系统';
  }

  function guessRes() {
    var h = window.screen.height, w = window.screen.width;
    var max = Math.max(h, w);
    if (max >= 2160) return '4k';
    if (max >= 1440) return '1440p';
    return '1080p';
  }

  function logLine(text, cls) {
    var log = $('detectLog');
    var div = document.createElement('div');
    div.className = 'line ' + (cls || '');
    div.textContent = text;
    log.appendChild(div);
  }

  async function runDetect() {
    var btn = $('runDetectBtn');
    var log = $('detectLog');
    btn.disabled = true;
    log.hidden = false;
    log.innerHTML = '';

    logLine('读取图形设备信息（WebGL）…');
    await sleep(500);
    var gpu = null, gpuNote = '';
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        var renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        var m = matchGpu(renderer);
        gpu = m.entry;
        gpuNote = m.note;
        if (renderer && /laptop|mobile/i.test(renderer)) state.laptop = true;
        else state.laptop = false;
      }
    } catch (e) { /* ignore */ }
    if (gpu) logLine('✔ GPU 识别：' + gpu[0] + (state.laptop ? '（移动版，性能按 ×0.85 折算）' : ''), 'ok');
    else logLine('⚠ GPU：' + (gpuNote || '浏览器未提供信息'), 'warn');

    logLine('识别操作系统…');
    await sleep(400);
    var os = detectOs();
    logLine('✔ 系统：' + os + ' · 逻辑核心数：' + (navigator.hardwareConcurrency || '未知'), 'ok');

    logLine('估算内存容量…');
    await sleep(400);
    var dm = navigator.deviceMemory;
    logLine(dm ? ('⚠ 浏览器估算内存约 ' + dm + ' GB（可能偏低，请手动确认）') : ('⚠ 浏览器无法读取内存，请手动选择'), 'warn');

    logLine('读取屏幕分辨率…');
    await sleep(400);
    var res = guessRes();
    logLine('✔ 屏幕分辨率：' + res + '（可手动修改）', 'ok');

    /* 回填表单 */
    if (gpu) { $('selGpu').value = String(DB.GPUS.indexOf(gpu)); state.gpuIdx = DB.GPUS.indexOf(gpu); }
    var hint = $('detectResult').querySelector('.form-note');
    hint.innerHTML = '💡 浏览器无法直接读取 CPU 型号，请参照「任务管理器 → 性能」选择；'
      + (dm ? ('浏览器估算内存约 ' + dm + ' GB，可能偏低，') : '') + '请手动确认（官方推荐 16GB）。';
    $('selRam').value = String(state.ramGb);
    $('selRes').value = res;
    state.res = res;
    state.detected = true;

    await sleep(300);
    btn.disabled = false;
    $('detectBox').hidden = true;
    $('detectResult').hidden = false;
    if (gpuNote && gpu) toast(gpuNote, 3200);
    toast('检测完成，请确认配置后生成报告', 2200);
  }

  /* ============ 生成报告 ============ */
  function genReport() {
    var gpuIdx = parseInt($('selGpu').value, 10);
    var cpuIdx = parseInt($('selCpu').value, 10);
    if (isNaN(gpuIdx) || isNaN(cpuIdx)) { toast('请选择显卡与 CPU 型号'); return; }
    state.gpuIdx = gpuIdx; state.cpuIdx = cpuIdx;
    state.ramGb = parseInt($('selRam').value, 10);
    state.disk = $('selDisk').value;
    state.res = $('selRes').value;

    var gpu = DB.GPUS[gpuIdx], cpu = DB.CPUS[cpuIdx];
    var gpuScore = Math.round(gpu[1] * (state.laptop ? 0.85 : 1));
    var report = DB.predict({
      gpuScore: gpuScore, cpuScore: cpu[1], ramGb: state.ramGb,
      disk: state.disk, res: state.res
    });
    report.gpuName = gpu[0] + (state.laptop ? '（移动版）' : '');
    report.cpuName = cpu[0];
    renderReport(report);
  }

  function renderReport(r) {
    var html = '';
    var letter = r.rating[0], rLabel = r.rating[1];

    /* 评级卡 */
    html += '<div class="rep-card"><h3>诊断总览<span class="sub-t">综合分 ' + r.total + ' / 100+</span></h3>';
    html += '<div class="rating-row">';
    html += '<div class="rating-badge r-' + letter + '"><span class="r-letter">' + letter + '</span><span class="r-label">' + rLabel + '</span></div>';
    html += '<div class="rating-info"><div class="verdict">' + summaryVerdict(r) + '</div>';
    html += '<div class="desc">' + summaryDesc(r) + '</div>';
    html += '<div class="chip-row">' + chips(r).join('') + '</div></div></div>';

    /* 配置清单 */
    html += '<div class="cfg-list" style="margin-top:18px">';
    html += cfgItem('显卡', r.gpuName) + cfgItem('处理器', r.cpuName);
    html += cfgItem('内存', r.ramGb + ' GB') + cfgItem('硬盘', { nvme: '固态 NVMe', sata: '固态 SATA', hdd: '机械硬盘' }[state.disk]);
    html += cfgItem('分辨率', state.res) + cfgItem('性能指数', 'GPU ' + r.gpuScore + ' · CPU ' + r.cpuScore);
    html += '</div></div>';

    /* 帧率预测表 */
    html += '<div class="rep-card"><h3>帧率预测<span class="sub-t">三角洲行动 · 1080p 基准</span></h3>';
    html += '<table class="fps-table"><tr><th>画质档位</th><th>预估平均帧率</th><th>1% low</th><th>体验评价</th></tr>';
    r.rows.forEach(function (row) {
      var vc = row.fps >= 60 ? 'v-good' : row.fps >= 45 ? 'v-mid' : 'v-bad';
      html += '<tr><td class="qname">' + row.name + '</td>'
        + '<td><span class="fps-num num">' + row.fps + '<small> FPS</small></span><br><small style="color:var(--muted)">区间 ' + row.range[0] + '~' + row.range[1] + '</small></td>'
        + '<td><span class="low-num num">' + row.low + '</span><small style="color:var(--muted)"> FPS</small></td>'
        + '<td class="' + vc + '">' + row.verdict + '</td></tr>';
    });
    html += '</table>';
    html += '<p class="table-note">预测按 1080p 全面战场估算；烽火地带同档位通常高 5%~15%。分辨率已在选项折算（2K ×0.72 / 4K ×0.52）。实际帧率受驱动、散热、后台负载影响，以游戏内实测为准。</p></div>';

    /* 瓶颈分析 */
    html += '<div class="rep-card"><h3>瓶颈分析<span class="sub-t">相对官方推荐线</span></h3>';
    r.comps.forEach(function (c) {
      var pct = Math.min(100, Math.round(c[1] / c[2] * 100));
      var cls = pct >= 100 ? 'ok' : pct >= 70 ? 'mid' : 'low';
      html += '<div class="bar-row"><div class="bar-head"><span class="name">' + c[0] + (c[3] ? ' <span style="color:var(--bad)">（低于官方最低线）</span>' : '') + '</span>'
        + '<span class="val num">' + c[1] + ' / 推荐 ' + c[2] + '</span></div>'
        + '<div class="bar-track"><span class="tick" style="left:100%"></span>'
        + '<div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div></div>';
    });
    html += '<div class="bottleneck-box">';
    if (r.bottlenecks.length) {
      html += '<span class="bn-title">⚡ 主要瓶颈：' + r.bottlenecks[0][0] + '</span>　' + bottleneckAdvice(r);
    } else {
      html += '<span class="bn-none">✔ 各部件均达官方推荐线，配置均衡，无显著瓶颈 —— 用软件优化榨干余量即可</span>';
    }
    if (r.diskWarn) html += '<br>⚠ 机械硬盘：进图慢、转场卡顿、贴图延迟的常见元凶，建议将游戏迁移至固态。';
    html += '</div></div>';

    /* 优化清单 */
    html += '<div class="rep-card"><h3>白帽优化清单<span class="sub-t">系统层优化 · 不碰游戏文件 · 可回滚</span></h3>';
    html += '<div class="opt-actions"><button class="btn btn-sm" id="optAll">全选</button><button class="btn btn-sm" id="optNone">全不选</button></div>';
    DB.OPTIMIZATIONS.forEach(function (o, i) {
      html += '<div class="opt-item"><input type="checkbox" id="opt' + i + '"' + (o.id === 'shader' ? '' : ' checked') + '>'
        + '<div><div class="t">' + o.title + '</div><div class="d">' + o.desc + '</div>'
        + (o.caution !== '无' ? '<div class="c">' + o.caution + '</div>' : '')
        + '</div><span class="cat-tag">' + o.cat + '</span></div>';
    });
    html += '<div class="opt-actions"><button class="btn btn-primary" id="genPlanBtn">📋 生成我的优化方案</button></div></div>';

    /* 升级推荐 */
    html += '<div class="rep-card"><h3>硬件升级建议<span class="sub-t">按瓶颈推荐 · 链接为演示占位</span></h3>' + upgradeHtml(r) + '</div>';

    /* 实测反馈 */
    html += '<div class="rep-card"><h3>提交实测帧率<span class="sub-t">众包校准预测模型</span></h3>';
    html += '<div class="fb-grid">'
      + '<label>模式<select id="fbMode"><option value="全面战场">全面战场</option><option value="烽火地带">烽火地带</option></select></label>'
      + '<label>画质<select id="fbPreset"><option>低</option><option selected>中</option><option>高</option><option>极致</option></select></label>'
      + '<label>平均帧率<input type="number" id="fbAvg" min="1" max="500" placeholder="如 75"></label>'
      + '<label>1% low（可选）<input type="number" id="fbLow" min="1" max="500" placeholder="如 48"></label>'
      + '</div><div class="center" style="margin-top:0"><button class="btn" id="fbSubmit">提交（演示）</button></div>'
      + '<p class="table-note">演示版数据仅存于本机，正式版将脱敏上传用于模型校准。</p></div>';

    /* 分享 + CTA */
    html += '<div class="rep-card share-box"><h3>分享我的帧率报告</h3>';
    html += '<img id="sharePreview" class="share-preview" alt="报告预览">';
    html += '<div><button class="btn btn-primary" id="shareBtn">🖼 生成分享卡片</button></div>';
    html += '<p class="table-note">带水印卡片，分享给队友或发布到社区，帮我们收集更多配置数据。</p></div>';

    html += '<div class="rep-card cta-box"><h3>想要一键自动执行以上优化？</h3>';
    html += '<p>PC 客户端开发中：自动应用系统方案、实时帧率悬浮监控、优化前后实测对比报告。<br>预约抢先体验，正式版上线免费赠送 30 天 VIP。</p>';
    html += '<button class="btn btn-primary btn-lg" id="reserveBtn">🔥 预约 PC 客户端</button></div>';

    $('report').innerHTML = html;
    $('report').hidden = false;
    $('report').scrollIntoView({ behavior: 'smooth', block: 'start' });
    bindReportEvents(r);
  }

  function cfgItem(k, v) {
    return '<div class="cfg-item"><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div>';
  }
  function summaryVerdict(r) {
    if (r.belowMin) return '⚠ 未达官方最低配置，游戏难以流畅运行';
    if (r.bottlenecks.length) return '主要瓶颈：' + r.bottlenecks[0][0];
    return '配置均衡，可放心畅玩';
  }
  function summaryDesc(r) {
    var best = r.rows[0], high = r.rows[2];
    return '预估 低画质 ' + best.range[0] + '~' + best.range[1] + ' 帧 · 高画质 ' + high.range[0] + '~' + high.range[1] + ' 帧。'
      + (r.belowMin ? '建议先解决最低配置门槛（内存 ≥12GB 为硬性要求）。' : '建议参照下方清单完成系统优化。');
  }
  function chips(r) {
    var out = [];
    if (r.belowMin) out.push('<span class="chip bad">未达官方最低配置</span>');
    if (r.bottlenecks.length) out.push('<span class="chip warn">主要瓶颈：' + r.bottlenecks[0][0] + '</span>');
    if (r.diskWarn) out.push('<span class="chip warn">机械硬盘：加载卡顿风险</span>');
    if (!r.bottlenecks.length && !r.belowMin) out.push('<span class="chip good">配置均衡</span>');
    return out;
  }
  function bottleneckAdvice(r) {
    var name = r.bottlenecks[0][0];
    if (name === '显卡') return '显卡低于官方推荐线（GTX1060/5500XT 同级），是帧率天花板，升级收益最大（见下方建议）。';
    if (name === '处理器') return 'CPU 低于官方推荐线（i5-6500/R5 1500X 同级），全面战场大战场模式尤其吃 CPU，团战掉帧与此相关。';
    return '内存低于官方推荐 16GB，直接导致 1% low 暴跌与转场卡顿，加内存是性价比最高的升级。';
  }
  function upgradeHtml(r) {
    if (r.bottlenecks.length) {
      var key = r.bottlenecks[0][0] === '显卡' ? 'gpu' : r.bottlenecks[0][0] === '处理器' ? 'cpu' : 'ram';
      var u = DB.UPGRADES[key];
      var html = '<p style="margin-bottom:12px;font-size:14px"><b>' + u.title + '</b></p>';
      u.options.forEach(function (o) {
        html += '<div class="upg-card"><span class="tag">' + o.tag + '</span>'
          + '<span class="name">' + o.name + '</span>'
          + '<a class="btn btn-sm" href="' + DB.jdLink(o.kw) + '" target="_blank" rel="noopener">去比价 ↗<br><span class="link-demo">演示链接</span></a></div>';
      });
      html += '<p class="upg-note">' + u.note + '</p>';
      return html;
    }
    if (r.diskWarn) {
      var d = DB.UPGRADES.disk;
      var html = '<p style="margin-bottom:12px;font-size:14px"><b>' + d.title + '</b></p>';
      d.options.forEach(function (o) {
        html += '<div class="upg-card"><span class="tag">' + o.tag + '</span><span class="name">' + o.name + '</span>'
          + '<a class="btn btn-sm" href="' + DB.jdLink(o.kw) + '" target="_blank" rel="noopener">去比价 ↗<br><span class="link-demo">演示链接</span></a></div>';
      });
      html += '<p class="upg-note">' + d.note + '</p>';
      return html;
    }
    return '<p>✔ 无需硬件升级。开启软件优化清单 + 更新驱动即可榨干余量；追求高刷可考虑 2K 高刷显示器（另见商城）。</p>';
  }

  /* ============ 报告内事件 ============ */
  function bindReportEvents(r) {
    $('optAll').onclick = function () {
      DB.OPTIMIZATIONS.forEach(function (o, i) { $('opt' + i).checked = true; });
    };
    $('optNone').onclick = function () {
      DB.OPTIMIZATIONS.forEach(function (o, i) { $('opt' + i).checked = false; });
    };
    $('genPlanBtn').onclick = function () {
      var picked = [];
      DB.OPTIMIZATIONS.forEach(function (o, i) { if ($('opt' + i).checked) picked.push(o); });
      var list = picked.map(function (o) { return '<li>' + o.title + ' <small style="color:var(--muted)">[' + o.cat + ']</small></li>'; }).join('');
      openModal('你的优化方案（' + picked.length + ' 项）',
        '<div class="mlist"><ul>' + list + '</ul></div>'
        + '<p style="font-size:13px;color:var(--muted);margin-top:10px">以上均为系统层设置，正式版客户端支持一键执行与一键回滚。</p>'
        + '<button class="btn btn-primary" id="modalToReserve" style="width:100%">预约 PC 客户端一键执行 →</button>');
      $('modalToReserve').onclick = function () { reserveForm(); };
    };
    $('fbSubmit').onclick = function () {
      var avg = parseInt($('fbAvg').value, 10);
      if (!avg || avg <= 0) { toast('请填写平均帧率'); return; }
      var delta = (parseInt(localStorage.getItem('dfopt_fps_count') || '0', 10) || 0) + 1;
      localStorage.setItem('dfopt_fps_count', String(delta));
      fsCount = getCount();
      $('dataCount').textContent = fsCount;
      toast('已收录（演示）！累计 ' + fsCount + ' 条配置数据，感谢校准预测模型', 3200);
      $('fbAvg').value = ''; $('fbLow').value = '';
    };
    $('shareBtn').onclick = function () {
      drawShareCard(r, function (url) {
        var a = document.createElement('a');
        a.href = url; a.download = '三角洲帧率报告.png';
        document.body.appendChild(a); a.click(); a.remove();
        toast('分享卡片已生成并开始下载');
      });
    };
    $('reserveBtn').onclick = reserveForm;
  }

  function reserveForm() {
    openModal('预约 PC 客户端 · 抢先体验',
      '<p style="font-size:14px;color:var(--muted)">正式版上线后，将按登记顺序发放 <b style="color:var(--accent)">30 天 VIP</b> 体验资格。</p>'
      + '<label>昵称（可选）<input id="rsvName" maxlength="20" placeholder="三角洲战神"></label>'
      + '<label>微信号 / 邮箱<input id="rsvContact" maxlength="50" placeholder="用于发送下载链接"></label>'
      + '<button class="btn btn-primary" id="rsvSubmit" style="width:100%">提交预约（演示）</button>');
    $('rsvSubmit').onclick = function () {
      var contact = $('rsvContact').value.trim();
      if (!contact) { toast('请填写联系方式'); return; }
      try {
        var list = JSON.parse(localStorage.getItem('dfopt_reserve') || '[]');
        list.push({ name: $('rsvName').value.trim(), contact: contact, time: new Date().toISOString() });
        localStorage.setItem('dfopt_reserve', JSON.stringify(list));
      } catch (e) { /* ignore */ }
      closeModal();
      toast('预约成功（演示）！正式版上线后优先通知', 3200);
    };
  }

  /* ============ 分享卡片（Canvas） ============ */
  function drawShareCard(r, cb) {
    var cv = $('shareCanvas'), ctx = cv.getContext('2d');
    var W = 750, H = 1060;
    /* 背景 */
    ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(232,237,245,0.05)'; ctx.lineWidth = 1;
    for (var x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (var y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = '#f7a32b'; ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, W - 32, H - 32);

    var F = function (size, weight) { return weight + ' ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif'; };

    /* 头部 */
    ctx.fillStyle = '#f7a32b'; ctx.font = F(40, '800');
    ctx.fillText('三角洲帧率优化助手', 56, 88);
    ctx.fillStyle = '#8b96a8'; ctx.font = F(22, '400');
    ctx.fillText('硬件诊断报告 · ' + new Date().toLocaleDateString('zh-CN'), 56, 128);

    /* 评级徽章 */
    var bx = W - 190, by = 64, bs = 120;
    var g = ctx.createLinearGradient(bx, by, bx + bs, by + bs);
    if (r.rating[0] === 'S') { g.addColorStop(0, '#ffe08a'); g.addColorStop(1, '#f7a32b'); }
    else if (r.rating[0] === 'A') { g.addColorStop(0, '#7df0c0'); g.addColorStop(1, '#22b573'); }
    else if (r.rating[0] === 'B') { g.addColorStop(0, '#8fd8ff'); g.addColorStop(1, '#2f80ed'); }
    else if (r.rating[0] === 'C') { g.addColorStop(0, '#ffd88a'); g.addColorStop(1, '#f2994a'); }
    else { g.addColorStop(0, '#ff9d9d'); g.addColorStop(1, '#eb5757'); }
    ctx.fillStyle = g;
    roundRect(ctx, bx, by, bs, bs, 20); ctx.fill();
    ctx.fillStyle = r.rating[0] === 'S' || r.rating[0] === 'C' ? '#33210a' : '#fff';
    ctx.font = F(58, '900'); ctx.textAlign = 'center';
    ctx.fillText(r.rating[0], bx + bs / 2, by + 76);
    ctx.font = F(15, '600'); ctx.fillText(r.rating[1], bx + bs / 2, by + 102);
    ctx.textAlign = 'left';

    /* 配置列表 */
    var rows = [
      ['显卡', r.gpuName], ['处理器', r.cpuName],
      ['内存', r.ramGb + ' GB'], ['分辨率', state.res],
      ['硬盘', { nvme: '固态 NVMe', sata: '固态 SATA', hdd: '机械硬盘' }[state.disk]]
    ];
    var cy = 196;
    rows.forEach(function (row) {
      ctx.fillStyle = '#8b96a8'; ctx.font = F(20, '400');
      ctx.fillText(row[0], 56, cy);
      ctx.fillStyle = '#e8edf5'; ctx.font = F(22, '700');
      ctx.fillText(row[1], 200, cy);
      cy += 44;
    });

    /* 分隔线 */
    ctx.strokeStyle = '#232c3d'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(56, cy + 6); ctx.lineTo(W - 56, cy + 6); ctx.stroke();
    cy += 44;

    /* 帧率表 */
    ctx.fillStyle = '#f7a32b'; ctx.font = F(26, '700');
    ctx.fillText('帧率预测（1080p 基准）', 56, cy);
    cy += 26;
    var cols = [56, 210, 400, 560];
    ctx.fillStyle = '#8b96a8'; ctx.font = F(17, '400');
    ctx.fillText('画质', cols[0], cy); ctx.fillText('平均帧率', cols[1], cy);
    ctx.fillText('1% low', cols[2], cy); ctx.fillText('评价', cols[3], cy);
    cy += 30;
    r.rows.forEach(function (row) {
      ctx.fillStyle = '#e8edf5'; ctx.font = F(24, '700');
      ctx.fillText(row.name, cols[0], cy);
      ctx.fillStyle = '#f7a32b'; ctx.font = F(30, '800');
      ctx.fillText(String(row.fps), cols[1], cy);
      ctx.fillStyle = '#2dd4bf'; ctx.font = F(24, '700');
      ctx.fillText(String(row.low), cols[2], cy);
      ctx.fillStyle = row.fps >= 60 ? '#3ddc84' : row.fps >= 45 ? '#ffc53d' : '#ff5c5c';
      ctx.font = F(20, '600'); ctx.fillText(row.verdict, cols[3], cy);
      cy += 52;
    });

    /* 瓶颈与建议 */
    cy += 12;
    ctx.strokeStyle = '#232c3d';
    ctx.beginPath(); ctx.moveTo(56, cy); ctx.lineTo(W - 56, cy); ctx.stroke();
    cy += 46;
    ctx.fillStyle = '#e8edf5'; ctx.font = F(24, '700');
    ctx.fillText(r.bottlenecks.length ? ('主要瓶颈：' + r.bottlenecks[0][0]) : '配置均衡 · 无显著瓶颈', 56, cy);
    cy += 40;
    ctx.fillStyle = '#8b96a8'; ctx.font = F(19, '400');
    ctx.fillText('建议：按「白帽优化清单」完成系统优化（电源计划 / 优先级 / 驱动 / 缓存）', 56, cy);
    cy += 38;
    ctx.fillText('未达官方门槛的部件请优先升级，参照报告内的硬件升级建议。', 56, cy);

    /* 页脚 */
    ctx.fillStyle = 'rgba(247,163,43,0.9)'; ctx.font = F(20, '700');
    ctx.fillText('白帽优化 · 不碰游戏文件 · 不注入进程 · 安全不封号', 56, H - 120);
    ctx.fillStyle = '#8b96a8'; ctx.font = F(16, '400');
    ctx.fillText('演示数据仅供参考 · 三角洲帧率优化助手 · df-opt.cn（占位）', 56, H - 84);

    var img = cv.toDataURL('image/png');
    var prev = $('sharePreview');
    prev.src = img; prev.style.display = 'block';
    cb(img);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ============ 初始化 ============ */
  function init() {
    fillSelects();
    $('dataCount').textContent = fsCount;
    $('startBtn').onclick = function () {
      $('checkup').scrollIntoView({ behavior: 'smooth' });
    };
    $('runDetectBtn').onclick = runDetect;
    $('redetectBtn').onclick = function () {
      $('detectResult').hidden = true;
      $('detectBox').hidden = false;
      $('detectLog').hidden = true;
    };
    $('genReportBtn').onclick = genReport;
    $('modalClose').onclick = closeModal;
    $('modalMask').onclick = function (e) { if (e.target === $('modalMask')) closeModal(); };
    ['selGpu', 'selCpu', 'selRam', 'selDisk', 'selRes'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        state.ramGb = parseInt($('selRam').value, 10);
        state.disk = $('selDisk').value;
        state.res = $('selRes').value;
        if (id === 'selGpu') state.laptop = false; // 手动选择视为桌面版
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
