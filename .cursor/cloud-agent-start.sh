#!/usr/bin/env bash
# Per-boot: ensure PATH + sysimage env vars for Cloud Agents.
# Does not rebuild the sysimage (that belongs in install).
set -euo pipefail

ENV_SH="$HOME/.config/masque/env.sh"
if [[ -f "$ENV_SH" ]]; then
  # shellcheck source=/dev/null
  . "$ENV_SH"
else
  export PATH="$HOME/.local/bin:$HOME/.juliaup/bin:$PATH"
  export MASQUE_JULIA_SYSIMAGE="${MASQUE_JULIA_SYSIMAGE:-$HOME/.julia/sysimages/masque-makie.so}"
fi

# Re-assert PATH for non-login agent shells.
export PATH="$HOME/.local/bin:$HOME/.juliaup/bin:$PATH"

if [[ -f "${MASQUE_JULIA_SYSIMAGE:-}" ]]; then
  echo "[masque-env] sysimage ready: $MASQUE_JULIA_SYSIMAGE"
else
  echo "[masque-env] WARNING: sysimage missing at ${MASQUE_JULIA_SYSIMAGE:-unset}; run .cursor/cloud-agent-install.sh"
fi

if command -v julia >/dev/null 2>&1; then
  echo "[masque-env] julia: $(command -v julia) ($(JULIA_NOSYSIMAGE=1 julia --version 2>/dev/null || julia --version))"
fi

exit 0
