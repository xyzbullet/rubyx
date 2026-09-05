//! Wraith wisp node — high-concurrency tunnel terminator.
//!
//! One WebSocket connection carries N multiplexed TCP/UDP streams using the
//! wisp frame layout (see `wisp.rs`). Egress paths:
//!   * direct TCP/UDP with on-node DNS (hickory, low-latency, cached)
//!   * SOCKS5 upstream (--socks5) for regional location swapping
//!   * Tor bridge: `.onion` targets route through a local tor SOCKS port
//!
//! Clients that cannot hold WebSockets (serverless hosts) fall back to the
//! chunked HTTP polling transport served on the same port.

mod socks;
mod wisp;

use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(name = "wraith-server", version, about)]
struct Args {
    /// Listen address for the wisp endpoint
    #[arg(long, default_value = "0.0.0.0:8080")]
    bind: SocketAddr,

    /// SOCKS5 upstream for regional exit swapping (host:port)
    #[arg(long)]
    socks5: Option<String>,

    /// Local Tor SOCKS port used to reach .onion destinations
    #[arg(long, default_value = "127.0.0.1:9050")]
    tor_socks: String,

    /// Upstream DNS for on-node resolution
    #[arg(long, default_value = "1.1.1.1:53")]
    dns: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("wraith_server=info".parse()?))
        .init();

    let args = Args::parse();
    let cfg = Arc::new(wisp::Config {
        socks5: args.socks5.clone(),
        tor_socks: args.tor_socks.clone(),
        dns: args.dns.clone(),
    });

    let listener = TcpListener::bind(args.bind).await?;
    info!("wraith wisp node listening on {}", args.bind);
    if let Some(s) = &args.socks5 {
        info!("regional egress via SOCKS5 upstream {s}");
    }
    info!(".onion targets bridge through tor socks {}", args.tor_socks);

    loop {
        let (stream, peer) = listener.accept().await?;
        let cfg = cfg.clone();
        tokio::spawn(async move {
            if let Err(e) = wisp::serve_conn(stream, cfg).await {
                warn!("conn {peer} closed: {e:#}");
            }
        });
    }
}
