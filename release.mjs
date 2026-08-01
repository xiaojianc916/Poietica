#!/usr/bin/env node
/**
 * 在本机完成一次发布。
 *
 *   pnpm release
 *   pnpm release --version 0.1.3
 *
 * 构建、签名、上传、验通道全部在本地用 gh 完成，不经过 GitHub Actions。
 *
 * 这条路径绕过了 release.yml 里的静默安装冒烟测试与依赖审计，代价自负；换来的是
 * 不依赖仓库 Secret、不用等 CI 排队，以及失败时能立刻回滚。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'

const MAIN_BRANCH = 'main'
const CONF = 'apps/desktop/src-tauri/tauri.conf.json'
const BUNDLE_DIR = 'target/x86_64-pc-windows-msvc/release/bundle/nsis'
const STAGE_DIR = 'dist-release'
const PLACEHOLDER_PUBKEY = 'REPLACE_WITH_TAURI_SIGNER_PUBKEY'

/*
 * 签名密钥住在用户目录，不住在仓库里。
 *
 * 私钥进仓库等于把整条更新通道交出去：拿到它的人能签出一个你的客户端会自动信任、
 * 自动安装的"更新"。放在这里还有一个好处——密码只需要在第一次运行时输一遍，此后
 * 脚本自己去取，不必每开一个终端窗口就重设两个环境变量。
 */
const KEY_PATH = path.join(homedir(), '.tauri', 'poietica.key')
const PASS_PATH = path.join(homedir(), '.tauri', 'poietica.pass')

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => (color ? `\u001B[${code}m${text}\u001B[0m` : text)

const bold = (text) => paint('1', text)
const dim = (text) => paint('2', text)
const red = (text) => paint('31', text)
const green = (text) => paint('32', text)
const yellow = (text) => paint('33', text)
const cyan = (text) => paint('36', text)

/** 预期内的失败：打印一句人话就退场，不甩堆栈。 */
class Abort extends Error {}

const rl = createInterface({ input: process.stdin, output: process.stdout })

let stepIndex = 0

/** 每一步开头的那行中文。 */
function step(title) {
  stepIndex += 1
  console.log('')
  console.log(bold(`[${stepIndex}] ${title}`))
}

function note(text) {
  console.log(dim(`    ${text}`))
}

/** 执行一条命令，输出直通终端。失败即抛。 */
function run(command) {
  console.log(dim(`    $ ${command}`))

  const result = spawnSync(command, { shell: true, stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Abort(`命令失败（退出码 ${result.status}）：${command}`)
  }
}

/** 执行一条命令并拿回它的输出。失败返回 null，用于探测。 */
function capture(command) {
  const result = spawnSync(command, { shell: true, encoding: 'utf8' })

  return result.status === 0 ? result.stdout.trim() : null
}

async function confirm(question, fallback = true) {
  const hint = fallback ? 'Y/n' : 'y/N'
  const answer = (await rl.question(`    ${question} (${hint}) `)).trim().toLowerCase()

  if (answer === '') {
    return fallback
  }

  return answer === 'y' || answer === 'yes'
}

async function choose(question, options) {
  console.log(`    ${question}`)

  options.forEach((option, index) => {
    console.log(`      ${cyan(String(index + 1))}. ${option.label}`)
  })

  for (;;) {
    const answer = (await rl.question('    请输入序号：')).trim()
    const picked = options[Number(answer) - 1]

    if (picked) {
      return picked.value
    }

    console.log(red('    序号不在范围内，再试一次。'))
  }
}

/**
 * 装载签名密钥。
 *
 * 优先用已经存在的环境变量（CI 走的就是那条路），否则从用户目录读。密码缺失时
 * 问一次并存下来——因为那种"每次发版前先粘两条 PowerShell"的流程，迟早会在某个
 * 深夜被跳过，而跳过的结果是一个没有 .sig 的发布，静默地断掉整条更新通道。
 */
async function loadSigningKey() {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    const key = await readFile(KEY_PATH, 'utf8').catch(() => null)

    if (key === null) {
      throw new Abort(
        [
          `找不到签名私钥：${KEY_PATH}`,
          '',
          '如果这是一台新机器，把旧机器上的这个文件拷过来；',
          '如果密钥从未生成过（注意：换密钥意味着所有老客户端都收不到更新了）：',
          '  pnpm tauri signer generate -w ~/.tauri/poietica.key',
        ].join('\n'),
      )
    }

    process.env.TAURI_SIGNING_PRIVATE_KEY = key.trim()
    note(`已读取私钥 ${KEY_PATH}`)
  }

  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD !== undefined) {
    return
  }

  const saved = await readFile(PASS_PATH, 'utf8').catch(() => null)

  if (saved !== null) {
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = saved.trim()
    note(`已读取私钥密码 ${PASS_PATH}`)
    return
  }

  console.log('')
  note('第一次运行，需要私钥密码。它会存进你的用户目录，以后不会再问。')

  const entered = (await rl.question('    私钥密码（没有密码就直接回车）：')).trim()

  await mkdir(path.dirname(PASS_PATH), { recursive: true })
  await writeFile(PASS_PATH, entered, 'utf8')

  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = entered

  console.log(green(`    已记住，存在 ${PASS_PATH}`))
}

function bumped(version) {
  const [major, minor, patch] = version.split('.').map(Number)

  return {
    patch: [major, minor, patch + 1].join('.'),
    minor: [major, minor + 1, 0].join('.'),
    major: [major + 1, 0, 0].join('.'),
  }
}

async function main() {
  console.log(bold('\nPoietica 发布流程 · 本地构建 + gh 发布\n'))

  /* ── 起飞前检查 ────────────────────────────────────────── */

  step('起飞前检查：确认现在这台机器可以安全地发一个版本')

  const pkg = JSON.parse(await readFile('package.json', 'utf8').catch(() => 'null'))

  if (pkg?.name !== 'poietica') {
    throw new Abort('请在仓库根目录运行这个脚本。')
  }

  const branch = capture('git rev-parse --abbrev-ref HEAD')

  if (branch !== MAIN_BRANCH) {
    note(`当前分支是 ${branch}，不是 ${MAIN_BRANCH}`)

    if (!(await confirm('仍然从这个分支发布？', false))) {
      throw new Abort('已取消。')
    }
  }

  if (capture('git status --porcelain') !== '') {
    throw new Abort('工作区有未提交的改动。发布必须来自一个确定的提交，请先提交或暂存。')
  }

  note('正在与远端对表…')
  run('git fetch origin --tags --quiet')

  const behind = capture(`git rev-list --count HEAD..origin/${MAIN_BRANCH}`)

  if (behind !== '0' && behind !== null) {
    throw new Abort(`本地落后远端 ${behind} 个提交，请先 git pull。`)
  }

  if (capture('gh --version') === null) {
    throw new Abort('找不到 gh 命令。请先安装 GitHub CLI：https://cli.github.com')
  }

  if (capture('gh auth status') === null) {
    throw new Abort('gh 尚未登录。请先运行：gh auth login')
  }

  const conf = await readFile(CONF, 'utf8')

  if (conf.includes(PLACEHOLDER_PUBKEY)) {
    throw new Abort(
      [
        'updater 公钥还是占位符。',
        '发出去的后果是所有已安装客户端永远更新失败，而且不会有任何报错。',
        '生成密钥对：pnpm tauri signer generate -w ~/.tauri/poietica.key',
      ].join('\n'),
    )
  }

  await loadSigningKey()

  console.log(green('    通过。'))

  /* ── 选版本 ────────────────────────────────────────────── */

  step('选版本：决定这次发布叫什么')

  const current = pkg.version
  note(`当前版本 ${current}`)

  const flagIndex = process.argv.indexOf('--version')
  const next = bumped(current)

  const version =
    flagIndex === -1
      ? await choose('这次发布哪一个？', [
          { label: `修订版  ${next.patch}   （修 bug、小改动）`, value: next.patch },
          { label: `次版本  ${next.minor}   （加功能）`, value: next.minor },
          { label: `主版本  ${next.major}   （不兼容变更）`, value: next.major },
          { label: '手动输入', value: null },
        ])
      : process.argv[flagIndex + 1]

  const target =
    version === null ? (await rl.question('    输入版本号（如 0.2.0）：')).trim() : version

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target)) {
    throw new Abort(`不是合法的版本号：${target}`)
  }

  const tag = `v${target}`

  if (capture(`git rev-parse -q --verify refs/tags/${tag}`) !== null) {
    throw new Abort(
      [
        `tag ${tag} 已经存在。`,
        '如果那次发布是失败的，先撤掉它：',
        `  gh release delete ${tag} --yes`,
        `  git push origin :refs/tags/${tag}`,
        `  git tag -d ${tag}`,
      ].join('\n'),
    )
  }

  console.log('')
  console.log(`    ${bold(current)} ${dim('→')} ${bold(green(target))}`)
  console.log('')

  if (!(await confirm('确认开始？'))) {
    throw new Abort('已取消。')
  }

  /* ── 写版本号 ──────────────────────────────────────────── */

  step('写版本号：把它同时写进 Cargo.toml 与三个 package/conf 文件')
  note('四处版本号不一致会让客户端陷入无限更新提示，所以写完立刻校验一遍。')

  run(`pnpm version:set ${target}`)
  run('pnpm check:versions')

  /* ── 质量门禁 ──────────────────────────────────────────── */

  step('质量门禁：lint、类型、测试、clippy 全跑一遍')
  note('这一步比较慢。跳过它意味着你可能会把一个坏版本装到自己电脑上。')

  if (await confirm('现在跑完整门禁？（推荐）')) {
    run('pnpm check')
    run('pnpm ipc:check')
  } else {
    console.log(yellow('    已跳过门禁。'))
  }

  /* ── 清空构建目录 ──────────────────────────────────────── */

  step('清空构建目录：删掉上一版残留的安装包')
  note('残留产物会让清单指向旧版本的安装包，签名照样能过，客户端会陷入更新死循环。')

  await rm(BUNDLE_DIR, { recursive: true, force: true })
  await rm(STAGE_DIR, { recursive: true, force: true })

  console.log(dim(`    已清空 ${BUNDLE_DIR} 与 ${STAGE_DIR}`))

  /* ── 构建 ──────────────────────────────────────────────── */

  step('构建安装包：编译并用你的私钥签名（这一步最久，十几分钟起）')

  run('pnpm build:release')

  /* ── 收集产物 ──────────────────────────────────────────── */

  step('收集产物：挑出这个版本的安装包、签名，生成更新清单与校验和')

  const files = await readdir(BUNDLE_DIR).catch(() => [])
  const installers = files.filter((name) => name.endsWith('-setup.exe'))
  const installer = installers.find((name) => name.includes(`_${target}_`))

  if (!installer) {
    throw new Abort(
      installers.length === 0
        ? `${BUNDLE_DIR} 下没有生成任何安装包。`
        : `没有找到 ${target} 的安装包，只找到：${installers.join(', ')}`,
    )
  }

  const strays = installers.filter((name) => name !== installer)

  if (strays.length > 0) {
    throw new Abort(
      `构建目录里混进了其它版本的安装包（${strays.join(', ')}），此刻发布的东西不可信。`,
    )
  }

  if (!files.includes(`${installer}.sig`)) {
    throw new Abort(`缺少 ${installer}.sig。签名没有生成，检查私钥与密码是否正确。`)
  }

  await mkdir(STAGE_DIR, { recursive: true })

  for (const name of [installer, `${installer}.sig`]) {
    await copyFile(path.join(BUNDLE_DIR, name), path.join(STAGE_DIR, name))
  }

  run(`node scripts/release/latest-json.mjs "${BUNDLE_DIR}" ${STAGE_DIR} ${tag}`)

  const digest = createHash('sha256')
    .update(await readFile(path.join(STAGE_DIR, installer)))
    .digest('hex')

  await writeFile(path.join(STAGE_DIR, 'SHA256SUMS.txt'), `${digest}  ${installer}\n`, 'utf8')

  const manifest = JSON.parse(await readFile(path.join(STAGE_DIR, 'latest.json'), 'utf8'))

  console.log('')
  console.log(`    安装包   ${installer}`)
  console.log(`    清单版本 ${manifest.version}`)
  console.log(`    指向     ${manifest.platforms['windows-x86_64'].url}`)
  console.log('')

  if (manifest.version !== target) {
    throw new Abort(`清单里的版本是 ${manifest.version}，不是 ${target}。`)
  }

  if (!manifest.platforms['windows-x86_64'].url.includes(installer)) {
    throw new Abort('清单指向的安装包和刚构建出来的这个对不上。')
  }

  if (!(await confirm('以上信息正确，继续发布？'))) {
    throw new Abort('已取消。产物留在 dist-release，未推送任何东西。')
  }

  /* ── 提交并打标 ────────────────────────────────────────── */

  step('提交并打标：把版本号改动推上去，附带这次的 tag')

  run('git add -A')
  run(`git commit -m "release: ${tag}"`)
  run(`git tag -a ${tag} -m "${tag}"`)

  let tagPushed = false

  try {
    run(`git push origin ${branch} --follow-tags`)
    tagPushed = true

    /* ── 发布 ────────────────────────────────────────────── */

    step('发布：上传安装包、签名、清单、校验和到 GitHub Release')

    run(
      [
        `gh release create ${tag}`,
        `"${path.join(STAGE_DIR, installer)}"`,
        `"${path.join(STAGE_DIR, `${installer}.sig`)}"`,
        `"${path.join(STAGE_DIR, 'latest.json')}"`,
        `"${path.join(STAGE_DIR, 'SHA256SUMS.txt')}"`,
        `--title "${tag}"`,
        '--generate-notes',
        '--latest',
      ].join(' '),
    )

    /* ── 验通道 ──────────────────────────────────────────── */

    step('验证更新通道：用客户端真正会去访问的那条地址，确认它现在返回新版本')
    note('资产没传上、release 不是 latest、版本对不上——这三种失败都是静默的，只能这样验。')

    run(`node scripts/release/verify-channel.mjs ${tag}`)
  } catch (error) {
    console.log('')
    console.log(red(`发布中断：${error.message}`))
    console.log('')

    if (await confirm('要撤回这次发布吗？（删除 release 与 tag）', true)) {
      if (capture(`gh release view ${tag}`) !== null) {
        run(`gh release delete ${tag} --yes`)
      }

      if (tagPushed) {
        run(`git push origin :refs/tags/${tag}`)
      }

      run(`git tag -d ${tag}`)

      console.log('')
      console.log(yellow(`已撤回 ${tag}。注意：版本号那个提交仍在 ${branch} 上。`))
      console.log(yellow('要一并回退：git revert HEAD && git push'))
    }

    throw new Abort('发布未完成。')
  }

  /* ── 收尾 ──────────────────────────────────────────────── */

  console.log('')
  console.log(green(bold(`  ${tag} 发布完成。`)))
  console.log('')
  console.log('  还剩下机器做不了的那一步：')
  console.log('    1. 打开已经装着旧版本的 Poietica')
  console.log('    2. 等左下角问号左边出现更新胶囊（启动后 30 秒内）')
  console.log('    3. 点它，看进度填满，再点重启')
  console.log(`    4. 重启后确认版本号已经是 ${target}`)
  console.log('')
}

main()
  .then(() => {
    rl.close()
  })
  .catch((error) => {
    rl.close()

    console.error('')
    console.error(red(error instanceof Abort ? error.message : String(error?.stack ?? error)))
    console.error('')

    process.exit(1)
  })
