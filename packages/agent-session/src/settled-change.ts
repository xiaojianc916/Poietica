import type { SessionConfigControl } from '@poietica/acp'

/**
 * 一次改动，问到收敛为止。
 *
 * ACP 的 set_config_option 回的是整张表，理由逐字是 changing one may add or
 * remove another —— 换模型会换掉推理档位的候选集。但答复只保证「被改的这一项已经
 * 改了」，不保证「依赖它的那几项已经跟着重算」：换模型那一趟回来的表里，模型是新
 * 的，推理档位还是上一个模型的整个控件，候选集与生效值一起旧。
 *
 * 屏幕上因此留着一个新模型根本不提供的档位。这不是本地缓存没清 —— 这一侧没有第二
 * 份状态可清：两台 store 都是整张表原样替换（agent-capability-store 的 #adopt、
 * session-controls-store 的 #remember），原生侧同样（driver.rs 的 clone_from、
 * config.rs 的 controls），全链路没有一处把两张表缝在一起，所以半新半旧只可能是
 * 答复本身就是半新半旧的。
 *
 * 也不是可以本地兜底的事：候选集由 agent 说了算，拿本机那份模型目录去纠正它，就是
 * 把同一件事变成两个产地 —— 那正是这个仓库上一次犯过并且已经删掉的错。
 *
 * 于是换模型不是一次往返，是一次事务：再问一次同一件事，拿它重算之后的那张表。值
 * 不变，对 agent 是幂等的；对用户是那一格终于写着这个模型真有的档位。
 *
 * 只有模型这一档需要。模式与推理档位自己不带依赖项，它们的答复当场就是收敛的。
 *
 * 它不认识端口、不认识 React、也不认识对话，所以两台 store 用的是同一条规则，而
 * 不是同一段抄写 —— 与 arrival-order 同一个形状。
 */
export async function settledChange(
  purpose: SessionConfigControl['purpose'] | undefined,
  send: () => Promise<readonly SessionConfigControl[]>,
): Promise<readonly SessionConfigControl[]> {
  const answered = await send()

  return purpose === 'model' ? send() : answered
}
