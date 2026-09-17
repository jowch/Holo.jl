#!/usr/bin/env bash
# Idempotent Cloud Agent install: Julia 1.10 + CairoMakie/Masque/Pluto sysimage.
# WGLMakie is *not* baked (a dual-backend image used to make masque() throw).
# Artifacts live under $HOME/.julia (and juliaup) — never the Agent Store.
# WGL live-verify / stock Julia: JULIA_NOSYSIMAGE=1 julia …
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export MASQUE_JULIA_SYSIMAGE="${MASQUE_JULIA_SYSIMAGE:-$HOME/.julia/sysimages/masque-makie.so}"
JULIA_CHANNEL="${MASQUE_JULIA_CHANNEL:-1.10}"
DEV_ENV="$HOME/.julia/environments/masque-dev"

ensure_path() {
  export PATH="$HOME/.juliaup/bin:$HOME/.local/bin:$PATH"
}

install_juliaup() {
  if command -v juliaup >/dev/null 2>&1 && command -v julia >/dev/null 2>&1; then
    echo "[masque-env] juliaup already present: $(command -v julia) ($(julia --version))"
    return 0
  fi
  echo "[masque-env] installing juliaup + Julia ${JULIA_CHANNEL}"
  curl -fsSL https://install.julialang.org | sh -s -- --yes
  ensure_path
  juliaup add "$JULIA_CHANNEL" || true
  juliaup default "$JULIA_CHANNEL"
}

install_sys_deps() {
  # CairoMakie JLLs cover most libs; fonts help Makie text paths in headless renders.
  if command -v apt-get >/dev/null 2>&1; then
    if ! dpkg -s fonts-dejavu-core >/dev/null 2>&1; then
      echo "[masque-env] installing fonts-dejavu-core (apt)"
      sudo apt-get update -qq
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-dejavu-core
    fi
  fi
}

instantiate_masque() {
  echo "[masque-env] instantiating Masque project at $ROOT"
  JULIA_NOSYSIMAGE=1 julia --project="$ROOT" -e 'using Pkg; Pkg.instantiate()'
}

setup_dev_env() {
  # Separate env so we can develop Masque + load backends without editing package Project.toml.
  mkdir -p "$DEV_ENV"
  echo "[masque-env] syncing @masque-dev (Masque + CairoMakie + WGLMakie + Pluto)"
  JULIA_NOSYSIMAGE=1 julia -e "
    using Pkg
    Pkg.activate(raw\"$DEV_ENV\")
    Pkg.develop(path=raw\"$ROOT\")
    for pkg in [\"CairoMakie\", \"WGLMakie\", \"Pluto\", \"JSON3\"]
      try
        Pkg.add(pkg)
      catch e
        @warn \"Pkg.add failed\" pkg exception=e
        rethrow()
      end
    end
    Pkg.precompile()
  "
}

build_sysimage() {
  echo "[masque-env] ensuring PackageCompiler sysimage at $MASQUE_JULIA_SYSIMAGE"
  # Never compile the sysimage while already running under it.
  JULIA_NOSYSIMAGE=1 julia "$ROOT/.cursor/sysimage/build_sysimage.jl"
}

install_wrappers() {
  mkdir -p "$HOME/.local/bin"
  # Real julia from juliaup (resolve before we might shadow PATH later).
  local real_julia
  real_julia="$(JULIA_NOSYSIMAGE=1 command -v julia)"
  # Prefer juliaup's binary if our wrapper already exists from a prior run.
  if [[ -x "$HOME/.juliaup/bin/julia" ]]; then
    real_julia="$HOME/.juliaup/bin/julia"
  fi
  printf '%s\n' "$real_julia" >"$HOME/.julia/sysimages/masque-julia-real.path"

  cat >"$HOME/.local/bin/julia-masque" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REAL="\${MASQUE_JULIA_REAL:-}"
if [[ -z "\$REAL" && -f "\$HOME/.julia/sysimages/masque-julia-real.path" ]]; then
  REAL="\$(cat "\$HOME/.julia/sysimages/masque-julia-real.path")"
fi
REAL="\${REAL:-\$HOME/.juliaup/bin/julia}"
IMG="\${MASQUE_JULIA_SYSIMAGE:-\$HOME/.julia/sysimages/masque-makie.so}"
if [[ -n "\${JULIA_NOSYSIMAGE:-}" ]]; then
  exec "\$REAL" "\$@"
fi
if [[ -f "\$IMG" ]]; then
  exec "\$REAL" -J "\$IMG" "\$@"
fi
exec "\$REAL" "\$@"
EOF
  chmod +x "$HOME/.local/bin/julia-masque"

  # Optional default: make bare `julia` use the Cairo+Masque sysimage when present.
  # Opt out with JULIA_NOSYSIMAGE=1 (install itself, WGL live-verify, stock Julia).
  cat >"$HOME/.local/bin/julia" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="\$HOME/.juliaup/bin:\$PATH"
exec "\$HOME/.local/bin/julia-masque" "\$@"
EOF
  chmod +x "$HOME/.local/bin/julia"

  # Shell hints for interactive / agent terminals.
  mkdir -p "$HOME/.config/masque"
  cat >"$HOME/.config/masque/env.sh" <<EOF
export PATH="\$HOME/.local/bin:\$HOME/.juliaup/bin:\$PATH"
export MASQUE_JULIA_SYSIMAGE="\${MASQUE_JULIA_SYSIMAGE:-\$HOME/.julia/sysimages/masque-makie.so}"
# Optional cloud project (Masque developed + CairoMakie/WGLMakie/Pluto):
#   julia --project=@masque-dev
# Bare \`julia\` / \`julia-masque\` uses the Cairo+Masque sysimage when present (\`-J\`).
# JULIA_NOSYSIMAGE=1 skips -J: required for WGLMakie live-verify and stock Julia.
# Also use it to pick up Masque source edits that landed after this image was baked.
EOF

  # Ensure login shells pick this up once.
  if ! grep -q 'config/masque/env.sh' "$HOME/.bashrc" 2>/dev/null; then
    printf '\n# Masque cloud env\n[ -f "$HOME/.config/masque/env.sh" ] && . "$HOME/.config/masque/env.sh"\n' >>"$HOME/.bashrc"
  fi
}

ensure_path
install_juliaup
ensure_path
install_sys_deps
instantiate_masque
setup_dev_env
build_sysimage
install_wrappers
ensure_path

echo "[masque-env] install complete"
echo "[masque-env] sysimage: $MASQUE_JULIA_SYSIMAGE ($(du -h "$MASQUE_JULIA_SYSIMAGE" 2>/dev/null | cut -f1 || echo missing))"
echo "[masque-env] use: julia / julia-masque  (or julia -J \"\$MASQUE_JULIA_SYSIMAGE\")"
echo "[masque-env] JULIA_NOSYSIMAGE=1 for stock Julia / WGL live-verify (do not bake WGLMakie)"
