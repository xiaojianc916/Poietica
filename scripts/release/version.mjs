/**
 * 发布脚本共享的版本号工具。
 *
 * release.mjs（预设下一版本、校验手动输入）与 set-version.mjs（写入前校验）曾各
 * 自维护一份正则；抽到这里，改一处即可。bumped 只对三段数字自增：带预发布号的
 * 版本（0.2.0-beta.1）先剥掉尾巴再算，否则会算出 0.2.NaN。
 */

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function bumped(version) {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number)
  return {
    patch: [major, minor, patch + 1].join('.'),
    minor: [major, minor + 1, 0].join('.'),
    major: [major + 1, 0, 0].join('.'),
  }
}
