//! 一次性的目录文档服务。
//!
//! agent 的 catalog add 只吃一个 http(s) 的目录 URL —— 那是它读协议类型、接口地址
//! 与模型清单的唯一入口。默认目录是 models.dev，在部分网络下不可达，拉不到它就
//! exit 1。所以这里把渲染层随请求带来的那份目录文档绑在 127.0.0.1 上，经官方
//! --url 喂给它。
//!
//! 用 `std::net` 手写而不是引入 HTTP 框架：一份静态文档、一个内容类型、一次调用的
//! 生命周期，框架能提供的我们一样都用不上。
//!
//! 「一次性」此前只写在注释里：实现是一个无限循环，任何本机进程在这段时间里
//! 发一个请求都拿得到这份文档，而且不看路径、不看 Host、不看任何凭据。三条一起补：
//!
//!   - 地址里带一个 128 位的一次性凭据，对不上回 404；
//!   - Host 必须是我们自己绑的那个 loopback 地址，挡住 DNS rebinding；
//!   - 答完一次就收摊，不等 Drop。
//!
//! 「文档里没有密钥」不再是这个服务依赖的前提 —— 那个不变式由调用方持有，
//! 不该由这里替它承诺。

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// 请求头读到这个尺寸就够：一个 GET 加几个头，远超所需。
const MAX_HEAD_BYTES: usize = 8 * 1024;

/// 单个连接上等请求头的时限。对方不说话了，我们也不干等。
const READ_TIMEOUT: Duration = Duration::from_secs(2);

/// 轮询停止旗标的间隔。没有异步执行器可借，这是唯一能被取消的等法。
const POLL_INTERVAL: Duration = Duration::from_millis(5);

/// 整个服务的总时限。对方在这之内不来取，这次调用本来也已经失败了。
const LIFETIME: Duration = Duration::from_secs(30);

/// 绑在 loopback 上的一次性目录服务。答过一次即停；Drop 提前收编线程。
#[derive(Debug)]
pub struct CatalogServer {
    port: u16,
    token: String,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl CatalogServer {
    /// 在 127.0.0.1 的随机端口上服务这份文档，直到被取走一次、超时，或被 Drop。
    ///
    /// # Errors
    ///
    /// 绑定或设置非阻塞失败时返回 io 错误 —— 那种情况下也不该继续这次调用。
    pub fn start(document: String) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;

        let port = listener.local_addr()?.port();
        let token = one_time_token();
        let stop = Arc::new(AtomicBool::new(false));

        let worker = {
            let stop = Arc::clone(&stop);
            let expected = Expected {
                token: token.clone(),
                host: format!("127.0.0.1:{port}"),
            };

            thread::spawn(move || serve_once(&listener, &document, &expected, &stop))
        };

        Ok(Self {
            port,
            token,
            stop,
            worker: Some(worker),
        })
    }

    /// 喂给 agent CLI 的目录地址。凭据在路径里 —— 对方只 fetch 一次，不需要
    /// 一个额外的头，而 URL 从绑定结果现算，从不经过调用方。
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/{}.json", self.port, self.token)
    }
}

impl Drop for CatalogServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);

        if let Some(worker) = self.worker.take() {
            // 有界：工作线程最多停在一次读超时上，且答过一次就已经自己退出了。
            let _ = worker.join();
        }
    }
}

/// 这次调用认得的那一份地址。
struct Expected {
    token: String,
    host: String,
}

/// 一个不可预测的一次性凭据。
///
/// RandomState的种子来自操作系统的随机源，这是标准库内不引依赖就能拿到
/// 的随机性。两次取样拼成 128 位 —— 这条地址只活几百毫秒，且只有一次机会。
fn one_time_token() -> String {
    let high = RandomState::new().build_hasher().finish();
    let low = RandomState::new().build_hasher().finish();

    format!("{high:016x}{low:016x}")
}

fn serve_once(listener: &TcpListener, document: &str, expected: &Expected, stop: &AtomicBool) {
    let deadline = Instant::now() + LIFETIME;

    while !stop.load(Ordering::Relaxed) {
        if Instant::now() >= deadline {
            return;
        }

        match listener.accept() {
            Ok((stream, _)) => {
                // 答过一次这条地址就没有用处了，不论那一次是 200 还是 404：
                // 凭据错了说明来的不是我们喂出去的那个 URL。
                //
                // 但「没能答上」不叫「答过」。此前这里不看结果就 return，于是一次
                // 读失败就把整个服务连同端口一起收掉：对方拿到一个没有任何响应就被
                // 关掉的连接，重试又只剩 ECONNREFUSED —— 两种都是同一句 fetch
                // failed，而我们这边一个字都没留下。
                //
                // 失败继续等，上界仍然是 deadline，所以本机上的其他进程也拖不长它。
                match serve_connection(stream, document, expected) {
                    Ok(()) => return,
                    Err(error) => {
                        log::warn!("目录服务没能答上一次请求：{error}");
                    }
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(POLL_INTERVAL);
            }
            Err(_) => return,
        }
    }
}

fn serve_connection(
    mut stream: TcpStream,
    document: &str,
    expected: &Expected,
) -> std::io::Result<()> {
    // 监听套接字是非阻塞的，而 accept 出来的连接会继承这个属性 —— 除了 Linux
    // （rust-lang/rust#67027：那里用的是 accept4，不继承；MSDN 对 accept 的说法
    // 是新套接字 "has the same properties as socket s"）。
    //
    // 也就是说在 Windows 上，这条连接一落地就是非阻塞的：TCP 握手一完成 accept
    // 就返回，而请求头还在路上，下面第一个 read 立刻返回 WouldBlock，? 把它当成
    // 致命错误 —— 连接就这么被关掉了，一个字节的响应都没写。对方看到的是「连上了
    // 然后被挂断」，在 Node 那边就是一句 fetch failed。
    //
    // 顺带，set_read_timeout 设的是 SO_RCVTIMEO，对非阻塞套接字根本不起作用：
    // 那两秒时限从来没有生效过，它只是看起来在那儿。
    //
    // 这一条连接上我们要的语义就是「等，最多两秒」，所以先切回阻塞，时限才作数。
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(READ_TIMEOUT))?;

    // 先把请求头读完再回答：带着未读数据 close，Windows 会用 RST 把还没被取走
    // 的响应一起吃掉。
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

        head.extend_from_slice(chunk.get(..read).unwrap_or_default());
    }

    let request = String::from_utf8_lossy(&head);

    if is_ours(&request, expected) {
        write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            document,
        )
    } else {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            "",
        )
    }
}

/// 这个请求是不是冲着我们刚刚交出去的那条地址来的。
///
/// 两条都要过：凭据挡住本机上其他进程的盲猜，Host 挡住把一个外部域名解析到
/// 127.0.0.1 之后由浏览器发起的请求（DNS rebinding）。
fn is_ours(request: &str, expected: &Expected) -> bool {
    let Some(request_line) = request.lines().next() else {
        return false;
    };

    let path_matches = request_line
        .split_whitespace()
        .nth(1)
        .is_some_and(|target| target == format!("/{}.json", expected.token));

    let host_matches = request.lines().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("host") && value.trim() == expected.host
        })
    });

    path_matches && host_matches
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &str,
) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len(),
    );

    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}
