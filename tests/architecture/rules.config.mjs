/**
 * Architecture rules — data, not programs.
 *
 * Every rule is a regular expression evaluated against production source files.
 * Adding a rule means adding an object here; it never means adding a script.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

/*
 * 扫描根必须是真实存在的顶层目录。
 *
 * 这份配置曾经声明 agent / editor / features / foundations / platforms，
 * 重构后五个目录一个不剩，packages/ 又从未被列进来 —— 十四个包一行没被扫过，
 * Architecture rules passed. 是空转出来的绿。所以不只列名字，还要当场断言。
 */
export const sourceRoots = ['apps', 'packages']

/*
 * sourceRoots 是 pattern 规则的扫描根；inventoryRoots 是 check 规则的。crates 里
 * 没有 .ts，但目录命名、Cargo.toml 分层与体量棘轮都管得到它。上一版给治理段单独
 * 抄了一份根列表和一份忽略名单，两份要人手同步 —— 现在根列表两张、忽略名单一张。
 */
export const inventoryRoots = ['apps', 'crates', 'packages']

for (const root of new Set([...sourceRoots, ...inventoryRoots])) {
  if (!existsSync(path.join(repositoryRoot, root))) {
    throw new Error(
      `architecture: 扫描根声明了不存在的目录 "${root}"。` +
        '目录被移动或删除后，这份配置必须同步更新，否则规则会静默失效。',
    )
  }
}

export const ignoredDirectories = new Set([
  '.git',
  '.refactor-backup',
  '.turbo',
  'build',
  'dist',
  'generated',
  'node_modules',
  'target',
])

export const sourceExtensions = new Set(['.ts', '.tsx'])

const isProductionSource = (file) =>
  !/\.(?:test|spec)\.[jt]sx?$/.test(file) && !file.includes('/__tests__/')

const inDirectory = (directory) => (file) =>
  isProductionSource(file) && file.startsWith(`${directory}/`)

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const alternation = (values) => values.map(escapeForRegExp).join('|')

/*
 * 依赖方向。
 *
 * 层次不是从目录名或包名前缀推断的 —— 上一版正是这么做的，命名法一改
 * 规则就整体失效，而且失效时不报错。这里是一张显式的表，加载时逐条断言。
 *
 * 分层依据是工作区 manifest 里真实存在的那些边，不是设想中的目标态。
 * 每一条现存的边都指向同层或更低层，所以这套规则开启时零违规。
 *
 * transport 与 composition 分成两层，而不是合成一个 "platform"：
 * ipc 只依赖 acp，被 settings / desktop-adapters / desktop 依赖，位置在 features
 * 之下；desktop-adapters 依赖 agents + ipc + settings，且只被应用入口
 * 依赖，位置在 features 之上。上一版把两者塞进同一层，于是不得不写一段注释
 * 解释为什么 platform 可以反向依赖 features。分开之后，那个破例不存在了。
 */
const tiers = [
  { name: 'foundations', packages: ['core', 'observability', 'serialization', 'ui'] },
  { name: 'protocol', packages: ['acp'] },
  { name: 'domain', packages: ['agent-session', 'agent-timeline', 'agents'] },
  { name: 'transport', packages: ['ipc'] },
  { name: 'features', packages: ['agent-ui', 'settings', 'workspace'] },
  { name: 'composition', packages: ['desktop-adapters'] },
  { name: 'application', packages: ['desktop'] },
]

/* 只有这三个包可以直连原生宿主。其余任何一个碰 @tauri-apps 都是越界。 */
const nativeAllowed = new Set(['desktop', 'desktop-adapters', 'ipc'])

/*
 * 分层表与工作区对账，一次做完。
 *
 * 上一版把这件事拆成三段各自为政地跑：directoryOf 逐包 existsSync、一段循环找
 * 「磁盘上多出来的包」、再一段循环核对包名。表里写了一个磁盘上已经不存在的包时，
 * directoryOf 在第一个受害者身上直接抛 —— 整个检查器死在模块加载期，一次只报一
 * 个名字，改完再跑再报下一个。run.mjs 开头写着 "Never short-circuits."，这份配
 * 置却把那条原则毁在了加载阶段。
 *
 * 现在工作区只扫一次，两个方向与包名核对合并成一份清单，一次抛全。
 */
const workspacePackages = new Map()

for (const root of sourceRoots) {
  for (const entry of readdirSync(path.join(repositoryRoot, root), { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const directory = `${root}/${entry.name}`

    if (existsSync(path.join(repositoryRoot, directory, 'package.json'))) {
      workspacePackages.set(entry.name, directory)
    }
  }
}

const placed = new Map()
const mismatches = []

for (const [index, tier] of tiers.entries()) {
  for (const pkg of tier.packages) {
    if (placed.has(pkg)) {
      mismatches.push(`"${pkg}" 被放进了不止一层`)
      continue
    }

    placed.set(pkg, index)

    const directory = workspacePackages.get(pkg)

    if (directory === undefined) {
      mismatches.push(`分层表里的 "${pkg}" 在磁盘上不存在 —— 包删除或改名后必须同步这张表`)
      continue
    }

    /* 允许集按包名拼装，所以包名与目录名必须一致，否则规则会指向错误的东西。 */
    const declared = JSON.parse(
      readFileSync(path.join(repositoryRoot, directory, 'package.json'), 'utf8'),
    ).name

    if (declared !== `@poietica/${pkg}`) {
      mismatches.push(`${directory} 的包名是 "${declared}"，与目录名不一致`)
    }
  }
}

/* 新增一个包却没有给它定层，就在这里失败 —— 而不是安静地不受任何方向约束。 */
for (const [pkg, directory] of workspacePackages) {
  if (!placed.has(pkg)) {
    mismatches.push(`${directory} 没有出现在分层表里 —— 新增包必须先声明它属于哪一层`)
  }
}

/*
 * pnpm-workspace.yaml 把 tests 列为工作区包，但分层只覆盖 sourceRoots，所以
 * 上面那条「新增包必须先定层」抓不到它。洞就是洞 —— 显式豁免比隐式遗漏可信。
 */
if (!existsSync(path.join(repositoryRoot, 'tests', 'package.json'))) {
  mismatches.push('tests/package.json 不存在 —— 豁免名单必须与 pnpm-workspace.yaml 一致')
}

if (mismatches.length > 0) {
  throw new Error(
    ['architecture: 分层表与工作区对不上：', ...mismatches.map((item) => `  · ${item}`)].join('\n'),
  )
}

/*
 * 判据是 import 说明符，不是包名在文本里出现过。后行断言零宽，match.index
 * 仍落在包名上，报出来的列号才继续指着出问题的那个字。
 */
const SPECIFIER = String.raw`(?<=(?:from|import)\s*\(?\s*['"])`

const tierRules = [...placed].flatMap(([pkg, index]) => {
  const allowed = tiers.slice(0, index + 1).flatMap((tier) => tier.packages)
  const forbidden = [`${SPECIFIER}@poietica/(?!(?:${alternation(allowed)})['"/])[\\w-]+`]

  if (!nativeAllowed.has(pkg)) {
    forbidden.push(`${SPECIFIER}@tauri-apps/[\\w-]+`)
  }

  return [
    {
      id: `${pkg}-depends-downward`,
      appliesTo: inDirectory(workspacePackages.get(pkg)),
      pattern: new RegExp(forbidden.join('|'), 'g'),
      message: `${pkg}（${tiers[index].name}）只能依赖 ${allowed.join(', ')}`,
    },
    /*
     * 包名指回自己，上面那条抓不到 —— allowed 是「自己这一层及以下」，自然
     * 含自己，负向断言当场落空。另外两条也各差一格：public-package-exports
     * 管的是 src/ 深路径，no-cross-boundary-relative-imports 管的是相对路径
     * 跨包。三条围了一圈，恰好漏掉这一个方向 —— 于是 agent-timeline 里
     * index → timeline-reducer → index 成了一个模块环，只因为全是 import
     * type 才没在运行时炸，而检查器一路报着 Architecture rules passed.
     *
     * 包入口是给别人看的那道边界。自己人绕它一圈，这道边界就是假的。
     */
    {
      id: `${pkg}-owns-its-entry`,
      appliesTo: inDirectory(workspacePackages.get(pkg)),
      pattern: new RegExp(`${SPECIFIER}@poietica/${escapeForRegExp(pkg)}(?=['"/])`, 'g'),
      message: `${pkg} 不能用包名引用自己：包内走相对路径，否则包入口与模块互指成环`,
    },
  ]
})

/*
 * Design-system control geometry, motion, elevation and stacking are owned by
 * the --ui-* custom properties. Raw utility classes fork that authority.
 */
const restrictedUtilityClasses = [
  { token: 'h-8', replacement: 'h-[var(--ui-control-height-sm)]' },
  { token: 'h-9', replacement: 'h-[var(--ui-control-height-md)]' },
  { token: 'h-10', replacement: 'h-[var(--ui-control-height-lg)]' },
  { token: 'w-9', replacement: 'w-[var(--ui-control-height-md)]' },
  { token: 'duration-150', replacement: 'duration-[var(--ui-duration-fast)]' },
  { token: 'z-50', replacement: 'z-[var(--ui-z-popover)]' },
  { token: 'shadow-2xl', replacement: 'shadow-[var(--ui-shadow-xl)]' },
]

/* ════════════════════════════════════════════════════════════════════════
 * 治理判据 —— 与上面的 pattern 规则同住一张表、同一个汇报通道
 *
 * 这三条看的都不是「源文件里的正则」：一条看目录名，一条看 Cargo.toml，一条看
 * 文件体量。上一版把它们写成这份配置的加载期副作用，命中就 throw —— run.mjs
 * 开头写着 "Never short-circuits."，而这份文件上面那段注释刚刚痛斥过「把那条
 * 原则毁在加载阶段」，一屏之下就又犯了一次。加载期 throw 的代价是实的：目录名
 * 一旦踩线，pattern 规则与全部 tier 规则的结果都被掩掉，一次只看得见一个问题。
 *
 * 现在它们是 rules 里的普通行，只是用 check 而不是 pattern。遍历由 run.mjs 做
 * 一次，忽略名单只有 ignoredDirectories 一份，违规汇总只有一处。
 * ════════════════════════════════════════════════════════════════════════ */

/*
 * application / presentation / ports 是 DDD 的层名；services / stores / managers
 * / helpers / common / utils / types 不声明任何边界。上面那张 tiers 表已经用包边界
 * 承担了分层，包内部再套一套就是两套架构叠着。zed 的 crates 是 acp_thread /
 * agent_ui / project / settings_ui，codex-rs 是 core / protocol / thread-store，
 * VS Code 是 base / platform / editor / workbench —— 三家一个 DDD 层名都没有。
 * AGENTS.md 早就写了这条禁令，此前没有任何配置执行它。
 */
const forbiddenDirectoryNames = new Set([
  'application',
  'common',
  'helpers',
  'managers',
  'ports',
  'presentation',
  'services',
  'stores',
  'types',
  'utils',
])

const capabilityScopedDirectoryNames = (inventory) =>
  inventory.directories
    .filter((directory) => forbiddenDirectoryNames.has(path.basename(directory)))
    .map((directory) => ({
      file: directory,
      message: '目录名不声明能力边界：架构性目录只允许 contracts / domain / state / ui',
    }))

/*
 * docs/architecture/rust-layers.md 的「规则」一节有四条。这里执行其中三条：
 * 不依赖 tauri、互不依赖、必须写 [lints] workspace = true。第四条「领域实体
 * 定义在 native crate，不在 src-tauri」判不了 —— 那需要语义分析，不是正则或
 * 清单能做的事，所以不假装它被守住了。体量棘轮从旁侧压住同一个方向。
 */
const nativeCrates = ['agent-runtime', 'desktop-runtime', 'persistence']

const nativeCratesStayHostAgnostic = async (inventory) => {
  const present = new Set(inventory.files)
  const defects = []

  for (const crate of nativeCrates) {
    const manifest = `crates/${crate}/Cargo.toml`

    if (!present.has(manifest)) {
      defects.push({ file: manifest, message: 'native crate 清单与磁盘不一致：这个文件不存在' })
      continue
    }

    const source = await inventory.read(manifest)

    /* 精确切出 [lints] 段。宽松匹配会被 [dependencies] 里的
     * serde = { workspace = true } 假通过。 */
    const lints = /\n\[lints\]\r?\n([\s\S]*?)(?=\n\[|$)/.exec(`\n${source}`)

    if (lints === null || !/^\s*workspace\s*=\s*true\s*$/m.test(lints[1])) {
      defects.push({
        file: manifest,
        message: '缺少 [lints] workspace = true：工作区的 unsafe_code 与 non_ascii_idents 不生效',
      })
    }

    if (/^\s*tauri[\w.-]*\s*=/m.test(source)) {
      defects.push({ file: manifest, message: '依赖了 tauri：宿主耦合只允许出现在 src-tauri' })
    }

    for (const edge of source.matchAll(/path\s*=\s*"\.\.\/([\w-]+)"/g)) {
      if (edge[1] !== crate && nativeCrates.includes(edge[1])) {
        defects.push({
          file: manifest,
          message: `依赖了 crates/${edge[1]}：三个 native crate 必须互不依赖`,
        })
      }
    }
  }

  for (const file of inventory.files) {
    if (!file.startsWith('crates/') || !file.endsWith('.rs') || /(?:^|\/)tests\//.test(file)) {
      continue
    }

    const hit = /\btauri(?:_[a-z_]+)?\s*::/.exec(await inventory.read(file))

    if (hit !== null) {
      defects.push({ file, message: `引用了 ${hit[0]}：native crate 不得耦合宿主` })
    }
  }

  return defects
}

/*
 * rust-layers.md 的「已知偏差」点名了 commands/agent.rs、agent_config.rs、
 * agent_install.rs，写着这些是待偿还的债。债写在文档里等于没有债 —— 没有任何
 * 东西阻止它继续长大。专业做法是 baseline ratchet（TypeScript 的 baseline 快照、
 * Chromium 的 DEPS 白名单），不是 markdown 里的一段自我批评。size-budget.json
 * 是实测生成的，不是手抄的：基线内只许变小，基线外不得越线，还完了要删行。
 */
const budgetPath = path.join(import.meta.dirname, 'size-budget.json')

const isGovernedSource = (file) =>
  /\.(?:rs|ts|tsx)$/.test(file) && isProductionSource(file) && !/(?:^|\/)tests\//.test(file)

/* CRLF checkout 不该把基线整体顶高，所以按归一后的换行计长度。 */
const measureBytes = (source) => source.split('\r\n').join('\n').length

const fileSizeRatchet = async (inventory) => {
  if (!existsSync(budgetPath)) {
    const file = 'tests/architecture/size-budget.json'

    return [{ file, message: '棘轮没有基线等于没有闸门：用实测结果生成这个文件' }]
  }

  const budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
  const frozen = new Map(Object.entries(budget.files))
  const present = new Set(inventory.files)
  const defects = []

  for (const [file, allowance] of frozen) {
    if (!present.has(file)) {
      defects.push({ file, message: '基线里的文件已不存在：债还完了就删掉这一行，不留幽灵' })
      continue
    }

    const actual = measureBytes(await inventory.read(file))

    if (actual > allowance) {
      defects.push({ file, message: `从 ${allowance} 涨到 ${actual} 字节：体量债只允许下降` })
    }
  }

  for (const file of inventory.files) {
    if (!isGovernedSource(file) || frozen.has(file)) {
      continue
    }

    const actual = measureBytes(await inventory.read(file))

    if (actual > budget.limit) {
      defects.push({ file, message: `${actual} 字节超过 ${budget.limit} 上限：拆成有名字的模块` })
    }
  }

  return defects
}

/*
 * 工作区 manifest 的公共契约面。
 *
 * 判据版本：v4（重复脚本 + shell 编排）
 *
 * 十四份 manifest 此前四套写法并存：main/types 与 exports 并存（Bundler 解析下
 * 前两者永远读不到 —— workspace 与 ui 两个包根本没声明，照样跑得通，这是同一个
 * 仓库里的对照实验）；同一个 .ts 目标一半写裸串一半写 { types, default }，而对象
 * 里两个条件指的是同一个文件；子路径名一半照 src/ 下的路径、一半照框架名。Biome
 * 的 useSortedKeys 是 off，turbo 不看 manifest 形状，tsc 只看解析结果 —— 这些此前
 * 不受任何工具约束。
 *
 * 判据只写这份文件自己能证明的事。曾经这里断言过「check 没有调用方」，那需要穷举
 * 全仓所有调用路径 —— 规则做不到，于是成了硬编码断言，两轮都被证伪（一次是根
 * package.json 的同名聚合脚本，一次是未跟踪的 quality.yml.bak）。现在的判据都不
 * 需要外部知识：重复脚本、shell 编排，看 manifest 自己就能判。
 *
 * 双下划线目录（__fixtures__ 与 __tests__ 同族）不进公共路径名，显式豁免。
 * tests/package.json 不在 inventoryRoots 里，这条规则够不着它 —— 洞就是洞。
 */
const CONVENTION_EXEMPT_TARGET = /\/__[\w-]+__\//

/* 编排型工具：同一个 script 里出现两次，那就是在 shell 里排 task。 */
const ORCHESTRATED_TOOLS = ['tsc', 'vitest', 'biome']

const canonicalSubpath = (target) =>
  `./${target.replace(/^\.\/src\//, '').replace(/(?:\/index)?\.tsx?$/, '')}`

const manifestExportDefects = (file, exportMap) =>
  Object.entries(exportMap).flatMap(([subpath, target]) => {
    if (typeof target !== 'string') {
      return [
        {
          file,
          message: `exports["${subpath}"] 用了条件对象：目标是 .ts，types 与 default 同值`,
        },
      ]
    }

    if (subpath === '.' || !/\.tsx?$/.test(target) || CONVENTION_EXEMPT_TARGET.test(target)) {
      return []
    }

    const expected = canonicalSubpath(target)

    return subpath === expected
      ? []
      : [{ file, message: `exports["${subpath}"] 指向 ${target}，子路径名必须是 ${expected}` }]
  })

/*
 * 两个脚本一字不差 —— 调用方分不清该用哪个，而其中一个注定不会被更新。
 */
const manifestScriptDefects = (file, scripts) => {
  const seen = new Map()

  return Object.entries(scripts ?? {}).flatMap(([name, body]) => {
    const twin = seen.get(body)

    if (twin === undefined) {
      seen.set(body, name)

      return []
    }

    return [{ file, message: `脚本 "${name}" 与 "${twin}" 一字不差：同一件事两个名字` }]
  })
}

/*
 * 同一个 script 里用 && 串起两次同一个程序 —— 那是 task 编排：前一个红了后一个
 * 不跑，两份结果也汇不到一处，缓存粒度还被绑死成一个黑盒。这个仓库有 turbo，
 * 编排是它的活。只认同名程序：vite build && tauri build 是真的顺序依赖，不在此列。
 */
const manifestOrchestrationDefects = (file, scripts) =>
  Object.entries(scripts ?? {}).flatMap(([name, body]) => {
    const segments = body.split('&&').map((part) => part.trim())

    if (segments.length < 2) {
      return []
    }

    return ORCHESTRATED_TOOLS.filter((tool) => {
      const invocation = new RegExp(`(?:^|\\s)${tool}(?:\\s|$)`)

      return segments.filter((segment) => invocation.test(segment)).length > 1
    }).map((tool) => ({
      file,
      message: `脚本 "${name}" 用 && 串了两次 ${tool}：前一个红了后一个不跑，编排交给 turbo 的 task 图`,
    }))
  })

/* pnpm-workspace.yaml 声明了 saveExact，版本只能来自 catalog: 或精确号。 */
const manifestVersionDefects = (file, manifest) =>
  ['dependencies', 'devDependencies'].flatMap((block) =>
    Object.entries(manifest[block] ?? {})
      .filter(([, range]) => /^[\^~]/.test(range))
      .map(([dep, range]) => ({
        file,
        message: `${block}.${dep} 是范围 "${range}"：saveExact 之下版本只能来自 catalog: 或精确号`,
      })),
  )

const workspaceManifestConventions = async (inventory) => {
  const defects = []

  for (const file of inventory.files) {
    if (!/^(?:apps|packages)\/[\w-]+\/package\.json$/.test(file)) {
      continue
    }

    const manifest = JSON.parse(await inventory.read(file))

    if (manifest.exports !== undefined) {
      for (const field of ['main', 'types']) {
        if (manifest[field] !== undefined) {
          defects.push({
            file,
            message: `"${field}" 与 exports 并存：Bundler 解析只读 exports，这一行永远不生效`,
          })
        }
      }

      defects.push(...manifestExportDefects(file, manifest.exports))
    }

    for (const entry of manifest.sideEffects ?? []) {
      if (typeof entry === 'string' && entry.startsWith('*') && !entry.startsWith('**/')) {
        defects.push({
          file,
          message: `sideEffects "${entry}" 不含 **/：各家 bundler 对无斜杠 glob 的匹配基准不一致`,
        })
      }
    }

    defects.push(...manifestScriptDefects(file, manifest.scripts))
    defects.push(...manifestOrchestrationDefects(file, manifest.scripts))
    defects.push(...manifestVersionDefects(file, manifest))
  }

  return defects
}

const governanceRules = [
  { id: 'capability-scoped-directory-names', check: capabilityScopedDirectoryNames },
  { id: 'native-crates-stay-host-agnostic', check: nativeCratesStayHostAgnostic },
  { id: 'file-size-ratchet', check: fileSizeRatchet },
  { id: 'workspace-manifest-conventions', check: workspaceManifestConventions },
]

export const rules = [
  {
    id: 'public-package-exports',
    appliesTo: isProductionSource,
    pattern: /from\s+['"]@poietica\/[^'"]+\/src\//g,
    message: 'cross-package imports must use public package exports, not src/ deep paths',
  },
  {
    id: 'no-cross-boundary-relative-imports',
    appliesTo: isProductionSource,
    pattern: /from\s+['"](?:\.\.\/){2,}(?:apps|packages)\//g,
    message: 'relative imports must not cross top-level package boundaries',
  },
  ...tierRules,
  {
    id: 'design-system-token-authority',
    appliesTo: inDirectory('packages/ui/src/components'),
    pattern: new RegExp(
      '(?<![\\w-])(?:' +
        alternation(restrictedUtilityClasses.map((rule) => rule.token)) +
        ')(?![\\w-])',
      'g',
    ),
    message: 'design-system components must consume --ui-* tokens instead of raw utility classes',
    hint: (match) =>
      restrictedUtilityClasses.find((rule) => rule.token === match)?.replacement ?? null,
  },
  ...governanceRules,
]
