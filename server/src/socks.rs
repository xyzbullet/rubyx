//! Minimal SOCKS5 client used for the regional exit and the Tor bridge.
//! Implements RFC 1928 greeting → no-auth → CONNECT, returning the raw TCP
//! stream once the proxy reports success. `.onion` hosts are passed
//! verbatim (ATYP 0x03) so resolution happens inside the Tor circuit.

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub async fn connect_via_socks(proxy: &str, host: &str, port: u16) -> Result<TcpStream> {
    let mut s = TcpStream::connect(proxy)
        .await
        .with_context(|| format!("cannot reach SOCKS5 upstream {proxy}"))?;
    s.set_nodelay(true)?;

    // greeting: version 5, one method (no auth)
    s.write_all(&[0x05, 0x01, 0x00]).await?;
    let mut hdr = [0u8; 2];
    s.read_exact(&mut hdr).await?;
    if hdr != [0x05, 0x00] {
        return Err(anyhow!("SOCKS5 method negotiation rejected: {hdr:x?}"));
    }

    // CONNECT request
    let mut req = vec![0x05, 0x01, 0x00];
    let hb = host.as_bytes();
    if hb.len() > 255 {
        return Err(anyhow!("hostname too long for SOCKS5"));
    }
    req.push(0x03); // ATYP domainname
    req.push(hb.len() as u8);
    req.extend_from_slice(hb);
    req.extend_from_slice(&port.to_be_bytes());
    s.write_all(&req).await?;

    // reply: VER REP RSV ATYP BND.ADDR BND.PORT
    let mut head = [0u8; 4];
    s.read_exact(&mut head).await?;
    if head[1] != 0x00 {
        return Err(anyhow!("SOCKS5 connect failed, rep={:#04x}", head[1]));
    }
    let skip = match head[3] {
        0x01 => 4,           // IPv4
        0x04 => 16,          // IPv6
        0x03 => {
            let mut l = [0u8; 1];
            s.read_exact(&mut l).await?;
            l[0] as usize
        }
        _ => return Err(anyhow!("bad ATYP in SOCKS5 reply")),
    };
    let mut tail = vec![0u8; skip + 2];
    s.read_exact(&mut tail).await?;

    Ok(s)
}
