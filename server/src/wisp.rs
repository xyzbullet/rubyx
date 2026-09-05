//! Wisp frame multiplexer over WebSocket — encrypted end to end.
//!
//! Frame layout (little-endian):
//!   u32 length (payload+5) | u8 type | u32 stream_id | payload
//!
//!   0x01 CONNECT  u8 proto (1 tcp · 2 udp · 3 l7-fetch) | utf8 "host:port"
//!   0x02 DATA     raw stream bytes
//!   0x03 END      half-close / response complete
//!   0x04 UDP      datagram
//!   0x05 EXTEND   window update
//!   0x06 REQ      L7: full HTTP request bytes  (client → node)
//!   0x07 RES      L7: full HTTP response bytes (node → client)
//!
//! Transport encryption: the first text frame is a JSON handshake
//! { v: 1, pub: <b64 X25519> }; both sides derive
//! HKDF-SHA256(ECDH, "wraith-wisp-v1", "wisp-gcm-aes256") and every
//! binary message after is  nonce(12) || AES-256-GCM(frame).

use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use hickory_resolver::{
    config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts},
    TokioAsyncResolver,
};
use rustls::ClientConfig;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio_rustls::{client::TlsStream, TlsConnector};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

use crate::crypto::{Cipher, KeyExchange};
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
const T_REQ: u8 = 0x06;
const T_RES: u8 = 0x07;

type Io = Box<dyn AsyncRead + AsyncWrite + Unpin + Send>;

#[derive(Clone)]
enum StreamHandle {
    Io(Arc<tokio::sync::Mutex<Io>>),
    Udp(Arc<UdpSocket>),
}

type Streams = Arc<DashMap<u32, StreamHandle>>;

fn resolver(cfg: &Config) -> Result<TokioAsyncResolver> {
    let mut opts = ResolverOpts::default();
    opts.cache_size = 4096;
    let addr = cfg.dns.parse().context("bad --dns addr")?;
    let ns = NameServerConfig::new(addr, Protocol::Udp);
    Ok(TokioAsyncResolver::tokio(
        ResolverConfig::from_parts(None, Vec::new(), vec![ns]),
        opts,
    ))
}

fn tls_connector() -> TlsConnector {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    TlsConnector::from(Arc::new(cfg))
}

#[derive(Deserialize)]
struct HandshakeIn {
    #[allow(dead_code)]
    v: u32,
    #[serde(rename = "pub")]
    pub_key: String,
}

#[derive(Serialize)]
struct HandshakeOut {
    v: u32,
    #[serde(rename = "pub")]
    pub_key: String,
}

pub async fn serve_conn(stream: TcpStream, cfg: Arc<Config>) -> Result<()> {
    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .context("ws handshake failed")?;
    let (mut sink, mut rx) = ws.split();

    /* ---- E2E handshake (first text frame) ---- */
    let mut cipher: Option<Cipher> = None;
    let first = rx.next().await.context("conn closed before handshake")??;
    let first_binary = match first {
        Message::Text(t) => {
            let hs: HandshakeIn = serde_json::from_str(&t).context("bad handshake json")?;
            let kx = KeyExchange::new();
            let shared = kx
                .shared_from_peer_b64(&hs.pub_key)
                .ok_or_else(|| anyhow!("bad peer public key"))?;
            cipher = Some(Cipher::from_shared(&shared));
            sink.send(Message::Text(
                serde_json::to_string(&HandshakeOut {
                    v: 1,
                    pub_key: kx.public_b64(),
                })
                .unwrap_or_default(),
            ))
            .await?;
            info!("e2e cipher established (x25519 + aes-256-gcm)");
            None
        }
        Message::Binary(b) => Some(b), // legacy unencrypted client
        _ => None,
    };

    let streams: Streams = Arc::new(DashMap::new());
    let resolver = Arc::new(resolver(&cfg)?);
    let connector = Arc::new(tls_connector());
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(1024);

    /* ---- egress pump: per-stream frames -> encrypted ws sink ---- */
    let cipher_out = cipher.clone();
    let pump = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            let msg = match &cipher_out {
                Some(c) => Message::Binary(c.seal(&frame).into()),
                None => Message::Binary(frame.into()),
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let process = |frame: Vec<u8>,
                   streams: &Streams,
                   cfg: &Arc<Config>,
                   resolver: &Arc<TokioAsyncResolver>,
                   connector: &Arc<TlsConnector>,
                   tx: &tokio::sync::mpsc::Sender<Vec<u8>>| async move {
        if frame.len() < 9 {
            return Ok(());
        }
        let ty = frame[4];
        let sid = u32::from_le_bytes([frame[5], frame[6], frame[7], frame[8]]);
        let payload = &frame[9..];

        match ty {
            T_CONNECT => {
                let proto = payload.first().copied().unwrap_or(1);
                let target = String::from_utf8_lossy(&payload[1..]).to_string();
                info!("stream {sid} connect proto={proto} -> {target}");
                match proto {
                    3 => {
                        // L7 fetch mode: node terminates TLS for the client
                        let stream = open_l7(cfg, resolver, connector, &target).await?;
                        streams.insert(sid, StreamHandle::Io(Arc::new(tokio::sync::Mutex::new(stream))));
                    }
                    2 => {
                        let handle = StreamHandle::Udp(open_udp(resolver, &target).await?);
                        streams.insert(sid, handle.clone());
                        spawn_io_pump(sid, handle, tx.clone(), streams.clone());
                    }
                    _ => {
                        let stream = open_tcp(cfg, resolver, &target).await?;
                        let handle = StreamHandle::Io(Arc::new(tokio::sync::Mutex::new(stream)));
                        streams.insert(sid, handle.clone());
                        spawn_io_pump(sid, handle, tx.clone(), streams.clone());
                    }
                }
            }
            T_DATA => {
                if let Some(h) = streams.get(&sid) {
                    if let StreamHandle::Io(sock) = h.value().clone() {
                        let data = payload.to_vec();
                        tokio::spawn(async move {
                            let mut s = sock.lock().await;
                            let _ = s.write_all(&data).await;
                        });
                    }
                }
            }
            T_REQ => {
                // L7 round trip: write request, read until EOF, send RES + END
                if let Some(h) = streams.get(&sid) {
                    if let StreamHandle::Io(sock) = h.value().clone() {
                        let req = payload.to_vec();
                        let tx = tx.clone();
                        let streams2 = streams.clone();
                        tokio::spawn(async move {
                            let res = l7_roundtrip(sock, &req).await;
                            match res {
                                Some(bytes) => {
                                    let _ = tx.send(frame(T_RES, sid, &bytes)).await;
                                }
                                None => warn!("stream {sid}: l7 fetch failed"),
                            }
                            let _ = tx.send(frame(T_END, sid, &[])).await;
                            streams2.remove(&sid);
                        });
                    }
                }
            }
            T_UDP => {
                if payload.len() >= 2 {
                    if let Some(StreamHandle::Udp(sock)) =
                        streams.get(&sid).map(|h| h.value().clone())
                    {
                        let datagram = payload.to_vec();
                        tokio::spawn(async move {
                            let _ = sock.send(&datagram).await;
                        });
                    }
                }
            }
            T_END => {
                streams.remove(&sid);
            }
            T_EXTEND => debug!("stream {sid} window extended"),
            _ => {}
        }
        Ok::<(), anyhow::Error>(())
    };

    if let Some(b) = first_binary {
        let _ = process(b.to_vec(), &streams, &cfg, &resolver, &connector, &frame_tx).await;
    }

    while let Some(msg) = rx.next().await {
        let msg = msg.context("ws read")?;
        let frame = match msg {
            Message::Binary(b) => match &cipher {
                Some(c) => match c.open(b.as_ref()) {
                    Some(f) => f,
                    None => {
                        warn!("dropped frame: gcm auth failed");
                        continue;
                    }
                },
                None => b.to_vec(),
            },
            Message::Close(_) => break,
            _ => continue,
        };
        if let Err(e) = process(frame, &streams, &cfg, &resolver, &connector, &frame_tx).await {
            warn!("frame error: {e:#}");
        }
    }

    drop(frame_tx);
    let _ = pump.await;
    Ok(())
}

fn frame(ty: u8, sid: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(9 + payload.len());
    out.extend_from_slice(&(payload.len() as u32 + 5).to_le_bytes());
    out.push(ty);
    out.extend_from_slice(&sid.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

async fn resolve_host(
    resolver: &TokioAsyncResolver,
    host: &str,
    port: u16,
) -> Result<std::net::SocketAddr> {
    // literal IPs skip DNS entirely
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return Ok(std::net::SocketAddr::new(ip, port));
    }
    let addrs = resolver.lookup_ip(host).await?;
    let ip = addrs.iter().next().ok_or_else(|| anyhow!("no A/AAAA for {host}"))?;
    Ok(std::net::SocketAddr::new(ip, port))
}

async fn open_tcp(cfg: &Config, resolver: &TokioAsyncResolver, target: &str) -> Result<Io> {
    let (host, port) = target.rsplit_once(':').ok_or_else(|| anyhow!("bad target {target}"))?;
    let port: u16 = port.parse()?;

    if host.ends_with(".onion") {
        let sock = socks::connect_via_socks(&cfg.tor_socks, host, port).await?;
        return Ok(Box::new(sock));
    }
    if let Some(upstream) = &cfg.socks5 {
        let sock = socks::connect_via_socks(upstream, host, port).await?;
        return Ok(Box::new(sock));
    }
    let remote = resolve_host(resolver, host, port).await?;
    let sock = TcpStream::connect(remote).await?;
    sock.set_nodelay(true)?;
    Ok(Box::new(sock))
}

async fn open_udp(resolver: &TokioAsyncResolver, target: &str) -> Result<Arc<UdpSocket>> {
    let (host, port) = target.rsplit_once(':').ok_or_else(|| anyhow!("bad target {target}"))?;
    let port: u16 = port.parse()?;
    let remote = resolve_host(resolver, host, port).await?;
    let sock = UdpSocket::bind("0.0.0.0:0").await?;
    sock.connect(remote).await?;
    Ok(Arc::new(sock))
}

async fn open_l7(
    cfg: &Config,
    resolver: &TokioAsyncResolver,
    connector: &TlsConnector,
    target: &str,
) -> Result<Io> {
    let (host, port) = target.rsplit_once(':').ok_or_else(|| anyhow!("bad target {target}"))?;
    let port: u16 = port.parse()?;
    if let Some(upstream) = &cfg.socks5 {
        let sock = socks::connect_via_socks(upstream, host, port).await?;
        let name = rustls_pki_types::ServerName::try_from(host.to_string())
            .map_err(|_| anyhow!("bad server name {host}"))?;
        let tls: TlsStream<TcpStream> = connector.connect(name, sock).await?;
        return Ok(Box::new(tls));
    }
    let remote = resolve_host(resolver, host, port).await?;
    let tcp = TcpStream::connect(remote).await?;
    let name = rustls_pki_types::ServerName::try_from(host.to_string())
        .map_err(|_| anyhow!("bad server name {host}"))?;
    let tls: TlsStream<TcpStream> = connector.connect(name, tcp).await?;
    Ok(Box::new(tls))
}

/// Message-mode HTTP/1.1: write the request, read until the peer closes.
async fn l7_roundtrip(sock: Arc<tokio::sync::Mutex<Io>>, req: &[u8]) -> Option<Vec<u8>> {
    let mut s = sock.lock().await;
    s.write_all(req).await.ok()?;
    s.flush().await.ok()?;
    let _ = s.shutdown().await;
    let mut buf = Vec::with_capacity(64 * 1024);
    s.read_to_end(&mut buf).await.ok()?;
    Some(buf)
}

fn spawn_io_pump(
    sid: u32,
    handle: StreamHandle,
    tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    streams: Streams,
) {
    tokio::spawn(async move {
        match handle {
            StreamHandle::Io(sock) => {
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
            StreamHandle::Udp(sock) => {
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


