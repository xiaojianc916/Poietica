import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const changedFiles = []

function patchFile(relativePath, replacements) {
  const filePath = resolve(root, relativePath)

  if (!existsSync(filePath)) {
    throw new Error(`找不到文件：${relativePath}`)
  }

  const original = readFileSync(filePath, 'utf8')
  let content = original

  for (const replacement of replacements) {
    const { oldText, newText, description } = replacement

    if (content.includes(oldText)) {
      const count = content.split(oldText).length - 1

      content = content.replaceAll(oldText, newText)

      console.log(`已处理：${description}（${count} 处）`)
      continue
    }

    if (content.includes(newText)) {
      console.log(`已存在：${description}`)
      continue
    }

    throw new Error(
      [`无法完成修改：${description}`, `文件：${relativePath}`, `未找到：${oldText}`].join('\n'),
    )
  }

  if (content === original) {
    console.log(`跳过：${relativePath}`)
    return
  }

  writeFileSync(filePath, content, 'utf8')
  changedFiles.push(relativePath)
  console.log(`已修改：${relativePath}`)
}

/*
 * 1. foundations/observability
 */
patchFile('foundations/observability/src/diagnostic-buffer.test.ts', [
  {
    oldText: 'entry?.context.accessToken',
    newText: "entry?.context['accessToken']",
    description: '修复 diagnostic accessToken 索引访问',
  },
  {
    oldText: 'entry?.context.authorization',
    newText: "entry?.context['authorization']",
    description: '修复 diagnostic authorization 索引访问',
  },
  {
    oldText: 'entry?.context.endpoint',
    newText: "entry?.context['endpoint']",
    description: '修复 diagnostic endpoint 索引访问',
  },
  {
    oldText: 'entry?.context.cause',
    newText: "entry?.context['cause']",
    description: '修复 diagnostic cause 索引访问',
  },
  {
    oldText: 'entry?.context.circular',
    newText: "entry?.context['circular']",
    description: '修复 diagnostic circular 索引访问',
  },
])

/*
 * 2. editor/document
 */
patchFile('editor/document/src/application/canvas-document-service.ts', [
  {
    oldText: 'const code = details.code',
    newText: "const code = details['code']",
    description: '修复 release failure code 索引访问',
  },
  {
    oldText: 'const recoverable = details.recoverable',
    newText: "const recoverable = details['recoverable']",
    description: '修复 release failure recoverable 索引访问',
  },
])

/*
 * 3. platforms/desktop-ipc
 */
patchFile('platforms/desktop-ipc/src/error.ts', [
  {
    oldText: 'candidate.code',
    newText: "candidate['code']",
    description: '修复 IPC code 索引访问',
  },
  {
    oldText: 'candidate.message',
    newText: "candidate['message']",
    description: '修复 IPC message 索引访问',
  },
  {
    oldText: 'candidate.operation',
    newText: "candidate['operation']",
    description: '修复 IPC operation 索引访问',
  },
  {
    oldText: 'candidate.recoverable',
    newText: "candidate['recoverable']",
    description: '修复 IPC recoverable 索引访问',
  },
])

/*
 * 4. platforms/desktop-runtime
 */
patchFile('platforms/desktop-runtime/src/adapters/assets/native-tl-asset-store.ts', [
  {
    oldText: 'asset.meta?.hybridCanvasAssetToken',
    newText: "asset.meta?.['hybridCanvasAssetToken']",
    description: '修复 asset token 索引访问',
  },
  {
    oldText: 'asset.meta?.hybridCanvasContentHash',
    newText: "asset.meta?.['hybridCanvasContentHash']",
    description: '修复 asset content hash 索引访问',
  },
])

/*
 * 5. apps/desktop fatal collector
 */
patchFile('apps/desktop/src/fatal/fatal-collectors.ts', [
  {
    oldText: 'const payloadError = payload.error',
    newText: "const payloadError = payload['error']",
    description: '修复 Vite payload error 索引访问',
  },
  {
    oldText: 'const locationValue = rawError.location',
    newText: "const locationValue = rawError['location']",
    description: '修复 Vite error location 索引访问',
  },
])

/*
 * 6. apps/desktop fatal incident tests
 */
patchFile('apps/desktop/src/fatal/fatal-incident.test.ts', [
  {
    oldText: 'incident.context.accessToken',
    newText: "incident.context['accessToken']",
    description: '修复 incident accessToken 索引访问',
  },
  {
    oldText: 'incident.context.password',
    newText: "incident.context['password']",
    description: '修复 incident password 索引访问',
  },
  {
    oldText: 'incident.context.authorization',
    newText: "incident.context['authorization']",
    description: '修复 incident authorization 索引访问',
  },
  {
    oldText: 'incident.context.operation',
    newText: "incident.context['operation']",
    description: '修复 incident operation 索引访问',
  },
])

/*
 * 7. ui-feedback.tsx
 *
 * failure.impact 的实际静态类型是完整 FailureImpact，
 * 因此 impactLabel 必须处理全部 FailureImpact 分支。
 */
patchFile('apps/desktop/src/presentation/ui/ui-feedback.tsx', [
  {
    oldText: "function impactLabel(impact: NonTerminalFailureInput['impact']): string {",
    newText: 'function impactLabel(impact: FailureImpact): string {',
    description: '扩大 impactLabel 参数类型',
  },
  {
    oldText: `    case 'document-fatal':
      return '文档已隔离'
  }
}`,
    newText: `    case 'document-fatal':
      return '文档已隔离'

    case 'application-fatal':
      return '应用错误'

    case 'native-fatal':
      return '原生错误'
  }
}`,
    description: '补全 fatal impact 标签',
  },
])

console.log('')

if (changedFiles.length === 0) {
  console.log('所有 typecheck 修改均已存在。')
} else {
  console.log(`完成，共修改 ${changedFiles.length} 个文件：`)

  for (const file of changedFiles) {
    console.log(`- ${file}`)
  }
}

console.log('')
console.log('接下来执行：')
console.log('  pnpm exec biome check --write .')
console.log('  pnpm typecheck')
