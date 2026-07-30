//! 一次性的目录文档服务。
//!
//! agent 的 catalog add 只吃一个 http(s) 的目录 URL —— 那是它读协议类型、接口地址
//! 与模型清单的唯一入口。默认目录是 models.dev，在部分网络下不可达，拉不到它就
//! exit 1。
//!
//! 这里把渲染层随请求带来的那份目录文档（api.json 形状，TS 侧由
//! agentProviderCatalogDocument 序列化）绑在 127.0.0.1 的随机端口上，只活到那一次
//! 调用结束。文档里没有密钥 —— 密钥走环境变量，从不经过这里。
//!
//! 用 std::net 手写而不是引入 HTTP 框架：一份静态文档、一个内容类型、一次调用的
//! 生命周期，框架能提供的我们一样都用不上。

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// 请求头读到这个尺寸就够：一个 GET 加几个头，远超所需。超了就当读完了直接回答。
const MAX_HEAD_BYTES: usize = 8 * 1024;

/// 单个连接上读请求头的上限。对方不读了，我们也不等 —— 文档是静态的，随时能答。
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// 轮询停止旗标的间隔。调用结束后服务最晚在这个量级内停下。
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// 绑在 loopback 上的一次性目录服务。Drop 即停止并收编线程。
#[derive(Debug)]
pub struct CatalogServer {
    port: u16,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl CatalogServer {
    /// 在 127.0.0.1 的随机端口上开始服务这份文档，直到被 Drop。
    ///
    /// # Errors
    ///
    /// 绑定或设置非阻塞失败时返回 io 错误 —— 那种情况下也不该继续这次调用。
    pub fn start(document: String) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let stop = Arc::clone(&stop);

            thread::spawn(move || serve_loop(&listener, &document, &stop))
        };

        Ok(Self {
            port,
            stop,
            worker: Some(worker),
        })
    }

    /// 喂给 agent CLI 的目录地址。路径叫什么都可以 —— 对方只 fetch 一次。
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/api.json", self.port)
    }
}

impl Drop for CatalogServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);

        if let Some(worker) = self.worker.take() {
            // 收编最多等一个读超时（5 秒），而且只在有连接悬着的时候。join 失败
            // 不代表文档没送到 —— 这次调用的成败看的是子进程的退出码。
            let _ = worker.join();
        }
    }
}

fn serve_loop(listener: &TcpListener, document: &str, stop: &AtomicBool) {
    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let _ = serve_connection(stream, document);
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(POLL_INTERVAL);
            }
            Err(_) => break,
        }
    }
}

fn serve_connection(mut stream: TcpStream, document: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(READ_TIMEOUT))?;

    // 先把请求头读完再回答：带着未读数据 close，Windows 会用 RST 把还没被取走
    // 的响应一起吃掉。文档与路径无关，读出头就够了，不解析。
    let mut head: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];

    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= MAX_HEAD_BYTES {
            break;
        }

        let read = stream.read(&mut chunk)?;

        if read == 0 {
            break;
        }

        head.extend_from_slice(&chunk[..read]);
    }

    let response_head = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        document.len(),
    );

    stream.write_all(response_head.as_bytes())?;
    stream.write_all(document.as_bytes())?;
    stream.flush()
}
