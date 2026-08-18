// [comment removed]
// [comment removed]
// [comment removed]

// [comment removed]
// [comment removed]
var W_ALIAS_EXACT = 3.0;
// [comment removed]
var W_ALIAS_SUB = 0.3;
// [comment removed]
var W_INDEX = 1.0;
// [comment removed]
var W_NAME_EXACT = 2.0;
// [comment removed]
var W_NAME_SUB = 3.0;
// [comment removed]
var COVERAGE_W = 2.0;
// [comment removed]
var LIKE_W = 0.05;
var LIKE_CAP = 15;

// [comment removed]
var MATERIAL_LEATHER = ['皮革','pu皮','pvc皮','真皮','再生皮','头层皮','二层皮','牛皮','羊皮','猪皮','头层','二层'];
var MATERIAL_COTTON_LINEN = ['棉','麻','竹纤维','竹浆','棉布','麻布','竹布'];
var MATERIAL_SILK_WOOL = ['丝','真丝','丝绸','羊毛','羊绒','驼绒','兔毛','貂毛','驼毛','马海毛'];
var MATERIAL_SYNTHETIC = ['化纤','涤纶','腈纶','锦纶','尼龙','氨纶','丙纶','维纶','氯纶','聚酯','聚酰胺','人造纤维','合成纤维','涤棉','棉纶','锦纶丝'];
var MATERIAL_PLASTIC_RUBBER = ['塑料','硅胶','PVC','TPU','TPE','PU','橡胶','乳胶','TPR'];
var MATERIAL_METAL = ['钢','铁','铜','铝','锌','镍','钛','不锈钢','合金'];
var MATERIAL_GLASS = ['玻璃','钢化','石英','水晶'];
var MATERIAL_PAPER = ['纸','纸板','卡纸','铜版纸','牛皮纸','瓦楞'];

// [comment removed]
function bm25Idf(df, total) {
  if (df <= 0) df = 1;
  return Math.log((total - df + 0.5) / (df + 0.5) + 1);
}

// [comment removed]
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

// [comment removed]
// [comment removed]
// [comment removed]
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

// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
// ctx: { allData, codeMap, processItem, getItemWeight }
function ruleBasedSearch(keyword, ctx) {
  var allData = ctx.allData;

  var q = String(keyword || '').trim().toLowerCase();

// [comment removed]
// [comment removed]
// [comment removed]
  var SHELL_KEYWORDS = ['壳','外壳','壳体'];
  var SLEEVE_KEYWORDS = ['保护套','护套','防尘套','软套','硅胶套','防水套'];
  var ACCESSORY_PATTERNS = SHELL_KEYWORDS.concat(SLEEVE_KEYWORDS).concat([
    '罩','盖','盒','匣','袋',
    '零件','部件','配件',
  ]);
// [comment removed]
  var qHasShell = false;
  for (var si = 0; si < SHELL_KEYWORDS.length; si++) {
    if (q.indexOf(SHELL_KEYWORDS[si]) !== -1) { qHasShell = true; break; }
  }
  var qHasSleeve = false;
  for (var sui = 0; sui < SLEEVE_KEYWORDS.length; sui++) {
    if (q.indexOf(SLEEVE_KEYWORDS[sui]) !== -1) { qHasSleeve = true; break; }
  }
// [comment removed]
  var blockDeviceChapter = qHasSleeve && !qHasShell;

// [comment removed]
// [comment removed]
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
// [comment removed]
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

// [comment removed]
// [comment removed]
  var CLOTHING_KEYWORDS = ['衫','服','衣服','衣物','上衣','皮衣','大衣','棉衣','毛衣','衬衣','外衣','内衣','风衣','夹克','外套','马甲','背心','裤','裙','围巾','斗篷'];
  var qHasClothing = false;
  for (var ckr = 0; ckr < CLOTHING_KEYWORDS.length; ckr++) {
    if (q.indexOf(CLOTHING_KEYWORDS[ckr]) !== -1) { qHasClothing = true; break; }
  }

// [comment removed]
// [comment removed]
  var DEVICE_CHAPTERS = {
// [comment removed]
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
// [comment removed]
    '显示器':    { ch4: ['8528'], partsCh4: ['8528','8471'] },
    '显示屏':    { ch4: ['8528'], partsCh4: ['8528','8471'] },
    '屏幕':      { ch4: ['8528','3926'], partsCh4: ['8528'] },
    '电视':      { ch4: ['8528'], partsCh4: ['8528'] },
    '电视机':    { ch4: ['8528'], partsCh4: ['8528'] },
// [comment removed]
    '打印机':    { ch4: ['8443'], partsCh4: ['8443'] },
    '扫描仪':    { ch4: ['8471'], partsCh4: ['8471'] },
    '复印机':    { ch4: ['8443'], partsCh4: ['8443'] },
// [comment removed]
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
// [comment removed]
    '电池':      { ch4: ['8507'], partsCh4: ['8507'] },
    '锂电池':    { ch4: ['8507'], partsCh4: ['8507'] },
    '蓄电池':    { ch4: ['8507'], partsCh4: ['8507'] },
// [comment removed]
    '灯':        { ch4: ['9405'], partsCh4: ['9405'] },
    '灯具':      { ch4: ['9405'], partsCh4: ['9405'] },
    'LED灯':     { ch4: ['9405'], partsCh4: ['9405'] },
    '灯泡':      { ch4: ['9405'], partsCh4: ['9405'] },
    '台灯':      { ch4: ['9405'], partsCh4: ['9405'] },
    '手电筒':    { ch4: ['9405'], partsCh4: ['9405'] },
// [comment removed]
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
// [comment removed]
    '电钻':      { ch4: ['8467'], partsCh4: ['8467'] },
    '电动工具':  { ch4: ['8467'], partsCh4: ['8467'] },
    '电锯':      { ch4: ['8467'], partsCh4: ['8467'] },
// [comment removed]
    '自行车':    { ch4: ['8714'], partsCh4: ['8714'] },
    '电动车':    { ch4: ['8711','8714'], partsCh4: ['8711','8714'] },
    '玩具':      { ch4: ['9503'], partsCh4: ['9503'] },
// [comment removed]
    '鞋':        { ch4: ['6403','6404'], partsCh4: ['6403'] },
    '皮鞋':      { ch4: ['6403'], partsCh4: ['6403'] },
    '运动鞋':    { ch4: ['6404','6403'], partsCh4: ['6404'] },
    '帽子':      { ch4: ['6505','6504'], partsCh4: ['6505'] },
    '帽子':      { ch4: ['6505','6504'], partsCh4: ['6505'] },
// [comment removed]
    '行李箱':    { ch4: ['4202'], partsCh4: ['4202'] },
    '拉杆箱':    { ch4: ['4202'], partsCh4: ['4202'] },
    '背包':      { ch4: ['4202'], partsCh4: ['4202'] },
    '包':        { ch4: ['4202'], partsCh4: ['4202'] },
// [comment removed]
    '衬衫':      { ch4: ['6105','6106','6205','6206'], partsCh4: ['6105'] },
    'T恤':      { ch4: ['6109','6205'], partsCh4: ['6109'] },
    '裙子':      { ch4: ['6104','6204'], partsCh4: ['6104'] },
    '裤子':      { ch4: ['6103','6104','6203','6204'], partsCh4: ['6103'] },
// [comment removed]
    '微波炉':    { ch4: ['8516'], partsCh4: ['8516'] },
    '电饭煲':    { ch4: ['8516'], partsCh4: ['8516'] },
    '电磁炉':    { ch4: ['8516'], partsCh4: ['8516'] },
    '榨汁机':    { ch4: ['8509'], partsCh4: ['8509'] },
    '搅拌机':    { ch4: ['8509'], partsCh4: ['8509'] },
    '吸尘器':    { ch4: ['8508'], partsCh4: ['8508'] },
// [comment removed]
    '摄像头':    { ch4: ['8525','8529'], partsCh4: ['8525'] },
    '监控':      { ch4: ['8525'], partsCh4: ['8525'] },
    '门禁':      { ch4: ['8531'], partsCh4: ['8531'] },
// [comment removed]
    '血压计':    { ch4: ['9018'], partsCh4: ['9018'] },
    '体温计':    { ch4: ['9025'], partsCh4: ['9025'] },
    '轮椅':      { ch4: ['8713'], partsCh4: ['8713'] },
  };

// [comment removed]
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

// [comment removed]
  var qAccPatterns = [];
  for (var pi = 0; pi < ACCESSORY_PATTERNS.length; pi++) {
    if (q.indexOf(ACCESSORY_PATTERNS[pi]) !== -1) qAccPatterns.push(ACCESSORY_PATTERNS[pi]);
  }
// [comment removed]
// [comment removed]
  if (qAccPatterns.length === 0 && foundDeviceWords.length === 0) return null;

// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
  var scanCh4 = { '3926': true };
// [comment removed]
  if (qHasLeatherMat) { scanCh4['4202'] = true; scanCh4['4203'] = true; }
// [comment removed]
  if (qHasLeatherMat && qHasClothing) { scanCh4['4303'] = true; }
// [comment removed]
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
// [comment removed]
// [comment removed]
    for (var dc in foundDeviceChapters) scanCh4[dc] = true;
    for (var pc in foundPartsChapters) scanCh4[pc] = true;
  } else if (foundDeviceWords.length > 0 && blockDeviceChapter) {
// [comment removed]
// [comment removed]
    for (var pc in foundPartsChapters) {
// [comment removed]
      if (pc === '3926') scanCh4[pc] = true;
    }
  } else if (qAccPatterns.length > 0) {
// [comment removed]
    for (var pc in foundPartsChapters) scanCh4[pc] = true;
  }

// [comment removed]
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
// [comment removed]
    '50': 25, '51': 25, // 丝/羊毛
    '5208': 28, '5209': 28, '5210': 28, '5211': 28, '5212': 28, // 棉布
    '5309': 28, '5310': 28, '5311': 28, // 麻布
    '5407': 28, '5408': 28, '5402': 28, '5403': 28, '5404': 28, '5405': 28, // 化纤
    '5501': 28, '5502': 28, '5503': 28, '5504': 28, '5506': 28, '5507': 28, '5508': 28, // 化纤
// [comment removed]
    '73': 30, '74': 30, '76': 30, '83': 30,
    '70': 25, // 玻璃
// [comment removed]
    '4801': 20, '4802': 20, '4810': 20, '4811': 20,
    '4820': 35, '4821': 35, '4822': 35,
    '6403': 30, '6404': 28,
    '6504': 25, '6505': 28,
    '6103': 30, '6104': 30, '6105': 30, '6106': 30, '6109': 28,
    '6203': 30, '6204': 30, '6205': 30, '6206': 30,
    '9608': 30,
  };

// [comment removed]
  var BLACKLIST = [
    '手套','避孕','卫生','口罩','气球','圣诞',
    '火箭','发动机','涡轮','燃气轮机',
    '离心机','过滤机','净化',
    '整套散件',
    '礼品','玩具',
  ];

// [comment removed]
  var isAccessoryQuery = qAccPatterns.length > 0;

// [comment removed]
  var PART_KEYWORDS = ['零件','部件','附件','配件','专用件','结构件'];

// [comment removed]
// [comment removed]
  var CH3926_GENERIC_BLACKLIST = [
    '办公室','学校','衣服','衣着','家具','车厢',
    '小雕塑','装饰品','手套','避孕','机器','仪器',
    '两用物项','马桶','座圈','椅',
  ];
// [comment removed]
  var CH3926_DEVICE_KEYWORDS = [
    '电子','通信','电气','电器','光纤','光缆',
    '手机','电话','计算机','电脑','终端','仪表',
    '机','壳','罩','盒','匣','塞','堵','封','壳体',
  ];

// [comment removed]
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
// [comment removed]
    if (qHasClothing && ch4 === '4202') chScore -= 45;
    if (qHasClothing && (ch4 === '4303' || ch4 === '4203')) chScore += 10;

// [comment removed]
    var accScore = 0;
    for (var ai = 0; ai < ACCESSORY_PATTERNS.length; ai++) {
      if (name.indexOf(ACCESSORY_PATTERNS[ai]) !== -1) {
        accScore += (ACCESSORY_PATTERNS[ai].length >= 2 ? 20 : 8);
      }
    }

// [comment removed]
    var devScore = 0;
    if (foundDeviceWords.length > 0) {
      for (var di = 0; di < foundDeviceWords.length; di++) {
        if (name.indexOf(foundDeviceWords[di]) !== -1) { devScore = 30; break; }
      }
// [comment removed]
// [comment removed]
      if (devScore === 0) {
        var isFurnitureCh = (ch4 === '9401' || ch4 === '9403' || ch4 === '9404');
        if (isFurnitureCh) { devScore = 30; }
      }
    }

    var ruleScore = chScore + accScore + devScore;

// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
    var furnitureBoost = 0;
    if (devScore > 0) {
      var isFurnitureChapter = (ch4 === '9401' || ch4 === '9403' || ch4 === '9404');
      if (isFurnitureChapter) {
// [comment removed]
        var isFurnitureDesc = (
          name.indexOf('用') !== -1 ||
          name.indexOf('制') !== -1 ||
          name.indexOf('坐具') !== -1 ||
          name.indexOf('家具') !== -1
        );
        var isPurePartName = (name.indexOf('零件') !== -1);
        if (isFurnitureDesc && !isPurePartName) {
          furnitureBoost = 25;
          ruleScore += furnitureBoost;
        }
      }
    }

// [comment removed]
    var isPartCode = (
      name.indexOf('零件') !== -1 ||
      name.indexOf('部件') !== -1 ||
      name.indexOf('附件') !== -1
    );

// [comment removed]
    if (isPartCode) ruleScore += 15;

// [comment removed]
// [comment removed]
    if (qHasLeatherMat && accScore === 0 && (ch4 === '4202' || ch4 === '4203')) {
      var sleeveNameTerms = ['套','袋','罩','壳'];
      for (var sli = 0; sli < sleeveNameTerms.length; sli++) {
        if (name.indexOf(sleeveNameTerms[sli]) !== -1) {
          ruleScore += 40;
          break;
        }
      }
    }

// [comment removed]
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
// [comment removed]
// [comment removed]
// [comment removed]
      var isPartsChapter = !!foundPartsChapters[ch4];
      if (isPartsChapter && accScore === 0 && devScore === 0) {
// [comment removed]
        var isPartLike = (
          name.indexOf('零件') !== -1 ||
          name.indexOf('部件') !== -1 ||
          name.indexOf('附件') !== -1 ||
          name.indexOf('用') !== -1
        );
        if (!isPartLike) continue;
      } else if (accScore === 0 && devScore === 0) {
// [comment removed]
// [comment removed]
        var isFurnitureChapter = (ch4 === '9401' || ch4 === '9403' || ch4 === '9404');
        if (!isFurnitureChapter) continue;
// [comment removed]
        var isFurnitureLike = (
          name.indexOf('用') !== -1 ||
          name.indexOf('制') !== -1 ||
          name.indexOf('坐具') !== -1 ||
          name.indexOf('家具') !== -1
        );
        if (!isFurnitureLike) continue;
      }
    }

// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
    var penalty = 0;
// [comment removed]
// [comment removed]
    if (blockDeviceChapter && ch4 !== '4202' && ch4 !== '4203') {
      penalty = -25;
    } else if (isAccessoryQuery && devScore > 0) {
      var hasPart = false;
// [comment removed]
      for (var pk = 0; pk < PART_KEYWORDS.length; pk++) {
        if (name.indexOf(PART_KEYWORDS[pk]) !== -1) { hasPart = true; break; }
      }
// [comment removed]
      if (name.indexOf('用') !== -1) hasPart = true;

      if (!hasPart) {
// [comment removed]
        var isDroneDevice = false;
        for (var dd = 0; dd < foundDeviceWords.length; dd++) {
          if (foundDeviceWords[dd] === '无人机' || foundDeviceWords[dd] === '航拍' || foundDeviceWords[dd] === '遥控飞机') {
            isDroneDevice = true; break;
          }
        }
        if (isDroneDevice && ch4 === '8806') {
// [comment removed]
        } else {
          penalty = -25;
        }
      }

// [comment removed]
// [comment removed]
// [comment removed]
      if (foundDeviceWords.length > 0 && !isAccessoryQuery) {
        var hasPartWord = false;
        for (var fp = 0; fp < PART_KEYWORDS.length; fp++) {
          if (name.indexOf(PART_KEYWORDS[fp]) !== -1) { hasPartWord = true; break; }
        }
        if (hasPartWord) {
// [comment removed]
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
// [comment removed]
    if (b.ruleScore !== a.ruleScore) return b.ruleScore - a.ruleScore;
// [comment removed]
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

// [comment removed]
// ctx: { allData, codeMap, hsIndex, hsSynonyms, expandMap, processItem, getItemWeight }
// [comment removed]
// [comment removed]
function semanticSearch(keyword, ctx) {
  var allData = ctx.allData;
  var codeMap = ctx.codeMap;
  var hsIndex = ctx.hsIndex;
  var hsSynonyms = ctx.hsSynonyms;
  var expandMap = ctx.expandMap;

  if (!allData || !hsIndex || !hsSynonyms || !hsIndex.index) return null;
  var q = String(keyword || '').trim().toLowerCase();
  if (!q) return null;

// [comment removed]
  var ACC_Q_PATTERNS = ['壳','套','罩','盖','匣'];
  var isAccQuery = false;
  for (var ap = 0; ap < ACC_Q_PATTERNS.length; ap++) {
    if (q.indexOf(ACC_Q_PATTERNS[ap]) !== -1) { isAccQuery = true; break; }
  }
// [comment removed]
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
// [comment removed]
// [comment removed]
  var isSleeveQuery = qHasSleeveSemantic && !qHasShellSemantic;

// [comment removed]
  var expanded = {};
// [comment removed]
  expanded[q] = true;
  if (expandMap[q]) {
    for (var e = 0; e < expandMap[q].length; e++) {
// [comment removed]
      if (expandMap[q][e] !== q) expanded[expandMap[q][e]] = true;
    }
  }
// [comment removed]
// [comment removed]
// [comment removed]
  if (!isSleeveQuery) {
    for (var term in expandMap) {
      if (q.indexOf(term) !== -1) {
        var grp = expandMap[term];
        for (var g = 0; g < grp.length; g++) expanded[grp[g]] = true;
      }
    }
  }
// [comment removed]
  var candidateCodes = {};
  for (var t in expanded) {
    var codes = hsIndex.index[t];
    if (codes && codes.length) {
      for (var c = 0; c < codes.length; c++) candidateCodes[codes[c]] = true;
    }
  }
// [comment removed]
// [comment removed]
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
// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
      var qLen = q.length;
      if (qLen >= 2) {
        var isChinese = /[\u4e00-\u9fa5]/.test(q);
        if (isChinese) {
// [comment removed]
          for (var bi = 0; bi < qLen - 1; bi++) {
            var bigram = q.substring(bi, bi + 2);
            if (nm.indexOf(bigram) !== -1) { candidateCodes[it.code] = true; break; }
          }
// [comment removed]
          if (!candidateCodes[it.code]) {
            var matched = 0;
            for (var ci = 0; ci < qLen; ci++) {
              if (nm.indexOf(q[ci]) !== -1) matched++;
            }
            var threshold = qLen === 2 ? 2 : qLen === 3 ? 2 : 3;
            if (matched >= threshold) { candidateCodes[it.code] = true; }
          }
        } else {
// [comment removed]
          var words = q.split(/\s+/);
          words.forEach(function(w) {
            if (w.length >= 2 && nm.indexOf(w) !== -1) { candidateCodes[it.code] = true; }
          });
        }
      }
    }
  }
// [comment removed]
// [comment removed]
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
// [comment removed]
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

// [comment removed]
  var CLOTHING_KEYWORDS = ['衫','服','衣服','衣物','上衣','皮衣','大衣','棉衣','毛衣','衬衣','外衣','内衣','风衣','夹克','外套','马甲','背心','裤','裙','围巾','斗篷'];
  var qHasClothing = false;
  for (var cki = 0; cki < CLOTHING_KEYWORDS.length; cki++) {
    if (q.indexOf(CLOTHING_KEYWORDS[cki]) !== -1) { qHasClothing = true; break; }
  }

// [comment removed]
// [comment removed]
// [comment removed]
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
// [comment removed]
      if (qHasLeatherMat) {
        candidateCodes[lit.code] = true;
      }
// [comment removed]
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
// [comment removed]

  if (Object.keys(candidateCodes).length === 0) return null;

  var totalDocs = hsIndex.total_docs || allData.length;
  var expandedArr = Object.keys(expanded);

// [comment removed]
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
// [comment removed]
// [comment removed]
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
// [comment removed]
        if (qHasClothing) materialChList.push('4303');
      } else if (hasPlastic2) {
        materialChList = ['3926', '3923', '3921', '3922', '3924', '3925'];
      } else {
        materialChList = ['3926', '3923', '4202', '4203', '6117', '6116', '4016', '4817', '4602', '4419', '4823', '5901'];
      }
      if (materialChList.indexOf(ch4) === -1) continue;
    }
// [comment removed]
    if (qHasLeatherMat && (ch4 === '4202' || ch4 === '4203' || (qHasClothing && ch4 === '4303'))) {
      var isLeatherChapterItem = candidateCodes[code] &&
        (String(code).substring(0, 4) === '4202' || String(code).substring(0, 4) === '4203' ||
         (qHasClothing && String(code).substring(0, 4) === '4303'));
      if (isLeatherChapterItem && score === 0) {
        if (qHasClothing && ch4 === '4202') {
// [comment removed]
          score = 5;
          matched.push('非衣物章');
        } else {
// [comment removed]
          var sleeveNameTerms2 = ['套', '袋', '罩', '壳'];
          var hasSleeveInName = sleeveNameTerms2.some(function(st) { return name.indexOf(st) !== -1; });
// [comment removed]
          var isClothingName = qHasClothing && CLOTHING_KEYWORDS.some(function(ck) { return name.indexOf(ck) !== -1; });
          if (isClothingName) {
// [comment removed]
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

// [comment removed]
      for (var j = 0; j < aliases.length; j++) {
        if (aliases[j] === term2) {
          score += idf * W_ALIAS_EXACT;
          matched.push(term2);
          termMatched = true;
          break;
        }
      }
// [comment removed]
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
// [comment removed]
      var idxCodes = hsIndex.index[term2];
      if (idxCodes && idxCodes.indexOf(code) !== -1) {
        score += idf * W_INDEX;
        if (!termMatched) { matched.push(term2); termMatched = true; }
      }
// [comment removed]
      if (term2 === name) {
        score += idf * W_NAME_EXACT;
        if (!termMatched) { matched.push(term2); termMatched = true; }
      } else if (name.indexOf(term2) !== -1) {
        score += idf * W_NAME_SUB;
        if (!termMatched) { matched.push(term2); termMatched = true; }
      }
    }

    if (score > 0) {
// [comment removed]
// [comment removed]
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
// [comment removed]
      var wi = ctx.getItemWeight ? ctx.getItemWeight(item.code, item.name) : { likes: 0, dislikes: 0, weight: 0 };
      var netLikes = Math.max(0, (wi.likes || 0) - (wi.dislikes || 0));
      var likeMul = 1 + Math.min(netLikes, LIKE_CAP) * LIKE_W;
// [comment removed]
      var covMul = 1 + COVERAGE_W * cov;
// [comment removed]
// [comment removed]
      var penalty = 0;
      if (isAccQuery && !qHasClothing) {
        var hasPart = (name.indexOf('用') !== -1 ||
          name.indexOf('零件') !== -1 ||
          name.indexOf('部件') !== -1 ||
          name.indexOf('附件') !== -1);
// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
        if (!hasPart) penalty = -25;
      }
// [comment removed]
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

// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
// [comment removed]
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

// [comment removed]
// [comment removed]
// [comment removed]
  function zeroResultFallback(keyword, ctx) {
    var q = String(keyword || '').trim().toLowerCase();
    if (!q) return null;

// [comment removed]
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

// [comment removed]
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
// [comment removed]
    if (guessChapters.length === 0) {
      var BOOK_KEYWORDS = ['书', '本', '册', '簿', '教材', '课本', '教辅', '字典', '词典', '辞典', '杂志', '报刊', '报纸', '日历', '贴纸', '练习', '作业'];
      for (var bk = 0; bk < BOOK_KEYWORDS.length; bk++) {
        if (q.indexOf(BOOK_KEYWORDS[bk]) !== -1) {
          guessChapters = ['4901', '4902', '4903', '4904', '4905', '4820', '4821', '4822'];
          break;
        }
      }
    }
// [comment removed]
    if (guessChapters.length === 0) {
      guessChapters = ['3926', '4202', '4203', '8471', '8517', '4820', '6109', '6403', '8544'];
    }

    var scored = [];
    var allData = ctx.allData;
    for (var i = 0; i < allData.length; i++) {
      var item = allData[i];
      var ch4 = String(item.code || '').substring(0, 4);
// [comment removed]
      var chMatch = guessChapters.some(function(gc) {
        return ch4 === gc || (gc.length === 2 && ch4.substring(0, 2) === gc);
      });
      if (!chMatch) continue;

      var nm = String(item.name || '').toLowerCase();
// [comment removed]
      var cov = nameCoverage(nm, q);
// [comment removed]
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

// [comment removed]
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
