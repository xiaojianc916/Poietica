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

for (const root of sourceRoots) {
  if (!existsSync(path.join(repositoryRoot, root))) {
    throw new Error(
      `architecture: sourceRoots 声明了不存在的目录 "${root}"。` +
        '目录被移动或删除后，这份配置必须同步更新，否则规则会静默失效。',
    )
  }
}

export const ignoredDirectories = new Set([
  '.git',
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
 * 分层依据是十五份 manifest 里真实存在的三十条工作区边，不是设想中的目标态。
 * 每一条现存的边都指向同层或更低层，所以这套规则开启时零违规。
 *
 * transport 与 composition 分成两层，而不是合成一个 "platform"：
 * ipc 只依赖 acp，被 settings / desktop-runtime / desktop 依赖，位置在 features
 * 之下；desktop-runtime 依赖 agent-registry + ipc + settings，且只被应用入口
 * 依赖，位置在 features 之上。上一版把两者塞进同一层，于是不得不写一段注释
 * 解释为什么 platform 可以反向依赖 features。分开之后，那个破例不存在了。
 */
const tiers = [
  { name: 'foundations', packages: ['core', 'observability', 'serialization', 'ui'] },
  { name: 'protocol', packages: ['acp'] },
  {
    name: 'domain',
    packages: ['agent-providers', 'agent-registry', 'agent-session', 'agent-timeline'],
  },
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
]

/* ════════════════════════════════════════════════════════════════════════
 * 地基治理
 *
 * 为什么写在这份配置里而不是新开一个 check-*.mjs：run.mjs 有一条
 * no-task-scoped-guards —— tests/architecture/ 下任何 check-*.mjs 一律判违规。
 * 规则必须住在配置里，这是这个仓库自己定的、也是对的。
 *
 * 下面全部是加载期对账，与上面「分层表与磁盘包一一对账」共用同一个失败通道：
 * 一次收集，一次抛出，pnpm test:architecture 直接红。
 * ════════════════════════════════════════════════════════════════════════ */

const governanceRoot = path.resolve(import.meta.dirname, '..', '..')
const governanceRoots = ['apps', 'crates', 'packages']
const governanceIgnored = new Set([
  '.git',
  '.refactor-backup',
  '.turbo',
  'build',
  'dist',
  'generated',
  'node_modules',
  'target',
])

/* 换行符归一后再量，避免 CRLF checkout 把体量基线整体顶高 */
const measureBytes = (absolute) => readFileSync(absolute, 'utf8').split('\r\n').join('\n').length

const isGovernedSource = (file) =>
  /\.(?:rs|ts|tsx)$/.test(file) &&
  !/\.(?:test|spec)\.[jt]sx?$/.test(file) &&
  !file.includes('/__tests__/') &&
  !/(?:^|\/)tests\//.test(file)

const governedFiles = []
const governedDirectories = []

const walkGoverned = (relative) => {
  for (const entry of readdirSync(path.join(governanceRoot, relative), { withFileTypes: true })) {
    const next = relative + '/' + entry.name

    if (entry.isDirectory()) {
      if (governanceIgnored.has(entry.name)) continue
      governedDirectories.push(next)
      walkGoverned(next)
      continue
    }

    if (entry.isFile()) governedFiles.push(next)
  }
}

for (const root of governanceRoots) walkGoverned(root)

const defects = []

/* ── 1. 目录名必须声明能力边界 ─────────────────────────────────────────
 * application / presentation / ports 是 DDD 的层名；services / stores /
 * managers / helpers / common / utils / types 根本不声明任何边界。
 *
 * 上面那张 tiers 表已经用包边界承担了分层 —— 包内部再套第二套分层就是两套架构
 * 叠在一起。zed 的 crates/ 是 acp_thread、agent_ui、project、settings_ui；
 * codex-rs 是 core、protocol、app-server-transport、thread-store；VS Code 是
 * base/platform/editor/workbench + common/browser/node。三家一个 DDD 层名都没有。
 *
 * AGENTS.md 早就写了这条禁令（且只限根级），此前没有任何配置执行它。
 * 架构性目录名只允许四个：contracts / domain / state / ui。 */
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

for (const directory of governedDirectories) {
  const name = directory.slice(directory.lastIndexOf('/') + 1)

  if (forbiddenDirectoryNames.has(name)) {
    defects.push(
      directory +
        ' 的目录名不声明能力边界 —— 架构性目录只允许 contracts / domain / state / ui，其余必须是具体能力名',
    )
  }
}

/* ── 2. Rust 分层规则从文档变成闸门 ───────────────────────────────────
 * docs/architecture/rust-layers.md 写了四条硬规则：三个 native crate 不得依赖
 * tauri、不得互相依赖、领域实体不留在 src-tauri、每个 crate 必须写
 * [lints] workspace = true。此前一条都没有机器执行。
 *
 * 而这份配置的注释自己痛斥过 TS 侧「十四个包一行没被扫过，Architecture rules
 * passed. 是空转出来的绿」—— Rust 侧原封不动重演了同一个错误。现在补上。 */
const nativeCrates = ['agent-runtime', 'desktop-runtime', 'persistence']

for (const crate of nativeCrates) {
  const manifestPath = path.join(governanceRoot, 'crates', crate, 'Cargo.toml')

  if (!existsSync(manifestPath)) {
    defects.push('crates/' + crate + '/Cargo.toml 不存在 —— native crate 清单必须与磁盘一致')
    continue
  }

  const manifest = readFileSync(manifestPath, 'utf8')

  /* 精确取 [lints] 段。不能用宽松匹配 —— [dependencies] 里的
   * serde = { workspace = true } 会让宽松匹配假通过。 */
  const lintsSection = /\n\[lints\]\r?\n([\s\S]*?)(?=\n\[|$)/.exec('\n' + manifest)

  if (!lintsSection || !/^\s*workspace\s*=\s*true\s*$/m.test(lintsSection[1])) {
    defects.push(
      'crates/' +
        crate +
        '/Cargo.toml 缺少 [lints] workspace = true —— 工作区的 unsafe_code = "deny" 与 non_ascii_idents = "forbid" 对它不生效',
    )
  }

  if (/^\s*tauri[\w.-]*\s*=/m.test(manifest)) {
    defects.push(
      'crates/' + crate + '/Cargo.toml 依赖了 tauri —— 宿主耦合只允许出现在 apps/desktop/src-tauri',
    )
  }

  for (const other of nativeCrates) {
    if (other === crate) continue

    if (new RegExp('path\\s*=\\s*"\\.\\./' + other + '"').test(manifest)) {
      defects.push(
        'crates/' + crate + ' 依赖了 crates/' + other + ' —— 三个 native crate 必须互不依赖',
      )
    }
  }
}

for (const file of governedFiles) {
  if (!file.startsWith('crates/') || !file.endsWith('.rs')) continue
  if (/(?:^|\/)tests\//.test(file)) continue

  const hit = /\btauri(?:_[a-z_]+)?\s*::/.exec(
    readFileSync(path.join(governanceRoot, file), 'utf8'),
  )

  if (hit) defects.push(file + ' 引用了 ' + hit[0] + ' —— native crate 不得耦合宿主')
}

/* ── 3. 体量债棘轮 ───────────────────────────────────────────────────
 * rust-layers.md 的「已知偏差」点名了 commands/agent.rs、agent_config.rs、
 * agent_install.rs、asset_protocol.rs，写着「这些是待偿还的债」。债被写进文档，
 * 却没有任何东西阻止它继续长大 —— 文档里的债等于没有债。
 *
 * 专业做法是 baseline ratchet（TypeScript 的 baseline 快照、Chromium 的 DEPS
 * 白名单），不是 markdown 里的一段自我批评。size-budget.json 由 refactor.mjs
 * 实测生成，不是手抄的。两条规则：基线里的文件只能变小；基线外的不得越过上限。 */
const budgetPath = path.join(import.meta.dirname, 'size-budget.json')

if (!existsSync(budgetPath)) {
  defects.push('tests/architecture/size-budget.json 缺失 —— 棘轮没有基线等于没有闸门')
} else {
  const budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
  const frozen = new Map(Object.entries(budget.files))

  for (const [file, allowance] of frozen) {
    const absolute = path.join(governanceRoot, file)

    if (!existsSync(absolute)) {
      defects.push(file + ' 已不存在 —— 债还完了就把这一行从 size-budget.json 删掉，基线不留幽灵')
      continue
    }

    const actual = measureBytes(absolute)

    if (actual > allowance) {
      defects.push(file + ' 从 ' + allowance + ' 涨到 ' + actual + ' 字节 —— 体量债只允许下降')
    }
  }

  for (const file of governedFiles) {
    if (!isGovernedSource(file) || frozen.has(file)) continue

    const actual = measureBytes(path.join(governanceRoot, file))

    if (actual > budget.limit) {
      defects.push(
        file +
          ' 有 ' +
          actual +
          ' 字节，超过 ' +
          budget.limit +
          ' 字节上限 —— 拆成有名字的模块，不要长成上帝文件',
      )
    }
  }
}

/* ── 4. 把规则洞显式记下来 ───────────────────────────────────────────
 * pnpm-workspace.yaml 把 tests 列为工作区包（tests/package.json 存在），但分层
 * 对账只遍历 apps 与 packages，所以「新增包必须先定层」抓不到它。
 * 洞就是洞 —— 显式豁免比隐式遗漏可信。 */
for (const directory of ['tests']) {
  if (!existsSync(path.join(governanceRoot, directory, 'package.json'))) {
    defects.push(directory + '/package.json 不存在 —— 豁免名单必须与 pnpm-workspace.yaml 一致')
  }
}

if (defects.length > 0) {
  throw new Error(
    ['architecture: 地基治理未通过：', ...defects.map((defect) => '  · ' + defect)].join('\n'),
  )
}
