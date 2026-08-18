# Sele

Sele is a native Linux desktop application built with Rust, [GTK 4](https://www.gtk.org/),
and [libadwaita](https://gnome.pages.gitlab.gnome.org/libadwaita/).

## Requirements

Install a current stable Rust toolchain, GTK 4.16 or newer, libadwaita 1.7 or
newer, and their development packages.

Fedora:

```bash
sudo dnf install gtk4-devel libadwaita-devel
```

Debian/Ubuntu:

```bash
sudo apt install libgtk-4-dev libadwaita-1-dev
```

## Development

```bash
cargo run
```

Create an optimized build with:

```bash
cargo build --release
```

Run the project checks with:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
```

Exercise GTK's variable-height transcript anchoring with:

```bash
cargo run --bin transcript-stress -- --verify --rows=100000 --cycles=20
```

The native transcript projection uses the versioned database filename
`sele-native-transcripts-v1.sqlite3`, deliberately separate from the legacy Electron
`sele.sqlite` database. Set `SELE_TRANSCRIPT_DATABASE_PATH` to explicitly override its
location during development.

## License

[GNU General Public License v3.0 only](LICENSE)
