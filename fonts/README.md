# Nerd Font symbols

`nerd-symbols.css` is generated. It carries Symbols Nerd Font Mono as an inline
`woff2`, because bb serves a plugin's `app.js` and `app.css` and nothing else —
a separate font file would have no URL to be fetched from.

It exists for devices that cannot have a Nerd Font installed. iOS is the case
that forced it: a shell that prints file icons (`eza --icons`, a powerline
prompt) renders every one of them as a tofu box there, and bb ships no Nerd Font
of its own. The family is listed **last** in the terminal's font stack and
restricted by `unicode-range`, so a machine with a real Nerd Font installed
keeps its own glyphs and metrics and never touches this.

Source: [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts) `NerdFontsSymbolsOnly`,
MIT — see `LICENSE-nerd-fonts`. The icon sets it aggregates (Powerline, Font
Awesome, Devicons, Octicons, Codicons, Font Logos, Material Design Icons,
Weather Icons) carry their own upstream licences, listed in that project.

## Rebuilding

```sh
curl -sSL -o symbols.zip \
  https://github.com/ryanoasis/nerd-fonts/releases/latest/download/NerdFontsSymbolsOnly.zip
unzip -o symbols.zip -d symbols
pip install fonttools brotli
pyftsubset symbols/SymbolsNerdFontMono-Regular.ttf \
  --unicodes='U+E000-F8FF,U+F0000-FFFFD,U+2600-27BF,U+2B00-2BFF,U+23FB-23FE,U+2665,U+26A1' \
  --layout-features='' --no-hinting --desubroutinize \
  --flavor=woff2 --output-file=nerd-symbols.woff2
```

Then base64 the result into the `src:` of `nerd-symbols.css`.
