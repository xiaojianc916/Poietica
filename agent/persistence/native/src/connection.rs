use std::fs::{File, remove_file, rename};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;

use crate::error::{Result, StoreError};
use crate::key::DatabaseKey;

/// How long a writer waits for the lock before giving up.
pub const DEFAULT_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// 明文 SQLite 文件的前 16 个字节。
const PLAINTEXT_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// 盘上那个文件是不是明文库。
///
/// 明文库的头 16 字节固定是上面那一串；SQLCipher 连文件头一起加密，所以
/// 加密库的那 16 字节是密文。这是官方用来区分两种文件的判据。
///
/// 不用「先试着开一下看报不报错」：那种做法分不清「密钥不对」和「文件本身
/// 坏了」—— 前者要转换，后者要如实报错，混在一起就会拿一个损坏的库去做
/// 转换，然后把失败归咎到密钥头上。
///
/// 文件不存在、或短得读不满 16 字节，都算明文：下面照常建一个新的明文库。
fn is_plaintext(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return true;
    };

    let mut header = [0_u8; 16];

    if file.read_exact(&mut header).is_err() {
        return true;
    }

    &header == PLAINTEXT_HEADER
}

/// SQLite 给主库文件起的两个附属文件名。
fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);

    PathBuf::from(name)
}

/// 把一个 `SQLCipher` 库就地换成明文库。每个旧文件只会发生一次。
///
/// 为什么不再加密：这个库里现在只剩 threads 一张表七列元数据 —— 0009 把
/// run_events / run_snapshots / tool_calls / permissions / runs 全删了，那条
/// 迁移的注释逐字写着「历史从此只有一份，在 agent 那边」。整段对话以明文
/// 躺在 agent 自己的存储里，同一块盘同一个账户；加密这里的 24 字标题挡不住
/// 任何能读到那份明文的人，却换来「钥匙串不可用就打不开对话列表」这一类
/// 纯亏的失败。
///
/// 这段代码是一次性迁移，不是兼容层：sqlcipher_export 只存在于链了
/// `SQLCipher` 的构建里，所以必须先发这一版把旧库都转完，下一版才能把
/// `SQLCipher` 连同 key.rs 一起摘掉。
///
/// # Errors
///
/// Fails when the stored key does not decrypt the file, the export is
/// rejected, or the converted file cannot take the place of the old one.
fn convert_from_sqlcipher(path: &Path, key: &DatabaseKey) -> Result<()> {
    let exported = path.with_extension("plaintext");

    // 上一次转换在改名之前被打断留下的半成品。重来一遍，不复用。
    let _ignored = remove_file(&exported);

    {
        let connection = Connection::open(path)?;

        // Interpolated rather than bound: pragma values cannot be parameters,
        // and the text is hexadecimal produced by this crate.
        connection.execute_batch(&format!("PRAGMA key = \"x'{}'\";", key.to_hex()))?;

        // 密钥对不对，要真读到一页才知道。在这里逼出来。
        connection
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|_ignored| StoreError::WrongKey)?;

        // 路径走绑定参数：Windows 上的路径带反斜杠、可能带引号，拼进 SQL
        // 就同时是一个崩溃点和一个注入点。
        connection.execute(
            "ATTACH DATABASE ?1 AS plaintext KEY ''",
            [exported.to_string_lossy().as_ref()],
        )?;

        // 返回值没有约定含义，只取「这一行确实来了」。
        connection.query_row("SELECT sqlcipher_export('plaintext')", [], |_row| Ok(()))?;

        connection.execute("DETACH DATABASE plaintext", [])?;
    }

    // 连接关掉之后才谈得上清干净。万一 -wal / -shm 还留着，它们描述的是
    // 那个马上要被覆盖掉的加密文件，留给新库就是一堆读不懂的页。
    let _ignored = remove_file(beside(path, "-wal"));
    let _ignored = remove_file(beside(path, "-shm"));

    // 导出成功之后才动原文件，而且是一次原子改名：中途失败，原库不受影响。
    rename(&exported, path)?;

    Ok(())
}

/// Opens the database and puts it into the configuration the rest of the
/// crate assumes.
///
/// 新建的库一开始就是明文。盘上如果还躺着旧的加密库，开之前先就地转换
/// 一次（见 `convert_from_sqlcipher`），此后这个 key 参数就没有用处了 ——
/// 下一版会连同它一起去掉。
///
/// # Errors
///
/// Fails when the file cannot be opened, an old encrypted database cannot be
/// converted, or a pragma is rejected.
pub fn open_or_convert(path: &Path, key: &DatabaseKey) -> Result<Connection> {
    if !is_plaintext(path) {
        convert_from_sqlcipher(path, key)?;
    }

    let connection = Connection::open(path)?;

    // Write ahead logging lets the UI read while a run is being recorded.
    let _mode: String = connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;

    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.busy_timeout(DEFAULT_BUSY_TIMEOUT)?;

    Ok(connection)
}
