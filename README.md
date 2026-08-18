# Sele

Sele is a native desktop application built with Rust and [Slint](https://slint.dev/).

## Development

Install a current stable Rust toolchain, then run:

```bash
cargo run
```

Run the project checks with:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
```

## License

[GNU General Public License v3.0 only](LICENSE)
