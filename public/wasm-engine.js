/* ============================================================
   Wraith WASM core — binary module, zero dependencies.
   ------------------------------------------------------------
   The canonical source is /wasm_engine (Rust, wasm-pack). This
   file emits the same module shape for environments where the
   wasm-pack artifact hasn't been shipped yet, so the hot paths
   — rewrite scanning and the block-verdict hash set — run as
   real WebAssembly instead of the JS fallback.

   Exports:
     memory, alloc(n), free(p), ver(),
     fnv1a(ptr,len) -> u32                 (raw FNV-1a)
     set_verdicts(ptr,len)                 (len u32 LE words)
     verdict_for_host(ptr,len) -> 0|1      (hashes internally)
     scan(hay,hlen,needle,nlen) -> i32     (memmem; -1 miss)

   Hash contract: set_verdicts and verdict_for_host both apply
   the avalanche mix  h ^= h>>15; h ^= h>>7; bit = h & 65535
   over the raw FNV-1a word, so JS callers push UNMIXED fnv1a.
   ============================================================ */
(function () {
  "use strict";

  const te = new TextEncoder();

  function leb(n) {
    const out = [];
    do {
      let b = n & 127;
      n >>>= 7;
      if (n) b |= 128;
      out.push(b);
    } while (n);
    return out;
  }
  function str(s) {
    const b = te.encode(s);
    return [...leb(b.length), ...b];
  }
  function vec(items) {
    return [...leb(items.length), ...items.flat()];
  }
  function sec(id, body) {
    return [id, ...leb(body.length), ...body];
  }
  function typeFn(params, results) {
    return [0x60, ...vec(params), ...vec(results)];
  }
  function code(locals, expr) {
    const body = [...vec(locals.map(([n, t]) => [...leb(n), t])), ...expr];
    return [...leb(body.length), ...body];
  }

  const I32 = 0x7f;
  const types = [
    typeFn([], [I32]), //            0: () -> i32
    typeFn([I32], [I32]), //         1: (i32) -> i32
    typeFn([I32, I32], [I32]), //    2: (i32,i32) -> i32
    typeFn([I32, I32, I32, I32], [I32]), // 3: scan
    typeFn([I32, I32], []), //       4: (i32,i32) -> ()
    typeFn([], []), //               5: () -> ()
  ];
  // funcs: ver alloc free fnv1a set_verdicts verdict_for_host scan reset
  const funcTypes = [0, 1, 1, 2, 4, 2, 3, 5];

  const FNV = [0x41, 0xc5, 0xf9, 0xd8, 0x80, 0x08]; // i32.const 2166136261
  const DEC = [0x20, 0x01, 0x41, 0x7f, 0x6a, 0x21, 0x01]; // len = len - 1 (local 1)

  // fnv1a / verdict share the byte-fold loop: h = h*16777619 ^ byte
  const FOLD = [
    0x20, 0x02, 0x20, 0x02, 0x41, 0x18, 0x74, // h<<24
    0x20, 0x02, 0x41, 0x0c, 0x74, 0x6a, // + h<<12
    0x20, 0x02, 0x6a, // + h   (== h*16777619)
    0x20, 0x00, 0x20, 0x01, 0x6b, 0x2d, 0x00, 0x00, // byte[p + (len-1)]
    0x73, 0x21, 0x02, // h ^= byte
  ];
  const LOOP = [
    0x02, 0x40, // block
    0x03, 0x40, // loop
    0x20, 0x01, 0x45, 0x0d, 0x01, // if len==0 break
    ...FOLD,
    ...DEC,
    0x0c, 0x00, // continue
    0x0b, 0x0b, // end loop, end block
  ];
  // avalanche: h ^= h>>15; h ^= h>>7
  const MIX = [
    0x20, 0x02, 0x20, 0x02, 0x41, 0x0f, 0x76, 0x73, // h ^ (h>>15)
    0x22, 0x02, // tee h
    0x20, 0x02, 0x41, 0x07, 0x76, 0x73, // ^ (h>>7)
  ];

  const bodies = [
    // f0 ver() = 0x00010200
    code([], [0x41, 0xc0, 0x83, 0x04, 0x0b]),
    // f1 alloc(n): bump allocator over page 0 region [4112, 524288)
    code(
      [],
      [
        0x41, 0x80, 0x20, // i32.const 4096 (bumpPtr cell)
        0x23, 0x00, // global.get 0
        0x36, 0x02, 0x00, // store
        0x23, 0x00, // old ptr (return)
        0x23, 0x00, 0x20, 0x00, 0x6a, // ptr + n
        0x41, 0x0f, 0x6a, 0x41, 0x70, 0x71, // align16
        0x24, 0x00, // global.set
        0x0b,
      ]
    ),
    // f2 free (noop — bump arena)
    code([], [0x0b]),
    // f3 fnv1a(ptr,len)
    code([[1, I32]], [...FNV, 0x21, 0x02, ...LOOP, 0x20, 0x02, 0x0b]),
    // f4 set_verdicts(ptr,len_u32s): sets bit for each word
    code(
      [[2, I32]],
      [
        0x02, 0x40, 0x03, 0x40, // block/loop
        0x20, 0x01, 0x45, 0x0d, 0x01, // if len==0 break
        // word = load32(p + (len-1)*4)
        0x20, 0x00, 0x20, 0x01, 0x41, 0x7f, 0x6a, 0x41, 0x02, 0x74, 0x6a,
        0x28, 0x02, 0x00,
        0x21, 0x02, // word → local2
        ...MIX,
        0x41, 0xff, 0xff, 0x03, 0x71, // & 65535 → bit
        0x21, 0x03, // bit → local3
        0x41, 0x01, 0x20, 0x03, 0x74, // 1 << bit
        0x20, 0x02, 0x72, 0x21, 0x02, // word |= …
        // store at 1024 + ((bit>>5)<<2)
        0x41, 0x80, 0x08, 0x20, 0x03, 0x41, 0x05, 0x76, 0x41, 0x02, 0x74, 0x6a,
        0x20, 0x02, 0x36, 0x02, 0x00,
        ...DEC,
        0x0c, 0x00,
        0x0b, 0x0b, 0x0b,
      ]
    ),
    // f5 verdict_for_host(ptr,len) -> 0|1
    code(
      [[1, I32]],
      [
        ...FNV, 0x21, 0x02, ...LOOP,
        ...MIX,
        0x41, 0xff, 0xff, 0x03, 0x71, // bit = h & 65535
        0x21, 0x02,
        // (mask[bit>>5] >> (bit&31)) & 1
        0x41, 0x80, 0x08, 0x20, 0x02, 0x41, 0x05, 0x76, 0x41, 0x02, 0x74, 0x6a,
        0x28, 0x02, 0x00,
        0x20, 0x02, 0x41, 0x1f, 0x71, 0x76,
        0x41, 0x01, 0x71,
        0x0b,
      ]
    ),
    // f6 scan(hay,hlen,needle,nlen) -> idx | -1
    code(
      [[2, I32]],
      [
        0x20, 0x03, 0x20, 0x01, 0x4b, // nlen > hlen ?
        0x04, 0x7f, // if (result i32)
        0x41, 0x7f, // -1
        0x05, // else
        0x41, 0x00, 0x21, 0x04, // i = 0 (local4)
        0x02, 0x40, // outer block
        0x03, 0x40, // outer loop
        0x20, 0x04, 0x20, 0x01, 0x20, 0x03, 0x6b, 0x4b, 0x0d, 0x01, // i > hlen-nlen → break
        0x41, 0x00, 0x21, 0x05, // j = 0 (local5)
        0x02, 0x40, // inner block
        0x03, 0x40, // inner loop
        0x20, 0x05, 0x20, 0x03, 0x46, 0x0d, 0x03, // j==nlen → break outer block
        // hay[i+j] != needle[j] → break inner
        0x20, 0x00, 0x20, 0x04, 0x6a, 0x20, 0x05, 0x6a, 0x2d, 0x00, 0x00,
        0x20, 0x02, 0x20, 0x05, 0x6a, 0x2d, 0x00, 0x00,
        0x47, 0x0d, 0x01,
        0x20, 0x05, 0x41, 0x01, 0x6a, 0x21, 0x05, // j++
        0x0c, 0x00,
        0x0b, 0x0b, // end inner loop/block
        0x20, 0x05, 0x20, 0x03, 0x46, 0x0d, 0x01, // matched → break outer
        0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04, // i++
        0x0c, 0x00,
        0x0b, 0x0b, // end outer loop/block
        0x20, 0x05, 0x20, 0x03, 0x46, // j==nlen ?
        0x04, 0x7f, 0x20, 0x04, 0x05, 0x41, 0x7f, 0x0b, // i : -1
        0x0b, // end else
        0x0b,
      ]
    ),
    // f7 reset(): rewind the bump arena (mask at 1024 is untouched)
    code([], [0x41, 0x90, 0x20, 0x24, 0x00, 0x0b]),
  ];

  function build() {
    return new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      sec(1, vec(types)), // types
      sec(3, vec(funcTypes.map((t) => [t]))), // functions
      sec(4, [0x01, 0x70, 0x00, 0x01, 0x01]), // table: 1 funcref
      sec(5, [0x01, 0x00, 0x08]), // memory: min 8 pages
      sec(6, [0x01, 0x7f, 0x01, 0x41, 0x90, 0x20, 0x0b]), // g0 bumpPtr = 4112
      sec(7, vec([
        [...str("memory"), 0x02, 0x00],
        [...str("alloc"), 0x00, 0x01],
        [...str("free"), 0x00, 0x02],
        [...str("ver"), 0x00, 0x00],
        [...str("fnv1a"), 0x00, 0x03],
        [...str("set_verdicts"), 0x00, 0x04],
        [...str("verdict_for_host"), 0x00, 0x05],
        [...str("scan"), 0x00, 0x06],
        [...str("reset"), 0x00, 0x07],
      ])), // exports
      sec(8, [0x01, 0x01]), // start → f1 seeds bumpPtr cell
      sec(9, [0x01, 0x00, 0x41, 0x00, 0x0b, 0x01, 0x03]), // elem: table[0]=fnv1a
      sec(10, vec(bodies)), // code
      sec(11, [0x01, 0x00, 0x41, 0x90, 0x20, 0x0b, 0x02, 0x10, 0x10]), // data: bumpPtr=4112
    ]);
  }

  /** Instantiate. Returns an api object or null (caller falls back to JS). */
  async function init() {
    try {
      const bytes = build();
      const { instance } = await WebAssembly.instantiate(bytes.buffer ?? bytes);
      const ex = instance.exports;
      if (ex.ver() !== 0x00010200) return null;
      const mem = () => new Uint8Array(ex.memory.buffer);

      const api = {
        version: "0.9.2-wasm",
        /** Rewind the bump arena — call at the top of each independent op. */
        reset() {
          ex.reset();
        },
        /** Raw FNV-1a (UNMIXED) of a UTF-8 string — what set_verdicts expects. */
        fnv(str) {
          const b = te.encode(str);
          const p = ex.alloc(b.length);
          mem().set(b, p);
          return ex.fnv1a(p, b.length) >>> 0;
        },
        setHosts(hosts) {
          const buf = new Uint8Array(hosts.length * 4);
          const dv = new DataView(buf.buffer);
          hosts.forEach((h, i) => dv.setUint32(i * 4, api.fnv(h), true));
          ex.reset();
          const p = ex.alloc(buf.length);
          mem().set(buf, p);
          ex.set_verdicts(p, hosts.length);
        },
        blocked(host) {
          const b = te.encode(host);
          ex.reset();
          const p = ex.alloc(b.length);
          mem().set(b, p);
          return ex.verdict_for_host(p, b.length) === 1;
        },
        /** Copy bytes into wasm memory; returns the pointer. */
        putBytes(bytes) {
          const p = ex.alloc(bytes.length);
          mem().set(bytes, p);
          return p;
        },
        /** memmem over a wasm-memory range; -1 on miss. */
        scanRange(hayPtr, hayLen, needleBytes) {
          const n = te.encode(needleBytes);
          const np = ex.alloc(n.length);
          mem().set(n, np);
          return ex.scan(hayPtr, hayLen, np, n.length);
        },
        /** memmem with both operands as JS strings. */
        scan(haystack, needle) {
          const h = te.encode(haystack);
          ex.reset();
          const p = ex.alloc(h.length);
          mem().set(h, p);
          return api.scanRange(p, h.length, needle);
        },
      };
      return api;
    } catch (e) {
      console.warn("[wraith] wasm core unavailable, JS fallback engaged:", e);
      return null;
    }
  }

  self.WraithWasm = { init, build };
})();
