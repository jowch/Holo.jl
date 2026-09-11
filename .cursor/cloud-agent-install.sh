#!/usr/bin/env bash
# Idempotent Cloud Agent install: Julia 1.10 + Makie/CairoMakie/WGLMakie/Pluto sysimage.
# Artifacts live under $HOME/.julia (and juliaup) — never the Agent Store.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export HOLO_JULIA_SYSIMAGE="${HOLO_JULIA_SYSIMAGE:-$HOME/.julia/sysimages/holo-makie.so}"
JULIA_CHANNEL="${HOLO_JULIA_CHANNEL:-1.10}"
DEV_ENV="$HOME/.julia/environments/holo-dev"

ensure_path() {
  export PATH="$HOME/.juliaup/bin:$HOME/.local/bin:$PATH"
}

install_juliaup() {
  if command -v juliaup >/dev/null 2>&1 && command -v julia >/dev/null 2>&1; then
    echo "[holo-env] juliaup already present: $(command -v julia) ($(julia --version))"
    return 0
  fi
  echo "[holo-env] installing juliaup + Julia ${JULIA_CHANNEL}"
  curl -fsSL https://install.julialang.org | sh -s -- --yes
  ensure_path
  juliaup add "$JULIA_CHANNEL" || true
  juliaup default "$JULIA_CHANNEL"
}

install_sys_deps() {
  # CairoMakie JLLs cover most libs; fonts help Makie text paths in headless renders.
  if command -v apt-get >/dev/null 2>&1; then
    if ! dpkg -s fonts-dejavu-core >/dev/null 2>&1; then
      echo "[holo-env] installing fonts-dejavu-core (apt)"
      sudo apt-get update -qq
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-dejavu-core
    fi
  fi
}

instantiate_holo() {
  echo "[holo-env] instantiating Holo project at $ROOT"
  JULIA_NOSYSIMAGE=1 julia --project="$ROOT" -e 'using Pkg; Pkg.instantiate()'
}

setup_dev_env() {
  # Separate env so we can develop Holo + load backends without editing package Project.toml.
  mkdir -p "$DEV_ENV"
  echo "[holo-env] syncing @holo-dev (Holo + CairoMakie + WGLMakie + Pluto)"
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
  echo "[holo-env] ensuring PackageCompiler sysimage at $HOLO_JULIA_SYSIMAGE"
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
  printf '%s\n' "$real_julia" >"$HOME/.julia/sysimages/holo-julia-real.path"

  cat >"$HOME/.local/bin/julia-holo" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REAL="\${HOLO_JULIA_REAL:-}"
if [[ -z "\$REAL" && -f "\$HOME/.julia/sysimages/holo-julia-real.path" ]]; then
  REAL="\$(cat "\$HOME/.julia/sysimages/holo-julia-real.path")"
fi
REAL="\${REAL:-\$HOME/.juliaup/bin/julia}"
IMG="\${HOLO_JULIA_SYSIMAGE:-\$HOME/.julia/sysimages/holo-makie.so}"
if [[ -n "\${JULIA_NOSYSIMAGE:-}" ]]; then
  exec "\$REAL" "\$@"
fi
if [[ -f "\$IMG" ]]; then
  exec "\$REAL" -J "\$IMG" "\$@"
fi
exec "\$REAL" "\$@"
EOF
  chmod +x "$HOME/.local/bin/julia-holo"

  # Optional default: make bare `julia` use the sysimage when present.
  # Opt out with JULIA_NOSYSIMAGE=1 (used by install itself).
  cat >"$HOME/.local/bin/julia" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="\$HOME/.juliaup/bin:\$PATH"
exec "\$HOME/.local/bin/julia-holo" "\$@"
EOF
  chmod +x "$HOME/.local/bin/julia"

  # Shell hints for interactive / agent terminals.
  mkdir -p "$HOME/.config/holo"
  cat >"$HOME/.config/holo/env.sh" <<EOF
export PATH="\$HOME/.local/bin:\$HOME/.juliaup/bin:\$PATH"
export HOLO_JULIA_SYSIMAGE="\${HOLO_JULIA_SYSIMAGE:-\$HOME/.julia/sysimages/holo-makie.so}"
# Optional cloud project (Holo developed + CairoMakie/WGLMakie/Pluto):
#   julia --project=@holo-dev
# Bare \`julia\` / \`julia-holo\` uses the sysimage when present; JULIA_NOSYSIMAGE=1 skips it.
EOF

  # Ensure login shells pick this up once.
  if ! grep -q 'config/holo/env.sh' "$HOME/.bashrc" 2>/dev/null; then
    printf '\n# Holo cloud env\n[ -f "$HOME/.config/holo/env.sh" ] && . "$HOME/.config/holo/env.sh"\n' >>"$HOME/.bashrc"
  fi
}

ensure_path
install_juliaup
ensure_path
install_sys_deps
instantiate_holo
setup_dev_env
build_sysimage
install_wrappers
ensure_path

echo "[holo-env] install complete"
echo "[holo-env] sysimage: $HOLO_JULIA_SYSIMAGE ($(du -h "$HOLO_JULIA_SYSIMAGE" 2>/dev/null | cut -f1 || echo missing))"
echo "[holo-env] use: julia / julia-holo  (or julia -J \"\$HOLO_JULIA_SYSIMAGE\"); JULIA_NOSYSIMAGE=1 for stock julia"
