/**
 * 三角洲帧率优化助手 —— 硬件数据库与帧率预测模型（演示版）
 * ---------------------------------------------------------------
 * 说明：
 * 1. GPU/CPU 分数为「相对性能指数」，以 GTX960 ≈ 55 为基准锚点，
 *    综合公开基准数据估算，仅用于预测，非精确跑分。
 * 2. 预测模型为规则引擎：GPU 承载画质缩放，CPU 决定帧率上限，
 *    内存决定稳定性系数，分辨率影响 GPU 负载。
 * 3. 模型以 1080p 全面战场为基准场景，烽火地带同档位通常高 5%~15%。
 * 4. 本模块无浏览器依赖，可被网页 / 小程序 / Node 复用（小程序「配置库」直接调用）。
 */
(function (root) {
  'use strict';

  /* ============ 硬件数据库 ============ */
  /* 格式：[型号, 性能指数, 分组] 分组：0 NVIDIA / 1 AMD / 2 Intel / 3 核显 */
  var GPUS = [
    ['GT 1030', 28, 0], ['GTX 750 Ti', 38, 0], ['GTX 950', 50, 0], ['GTX 960', 55, 0],
    ['GTX 970', 72, 0], ['GTX 1050', 58, 0], ['GTX 1050 Ti', 62, 0],
    ['GTX 1060', 85, 0], ['GTX 1650', 80, 0], ['GTX 1650 Super', 88, 0],
    ['GTX 1660', 96, 0], ['GTX 1660 Super', 105, 0], ['GTX 1660 Ti', 105, 0],
    ['RTX 2060', 118, 0], ['RTX 2060 Super', 128, 0], ['RTX 2070', 135, 0],
    ['RTX 2080', 155, 0], ['RTX 3050', 112, 0], ['RTX 3060', 142, 0],
    ['RTX 3060 Ti', 165, 0], ['RTX 3070', 185, 0], ['RTX 3070 Ti', 200, 0],
    ['RTX 3080', 225, 0], ['RTX 4060', 168, 0], ['RTX 4060 Ti', 190, 0],
    ['RTX 4070', 225, 0], ['RTX 4070 Super', 250, 0], ['RTX 4070 Ti', 270, 0],
    ['RTX 4080', 290, 0], ['RTX 4080 Super', 300, 0], ['RTX 4090', 350, 0],
    ['RTX 5060', 190, 0], ['RTX 5070', 260, 0], ['RTX 5080', 320, 0], ['RTX 5090', 400, 0],
    ['R9 380', 50, 1], ['RX 470', 60, 1], ['RX 480', 65, 1], ['RX 570', 60, 1],
    ['RX 580', 70, 1], ['RX 5500 XT', 80, 1], ['RX 5600 XT', 100, 1],
    ['RX 5700 XT', 120, 1], ['RX 6500 XT', 75, 1], ['RX 6600', 130, 1],
    ['RX 6600 XT', 140, 1], ['RX 6650 XT', 145, 1], ['RX 6700 XT', 165, 1],
    ['RX 6750 XT', 180, 1], ['RX 6800 XT', 215, 1], ['RX 6900 XT', 235, 1],
    ['RX 7600', 150, 1], ['RX 7700 XT', 200, 1], ['RX 7800 XT', 230, 1],
    ['RX 7900 XT', 285, 1], ['RX 7900 XTX', 330, 1],
    ['Arc A380', 50, 2], ['Arc A580', 82, 2], ['Arc A750', 115, 2],
    ['Arc A770', 130, 2], ['Arc B580', 140, 2],
    ['UHD 630 核显', 18, 3], ['UHD 730/750 核显', 22, 3], ['Vega 8 核显', 22, 3],
    ['Iris Xe 核显', 25, 3], ['Radeon 780M 核显', 35, 3]
  ];

  /* 格式：[型号, 性能指数, 品牌] 品牌：0 Intel / 1 AMD */
  var CPUS = [
    ['i3-3220', 38, 0], ['i5-3550', 45, 0], ['i5-4590', 50, 0], ['i5-6500', 58, 0],
    ['i5-7500', 62, 0], ['i7-3770', 55, 0], ['i7-6700', 65, 0], ['i5-8400', 80, 0],
    ['i5-9400F', 82, 0], ['i7-8700', 90, 0], ['i5-10400F', 98, 0], ['i7-9700', 100, 0],
    ['i5-12400F', 112, 0], ['i5-12600KF', 120, 0], ['i5-13400F', 125, 0],
    ['i5-13600KF', 140, 0], ['i7-12700F', 135, 0], ['i7-13700F', 150, 0],
    ['i9-12900K', 150, 0], ['i9-13900K', 165, 0], ['i9-14900K', 170, 0],
    ['FX-8300', 35, 1], ['R5 1500X', 55, 1], ['R5 2600', 72, 1], ['R5 3600', 85, 1],
    ['R5 5500', 90, 1], ['R5 5600', 100, 1], ['R5 5600X', 105, 1],
    ['R5 7500F', 125, 1], ['R5 7600', 130, 1], ['R7 2700X', 78, 1],
    ['R7 3700X', 92, 1], ['R7 5700X', 110, 1], ['R7 5800X', 120, 1],
    ['R7 5800X3D', 140, 1], ['R7 7800X3D', 160, 1], ['R7 9800X3D', 175, 1],
    ['R9 5900X', 135, 1], ['R9 7950X', 165, 1], ['R9 9950X3D', 185, 1]
  ];

  var RAM_OPTIONS = [4, 8, 12, 16, 24, 32, 64];

  /* 官方配置门槛（三角洲行动 PC 端） */
  var THRESHOLDS = { gpu: 85, cpu: 58, ram: 16, gpuMin: 45, cpuMin: 40, ramMin: 12 };

  /* ============ 帧率预测模型 ============ */
  /* 画质档位 → [GPU 负载系数, CPU 上限系数] */
  var PRESETS = [
    { name: '低',   gpuF: 1.15, cpuF: 1.25 },
    { name: '中',   gpuF: 0.90, cpuF: 1.15 },
    { name: '高',   gpuF: 0.68, cpuF: 1.05 },
    { name: '极致', gpuF: 0.50, cpuF: 1.00 }
  ];
  var RES_FACTOR = { '1080p': 1, '1440p': 0.72, '4k': 0.52 };

  function ramFactor(ramGb) {
    if (ramGb <= 8) return 0.60;
    if (ramGb < 12) return 0.75;
    if (ramGb === 12) return 0.88;
    if (ramGb >= 32) return 1.03;
    return 1.00;
  }
  function ramScore(ramGb) {
    if (ramGb <= 8) return 25;
    if (ramGb < 12) return 35;
    if (ramGb === 12) return 55;
    if (ramGb >= 32) return 100;
    return 80;
  }
  function verdictOf(fps) {
    if (fps >= 100) return '电竞级流畅';
    if (fps >= 75) return '高刷流畅';
    if (fps >= 60) return '流畅';
    if (fps >= 45) return '可玩 · 团战或掉帧';
    if (fps >= 30) return '勉强可玩';
    return '卡顿严重';
  }
  function round5(x) { return Math.round(x / 5) * 5; }

  /**
   * 帧率预测主函数
   * @param {object} o { gpuScore, cpuScore, ramGb, disk:'nvme'|'sata'|'hdd', res:'1080p'|'1440p'|'4k', laptop:boolean }
   * @returns {object} 预测结果
   */
  function predict(o) {
    var gpuScore = o.gpuScore, cpuScore = o.cpuScore, ramGb = o.ramGb;
    var resF = RES_FACTOR[o.res] || 1;
    var ramF = ramFactor(ramGb);
    var rScore = ramScore(ramGb);

    var rows = PRESETS.map(function (p) {
      var gpuFps = gpuScore * p.gpuF * resF;
      var cpuCap = cpuScore * p.cpuF;
      var fps = Math.max(4, Math.round(Math.min(gpuFps, cpuCap) * ramF));
      var low = Math.round(fps * ((cpuScore >= 80 && ramGb >= 16) ? 0.62 : 0.48));
      return {
        name: p.name,
        fps: fps,
        low: low,
        verdict: verdictOf(fps),
        range: [round5(fps * 0.85), round5(fps * 1.15)]
      };
    });

    var total = Math.round(gpuScore * 0.50 + cpuScore * 0.30 + rScore * 0.20);
    var rating = total >= 170 ? ['S', '顶配旗舰'] :
                 total >= 130 ? ['A', '高端畅玩'] :
                 total >= 75  ? ['B', '主流性能'] :
                 total >= 55  ? ['C', '入门可玩'] : ['D', '低于推荐门槛'];

    /* 瓶颈分析：相对推荐线的缺口比例，缺口最大者为第一瓶颈 */
    var comps = [
      ['显卡', gpuScore, THRESHOLDS.gpu, gpuScore < THRESHOLDS.gpuMin],
      ['处理器', cpuScore, THRESHOLDS.cpu, cpuScore < THRESHOLDS.cpuMin],
      ['内存', rScore, 80, ramGb < THRESHOLDS.ramMin]
    ];
    var bottlenecks = comps
      .filter(function (c) { return c[1] < c[2]; })
      .sort(function (a, b) { return (a[1] / a[2]) - (b[1] / b[2]); });

    return {
      rows: rows,
      total: total,
      rating: rating,
      bottlenecks: bottlenecks,
      comps: comps,
      belowMin: gpuScore < THRESHOLDS.gpuMin || cpuScore < THRESHOLDS.cpuMin || ramGb < THRESHOLDS.ramMin,
      diskWarn: o.disk === 'hdd',
      gpuScore: gpuScore, cpuScore: cpuScore, ramScore: rScore, ramGb: ramGb
    };
  }

  /* ============ 白帽优化建议清单 ============ */
  var OPTIMIZATIONS = [
    { id: 'power',  cat: '系统', title: '切换「高性能 / 卓越性能」电源计划', desc: '解除 Windows 对 CPU 的降频节流，笔记本插电使用效果明显。', caution: '功耗与发热略微上升' },
    { id: 'fsopt',  cat: '系统', title: '关闭游戏「全屏优化」', desc: '系统兼容层设置（等价右键属性勾选），可减少全屏切换卡顿与输入延迟。', caution: '无副作用，可随时还原' },
    { id: 'hags',   cat: '系统', title: '开启「硬件加速 GPU 计划（HAGS）」', desc: 'Win11 建议开启，可降低调度延迟、提升 1% low 稳定性。', caution: '个别旧驱动版本建议关闭' },
    { id: 'prio',   cat: '进程', title: '游戏进程优先级设为「高」', desc: '让 CPU 优先调度游戏线程，减少后台抢占。', caution: '需每次启动游戏后应用（客户端可自动化）' },
    { id: 'bg',     cat: '进程', title: '关闭后台高占用程序', desc: '浏览器多标签、直播软件、下载工具、杀软全盘扫描等是卡顿元凶。', caution: '无' },
    { id: 'driver', cat: '驱动', title: '更新显卡驱动', desc: '三角洲每个赛季都有驱动适配更新，旧驱动是闪退重灾区。', caution: '使用「清洁安装」更稳' },
    { id: 'shader', cat: '缓存', title: '清理着色器缓存', desc: '仅建议在「游戏内卡顿异常」时使用，清理驱动与游戏缓存目录。', caution: '⚠️ 首次进游戏需重编译着色器，会短暂卡顿' },
    { id: 'net',    cat: '网络', title: '关闭网络节流 + 优选 DNS', desc: '关闭多媒体网络节流，DNS 换成延迟最低的公共 DNS。', caution: '国服直连为主，收益有限' },
    { id: 'ig',     cat: '画质', title: '游戏内按预测表选档位', desc: '参照上方帧率预测表选择档位，关掉体积云/动态模糊等低性价比特效。', caution: '无' },
    { id: 'dvr',    cat: '系统', title: '关闭 Xbox Game Bar 后台录制', desc: 'Win11 默认开启的后台录制会持续占用 GPU 资源。', caution: '无法再用 Win+G 录屏' }
  ];

  /* ============ 硬件升级建议（CPS 商城数据源，演示占位链接） ============ */
  function jdLink(kw) {
    return 'https://search.jd.com/Search?keyword=' + encodeURIComponent(kw);
  }
  var UPGRADES = {
    gpu: {
      title: '显卡是主要瓶颈 —— 升级建议（按预算阶梯）',
      note: '价格为大促/二手市场参考区间，仅供参考；升级前请确认电源功率（1660S 需 400W 以上，4060 需 450W 以上）。',
      options: [
        { name: 'GTX 1660 Super（二手约 500~700 元）', kw: 'GTX 1660 Super 显卡', tag: '性价比' },
        { name: 'RTX 3060（二手约 1400~1600 元）', kw: 'RTX 3060 显卡', tag: '推荐' },
        { name: 'RTX 4060（新品约 2200~2400 元）', kw: 'RTX 4060 显卡', tag: '一步到位' }
      ]
    },
    cpu: {
      title: '处理器是主要瓶颈 —— 升级建议',
      note: 'CPU 升级受主板平台限制：LGA1155 / AM3 等老平台需「板 U 内存」整套更换；AM4 平台可直接换 5600/5700X3D 续命。',
      options: [
        { name: 'R5 5600（AM4 老平台续命，约 600 元）', kw: 'R5 5600 处理器', tag: 'AM4 首选' },
        { name: 'i5-12400F + B660/H610 板U套装（约 1100 元）', kw: 'i5 12400F 板U套装', tag: '推荐' },
        { name: 'R5 7500F + B650 板U套装（约 1600 元）', kw: 'R5 7500F 板U套装', tag: '新平台' }
      ]
    },
    ram: {
      title: '内存不足是主要瓶颈 —— 升级建议',
      note: '三角洲官方最低要求 12GB、推荐 16GB；务必组双通道（两根同规格内存条），8GB 单通道会显著拖低 1% low。',
      options: [
        { name: 'DDR4 16GB（8G×2）3200 套条（约 250 元）', kw: 'DDR4 16G 3200 内存套条', tag: '推荐' },
        { name: 'DDR4 32GB（16G×2）3200 套条（约 450 元）', kw: 'DDR4 32G 3200 内存套条', tag: '一步到位' }
      ]
    },
    disk: {
      title: '机械硬盘会拖慢加载与素材流送 —— 升级建议',
      note: '机械硬盘会导致进图慢、跑图转场卡顿、贴图加载延迟；游戏本体建议放 NVMe 固态。',
      options: [
        { name: 'NVMe 固态 1TB（约 350~450 元）', kw: 'NVMe 固态硬盘 1TB', tag: '推荐' }
      ]
    }
  };

  var DFOPT = {
    GPUS: GPUS,
    CPUS: CPUS,
    RAM_OPTIONS: RAM_OPTIONS,
    THRESHOLDS: THRESHOLDS,
    predict: predict,
    OPTIMIZATIONS: OPTIMIZATIONS,
    UPGRADES: UPGRADES,
    jdLink: jdLink
  };
  root.DFOPT = DFOPT;
  if (typeof module !== 'undefined' && module.exports) { module.exports = DFOPT; }
})(typeof window !== 'undefined' ? window : this);
