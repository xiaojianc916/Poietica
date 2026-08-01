#!/usr/bin/env node
/**
 * pnpm tauri 的入口。
 *
 * 只有一条规则：dev 子命令带上开发那份配置，别的一个字不动。
 *
 * 为什么需要它。根脚本里的 tauri 是个透传，dev、build、signer generate
 * 全走同一条；直接在那条上加 --config，signer 会因为一个它不认识的参数
 * 报错，build 会打出一个叫 Poietica Dev 的安装包发给用户。判断得有个地方
 * 做，这里就是那个地方 —— 而不是让每个人在敲命令时自己记得加。
 *
 * 已经自己带了 --config 的调用原样放行：那是调用者比这里更清楚要什么。
 */

import { spawn } from 'node:child_process'
import process from 'node:process'

/** 开发运行的那份配置，相对 src-tauri。 */
const DEV_CONFIG = 'src-tauri/tauri.dev.conf.json'

const args = process.argv.slice(2)

const developing = args[0] === 'dev'
const chosen = args.includes('--config') || args.includes('-c')

const forwarded = developing && !chosen ? [...args, '--config', DEV_CONFIG] : args

const command = ['pnpm', '--filter', '@poietica/desktop', 'exec', 'tauri', ...forwarded]

/* Windows 上 pnpm 是一个 .cmd，只有走 shell 才找得到它。于是参数要自己
带引号 —— 带空格的路径（tauri signer generate -w 就常常是）不加引号会被
cmd 切成两段。 */
const quoted = command.map((part) => (/[\s"]/.test(part) ? JSON.stringify(part) : part))

const child = spawn(quoted.join(' '), { stdio: 'inherit', shell: true })

/* Ctrl+C 到达的是整个进程组，子进程自己收得到。这里不跟着退：退了就把
tauri dev 留成孤儿，而它下面还挂着一个 Vite 和一个 cargo。等它自己收完尾，
用它的退出码当自己的退出码。 */
process.on('SIGINT', () => {})
process.on('SIGTERM', () => {})

child.on('exit', (code, signal) => {
  process.exit(signal === null ? (code ?? 1) : 1)
})

child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
