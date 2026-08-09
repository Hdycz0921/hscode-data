/**
 * GitHub Actions 流水线 Step 3: 上传生成物到 GitHub 仓库
 *
 * 上传内容:
 *   - v2.0.1/tariff/p1~p4.json      (由 build_tariff.py 生成)
 *   - v2.0.1/hs_synonym_dict.json   (由 build_semantic.py 生成)
 *   - v2.0.1/hs_index.json          (由 build_semantic.py 生成)
 *   - v2.0.1/decisions.json         (由 _gen_decisions.py 生成)
 *   - v2.0.1/version.json           (自动更新)
 *
 * GitHub Actions 环境:
 *   - GITHUB_TOKEN  自动注入，无需手动配置
 *   - 权限:Contents=RW
 *
 * 本地调试:
 *   set GITHUB_TOKEN=ghp_xxx
 *   node upload.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.dirname(SCRIPT_DIR);       // 仓库根目录
// TOKEN 来自环境变量：
//   本地调试: set GITHUB_TOKEN=ghp_xxx
//   GitHub Actions: ${{ secrets.GITHUB_TOKEN }}（自动注入）
const TOKEN = process.env.GITHUB_TOKEN || process.env.TOKEN || '';
const OWNER = 'Hdycz0921';
const REPO = 'hscode-data';
const BRANCH = 'main';
const VERSION = 'v2.0.1';

const OUTPUT_DIRS = {
  tariff:      path.join(SCRIPT_DIR, 'tariff_output'),      // p1~p4.json
  semantic:    path.join(SCRIPT_DIR, 'semantic_output'),    // hs_index + dict
  decisions:   path.join(SCRIPT_DIR, 'decisions_output'),   // decisions.json
};

// GitHub API 请求封装
function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        Authorization: `token ${TOKEN}`,
        'User-Agent': 'actions-upload-hscode',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 获取文件 SHA（不存在返回 null）
async function getSha(gitPath) {
  try {
    const res = await githubRequest('GET', `/repos/${OWNER}/${REPO}/contents/${gitPath}?ref=${BRANCH}`);
    if (res.status === 200 && res.data && res.data.sha) return res.data.sha;
  } catch {}
  return null;
}

// 上传/更新单个文件
async function uploadFile(localPath, gitPath, category) {
  const content = fs.readFileSync(localPath);
  const base64 = content.toString('base64');
  const sha = await getSha(gitPath);

  const body = {
    message: `data: upload ${category} ${path.basename(gitPath)}`,
    content: base64,
    branch: BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await githubRequest('PUT', `/repos/${OWNER}/${REPO}/contents/${gitPath}`, body);

  if (res.status === 200 || res.status === 201) {
    const sz = (content.length / 1024).toFixed(1);
    process.stdout.write(`  ✅ ${sz.padStart(7)} KB  ${gitPath}\n`);
    return true;
  } else {
    const msg = typeof res.data === 'string' ? res.data.substring(0, 80) : JSON.stringify(res.data).substring(0, 80);
    console.error(`  ❌ ${gitPath}  HTTP ${res.status}  ${msg}`);
    return false;
  }
}

// 遍历目录上传
async function uploadDir(localDir, gitPrefix, category) {
  if (!fs.existsSync(localDir)) {
    console.log(`  ⚠️  目录不存在，跳过: ${localDir}`);
    return;
  }
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  let ok = 0, fail = 0;
  for (const e of entries) {
    const local = path.join(localDir, e.name);
    const git = `${gitPrefix}/${e.name}`;
    if (e.isDirectory()) {
      const r = await uploadDir(local, git, category + '/' + e.name);
      ok += r.ok; fail += r.fail;
    } else {
      const ok2 = await uploadFile(local, git, category);
      if (ok2) ok++; else fail++;
    }
  }
  return { ok, fail };
}

// 更新 version.json
async function updateVersion(totalItems) {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const versionData = {
    version: VERSION,
    description: `HS编码数据 ${dateStr} 更新版，含税则+语义搜索索引`,
    updated: dateStr,
    total: totalItems,
    build: 'github-actions',
  };
  const localPath = path.join(SCRIPT_DIR, 'version_gen.json');
  fs.writeFileSync(localPath, JSON.stringify(versionData, null, 2), 'utf8');
  const ok = await uploadFile(localPath, `${VERSION}/version.json`, 'meta');
  fs.unlinkSync(localPath);
  return ok;
}

// 主流程
async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  HS Code Data — GitHub Actions 上传流水线           ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Owner: ${OWNER}/${REPO}  Branch: ${BRANCH}`);
  console.log(`║  Version: ${VERSION}  Date: ${new Date().toISOString().slice(0,10)}`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  let totalOk = 0, totalFail = 0;

  // 1. tariff 分片
  console.log('📦 [1/3] 上传税则分片 (p1~p4.json)...');
  if (fs.existsSync(OUTPUT_DIRS.tariff)) {
    const entries = fs.readdirSync(OUTPUT_DIRS.tariff);
    let shardCount = 0;
    for (const name of entries) {
      if (name.endsWith('.json')) {
        const ok = await uploadFile(
          path.join(OUTPUT_DIRS.tariff, name),
          `${VERSION}/tariff/${name}`,
          'tariff'
        );
        if (ok) { totalOk++; shardCount++; } else totalFail++;
      }
    }
    console.log(`   税则分片: ${shardCount} 个文件 ✅\n`);
  } else {
    console.log('   ⚠️  tariff_output 不存在，跳过\n');
  }

  // 2. 语义搜索数据
  console.log('🔍 [2/3] 上传语义搜索数据...');
  if (fs.existsSync(OUTPUT_DIRS.semantic)) {
    const files = ['hs_index.json', 'hs_synonym_dict.json'];
    let semanticOk = 0;
    for (const name of files) {
      const local = path.join(OUTPUT_DIRS.semantic, name);
      if (fs.existsSync(local)) {
        const ok = await uploadFile(local, `${VERSION}/${name}`, 'semantic');
        if (ok) { totalOk++; semanticOk++; } else totalFail++;
      }
    }
    console.log(`   语义数据: ${semanticOk} 个文件 ✅\n`);
  } else {
    console.log('   ⚠️  semantic_output 不存在，跳过\n');
  }

  // 3. 归类决定数据
  console.log('⚖️  [3/3] 上传归类决定数据...');
  if (fs.existsSync(OUTPUT_DIRS.decisions)) {
    const local = path.join(OUTPUT_DIRS.decisions, 'decisions.json');
    if (fs.existsSync(local)) {
      const ok = await uploadFile(local, `${VERSION}/decisions.json`, 'decisions');
      if (ok) { totalOk++; } else totalFail++;
    }
  } else {
    console.log('   ⚠️  decisions_output 不存在，跳过（归类决定页可后续补充）\n');
  }

  // 4. 更新 version.json（统计总条数）
  let totalItems = 0;
  const tariffDir = OUTPUT_DIRS.tariff;
  if (fs.existsSync(tariffDir)) {
    for (const name of ['p1.json', 'p2.json', 'p3.json', 'p4.json']) {
      const fp = path.join(tariffDir, name);
      if (fs.existsSync(fp)) {
        try { totalItems += JSON.parse(fs.readFileSync(fp, 'utf8')).length; }
        catch {}
      }
    }
  }
  console.log('📋 [4/4] 更新 version.json...');
  await updateVersion(totalItems);
  totalOk++;

  // 摘要
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  完成: ${totalOk} 上传  ${totalFail > 0 ? totalFail + ' 失败 ❌' : '0 失败 ✅'}    ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\nCDN 路径: https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/${VERSION}/`);

  if (totalFail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
