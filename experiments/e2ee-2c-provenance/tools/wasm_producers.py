#!/usr/bin/env python3
"""wasm_producers.py — dump the WASM 'producers' and 'target_features' custom sections.

The `producers` custom section is emitted by the Rust/WASM toolchain and records
the language + every processing tool that touched the binary (e.g. rustc version,
walrus, wasm-bindgen). This is the primary toolchain fingerprint used to pin the
build environment in docs/e2ee-2c-provenance.md.

Usage:  python3 wasm_producers.py <path-to.wasm>
"""
import struct
import sys


def leb(buf, pos):
    r = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        r |= (b & 0x7F) << shift
        if not b & 0x80:
            return r, pos
        shift += 7


def read_string(d, p):
    ln, p = leb(d, p)
    return d[p:p + ln].decode("utf-8", "replace"), p + ln


def main(path):
    data = open(path, "rb").read()
    assert data[:4] == b"\x00asm", "not a wasm binary"
    print(f"file: {path}")
    print(f"size: {len(data)} bytes")
    pos = 8
    sections = {}
    while pos < len(data):
        sec = data[pos]
        pos += 1
        size, pos = leb(data, pos)
        start = pos
        sec_data = data[pos:pos + size]
        if sec == 0:  # custom
            name, np = leb(sec_data, 0)
            cname = sec_data[np:np + name].decode("utf-8", "replace")
            sections[cname] = sec_data[np + name:]
        pos = start + size

    print("\n--- producers ---")
    if "producers" not in sections:
        print("  (none)")
    else:
        d = sections["producers"]
        p = 0
        fcount, p = leb(d, p)
        for _ in range(fcount):
            fname, p = read_string(d, p)
            vcount, p = leb(d, p)
            print(f"[{fname}]")
            for _ in range(vcount):
                vname, p = read_string(d, p)
                vver, p = read_string(d, p)
                print(f"    {vname}  {vver}")

    print("\n--- target_features ---")
    if "target_features" not in sections:
        print("  (none)")
    else:
        d = sections["target_features"]
        p = 0
        cnt, p = leb(d, p)
        for _ in range(cnt):
            s, p = read_string(d, p)
            print("   ", s)


if __name__ == "__main__":
    main(sys.argv[1])
