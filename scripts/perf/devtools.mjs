/**
 * 一个够用的 DevTools Protocol 客户端。
 *
 * Chromium 开着 CDP，Node 26 自带 fetch 与 WebSocket，所以采样零依赖，也不必
 * 往产品代码里塞任何 performance.mark。
 *
 * 请求应答之外还要收事件：页面里的异常和 console 是通过事件出来的，收不到它们
 * 的测量工具看不见被测对象报错，等于没有。
 */

/** 挑出那个真正渲染界面的 target。 */
export async function findPage(endpoint, match) {
  const response = await fetch(endpoint + '/json/list')
  const targets = await response.json()

  return targets.find(
    (target) =>
      target.type === 'page' &&
      typeof target.webSocketDebuggerUrl === 'string' &&
      (match === undefined || String(target.url).includes(match)),
  )
}

export function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  const handlers = new Map()

  let next = 0

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)

    /* 没有 id 的是事件。 */
    if (message.id === undefined) {
      handlers.get(message.method)?.(message.params)

      return
    }

    const settle = pending.get(message.id)

    if (settle === undefined) {
      return
    }

    pending.delete(message.id)

    if (message.error) {
      settle.reject(new Error(message.error.message))

      return
    }

    settle.resolve(message.result)
  })

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve()
    })
    socket.addEventListener('error', () => {
      reject(new Error('devtools socket refused the connection'))
    })
  })

  return {
    ready,
    on: (method, handler) => {
      handlers.set(method, handler)
    },
    close: () => {
      socket.close()
    },
    send: (method, params = {}) => {
      next += 1

      const id = next

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

/** 轮询到有结果为止。 */
export async function until(probe, timeout, interval = 250) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined)

    if (value !== undefined && value !== null && value !== false) {
      return value
    }

    await new Promise((resolve) => {
      setTimeout(resolve, interval)
    })
  }

  return undefined
}

/** 把一份 CPU 剖面按 self time 摊平成排行榜。 */
export function rankCpu(profile) {
  const self = new Map()

  for (let index = 0; index < profile.samples.length; index += 1) {
    const id = profile.samples[index]
    const delta = profile.timeDeltas[index] ?? 0

    self.set(id, (self.get(id) ?? 0) + Math.max(delta, 0))
  }

  return group(profile.nodes, (node) => self.get(node.id) ?? 0)
}

/** 把一棵 samplingHeapProfile 拍平成排行榜。 */
export function rankHeap(head) {
  const nodes = []
  const walk = (node) => {
    nodes.push(node)

    for (const child of node.children ?? []) {
      walk(child)
    }
  }

  walk(head)

  return group(nodes, (node) => node.selfSize ?? 0)
}

function group(nodes, weigh) {
  const totals = new Map()

  for (const node of nodes) {
    const weight = weigh(node)

    if (weight <= 0) {
      continue
    }

    const frame = node.callFrame
    const file = String(frame.url || '<native>')
      .split(/[\\/]/)
      .pop()
    const name = frame.functionName || '(anonymous)'
    const key = name + '  ' + file + ':' + String(frame.lineNumber + 1)

    totals.set(key, (totals.get(key) ?? 0) + weight)
  }

  return [...totals].sort((left, right) => right[1] - left[1])
}

/** 打前几名。再往下就是噪声了。 */
export function report(rows, unit, scale, top = 20) {
  const total = rows.reduce((sum, [, weight]) => sum + weight, 0)

  if (total === 0) {
    console.log('')
    console.log('no samples')

    return
  }

  console.log('')
  console.log('total ' + (total / scale).toFixed(1) + ' ' + unit)
  console.log('')

  for (const [key, weight] of rows.slice(0, top)) {
    const share = ((weight / total) * 100).toFixed(1).padStart(5)
    const value = (weight / scale).toFixed(1).padStart(9)

    console.log(share + '%  ' + value + ' ' + unit + '  ' + key)
  }
}
