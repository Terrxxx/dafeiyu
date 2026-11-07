#!/bin/bash
set -euo pipefail
ROOT=/opt/dafeiyu
test "$(realpath "$ROOT")" = /opt/dafeiyu
install -d -m 755 "$ROOT/runtime" "$ROOT/deploy"
if ! id dafeiyu >/dev/null 2>&1; then useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin dafeiyu; fi
export DEBIAN_FRONTEND=noninteractive
if [ ! -x "$ROOT/runtime/node/bin/node" ]; then
  docker create --name dafeiyu-node-export node:24-bookworm-slim >/dev/null
  install -d "$ROOT/runtime/node"
  docker cp dafeiyu-node-export:/usr/local/. "$ROOT/runtime/node/"
  docker rm dafeiyu-node-export >/dev/null
fi
export PATH="$ROOT/runtime/node/bin:$PATH"
node --version
cd "$ROOT"
chown dafeiyu:dafeiyu "$ROOT" "$ROOT/.env" "$ROOT/config.json" "$ROOT/persona.md" "$ROOT/package.json" "$ROOT/package-lock.json"
chown -R dafeiyu:dafeiyu "$ROOT/data" "$ROOT/reports" "$ROOT/harness-runtime" "$ROOT/src" "$ROOT/web" "$ROOT/test"
chmod 600 "$ROOT/.env"
install -d -o dafeiyu -g dafeiyu "$ROOT/runtime/npm-cache"
runuser -u dafeiyu -- env PATH="$PATH" npm_config_cache="$ROOT/runtime/npm-cache" npm ci --no-audit --no-fund > "$ROOT/backups/migration-20261027/npm-install.log" 2>&1
cd "$ROOT/harness-runtime"
runuser -u dafeiyu -- env PATH="$PATH" npm_config_cache="$ROOT/runtime/npm-cache" npm ci --no-audit --no-fund > "$ROOT/backups/migration-20261027/harness-install.log" 2>&1
cat > "$ROOT/deploy/apt.sources" <<'EOF'
Types: deb
URIs: https://mirrors.tuna.tsinghua.edu.cn/debian
Suites: trixie trixie-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: https://mirrors.tuna.tsinghua.edu.cn/debian-security
Suites: trixie-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF
APT_ARGS=(-o "Dir::Etc::sourcelist=$ROOT/deploy/apt.sources" -o 'Dir::Etc::sourceparts=-' -o 'Acquire::ForceIPv4=true' -o 'Acquire::https::Timeout=30' -o 'Acquire::Retries=2')
apt-get "${APT_ARGS[@]}" update -qq
apt-get "${APT_ARGS[@]}" install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates libgomp1 > "$ROOT/backups/migration-20261027/apt-install.log" 2>&1
echo 'Linux Node, Chromium, voice engine and Harness dependencies installed.'
