#!/usr/bin/env bash
# Per-boot: ensure PATH + sysimage env vars for Cloud Agents.
# Does not rebuild the sysimage (that belongs in install).
set -euo pipefail

ENV_SH="$HOME/.config/holo/env.sh"
if [[ -f "$ENV_SH" ]]; then
  # shellcheck source=/dev/null
  . "$ENV_SH"
else
  export PATH="$HOME/.local/bin:$HOME/.juliaup/bin:$PATH"
  export HOLO_JULIA_SYSIMAGE="${HOLO_JULIA_SYSIMAGE:-$HOME/.julia/sysimages/holo-makie.so}"
fi

# Re-assert PATH for non-login agent shells.
export PATH="$HOME/.local/bin:$HOME/.juliaup/bin:$PATH"

if [[ -f "${HOLO_JULIA_SYSIMAGE:-}" ]]; then
  echo "[holo-env] sysimage ready: $HOLO_JULIA_SYSIMAGE"
else
  echo "[holo-env] WARNING: sysimage missing at ${HOLO_JULIA_SYSIMAGE:-unset}; run .cursor/cloud-agent-install.sh"
fi

if command -v julia >/dev/null 2>&1; then
  echo "[holo-env] julia: $(command -v julia) ($(JULIA_NOSYSIMAGE=1 julia --version 2>/dev/null || julia --version))"
fi

exit 0
