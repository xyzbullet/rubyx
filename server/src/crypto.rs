//! End-to-end transport encryption for the wisp tunnel.
//!
//! Handshake (first text frame each direction, JSON):
//!   { "v": 1, "pub": "<base64 X25519 public key>" }
//! Key schedule (must match the client in /public/sw.js):
//!   shared  = X25519(our_secret, peer_pub)
//!   key     = HKDF-SHA256(ikm=shared, salt="wraith-wisp-v1",
//!                         info="wisp-gcm-aes256", len=32)
//! Wire: every binary message is  Nonce(12B) || AES-256-GCM(frame)
//! where `frame` is the plaintext wisp frame — a passive observer
//! sees only authenticated ciphertext on both legs.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine;
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

pub const SALT: &[u8] = b"wraith-wisp-v1";
pub const INFO: &[u8] = b"wisp-gcm-aes256";

#[derive(Clone)]
pub struct Cipher {
    inner: Aes256Gcm,
}

impl Cipher {
    pub fn from_shared(shared: &[u8; 32]) -> Self {
        let mut okm = [0u8; 32];
        Hkdf::<Sha256>::new(Some(SALT), shared)
            .expand(INFO, &mut okm)
            .expect("hkdf expand to 32 bytes is in range");
        Self {
            inner: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm)),
        }
    }

    /// Seal plaintext → 12B random nonce || ciphertext+tag.
    pub fn seal(&self, plaintext: &[u8]) -> Vec<u8> {
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let ct = self
            .inner
            .encrypt(Nonce::from_slice(&nonce), plaintext)
            .expect("gcm seal");
        let mut out = Vec::with_capacity(12 + ct.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        out
    }

    /// Open a sealed message; None on truncation or auth failure.
    pub fn open(&self, sealed: &[u8]) -> Option<Vec<u8>> {
        if sealed.len() < 13 {
            return None;
        }
        self.inner
            .decrypt(Nonce::from_slice(&sealed[..12]), &sealed[12..])
            .ok()
    }
}

pub struct KeyExchange {
    secret: StaticSecret,
}

impl KeyExchange {
    pub fn new() -> Self {
        Self {
            secret: StaticSecret::random_from_rng(OsRng),
        }
    }

    pub fn public_b64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(self.secret.to_public().to_bytes())
    }

    pub fn shared_from_peer_b64(&self, peer: &str) -> Option<[u8; 32]> {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(peer.trim())
            .ok()?;
        if raw.len() != 32 {
            return None;
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&raw);
        let peer_pub = PublicKey::from(arr);
        Some(self.secret.diffie_hellman(&peer_pub).to_bytes())
    }
}
