//! Wisp frame multiplexer over WebSocket.
//!
//! Frame layout (little-endian):
//!   u32 length (payload only) | u8 type | u32 stream_id | payload
//!
//!   type 0x01 CONNECT  payload: u8 proto (1=tcp,2=udp) | utf8 "host:port"
//!   type 0x02 DATA     payload: raw bytes
//!   type 0x03 END      payload: empty (peer half-close)
//!   type 0x04 UDP      payload: u16 addr_len | addr | datagram
//!   type 0x05 EXTEND   payload: u32 new buffer window
//!
//! Each CONNECT spawns a duplex pump between the socket and the WS sink, so
//! thousands of streams share one handshake. DNS happens on-node via
//! hickory with a TTL cache — clients never leak resolution latency.

use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use bytes::{Buf, BytesMut};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use hickory_resolver::{
    config::{ResolverConfig, ResolverOpts},
    TokioAsyncResolver,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info};

use crate::socks;

pub struct Config {
    pub socks5: Option<String>,
    pub tor_socks: String,
    pub dns: String,
}

const T_CONNECT: u8 = 0x01;
const T_DATA: u8 = 0x02;
const T_END: u8 = 0x03;
const T_UDP: u8 = 0x04;
const T_EXTEND: u8 = 0x05;

#[derive(Clone)]
enum StreamHandle {
    Tcp(Arc<tokio::sync::Mutex<TcpStream>>),
    Udp(Arc<UdpSocket>, std::net::SocketAddr),
}

type Streams = Arc<DashMap<u32, StreamHandle>>;

fn resolver(cfg: &Config) -> Result<TokioAsyncResolver> {
    let mut opts = ResolverOpts::default();
    opts.cache_size = 4096;
    let server = cfg.dns.parse().context("bad --dns addr")?;
    Ok(TokioAsyncResolver::tokio(
        ResolverConfig::from_parts(None, vec![], vec![hickory_resolver::config::NameServerConfig {
            socket_addr: server,
            protocol: hickory_resolver::config::Protocol::Udp,
            tls_dns_name: None,
            trust_negative_responses: true,
            bind_addr: None,
        }]),
        opts,
    ))
}

pub async fn serve_conn(stream: TcpStream, cfg: Arc<Config>) -> Result<()> {
    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .context("ws handshake failed")?;
    let (mut sink, mut rx) = ws.split();

    let streams: Streams = Arc::new(DashMap::new());
    let resolver = Arc::new(resolver(&cfg)?);
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(1024);

    // egress pump: frames produced by per-stream readers -> ws sink
    let pump = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            if sink.send(Message::Binary(frame.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = rx.next().await {
        let msg = msg.context("ws read")?;
        let (ty, sid, payload) = match decode(msg) {
            Some(f) => f,
            None => continue,
        };
        match ty {
            T_CONNECT => {
                let proto = payload.first().copied().unwrap_or(1);
                let target = String::from_utf8_lossy(&payload[1..]).to_string();
                info!("stream {sid} connect {} -> {target}", if proto == 2 { "udp" } else { "tcp" });
                let handle = open_stream(&cfg, &resolver, proto, &target).await?;
                streams.insert(sid, handle.clone());
                spawn_stream_pump(sid, handle, frame_tx.clone(), streams.clone());
            }
            T_DATA => {
                if let Some(h) = streams.get(&sid) {
                    let h = h.value().clone();
                    tokio::spawn(async move {
                        if let StreamHandle::Tcp(sock) = h {
                            let mut s = sock.lock().await;
                            let _ = s.write_all(&payload).await;
                        }
                    });
                }
            }
            T_UDP => {
                if payload.len() < 2 { continue; }
                let alen = u16::from_be_bytes([payload[0], payload[1]]) as usize;
                if payload.len() < 2 + alen { continue; }
                if let Some(StreamHandle::Udp(sock, _)) = streams.get(&sid).map(|h| h.value().clone()) {
                    let datagram = payload[2 + alen..].to_vec();
                    tokio::spawn(async move {
                        let _ = sock.send(&datagram).await;
                    });
                }
            }
            T_END => {
                streams.remove(&sid);
            }
            T_EXTEND => {
                debug!("stream {sid} window extended");
            }
            _ => {}
        }
    }

    drop(frame_tx);
    let _ = pump.await;
    Ok(())
}

fn decode(msg: Message) -> Option<(u8, u32, Vec<u8>)> {
    let data = match msg {
        Message::Binary(b) => b,
        Message::Close(_) => None?,
        _ => return None,
    };
    let mut buf = BytesMut::from(data.as_ref());
    if buf.len() < 9 {
        return None;
    }
    let _len = buf.get_u32_le();
    let ty = buf.get_u8();
    let sid = buf.get_u32_le();
    Some((ty, sid, buf.to_vec()))
}

fn frame(ty: u8, sid: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(9 + payload.len());
    out.extend_from_slice(&(payload.len() as u32 + 5).to_le_bytes());
    out.push(ty);
    out.extend_from_slice(&sid.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

async fn open_stream(
    cfg: &Config,
    resolver: &TokioAsyncResolver,
    proto: u8,
    target: &str,
) -> Result<StreamHandle> {
    let (host, port) = target.rsplit_once(':').ok_or_else(|| anyhow!("bad target {target}"))?;
    let port: u16 = port.parse()?;

    // .onion destinations bridge via the local Tor SOCKS listener
    if host.ends_with(".onion") {
        let sock = socks::connect_via_socks(&cfg.tor_socks, host, port).await?;
        return Ok(StreamHandle::Tcp(Arc::new(tokio::sync::Mutex::new(sock))));
    }
    // regional swapping: everything through the configured SOCKS5 upstream
    if let Some(upstream) = &cfg.socks5 {
        let sock = socks::connect_via_socks(upstream, host, port).await?;
        return Ok(StreamHandle::Tcp(Arc::new(tokio::sync::Mutex::new(sock))));
    }

    if proto == 2 {
        let addrs = resolver.lookup_ip(host).await?;
        let remote = std::net::SocketAddr::new(addrs.iter().next().ok_or_else(|| anyhow!("no A/AAAA"))?, port);
        let sock = UdpSocket::bind("0.0.0.0:0").await?;
        sock.connect(remote).await?;
        Ok(StreamHandle::Udp(Arc::new(sock), remote))
    } else {
        let addrs = resolver.lookup_ip(host).await?;
        let remote = std::net::SocketAddr::new(addrs.iter().next().ok_or_else(|| anyhow!("no A/AAAA"))?, port);
        let sock = TcpStream::connect(remote).await?;
        sock.set_nodelay(true)?;
        Ok(StreamHandle::Tcp(Arc::new(tokio::sync::Mutex::new(sock))))
    }
}

fn spawn_stream_pump(sid: u32, handle: StreamHandle, tx: tokio::sync::mpsc::Sender<Vec<u8>>, streams: Streams) {
    tokio::spawn(async move {
        match handle {
            StreamHandle::Tcp(sock) => {
                let mut buf = [0u8; 64 * 1024];
                loop {
                    let n = {
                        let mut s = sock.lock().await;
                        s.read(&mut buf).await.unwrap_or(0)
                    };
                    if n == 0 {
                        let _ = tx.send(frame(T_END, sid, &[])).await;
                        break;
                    }
                    if tx.send(frame(T_DATA, sid, &buf[..n])).await.is_err() {
                        break;
                    }
                }
            }
            StreamHandle::Udp(sock, _) => {
                let mut buf = [0u8; 64 * 1024];
                loop {
                    match sock.recv(&mut buf).await {
                        Ok(n) => {
                            if tx.send(frame(T_UDP, sid, &buf[..n])).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
        streams.remove(&sid);
    });
}
