use log::LevelFilter;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// 日志落点。
///
/// Stdout 只在 debug 注册：release 是 windows 子系统进程，没有附着的控制台，
/// 那个 target 的每一次写入都是纯开销。
///
/// 轮转策略与单文件上限显式声明，不吃插件默认值 —— 这份日志落在用户自己的
/// %LOCALAPPDATA% 里，无人看管地长下去是我们的问题，不是用户的。
pub fn plugin() -> tauri_plugin_log::Builder {
    let builder = tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some("poietica".to_owned()),
            }),
            Target::new(TargetKind::Webview),
        ])
        .rotation_strategy(RotationStrategy::KeepOne)
        .max_file_size(5_000_000)
        .timezone_strategy(TimezoneStrategy::UseLocal);

    if cfg!(debug_assertions) {
        builder
            .target(Target::new(TargetKind::Stdout))
            .level(LevelFilter::Debug)
    } else {
        builder.level(LevelFilter::Info)
    }
}
