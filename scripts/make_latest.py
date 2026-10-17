#!/usr/bin/env python3
"""Build the updater manifest (latest.json) from locally built bundles.

Upload it together with the bundles to a GitHub release so the in-app updater
can find them. Example:

    python3 scripts/make_latest.py --repo skibidius/PhotoMap \\
        --tag v0.1.5 --version 0.1.5

Bundles are read from src-tauri/target/release/bundle by default. Only signed
artifacts (files with a matching .sig) are included, so build with
TAURI_SIGNING_PRIVATE_KEY set first.
"""
import argparse
import datetime
import json
import os
import platform
import sys

BUNDLE = "src-tauri/target/release/bundle"


def host_arch() -> str:
    machine = platform.machine().lower()
    return "aarch64" if machine in ("arm64", "aarch64") else "x86_64"


def sig_for(path: str) -> str | None:
    sig = path + ".sig"
    if os.path.exists(sig):
        with open(sig) as f:
            return f.read().strip()
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="owner/repo")
    ap.add_argument("--tag", required=True, help="release tag, e.g. v0.1.5")
    ap.add_argument("--version", required=True, help="app version, e.g. 0.1.5")
    ap.add_argument("--bundle", default=BUNDLE)
    ap.add_argument("--out", default=None)
    ap.add_argument(
        "--mac-arch",
        choices=["aarch64", "x86_64"],
        default=None,
        help="Architecture of the local macOS build (defaults to the host CPU)",
    )
    args = ap.parse_args()

    platforms: dict[str, dict[str, str]] = {}

    def add(key: str, path: str) -> None:
        sig = sig_for(path)
        if not sig:
            print(f"  skip {key}: no .sig for {path}", file=sys.stderr)
            return
        name = os.path.basename(path)
        platforms[key] = {
            "signature": sig,
            "url": f"https://github.com/{args.repo}/releases/download/{args.tag}/{name}",
        }

    def find(sub: str, suffix: str) -> list[str]:
        d = os.path.join(args.bundle, sub)
        if not os.path.isdir(d):
            return []
        return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(suffix))

    for p in find("macos", ".app.tar.gz"):
        name = os.path.basename(p)
        if "aarch64" in name:
            arch = "aarch64"
        elif "x64" in name or "x86_64" in name:
            arch = "x86_64"
        else:
            arch = args.mac_arch or host_arch()
        add(f"darwin-{arch}-app", p)
        add(f"darwin-{arch}", p)
    for p in find("nsis", "-setup.exe"):
        add("windows-x86_64-nsis", p)
        add("windows-x86_64", p)
    for p in find("msi", ".msi"):
        add("windows-x86_64-msi", p)
    for p in find("appimage", ".AppImage"):
        add("linux-x86_64-appimage", p)
        add("linux-x86_64", p)
    for p in find("deb", ".deb"):
        add("linux-x86_64-deb", p)
    for p in find("rpm", ".rpm"):
        add("linux-x86_64-rpm", p)

    if not platforms:
        sys.exit("No signed bundles found. Build with TAURI_SIGNING_PRIVATE_KEY set first.")

    manifest = {
        "version": args.version,
        "notes": "Download the installer for your platform.",
        "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    }
    out = args.out or os.path.join(args.bundle, "latest.json")
    with open(out, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"wrote {out} with {len(platforms)} platform entries")


if __name__ == "__main__":
    main()
