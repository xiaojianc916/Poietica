#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const PACKAGE_PATH = path.join(ROOT, 'package.json')
const BIOME_CONFIG_PATH = path.join(ROOT, 'biome.json')

async function main() {
  await assertRepository()
  const biomeVersion = await readBiomeVersion()

  await updateBiomeSchema(biomeVersion)

  writeOutput(`Biome 配置版本已同步到 ${biomeVersion}。\n`)
  writeOutput('开始应用 Biome 安全及 unsafe lint 修复……\n')

  runBiome(['lint', '--write', '--unsafe', '.'])

  writeOutput('\n开始格式化修改后的文件……\n')
  runBiome(['format', '--write', '.'])

  writeOutput('\n检查代码格式……\n')
  runBiome(['format', '.'])

  writeOutput('\n执行最终静态检查……\n')
  runBiome(['lint', '--max-diagnostics=none', '.'])

  writeOutput('\nBiome 修复及检查全部通过。\n')
}

async function assertRepository() {
  const packageJson = await readJson(PACKAGE_PATH)

  if (packageJson.name !== 'hybrid-canvas') {
    throw new Error(
      '当前目录不是 Hybrid Canvas 仓库根目录，请在 D:\\xiaojianc\\hybrid-canvas 中运行脚本。',
    )
  }
}

async function readBiomeVersion() {
  const packageJson = await readJson(PACKAGE_PATH)
  const biomeVersion = packageJson.devDependencies?.['@biomejs/biome']

  if (typeof biomeVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(biomeVersion)) {
    throw new Error('package.json 中的 @biomejs/biome 必须使用确定版本，例如 2.5.5。')
  }

  return biomeVersion
}

async function updateBiomeSchema(biomeVersion) {
  const biomeConfig = await readJson(BIOME_CONFIG_PATH)
  const expectedSchema = `https://biomejs.dev/schemas/${biomeVersion}/schema.json`

  if (biomeConfig.$schema === expectedSchema) {
    writeOutput(`biome.json 已使用 ${biomeVersion} schema，无需修改。\n`)
    return
  }

  biomeConfig.$schema = expectedSchema

  await writeFile(BIOME_CONFIG_PATH, `${JSON.stringify(biomeConfig, null, 2)}\n`, 'utf8')
}

async function readJson(filePath) {
  let source

  try {
    source = await readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`无法读取 ${path.relative(ROOT, filePath)}`, {
      cause: error,
    })
  }

  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`${path.relative(ROOT, filePath)} 不是合法 JSON`, {
      cause: error,
    })
  }
}

function runBiome(arguments_) {
  const biomeArguments = ['exec', 'biome', ...arguments_]

  const result =
    process.platform === 'win32'
      ? spawnSync(
          process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
          ['/d', '/s', '/c', ['pnpm', ...biomeArguments].join(' ')],
          {
            cwd: ROOT,
            stdio: 'inherit',
            windowsHide: true,
          },
        )
      : spawnSync('pnpm', biomeArguments, {
          cwd: ROOT,
          stdio: 'inherit',
        })

  if (result.error) {
    throw result.error
  }

  if (result.signal) {
    throw new Error(`Biome 命令被信号 ${result.signal} 终止。`)
  }

  if (result.status !== 0) {
    throw new Error(`Biome 命令执行失败，退出码：${String(result.status ?? 'unknown')}`)
  }
}

function writeOutput(message) {
  process.stdout.write(message)
}

main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)

  process.stderr.write(`\nBiome 修复失败：\n${message}\n`)
  process.exitCode = 1
})
