#!/usr/bin/env python3
"""PKGBUILD の sha256sums を実値で書き換える (release.yml の aur job が呼ぶ, #1106)。

引数: PKGBUILD のパス、続いて source の並び順どおりのハッシュ。
source の要素数とハッシュの数が違えば失敗する (source を足したらここも直す)。
"""

import re
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: pkgbuild-checksums.py PKGBUILD HASH...", file=sys.stderr)
        return 2
    path, hashes = sys.argv[1], sys.argv[2:]
    text = open(path, encoding="utf-8").read()
    source = re.search(r"^source=\((.*?)\)", text, re.S | re.M)
    if source is None:
        print("source=(...) not found", file=sys.stderr)
        return 1
    entries = [line for line in source.group(1).splitlines() if line.strip()]
    if len(entries) != len(hashes):
        print(f"source has {len(entries)} entries but {len(hashes)} hashes given", file=sys.stderr)
        return 1
    for h in hashes:
        if not re.fullmatch(r"[0-9a-f]{64}", h):
            print(f"not a sha256: {h!r}", file=sys.stderr)
            return 1
    body = "\n".join(("sha256sums=(" if i == 0 else "            ") + f"'{h}'" for i, h in enumerate(hashes)) + ")"
    new, n = re.subn(r"^sha256sums=\(.*?\)", body, text, count=1, flags=re.S | re.M)
    if n != 1:
        print("sha256sums=(...) not found", file=sys.stderr)
        return 1
    open(path, "w", encoding="utf-8").write(new)
    return 0


if __name__ == "__main__":
    sys.exit(main())
