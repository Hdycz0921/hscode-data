// utils/semantic-search.js - 语义搜索核心逻辑(无服务器,全部走 CDN 数据)
// 依赖外部传入:allData(商品数组), codeMap(code→item), hsIndex(倒排索引), hsSynonyms(同义词词典)
// 调用方负责数据加载,本模块只做计算。

// ===== 评分权重参数(集中可调) =====
// 别名精确命中(口语关键词与商品别名完全一致):最强信号
var W_ALIAS_EXACT = 3.0;
// 别名子串命中(如"苹果"匹配到别名"苹果线",属巧合,弱信号)
var W_ALIAS_SUB = 0.3;
// 索引命中(term 直接映射到该商品,口语别名权威映射)
var W_INDEX = 1.0;
// 名称完全一致(query 与品名相同)
var W_NAME_EXACT = 2.0;
// 名称子串命中(品名包含 query,真实匹配的最强信号之一)
var W_NAME_SUB = 3.0;
// 名称覆盖度放大系数:query 占品名字数比例越高,整体分数放大越多
var COVERAGE_W = 2.0;
// 点赞放大系数与上限:netLikes 每 +1 放大 LIKE_W,封顶 LIKE_CAP
var LIKE_W = 0.05;
var LIKE_CAP = 15;

// ===== 全局材质词表（供零结果保底函数访问，ruleBasedSearch/semanticSearch 内也同步引用同值）=====
var MATERIAL_LEATHER = ['皮革','pu皮','pvc皮','真皮','再生皮','头层皮','二层皮','牛皮','羊皮','猪皮','头层','二层'];
var MATERIAL_COTTON_LINEN = ['棉','麻','竹纤维','竹浆','棉布','麻布','竹布'];
var MATERIAL_SILK_WOOL = ['丝','真丝','丝绸','羊毛','羊绒','驼绒','兔毛','貂毛','驼毛','马海毛'];
var MATERIAL_SYNTHETIC = ['化纤','涤纶','腈纶','锦纶','尼龙','氨纶','丙纶','维纶','氯纶','聚酯','聚酰胺','人造纤维','合成纤维','涤棉','棉纶','锦纶丝'];
var MATERIAL_PLASTIC_RUBBER = ['塑料','硅胶','PVC','TPU','TPE','PU','橡胶','乳胶','TPR'];
var MATERIAL_METAL = ['钢','铁','铜','铝','锌','镍','钛','不锈钢','合金'];
var MATERIAL_GLASS = ['玻璃','钢化','石英','水晶'];
var MATERIAL_PAPER = ['纸','纸板','卡纸','铜版纸','牛皮纸','瓦楞'];

// IDF 计算(BM25 简化):文档频率越低,区分度越高
function bm25Idf(df, total) {
  if (df <= 0) df = 1;
  return Math.log((total - df + 0.5) / (df + 0.5) + 1);
}

// 构建 词 → 同组词 展开映射(运行时从同义词词典构建一次)
function buildExpandMap(synDict) {
  var map = {};
  if (!synDict || !synDict.groups) return map;
  for (var i = 0; i < synDict.groups.length; i++) {
    var group = synDict.groups[i];
    for (var j = 0; j < group.length; j++) {
      var term = String(group[j] || '').trim().toLowerCase();
      if (!term) continue;
      if (!map[term]) map[term] = [];
      for (var k = 0; k < group.length; k++) {
        var other = String(group[k] || '').trim().toLowerCase();
        if (other && other !== term && map[term].indexOf(other) === -1) {
          map[term].push(other);
        }
      }
    }
  }
  return map;
}

// 名称覆盖度:query 是品名子串时按紧致度(q.len/name.len)计分;
// 否则按字符命中比例估算作为平滑分项。
// 公式:0.4 + 0.6*(q.len/name.len),品名越接近查询词本体越高分。
function nameCoverage(name, q) {
  if (!name || !q) return 0;
  if (name.indexOf(q) !== -1) {
    var tightness = q.length / name.length;
    if (tightness > 1) tightness = 1;
    return 0.4 + 0.6 * tightness;
  }
  var found = 0;
  for (var i = 0; i < q.length; i++) {
    if (name.indexOf(q.charAt(i)) !== -1) found++;
  }
  return found / q.length * 0.3; // 未命中品名时降权,避免与命中品名同档
}

// ===== 规则增强搜索 =====
// 核心场景:「手机壳/电脑壳」等 → 查询含配件词但品名中无配件词
// 策略:扫描目标章节全部品名,按"配件词命中"和"设备词命中"双维度评分
//       3926(塑料零配件)是所有"壳/套/罩"类查询的首选章节
//       有配件词命中 → 强推荐;有设备词命中 → 中推荐
// ctx: { allData, codeMap, processItem, getItemWeight }
function ruleBasedSearch(keyword, ctx) {
  var allData = ctx.allData;

  var q = String(keyword || '').trim().toLowerCase();

  // === 配件词识别(查询词含它 = 用户要找配件外壳)===
  // 「壳」类 = 设备专属配件(如手机壳→手机零件)→ 走设备章节
  // 「套/护套」类 = 通用保护套(如手机保护套→按材质归3926)→ 不走设备章节
  var SHELL_KEYWORDS = ['壳','外壳','壳体'];
  var SLEEVE_KEYWORDS = ['保护套','护套','防尘套','软套','硅胶套','防水套'];
  var ACCESSORY_PATTERNS = SHELL_KEYWORDS.concat(SLEEVE_KEYWORDS).concat([
    '罩','盖','盒','匣','袋',
    '零件','部件','配件',
  ]);
  // 用于判定查询是"壳"型还是"套"型
  var qHasShell = false;
  for (var si = 0; si < SHELL_KEYWORDS.length; si++) {
    if (q.indexOf(SHELL_KEYWORDS[si]) !== -1) { qHasShell = true; break; }
  }
  var qHasSleeve = false;
  for (var sui = 0; sui < SLEEVE_KEYWORDS.length; sui++) {
    if (q.indexOf(SLEEVE_KEYWORDS[sui]) !== -1) { qHasSleeve = true; break; }
  }
  // 「套」类查询屏蔽设备章节(3926 等按材质章节照常入)
  var blockDeviceChapter = qHasSleeve && !qHasShell;

  // === 材质章节检测（皮革/塑料材质查询时 ruleBasedSearch fallback 也应扫描对应章节）===
  // === 材质章节扩展映射（海关"成分归类"法:按材料归对应章节）===
  var MATERIAL_LEATHER = ['皮革','pu皮','pvc皮','真皮','再生皮','头层皮','二层皮','牛皮','羊皮','猪皮','头层','二层'];
  var MATERIAL_COTTON_LINEN = ['棉','麻','竹纤维','竹浆','棉布','麻布','竹布'];
  var MATERIAL_SILK_WOOL = ['丝','真丝','丝绸','羊毛','羊绒','驼绒','兔毛','貂毛','驼毛','马海毛'];
  var MATERIAL_SYNTHETIC = ['化纤','涤纶','腈纶','锦纶','尼龙','氨纶','丙纶','维纶','氯纶','聚酯','聚酰胺','人造纤维','合成纤维','涤棉','棉纶','锦纶丝'];
  var MATERIAL_PLASTIC_RUBBER = ['塑料','硅胶','PVC','TPU','TPE','PU','橡胶','乳胶','TPR'];
  var MATERIAL_METAL = ['钢','铁','铜','铝','锌','镍','钛','不锈钢','合金'];
  var MATERIAL_GLASS = ['玻璃','钢化','石英','水晶'];
  var MATERIAL_PAPER = ['纸','纸板','卡纸','铜版纸','牛皮纸','瓦楞'];

  var leatherTermsQ = MATERIAL_LEATHER;
  var qHasLeatherMat = leatherTermsQ.some(function(t) { return q.indexOf(t) !== -1; });
  // 兼容"材质制"形式（如"皮革制"去掉"制"后匹配）
  if (!qHasLeatherMat) {
    var qTrimZhi = q.replace(/制$/, '');
    if (qTrimZhi !== q && qTrimZhi.length >= 2) {
      qHasLeatherMat = leatherTermsQ.some(function(t) {
        return qTrimZhi.indexOf(t) !== -1 || t.indexOf(qTrimZhi) !== -1;
      });
    }
  }
  var plasticTermsQ = MATERIAL_PLASTIC_RUBBER;
  var qHasPlasticMat = plasticTermsQ.some(function(t) { return q.indexOf(t) !== -1; });

  // === 衣物词检测（衫/服/外套/裤/裙等 = 用户要找衣服类商品）===
  // 注意:不含单字'衣'(会误伤'衣箱'等箱包容器);'服'单字安全(服装/制服/皮服)
  var CLOTHING_KEYWORDS = ['衫','服','衣服','衣物','上衣','皮衣','大衣','棉衣','毛衣','衬衣','外衣','内衣','风衣','夹克','外套','马甲','背心','裤','裙','围巾','斗篷'];
  var qHasClothing = false;
  for (var ckr = 0; ckr < CLOTHING_KEYWORDS.length; ckr++) {
    if (q.indexOf(CLOTHING_KEYWORDS[ckr]) !== -1) { qHasClothing = true; break; }
  }

  // === 设备名 → 其专属章节 ===
  // 每个设备可能扫描多个章节:整机章节 + 配件章节(按优先级排序)
  var DEVICE_CHAPTERS = {
    // 原有
    '手机':      { ch4: ['8517','3926'], partsCh4: ['8517'] },
    'iphone':   { ch4: ['8517','3926'], partsCh4: ['8517'] },
    '智能手机':  { ch4: ['8517','3926'], partsCh4: ['8517'] },
    '安卓手机':  { ch4: ['8517','3926'], partsCh4: ['8517'] },
    '苹果手机':  { ch4: ['8517','3926'], partsCh4: ['8517'] },
    '电脑':      { ch4: ['8471','3922'], partsCh4: ['8471'] },
    '笔记本':    { ch4: ['8471','3922'], partsCh4: ['8471'] },
    '笔记本电脑':{ ch4: ['8471','3922'], partsCh4: ['8471'] },
    '台式机':    { ch4: ['8471','3922'], partsCh4: ['8471'] },
    '相机':      { ch4: ['9007','9001'], partsCh4: ['9006','9007'] },
    '摄像机':    { ch4: ['9007','9001'], partsCh4: ['9006','9007'] },
    '手表':      { ch4: ['9111','9110'], partsCh4: ['9111'] },
    '耳机':      { ch4: ['8518'], partsCh4: ['8518'] },
    '音响':      { ch4: ['8518','8519'], partsCh4: ['8518'] },
    '音箱':      { ch4: ['8518'], partsCh4: ['8518'] },
    '键盘':      { ch4: ['8471'], partsCh4: ['8471'] },
    '汽车':      { ch4: ['8708'], partsCh4: ['8708'] },
    '眼镜':      { ch4: ['9004'], partsCh4: ['9004'] },
    '无人机':    { ch4: ['8806'], partsCh4: ['8806'] },
    '航拍':      { ch4: ['8806'], partsCh4: ['8806'] },
    '遥控飞机':  { ch4: ['8806'], partsCh4: ['8806'] },
    '充电宝':    { ch4: ['8507'], partsCh4: ['8507'] },
    '移动电源':  { ch4: ['8507'], partsCh4: ['8507'] },
    // 新增: 显示/屏幕
    '显示器':    { ch4: ['8528'], partsCh4: ['8528','8471'] },
    '显示屏':    { ch4: ['8528'], partsCh4: ['8528','8471'] },
    '屏幕':      { ch4: ['8528','3926'], partsCh4: ['8528'] },
    '电视':      { ch4: ['8528'], partsCh4: ['8528'] },
    '电视机':    { ch4: ['8528'], partsCh4: ['8528'] },
    // 新增: 打印/扫描
    '打印机':    { ch4: ['8443'], partsCh4: ['8443'] },
    '扫描仪':    { ch4: ['8471'], partsCh4: ['8471'] },
    '复印机':    { ch4: ['8443'], partsCh4: ['8443'] },
    // 新增: 网络/通信设备
    '路由器':    { ch4: ['8517'], partsCh4: ['8517'] },
    '交换机':    { ch4: ['8517'], partsCh4: ['8517'] },
    '光猫':      { ch4: ['8517'], partsCh4: ['8517'] },
    '网卡':      { ch4: ['8517'], partsCh4: ['8517'] },
    '数据线':    { ch4: ['8544'], partsCh4: ['8544'] },
    '数据线':    { ch4: ['8544'], partsCh4: ['8544'] },
    '充电器':    { ch4: ['8504'], partsCh4: ['8504'] },
    '适配器':    { ch4: ['8504','3926'], partsCh4: ['8504'] },
    '充电线':    { ch4: ['8544','8504'], partsCh4: ['8544'] },
    'USB线':     { ch4: ['8544'], partsCh4: ['8544'] },
    'HDMI线':    { ch4: ['8544'], partsCh4: ['8544'] },
    // 新增: 电池/储能
    '电池':      { ch4: ['8507'], partsCh4: ['8507'] },
    '锂电池':    { ch4: ['8507'], partsCh4: ['8507'] },
    '蓄电池':    { ch4: ['8507'], partsCh4: ['8507'] },
    // 新增: 照明/灯具
    '灯':        { ch4: ['9405'], partsCh4: ['9405'] },
    '灯具':      { ch4: ['9405'], partsCh4: ['9405'] },
    'LED灯':     { ch4: ['9405'], partsCh4: ['9405'] },
    '灯泡':      { ch4: ['9405'], partsCh4: ['9405'] },
    '台灯':      { ch4: ['9405'], partsCh4: ['9405'] },
    '手电筒':    { ch4: ['9405'], partsCh4: ['9405'] },
    // 新增: 家具/家居（v2.0.1.3 修复：沙发等词索引为0，用章节映射兜底）
    '沙发':      { ch4: ['9401','9403'], partsCh4: ['9401'] },
    '床':        { ch4: ['9401','9403'], partsCh4: ['9401'] },
    '床垫':      { ch4: ['9404'], partsCh4: ['9404'] },
    '衣柜':      { ch4: ['9403'], partsCh4: ['9403'] },
    '橱柜':      { ch4: ['9403'], partsCh4: ['9403'] },
    '餐桌':      { ch4: ['9403'], partsCh4: ['9403'] },
    '椅子':      { ch4: ['9401','9403'], partsCh4: ['9401'] },
    '书桌':      { ch4: ['9403'], partsCh4: ['9403'] },
    '办公桌':    { ch4: ['9403'], partsCh4: ['9403'] },
    '茶几':      { ch4: ['9403'], partsCh4: ['9403'] },
    '柜子':      { ch4: ['9403'], partsCh4: ['9403'] },
    '家具':      { ch4: ['9401','9403'], partsCh4: ['9401'] },
    // 新增: 电动工具
    '电钻':      { ch4: ['8467'], partsCh4: ['8467'] },
    '电动工具':  { ch4: ['8467'], partsCh4: ['8467'] },
    '电锯':      { ch4: ['8467'], partsCh4: ['8467'] },
    // 新增: 运动/玩具
    '自行车':    { ch4: ['8714'], partsCh4: ['8714'] },
    '电动车':    { ch4: ['8711','8714'], partsCh4: ['8711','8714'] },
    '玩具':      { ch4: ['9503'], partsCh4: ['9503'] },
    // 新增: 鞋/帽
    '鞋':        { ch4: ['6403','6404'], partsCh4: ['6403'] },
    '皮鞋':      { ch4: ['6403'], partsCh4: ['6403'] },
    '运动鞋':    { ch4: ['6404','6403'], partsCh4: ['6404'] },
    '帽子':      { ch4: ['6505','6504'], partsCh4: ['6505'] },
    '帽子':      { ch4: ['6505','6504'], partsCh4: ['6505'] },
    // 新增: 箱包
    '行李箱':    { ch4: ['4202'], partsCh4: ['4202'] },
    '拉杆箱':    { ch4: ['4202'], partsCh4: ['4202'] },
    '背包':      { ch4: ['4202'], partsCh4: ['4202'] },
    '包':        { ch4: ['4202'], partsCh4: ['4202'] },
    // 新增: 纺织服装
    '衬衫':      { ch4: ['6105','6106','6205','6206'], partsCh4: ['6105'] },
    'T恤':      { ch4: ['6109','6205'], partsCh4: ['6109'] },
    '裙子':      { ch4: ['6104','6204'], partsCh4: ['6104'] },
    '裤子':      { ch4: ['6103','6104','6203','6204'], partsCh4: ['6103'] },
    // 新增: 厨房/餐饮
    '微波炉':    { ch4: ['8516'], partsCh4: ['8516'] },
    '电饭煲':    { ch4: ['8516'], partsCh4: ['8516'] },
    '电磁炉':    { ch4: ['8516'], partsCh4: ['8516'] },
    '榨汁机':    { ch4: ['8509'], partsCh4: ['8509'] },
    '搅拌机':    { ch4: ['8509'], partsCh4: ['8509'] },
    '吸尘器':    { ch4: ['8508'], partsCh4: ['8508'] },
    // 新增: 安防/门禁
    '摄像头':    { ch4: ['8525','8529'], partsCh4: ['8525'] },
    '监控':      { ch4: ['8525'], partsCh4: ['8525'] },
    '门禁':      { ch4: ['8531'], partsCh4: ['8531'] },
    // 新增: 医疗/健康
    '血压计':    { ch4: ['9018'], partsCh4: ['9018'] },
    '体温计':    { ch4: ['9025'], partsCh4: ['9025'] },
    '轮椅':      { ch4: ['8713'], partsCh4: ['8713'] },
  };

  // === 设备名检测 ===
  var foundDeviceWords = [];
  var foundDeviceChapters = {};
  var foundPartsChapters = {};
  for (var dev in DEVICE_CHAPTERS) {
    if (q.indexOf(dev) !== -1) {
      foundDeviceWords.push(dev);
      var chs = DEVICE_CHAPTERS[dev].ch4;
      for (var ci = 0; ci < chs.length; ci++) foundDeviceChapters[chs[ci]] = true;
      var pchs = DEVICE_CHAPTERS[dev].partsCh4 || [];
      for (var pci = 0; pci < pchs.length; pci++) foundPartsChapters[pchs[pci]] = true;
    }
  }

  // === 配件词检测 ===
  var qAccPatterns = [];
  for (var pi = 0; pi < ACCESSORY_PATTERNS.length; pi++) {
    if (q.indexOf(ACCESSORY_PATTERNS[pi]) !== -1) qAccPatterns.push(ACCESSORY_PATTERNS[pi]);
  }
  // v2.0.1.3 修复:若 DEVICE_CHAPTERS 命中(如"沙发"→9401/9403)，即使无配件词也应注入章节
  // 只有既无配件词也无设备词时才退出
  if (qAccPatterns.length === 0 && foundDeviceWords.length === 0) return null;

  // === 扫描章节 ===
  // 配件查询(设备词+配件词):扫描设备章节+零件章节+3926
  // 纯配件查询(仅有配件词):扫描3926 + 零件章节
  // 「套」类查询 → 屏蔽设备章节(保护套按材质归3926/4202,不归手机零件)
  var scanCh4 = { '3926': true };
  // 皮革材质查询时：fallback 也必须扫描 4202/4203（否则语义候选项不足时 fallback 捞不到皮革商品）
  if (qHasLeatherMat) { scanCh4['4202'] = true; scanCh4['4203'] = true; }
  // 衣物查询（羊皮衫等）:毛皮衣服章 4303 也加入扫描（毛皮衣服归 4303,不归 4202）
  if (qHasLeatherMat && qHasClothing) { scanCh4['4303'] = true; }
  // 新增材质章节扩展（海关"成分归类"法）:按材质词扫描对应章节
  var hasCotton = MATERIAL_COTTON_LINEN.some(function(t) { return q.indexOf(t) !== -1; });
  var hasSilkWool = MATERIAL_SILK_WOOL.some(function(t) { return q.indexOf(t) !== -1; });
  var hasSynthetic = MATERIAL_SYNTHETIC.some(function(t) { return q.indexOf(t) !== -1; });
  var hasMetal = MATERIAL_METAL.some(function(t) { return q.indexOf(t) !== -1; });
  var hasGlass = MATERIAL_GLASS.some(function(t) { return q.indexOf(t) !== -1; });
  var hasPaper = MATERIAL_PAPER.some(function(t) { return q.indexOf(t) !== -1; });
  if (hasCotton) {
    scanCh4['5208'] = true; scanCh4['5209'] = true; scanCh4['5210'] = true;
    scanCh4['5211'] = true; scanCh4['5212'] = true;
    scanCh4['5309'] = true; scanCh4['5310'] = true; scanCh4['5311'] = true;
    scanCh4['50'] = true; // 丝(5001-5007)
    scanCh4['51'] = true; // 羊毛(5101-5113)
  }
  if (hasSilkWool) {
    scanCh4['50'] = true; // 丝
    scanCh4['51'] = true; // 羊毛/羊绒
    scanCh4['4302'] = true; scanCh4['4303'] = true; // 毛皮
  }
  if (hasSynthetic) {
    scanCh4['5407'] = true; scanCh4['5408'] = true; scanCh4['5501'] = true;
    scanCh4['5502'] = true; scanCh4['5503'] = true; scanCh4['5504'] = true;
    scanCh4['5506'] = true; scanCh4['5507'] = true; scanCh4['5508'] = true;
    scanCh4['5402'] = true; scanCh4['5403'] = true; scanCh4['5404'] = true; scanCh4['5405'] = true;
  }
  if (hasMetal) {
    scanCh4['73'] = true; // 钢铁制品(7326/7323等)
    scanCh4['74'] = true; // 铜
    scanCh4['76'] = true; // 铝
    scanCh4['83'] = true; // 贱金属杂项制品
  }
  if (hasGlass) { scanCh4['70'] = true; } // 玻璃及其制品
  if (hasPaper) {
    scanCh4['4801'] = true; scanCh4['4802'] = true; scanCh4['4810'] = true;
    scanCh4['4811'] = true; scanCh4['4820'] = true; scanCh4['4821'] = true; scanCh4['4822'] = true;
  }
  if (foundDeviceWords.length > 0 && !blockDeviceChapter) {
    // v2.0.1.3 修复:设备词命中(包括纯设备词如"沙发",或设备词+配件词如"手机壳")
    // 加入设备章节(整机+零件章节)
    for (var dc in foundDeviceChapters) scanCh4[dc] = true;
    for (var pc in foundPartsChapters) scanCh4[pc] = true;
  } else if (foundDeviceWords.length > 0 && blockDeviceChapter) {
    // 套类查询带设备词(如手机保护套):只扫3926,屏蔽设备章节
    // 但仍扫零件章节兜底(如果设备在3926里有专属零件的话)
    for (var pc in foundPartsChapters) {
      // 仅3926算材质章节,设备专属零件章节不收录
      if (pc === '3926') scanCh4[pc] = true;
    }
  } else if (qAccPatterns.length > 0) {
    // 纯配件查询(有配件词但无设备词):仅扫零件章节(如"零件"单独出现)
    for (var pc in foundPartsChapters) scanCh4[pc] = true;
  }

  // === 章节优先级 ===
  var CHAPTER_BASE_SCORE = {
    '3926': 60,
    '4202': 55,
    '4203': 55,
    '4303': 60,
    '4302': 55,
    '8517': 40,
    '8518': 40,
    '8528': 40,  // 显示设备
    '8443': 40,  // 打印机/复印机
    '8504': 38,  // 充电器/变压器
    '8507': 38,  // 电池
    '8508': 35,  // 吸尘器
    '8509': 35,  // 小家电
    '8516': 35,  // 电热设备
    '8544': 38,  // 数据线/电缆
    '8471': 35,
    '8473': 35,
    '8525': 38,  // 摄像机/摄像头
    '8529': 35,
    '8713': 35,  // 轮椅
    '8714': 30,  // 自行车零件
    '8711': 30,
    '8712': 25,  // 自行车
    '8713': 35,  // 残疾人用车
    '3922': 30,
    '9007': 30,
    '9001': 25,
    '9018': 30,  // 医疗设备
    '9025': 30,  // 体温计等
    '9401': 50,  // 坐具（椅子/沙发等）
    '9403': 50,  // 其他家具及零件
    '9404': 50,  // 床垫/床架等
    '9405': 35,  // 灯具
    '9503': 20,  // 玩具
    '8467': 38,  // 电动工具
    '9111': 25,
    '9110': 20,
    '8708': 20,
    '8806': 20,
    '9004': 15,
    '4011': 10,
    // 纺织/服装章节
    '50': 25, '51': 25, // 丝/羊毛
    '5208': 28, '5209': 28, '5210': 28, '5211': 28, '5212': 28, // 棉布
    '5309': 28, '5310': 28, '5311': 28, // 麻布
    '5407': 28, '5408': 28, '5402': 28, '5403': 28, '5404': 28, '5405': 28, // 化纤
    '5501': 28, '5502': 28, '5503': 28, '5504': 28, '5506': 28, '5507': 28, '5508': 28, // 化纤
    // 金属章节
    '73': 30, '74': 30, '76': 30, '83': 30,
    '70': 25, // 玻璃
    // 纸/文具
    '4801': 20, '4802': 20, '4810': 20, '4811': 20,
    '4820': 35, '4821': 35, '4822': 35,
    '6403': 30, '6404': 28,
    '6504': 25, '6505': 28,
    '6103': 30, '6104': 30, '6105': 30, '6106': 30, '6109': 28,
    '6203': 30, '6204': 30, '6205': 30, '6206': 30,
    '9608': 30,
  };

  // === 黑名单 ===
  var BLACKLIST = [
    '手套','避孕','卫生','口罩','气球','圣诞',
    '火箭','发动机','涡轮','燃气轮机',
    '离心机','过滤机','净化',
    '整套散件',
    '礼品','玩具',
  ];

  // === 配件查询检测:含壳/套/罩时,整机(非零件号)需要降权 ===
  var isAccessoryQuery = qAccPatterns.length > 0;

  // === 零件/部件关键词(整机不含这些,零件号含这些)===
  var PART_KEYWORDS = ['零件','部件','附件','配件','专用件','结构件'];

  // === 3926 泛用品名黑名单(无设备词时不应用来匹配手机壳/电脑壳等)===
  // 这些品名与"手机/电脑"无关,出现在设备配件搜索里会干扰
  var CH3926_GENERIC_BLACKLIST = [
    '办公室','学校','衣服','衣着','家具','车厢',
    '小雕塑','装饰品','手套','避孕','机器','仪器',
    '两用物项','马桶','座圈','椅',
  ];
  // 3926 里与设备配件相关的正面关键词(命中则保留)
  var CH3926_DEVICE_KEYWORDS = [
    '电子','通信','电气','电器','光纤','光缆',
    '手机','电话','计算机','电脑','终端','仪表',
    '机','壳','罩','盒','匣','塞','堵','封','壳体',
  ];

  // === 扫描 allData ===
  var scored = [];
  for (var i = 0; i < allData.length; i++) {
    var item = allData[i];
    var code = String(item.code || '');
    var ch4 = code.substring(0, 4);
    if (!scanCh4[ch4]) continue;

    var name = String(item.name || '').toLowerCase();

    var blacklisted = false;
    for (var bi = 0; bi < BLACKLIST.length; bi++) {
      if (name.indexOf(BLACKLIST[bi]) !== -1) { blacklisted = true; break; }
    }
    if (blacklisted) continue;

    var chScore = CHAPTER_BASE_SCORE[ch4] || 10;
    // 衣物查询时:4202(钱包/箱包/容器)与衣服无关 → 大幅降权;4303/4203 衣服章 → 加分
    if (qHasClothing && ch4 === '4202') chScore -= 45;
    if (qHasClothing && (ch4 === '4303' || ch4 === '4203')) chScore += 10;

    // 配件词命中:品名含配件词（仅内部评分用，不写入 matched 标签暴露给用户）
    var accScore = 0;
    for (var ai = 0; ai < ACCESSORY_PATTERNS.length; ai++) {
      if (name.indexOf(ACCESSORY_PATTERNS[ai]) !== -1) {
        accScore += (ACCESSORY_PATTERNS[ai].length >= 2 ? 20 : 8);
      }
    }

    // 设备词命中:品名含设备名
    var devScore = 0;
    if (foundDeviceWords.length > 0) {
      for (var di = 0; di < foundDeviceWords.length; di++) {
        if (name.indexOf(foundDeviceWords[di]) !== -1) { devScore = 30; break; }
      }
      // 家具章节(9401/9403/9404)特殊:查询词本身含设备词(如"沙发")时,
      // 整机品名含"坐具"不含"沙发"，devScore 仍应计入
      if (devScore === 0) {
        var isFurnitureCh = (ch4 === '9401' || ch4 === '9403' || ch4 === '9404');
        if (isFurnitureCh) { devScore = 30; }
      }
    }

    var ruleScore = chScore + accScore + devScore;

    // === isPartCode 标记:品名含"零件/部件/附件"(兜底品名特征,排序优先)===
    var isPartCode = (
      name.indexOf('零件') !== -1 ||
      name.indexOf('部件') !== -1 ||
      name.indexOf('附件') !== -1
    );

    // 零件品名额外加分(零件名称优先于任何具体件)
    if (isPartCode) ruleScore += 15;

    // 皮革材质查询时:4202/4203 品名含「套」字额外加分(+40)
    // 皮革章节无配件词命中时,套类品名是皮革保护套的核心特征(如"皮革手机套")
    if (qHasLeatherMat && accScore === 0 && (ch4 === '4202' || ch4 === '4203')) {
      var sleeveNameTerms = ['套','袋','罩','壳'];
      for (var sli = 0; sli < sleeveNameTerms.length; sli++) {
        if (name.indexOf(sleeveNameTerms[sli]) !== -1) {
          ruleScore += 40;
          break;
        }
      }
    }

    // 3926 章节特殊处理:过滤泛用品名
    if (ch4 === '3926') {
      var isGenericName = false;
      for (var gi = 0; gi < CH3926_GENERIC_BLACKLIST.length; gi++) {
        if (name.indexOf(CH3926_GENERIC_BLACKLIST[gi]) !== -1) {
          isGenericName = true;
          break;
        }
      }
      if (isGenericName && isAccessoryQuery) continue;
      if (accScore === 0 && foundDeviceWords.length === 0) continue;
    } else {
      // 零件章节(不含配件词的设备章节):零件兜底号强制入选
      // 例:搜"手机壳" → 85.17 章节的 8517799000(零件兜底)应出现
      // 判断:当前章节在 foundPartsChapters 里(零件章节)
      var isPartsChapter = !!foundPartsChapters[ch4];
      if (isPartsChapter && accScore === 0 && devScore === 0) {
        // 品名含"零件/部件/附件/用"的零件章节商品才入选
        var isPartLike = (
          name.indexOf('零件') !== -1 ||
          name.indexOf('部件') !== -1 ||
          name.indexOf('附件') !== -1 ||
          name.indexOf('用') !== -1
        );
        if (!isPartLike) continue;
      } else if (accScore === 0 && devScore === 0) {
        // 家具章节(9401/9403/9404):chapter 50分本身就是入选依据，
        // "带软垫的坐具"等整机品名不含"沙发"字但应被召回
        var isFurnitureChapter = (ch4 === '9401' || ch4 === '9403' || ch4 === '9404');
        if (!isFurnitureChapter) continue;
        // 家具章节:品名必须含'用'字才算整机(排除"家具的零件"等纯零件兜底)
        var isFurnitureLike = (
          name.indexOf('用') !== -1 ||
          name.indexOf('制') !== -1 ||
          name.indexOf('坐具') !== -1 ||
          name.indexOf('家具') !== -1
        );
        if (!isFurnitureLike) continue;
      }
    }

    // === 整机惩罚:配件查询 + 品名含设备词 + 品名不含"用/零件/部件" → 整机降权 ===
    // 关键区分:
    //   - 整机品名:"智能手机" / "平板电脑"(无"用"字)
    //   - 零件品名:"...用(天线除外)" / "...的零件" / "...部件"
    // 规则六:零件号应排在整机之前,所以零件品名不扣分
    var penalty = 0;
    // 「套」类查询:套是保护用品不是设备零件,整机也要降权
    // 但皮革/塑料材质章节(4202/4203/3926等)不受此惩罚,它们本身就是正确的归类
    if (blockDeviceChapter && ch4 !== '4202' && ch4 !== '4203') {
      penalty = -25;
    } else if (isAccessoryQuery && devScore > 0) {
      var hasPart = false;
      // 检查零件关键词
      for (var pk = 0; pk < PART_KEYWORDS.length; pk++) {
        if (name.indexOf(PART_KEYWORDS[pk]) !== -1) { hasPart = true; break; }
      }
      // 或者品名含"用"字(用途描述 = 零件品名特征,如"手持电话机用(天线除外)")
      if (name.indexOf('用') !== -1) hasPart = true;

      if (!hasPart) {
        // 无人机整机免罚:搜"无人机套"时无人机整机本身可能相关
        var isDroneDevice = false;
        for (var dd = 0; dd < foundDeviceWords.length; dd++) {
          if (foundDeviceWords[dd] === '无人机' || foundDeviceWords[dd] === '航拍' || foundDeviceWords[dd] === '遥控飞机') {
            isDroneDevice = true; break;
          }
        }
        if (isDroneDevice && ch4 === '8806') {
          // 无人机整机(8806章节)不降权
        } else {
          penalty = -25;
        }
      }

      // 家具章节整机查询时:含"坐具的零件"等描述的零件品名降权
      // "坐具的零件"的 ruleScore(95) 会盖过整机"装软垫的坐具"(80)，
      // 但实际归类时用户搜"沙发"想要的是整机而非零件描述
      if (foundDeviceWords.length > 0 && !isAccessoryQuery) {
        var hasPartWord = false;
        for (var fp = 0; fp < PART_KEYWORDS.length; fp++) {
          if (name.indexOf(PART_KEYWORDS[fp]) !== -1) { hasPartWord = true; break; }
        }
        if (hasPartWord) {
          // 品名同时含"坐具/家具"类描述 → 这是"坐具的零件"类降权
          var furnitureDesWords = ['坐具','家具','床垫','床架','支架','框架'];
          var hasFurnDes = false;
          for (var fdi = 0; fdi < furnitureDesWords.length; fdi++) {
            if (name.indexOf(furnitureDesWords[fdi]) !== -1) { hasFurnDes = true; break; }
          }
          if (hasFurnDes && name.indexOf('零件') !== -1) penalty = -25;
        }
      }
    }

    var wi = ctx.getItemWeight ? ctx.getItemWeight(item.code, item.name) : { likes: 0, dislikes: 0, weight: 0 };
    scored.push({
      item: item,
      ruleScore: ruleScore + penalty,
      rawScore: ruleScore,
      ch4: ch4,
      accScore: accScore,
      devScore: devScore,
      penalty: penalty,
      isPartCode: isPartCode || false,
      matched: null,  // matched 标签改为语义搜索私有，ruleBasedSearch 不暴露配件词
      likes: (wi.likes || 0),
      dislikes: (wi.dislikes || 0),
      weight: (wi.weight || 0)
    });
  }

  if (scored.length === 0) return null;

  scored.sort(function(a, b) {
    // 第一优先级:ruleScore(含 penalty)
    if (b.ruleScore !== a.ruleScore) return b.ruleScore - a.ruleScore;
    // 第二优先级:配件词命中越多越好
    return b.accScore - a.accScore;
  });

  var top = scored.slice(0, 12);
  var maxRS = top[0].ruleScore || 1;
  var results = [];
  for (var k = 0; k < top.length; k++) {
    var s2 = top[k];
    var processed = ctx.processItem(s2.item);
    processed.likeCount = s2.likes;
    processed.dislikeCount = s2.dislikes;
    processed.weight = s2.weight;
    processed.score = Math.round(65 + (s2.ruleScore / maxRS) * 30);
    processed.matched = s2.matched;
    processed.isRuleMatch = true;
    results.push(processed);
  }
  return results;
}

// 语义搜索主函数
// ctx: { allData, codeMap, hsIndex, hsSynonyms, expandMap, processItem, getItemWeight }
// 返回 results 数组(含 score 0-100, matched 匹配词, likeCount, weight),无结果返回 null
// 当语义结果 < 3 条时,自动触发规则增强 fallback
function semanticSearch(keyword, ctx) {
  var allData = ctx.allData;
  var codeMap = ctx.codeMap;
  var hsIndex = ctx.hsIndex;
  var hsSynonyms = ctx.hsSynonyms;
  var expandMap = ctx.expandMap;

  if (!allData || !hsIndex || !hsSynonyms || !hsIndex.index) return null;
  var q = String(keyword || '').trim().toLowerCase();
  if (!q) return null;

  // === 配件查询检测（须在同义词扩展前执行，以决定扩展策略）===
  var ACC_Q_PATTERNS = ['壳','套','罩','盖','匣'];
  var isAccQuery = false;
  for (var ap = 0; ap < ACC_Q_PATTERNS.length; ap++) {
    if (q.indexOf(ACC_Q_PATTERNS[ap]) !== -1) { isAccQuery = true; break; }
  }
  // 壳类 vs 套类语义区分
  var SHELL_Q = ['壳','外壳','壳体'];
  var SLEEVE_Q = ['保护套','护套','防尘套','软套','硅胶套','防水套'];
  var qHasShellSemantic = false;
  for (var sqi = 0; sqi < SHELL_Q.length; sqi++) {
    if (q.indexOf(SHELL_Q[sqi]) !== -1) { qHasShellSemantic = true; break; }
  }
  var qHasSleeveSemantic = false;
  for (var svqi = 0; svqi < SLEEVE_Q.length; svqi++) {
    if (q.indexOf(SLEEVE_Q[svqi]) !== -1) { qHasSleeveSemantic = true; break; }
  }
  // 「套」类查询（不带壳）→ 屏蔽设备章节结果
  // 关键：禁用「部分包含」的同义词展开，避免「手机保护套」因含「手机」而展开全部手机组扩展词
  var isSleeveQuery = qHasSleeveSemantic && !qHasShellSemantic;

  // 1. 同义词扩展
  var expanded = {};
  // 原始查询词必须参与匹配（"书包"即使在同义词组里也要搜索自己）
  expanded[q] = true;
  if (expandMap[q]) {
    for (var e = 0; e < expandMap[q].length; e++) {
      // 同组词加入，但原始词保留为 true（防止"书包"→同义词组→"书包"被覆盖为 false）
      if (expandMap[q][e] !== q) expanded[expandMap[q][e]] = true;
    }
  }
  // 部分包含匹配：仅当"查询词包含已知同义词"时展开其同组（如"手机壳"含"手机"）
  // 注意：不做反向扩展（term 包含 query），否则"苹果"会被"苹果线"反向污染
  // 关键修复：套类查询禁用此展开，防止「手机保护套」展开「手机」组导致85章污染
  if (!isSleeveQuery) {
    for (var term in expandMap) {
      if (q.indexOf(term) !== -1) {
        var grp = expandMap[term];
        for (var g = 0; g < grp.length; g++) expanded[grp[g]] = true;
      }
    }
  }
  // 2. 倒排索引取候选 + 品名/别名子串召回(覆盖索引未收录的查询词,如"摩托")
  var candidateCodes = {};
  for (var t in expanded) {
    var codes = hsIndex.index[t];
    if (codes && codes.length) {
      for (var c = 0; c < codes.length; c++) candidateCodes[codes[c]] = true;
    }
  }
  // 品名或别名包含 q 的商品也进入候选（扩充索引缺口）
  // 放宽条件:候选<5 或 候选为空 或 最佳候选品名不包含查询词（"书包"→4202"箱包"不含"书包"→强制全量 fallback）
  var topCodes = Object.keys(candidateCodes).slice(0, 3);
  var bestHasQuery = topCodes.some(function(code) {
    var item = codeMap ? codeMap[code] : null;
    if (!item) return false;
    return String(item.name || '').toLowerCase().indexOf(q) !== -1;
  });
  if (allData.length <= 4000 || Object.keys(candidateCodes).length < 5 || Object.keys(candidateCodes).length === 0 || !bestHasQuery) {
    for (var n = 0; n < allData.length; n++) {
      var it = allData[n];
      if (candidateCodes[it.code]) continue;
      var nm = String(it.name || '').toLowerCase();
      if (nm.indexOf(q) !== -1) { candidateCodes[it.code] = true; continue; }
      var als = it.a;
      if (als && als.length) {
        for (var ai = 0; ai < als.length; ai++) {
          if (String(als[ai] || '').toLowerCase().indexOf(q) !== -1) { candidateCodes[it.code] = true; break; }
        }
        if (candidateCodes[it.code]) continue;
      }
      // 增强兜底: 两阶段召回
      // 阶段1: bigram — 相邻两字组合（"摩托"→"摩托车"、"数学"→"数学计算器具"）
      // 阶段2: 单字重叠 — 同义词词典已将"数学簿"→"练习本"，此时 bigram"数学"在"练习本"不命中，
      //           触发单字重叠召回；2字查询阈值=2，3字≥2，4字+≥3，避免"皮衣"等宽泛单字召太多
      var qLen = q.length;
      if (qLen >= 2) {
        var isChinese = /[\u4e00-\u9fa5]/.test(q);
        if (isChinese) {
          // 阶段1: bigram 精确匹配
          for (var bi = 0; bi < qLen - 1; bi++) {
            var bigram = q.substring(bi, bi + 2);
            if (nm.indexOf(bigram) !== -1) { candidateCodes[it.code] = true; break; }
          }
          // 阶段2: 单字重叠（仅当 bigram 未命中时）
          if (!candidateCodes[it.code]) {
            var matched = 0;
            for (var ci = 0; ci < qLen; ci++) {
              if (nm.indexOf(q[ci]) !== -1) matched++;
            }
            var threshold = qLen === 2 ? 2 : qLen === 3 ? 2 : 3;
            if (matched >= threshold) { candidateCodes[it.code] = true; }
          }
        } else {
          // 英文: 空格分词后全词匹配
          var words = q.split(/\s+/);
          words.forEach(function(w) {
            if (w.length >= 2 && nm.indexOf(w) !== -1) { candidateCodes[it.code] = true; }
          });
        }
      }
    }
  }
  // 皮革材质检测:皮革制品(4202/4203等)品名不含完整"皮革+套"组合,但d字段含"手机套"
  // 只要query含皮革材质词,就触发皮革章节候选召回(不限isSleeveQuery)
  var MATERIAL_LEATHER = ['皮革','pu皮','pvc皮','真皮','再生皮','头层皮','二层皮','牛皮','羊皮','猪皮','头层','二层'];
  var MATERIAL_COTTON_LINEN = ['棉','麻','竹纤维','竹浆','棉布','麻布','竹布'];
  var MATERIAL_SILK_WOOL = ['丝','真丝','丝绸','羊毛','羊绒','驼绒','兔毛','貂毛','驼毛','马海毛'];
  var MATERIAL_SYNTHETIC = ['化纤','涤纶','腈纶','锦纶','尼龙','氨纶','丙纶','维纶','氯纶','聚酯','聚酰胺','人造纤维','合成纤维','涤棉','棉纶','锦纶丝'];
  var MATERIAL_PLASTIC_RUBBER = ['塑料','硅胶','PVC','TPU','TPE','PU','橡胶','乳胶','TPR'];
  var MATERIAL_METAL = ['钢','铁','铜','铝','锌','镍','钛','不锈钢','合金'];
  var MATERIAL_GLASS = ['玻璃','钢化','石英','水晶'];
  var MATERIAL_PAPER = ['纸','纸板','卡纸','铜版纸','牛皮纸','瓦楞'];
  var leatherTermsQ = MATERIAL_LEATHER;
  var qHasLeatherMat = leatherTermsQ.some(function(t) { return q.indexOf(t) !== -1; });
  // 兼容"皮革制""真皮制"等"材质+制"查询形式：去掉末尾"制"后检测是否为材质词
  if (!qHasLeatherMat) {
    var qTrimZhi = q.replace(/制$/, '');
    if (qTrimZhi !== q && qTrimZhi.length >= 2) {
      qHasLeatherMat = leatherTermsQ.some(function(t) {
        return qTrimZhi.indexOf(t) !== -1 || t.indexOf(qTrimZhi) !== -1;
      });
    }
  }
  var plasticTermsQ = MATERIAL_PLASTIC_RUBBER;
  var qHasPlasticMat = plasticTermsQ.some(function(t) { return q.indexOf(t) !== -1; });

  // === 衣物词检测（与 ruleBasedSearch 保持一致:无单字'衣',防误伤'衣箱'）===
  var CLOTHING_KEYWORDS = ['衫','服','衣服','衣物','上衣','皮衣','大衣','棉衣','毛衣','衬衣','外衣','内衣','风衣','夹克','外套','马甲','背心','裤','裙','围巾','斗篷'];
  var qHasClothing = false;
  for (var cki = 0; cki < CLOTHING_KEYWORDS.length; cki++) {
    if (q.indexOf(CLOTHING_KEYWORDS[cki]) !== -1) { qHasClothing = true; break; }
  }

  // 皮革/塑料材质查询:皮革材质直接注入4202/4203全部商品(不再依赖d字段的严格检查,
  // 因为4202310090品名为"皮革手机套",d="以皮革...皮革手机套","套"被"皮革"包裹导致dHasRealSleeve=false)
  // 皮革查询时章节过滤会限制4202/4203,评分层再过滤高分结果,噪声可控
  if (qHasLeatherMat || qHasPlasticMat) {
    var leatherTerms2 = ['皮革','pu皮','pvc皮','真皮','再生皮'];
    var plasticTerms2 = ['塑料','硅胶','PVC','TPU','TPE','PU'];
    for (var lix = 0; lix < allData.length; lix++) {
      var lit = allData[lix];
      if (candidateCodes[lit.code]) continue;
      var ch4 = String(lit.code).substring(0, 4);
      var isLeatherChapter = ch4 === '4202' || ch4 === '4203' || (qHasClothing && ch4 === '4303');
      var isPlasticChapter = ['3926','3923','3921','3922','3924','3925'].indexOf(ch4) !== -1;
      if (!(qHasLeatherMat && isLeatherChapter) && !(qHasPlasticMat && isPlasticChapter)) continue;
      // 皮革材质查询:直接注入所有4202/4203商品,不再做d字段的套类品名检查
      if (qHasLeatherMat) {
        candidateCodes[lit.code] = true;
      }
      // 塑料材质查询:保持原有逻辑(d字段含材质+套类品名)
      if (qHasPlasticMat) {
        var lnm = String(lit.name || '').toLowerCase();
        var hasPlasticInName = plasticTerms2.some(function(t) { return lnm.indexOf(t) !== -1; });
        var dLower = lit.d ? String(lit.d).toLowerCase() : '';
        var sleeveSpecificTerms = ['手机','平板','电脑','相机','手表','钱夹','钱包'];
        var dHasMaterial = plasticTerms2.some(function(t) { return dLower.indexOf(t) !== -1; });
        var dHasRealSleeve = dLower.indexOf('套') !== -1 && sleeveSpecificTerms.some(function(t) { return dLower.indexOf(t) !== -1; });
        if (hasPlasticInName || (dHasMaterial && dHasRealSleeve)) {
          candidateCodes[lit.code] = true;
        }
      }
    }
  }
  // 配件查询检测已在同义词扩展前完成（isAccQuery / isSleeveQuery 变量已定义）

  if (Object.keys(candidateCodes).length === 0) return null;

  var totalDocs = hsIndex.total_docs || allData.length;
  var expandedArr = Object.keys(expanded);

  // 3. 候选评分
  var scored = [];
  for (var code in candidateCodes) {
    var item = codeMap ? codeMap[code] : null;
    if (!item) continue;
    var name = String(item.name || '').toLowerCase();
    var aliases = [];
    if (item.a && item.a.length) {
      for (var ai = 0; ai < item.a.length; ai++) aliases.push(String(item.a[ai] || '').toLowerCase());
    }
    var cov = nameCoverage(name, q);
    var score = 0;
    var matched = [];
    // 套类查询或皮革材质查询:只保留材质章节,排除设备/玻璃/光学等章节
    // 皮革/PU/PVC → 皮革章节; 塑料 → 塑料章节; 无材质 → 所有材质章节
    if (isSleeveQuery || qHasLeatherMat) {
      var ch4 = String(code).substring(0, 4);
      var leatherTerms2 = ['皮革','pu皮','pvc皮','真皮','再生皮','头层皮','二层皮','牛皮','羊皮','猪皮'];
      var hasLeather2 = leatherTerms2.some(function(t) { return q.indexOf(t) !== -1; });
      var plasticTerms2 = ['塑料','硅胶','PVC','TPU','TPE','PU'];
      var hasPlastic2 = plasticTerms2.some(function(t) { return q.indexOf(t) !== -1; });
      var materialChList;
      if (hasLeather2) {
        materialChList = ['4202', '4203', '5001', '5002', '5003', '5004', '5005', '5006', '5007',
                          '5101', '5102', '5103', '5104', '5105', '5106', '5107', '5108', '5109', '5110', '5111', '5112', '5113'];
        // 衣物查询（羊皮衫等）:毛皮衣服章 4303 加入材质章节列表（毛皮衣服归 4303 而非 4202）
        if (qHasClothing) materialChList.push('4303');
      } else if (hasPlastic2) {
        materialChList = ['3926', '3923', '3921', '3922', '3924', '3925'];
      } else {
        materialChList = ['3926', '3923', '4202', '4203', '6117', '6116', '4016', '4817', '4602', '4419', '4823', '5901'];
      }
      if (materialChList.indexOf(ch4) === -1) continue;
    }
    // 皮革材质查询：皮革章节商品（4202/4203,衣物查询时含4303）通过 leatherChapterScan 注入，无 index 命中词 → 直接给章节基础分
    if (qHasLeatherMat && (ch4 === '4202' || ch4 === '4203' || (qHasClothing && ch4 === '4303'))) {
      var isLeatherChapterItem = candidateCodes[code] &&
        (String(code).substring(0, 4) === '4202' || String(code).substring(0, 4) === '4203' ||
         (qHasClothing && String(code).substring(0, 4) === '4303'));
      if (isLeatherChapterItem && score === 0) {
        if (qHasClothing && ch4 === '4202') {
          // 衣物查询:4202 是钱包/箱包/容器等,与衣服无关 → 低基础分垫底
          score = 5;
          matched.push('非衣物章');
        } else {
          // name 含「套/袋/罩/壳」→ 皮革保护套核心品名
          var sleeveNameTerms2 = ['套', '袋', '罩', '壳'];
          var hasSleeveInName = sleeveNameTerms2.some(function(st) { return name.indexOf(st) !== -1; });
          // 衣物查询:4303(毛皮衣服)/4203(皮革衣服)品名含衣/服词 → 高基础分
          var isClothingName = qHasClothing && CLOTHING_KEYWORDS.some(function(ck) { return name.indexOf(ck) !== -1; });
          if (isClothingName) {
            // 毛皮衣服章(4303)基础分略高于皮革衣服章(4203):羊皮衫等带毛皮衣物按规则一/三归 43 章
            score = (ch4 === '4303') ? 62 : 58;
            matched.push('衣物章节');
          } else {
            score = hasSleeveInName ? 50 : 25;
            matched.push('皮革章节');
            if (hasSleeveInName) matched.push('套类品名');
          }
        }
      }
    }
    for (var i = 0; i < expandedArr.length; i++) {
      var term2 = expandedArr[i];
      var df = (hsIndex.index[term2] || []).length;
      var idf = bm25Idf(df, totalDocs);
      var termMatched = false;

      // 别名精确命中(口语关键词与商品别名完全一致)
      for (var j = 0; j < aliases.length; j++) {
        if (aliases[j] === term2) {
          score += idf * W_ALIAS_EXACT;
          matched.push(term2);
          termMatched = true;
          break;
        }
      }
      // 别名子串命中(巧合匹配,降权)
      if (!termMatched) {
        for (var j2 = 0; j2 < aliases.length; j2++) {
          if (aliases[j2].indexOf(term2) !== -1) {
            score += idf * W_ALIAS_SUB;
            matched.push(term2);
            termMatched = true;
            break;
          }
        }
      }
      // 索引命中:term 直接映射到该商品(核心信号,覆盖 a 字段缺失的口语别名)
      var idxCodes = hsIndex.index[term2];
      if (idxCodes && idxCodes.indexOf(code) !== -1) {
        score += idf * W_INDEX;
        if (!termMatched) { matched.push(term2); termMatched = true; }
      }
      // 名称匹配:精确 > 子串,权重高于别名
      if (term2 === name) {
        score += idf * W_NAME_EXACT;
        if (!termMatched) { matched.push(term2); termMatched = true; }
      } else if (name.indexOf(term2) !== -1) {
        score += idf * W_NAME_SUB;
        if (!termMatched) { matched.push(term2); termMatched = true; }
      }
    }

    if (score > 0) {
      // 皮革材质查询:d字段精准含"手机套"类具体品名时+80分
      // 衣物查询(qHasClothing)禁用:钱包/箱包类 d 字段含"钱包""套"等词会误加分,把非衣物章拉高(羊皮衫误出钱包)
      if (qHasLeatherMat && !qHasClothing && item.d) {
        var dText2 = String(item.d || '').toLowerCase();
        var dHasLeather2 = ['皮革','pu皮','pvc皮','真皮','再生皮'].some(function(t) { return dText2.indexOf(t) !== -1; });
        var dHasRealSleeve2 = dText2.indexOf('套') !== -1 &&
          (dText2.indexOf('手机') !== -1 || dText2.indexOf('平板') !== -1 ||
           dText2.indexOf('电脑') !== -1 || dText2.indexOf('相机') !== -1 ||
           dText2.indexOf('手表') !== -1 || dText2.indexOf('钱夹') !== -1 || dText2.indexOf('钱包') !== -1);
        if (dHasLeather2 && dHasRealSleeve2) {
          score += 80;
          matched.push('申报要素匹配');
        }
      }
      // 点赞加权(计数唯一来源 GitHub,netLikes = 赞 - 踩)
      var wi = ctx.getItemWeight ? ctx.getItemWeight(item.code, item.name) : { likes: 0, dislikes: 0, weight: 0 };
      var netLikes = Math.max(0, (wi.likes || 0) - (wi.dislikes || 0));
      var likeMul = 1 + Math.min(netLikes, LIKE_CAP) * LIKE_W;
      // 名称覆盖度放大:query 占品名字数越多,分数越高
      var covMul = 1 + COVERAGE_W * cov;
      // 配件查询模式:整机降权(品名含设备词但不含"用/零件/部件")
      // 衣物查询(qHasClothing)禁用:衣服不是配件,'外套/裙'等含'套'字会误触发降权
      var penalty = 0;
      if (isAccQuery && !qHasClothing) {
        var hasPart = (name.indexOf('用') !== -1 ||
          name.indexOf('零件') !== -1 ||
          name.indexOf('部件') !== -1 ||
          name.indexOf('附件') !== -1);
        // 简单判断:含"的"字 = 零件品名特征(如"手机的零件"、"手持电话机用的")
        // 整机品名一般不含"的"(如"智能手机")
        // 但更准确:含"用"字直接不扣分;其余含"的"则可能是品名结构特征
        // 直接用"用"判断即可
        if (!hasPart) penalty = -25;
      }
      // 壳类查询:设备章节候选加分(手机壳→8517 优先)
      var bonus = 0;
      var isShellQuery = qHasShellSemantic && !qHasSleeveSemantic;
      if (isShellQuery) {
        var ch4 = String(item.code).substring(0, 4);
        var deviceChList = ['8517', '8471', '8473', '8518', '8519', '9007', '9001', '9111', '9110', '9112', '9004', '8708', '8806', '8507', '9006'];
        if (deviceChList.indexOf(ch4) !== -1) {
          bonus = 120; // 设备章节壳类候选高分加分(抵消 3926 别名匹配)
        }
      }
      var finalRaw = (score * covMul * likeMul) + penalty + bonus;
      scored.push({
        item: item,
        score: finalRaw,
        rawScore: score * covMul * likeMul,
        penalty: penalty,
        matched: matched,
        likes: (wi.likes || 0),
        dislikes: (wi.dislikes || 0),
        weight: netLikes,
        cov: cov
      });
    }
  }

  if (scored.length === 0) return null;
  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.rawScore - a.rawScore; // penalty 相同时 rawScore 高的排前
  });
  var maxScore = scored[0].score || 1;

  var results = [];
  for (var k = 0; k < scored.length && k < 20; k++) {
    var s = scored[k];
    var processed = ctx.processItem(s.item);
    processed.likeCount = s.likes;
    processed.dislikeCount = s.dislikes;
    processed.weight = s.weight;
    processed.score = Math.min(100, Math.max(1, Math.round((s.score / maxScore) * 100)));
    processed.matched = s.matched;
    processed.cov = s.cov;
    results.push(processed);
  }
  return results;
}

// Fallback: 语义结果 < 3 条时,触发规则增强搜索并合并
// 解决"手机壳/电脑壳"等口语词在倒排索引和品名中均无"壳"字的问题
// 手机壳 → 8517(通信设备)/8471(计算机)/3926(塑料零件)
// 电脑壳 → 8471/3926/4202
// 规则分低于语义最后一名,isRuleMatch 标记用于 UI 区分
function ruleFallback(keyword, ctx) {
  var ruleResults = ruleBasedSearch(keyword, ctx);
  if (!ruleResults || ruleResults.length === 0) return null;
  var existCodes = {};
  for (var ri = 0; ri < ctx.existingResults.length; ri++) existCodes[ctx.existingResults[ri].code] = true;
  var lastScore = ctx.existingResults.length > 0 ? ctx.existingResults[ctx.existingResults.length - 1].score : 99;
  var added = [];
  for (var rj = 0; rj < ruleResults.length; rj++) {
    if (!existCodes[ruleResults[rj].code]) {
      ruleResults[rj].score = Math.max(1, lastScore - 1);
      ruleResults[rj].isRuleMatch = true;
      added.push(ruleResults[rj]);
    }
  }
  return added;
}

  // 零结果保底兜底（绝对不返回空结果）
  // 触发条件:所有语义/规则路径均无结果
  // 策略:按材质/用途关键词猜测章节,扫描该章节全部品名,按品名字符覆盖率排序
  function zeroResultFallback(keyword, ctx) {
    var q = String(keyword || '').trim().toLowerCase();
    if (!q) return null;

    // 扩展材质词表（与 ruleBasedSearch 保持一致）
    var allMaterialTerms = (MATERIAL_LEATHER || [])
      .concat(MATERIAL_COTTON_LINEN || [])
      .concat(MATERIAL_SILK_WOOL || [])
      .concat(MATERIAL_SYNTHETIC || [])
      .concat(MATERIAL_PLASTIC_RUBBER || [])
      .concat(MATERIAL_METAL || [])
      .concat(MATERIAL_GLASS || [])
      .concat(MATERIAL_PAPER || []);

    var materialChMap = {
      '4202': MATERIAL_LEATHER, '4203': MATERIAL_LEATHER, '4303': MATERIAL_LEATHER,
      '3926': MATERIAL_PLASTIC_RUBBER, '3923': MATERIAL_PLASTIC_RUBBER,
      '3921': MATERIAL_PLASTIC_RUBBER, '3922': MATERIAL_PLASTIC_RUBBER,
      '3924': MATERIAL_PLASTIC_RUBBER, '3925': MATERIAL_PLASTIC_RUBBER,
      '5208': MATERIAL_COTTON_LINEN, '5209': MATERIAL_COTTON_LINEN,
      '5309': MATERIAL_COTTON_LINEN,
      '50': MATERIAL_SILK_WOOL, '51': MATERIAL_SILK_WOOL,
      '5407': MATERIAL_SYNTHETIC, '5408': MATERIAL_SYNTHETIC,
      '5501': MATERIAL_SYNTHETIC,
      '73': MATERIAL_METAL, '74': MATERIAL_METAL, '76': MATERIAL_METAL,
      '70': MATERIAL_GLASS,
      '4820': MATERIAL_PAPER, '4821': MATERIAL_PAPER, '4822': MATERIAL_PAPER,
    };

    // 尝试猜测试图扫描的章节
    var guessChapters = [];
    for (var ch in materialChMap) {
      var terms = materialChMap[ch];
      for (var ti = 0; ti < terms.length; ti++) {
        if (q.indexOf(terms[ti]) !== -1) {
          guessChapters.push(ch);
          break;
        }
      }
    }
    // 如果没有材质词，尝试书/教育类关键词
    if (guessChapters.length === 0) {
      var BOOK_KEYWORDS = ['书', '本', '册', '簿', '教材', '课本', '教辅', '字典', '词典', '辞典', '杂志', '报刊', '报纸', '日历', '贴纸', '练习', '作业'];
      for (var bk = 0; bk < BOOK_KEYWORDS.length; bk++) {
        if (q.indexOf(BOOK_KEYWORDS[bk]) !== -1) {
          guessChapters = ['4901', '4902', '4903', '4904', '4905', '4820', '4821', '4822'];
          break;
        }
      }
    }
    // 如果还是没有，扫描通用章节
    if (guessChapters.length === 0) {
      guessChapters = ['3926', '4202', '4203', '8471', '8517', '4820', '6109', '6403', '8544'];
    }

    var scored = [];
    var allData = ctx.allData;
    for (var i = 0; i < allData.length; i++) {
      var item = allData[i];
      var ch4 = String(item.code || '').substring(0, 4);
      // 精准章节匹配优先（章节基础分+1.0，保证章节匹配商品永远在全量兜底之前）
      var chMatch = guessChapters.some(function(gc) {
        return ch4 === gc || (gc.length === 2 && ch4.substring(0, 2) === gc);
      });
      if (!chMatch) continue;

      var nm = String(item.name || '').toLowerCase();
      // 按字符覆盖率评分 + 章节基础分
      var cov = nameCoverage(nm, q);
      // 也接受单字符重叠匹配（如「语文书」含「书」→ 匹配品名「书籍」）
      var charOverlap = false;
      if (cov === 0 && q.length >= 1 && nm.length >= 1) {
        for (var ci = 0; ci < q.length; ci++) {
          if (nm.indexOf(q[ci]) !== -1) { charOverlap = true; break; }
        }
      }
      if (cov > 0 || charOverlap) {
        scored.push({ item: item, score: (cov > 0 ? cov : 0.3) + 1.0, fromGuessChapter: true });
      }
    }

    // 如果猜测章节没有命中，扫全量（低优先级）
    if (scored.length === 0) {
      for (var j = 0; j < allData.length; j++) {
        var it2 = allData[j];
        var nm2 = String(it2.name || '').toLowerCase();
        var cov2 = nameCoverage(nm2, q);
        var charOverlap2 = false;
        if (cov2 === 0 && q.length >= 1 && nm2.length >= 1) {
          for (var ci2 = 0; ci2 < q.length; ci2++) {
            if (nm2.indexOf(q[ci2]) !== -1) { charOverlap2 = true; break; }
          }
        }
        if (cov2 > 0 || charOverlap2) {
          scored.push({ item: it2, score: (cov2 > 0 ? cov2 : 0.3), fromGuessChapter: false });
        }
      }
    }

    if (scored.length === 0) return null;

    scored.sort(function(a, b) { return b.score - a.score; });
    var maxS = scored[0].score || 1;
    var results = [];
    var limit = 10;
    for (var k = 0; k < Math.min(scored.length, limit); k++) {
      var s = scored[k];
      var processed = ctx.processItem(s.item);
      processed.score = Math.min(100, Math.max(1, Math.round((s.score / maxS) * 80)));
      processed.matched = ['零结果兜底'];
      processed.isZeroResultFallback = true;
      results.push(processed);
    }
    return results;
  }

module.exports = {
  bm25Idf: bm25Idf,
  buildExpandMap: buildExpandMap,
  nameCoverage: nameCoverage,
  semanticSearch: semanticSearch,
  ruleBasedSearch: ruleBasedSearch,
  ruleFallback: ruleFallback,
  zeroResultFallback: zeroResultFallback
};
