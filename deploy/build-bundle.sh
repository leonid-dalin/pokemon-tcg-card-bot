#!/bin/bash
set -euo pipefail

sha=${1:?usage: build-bundle.sh COMMIT_SHA OUTPUT_DIRECTORY}
output=${2:?output directory required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ $(uname -s) == Linux && $(uname -m) == aarch64 ]] || { echo 'Linux ARM64 required' >&2; exit 1; }
node_version=$(cat .nvmrc)
[[ $(node --version) == "v$node_version" ]] || { echo 'Node version does not match .nvmrc' >&2; exit 1; }
mkdir -p "$output"
output=$(realpath "$output")
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/bin" "$stage/src/data" "$stage/deploy" "$stage/docs"
node_version=$(cat .nvmrc)
dist_url="https://nodejs.org/dist/v$node_version"
runtime_tar="node-v$node_version-linux-arm64.tar.xz"
curl --fail --silent --show-error --location "$dist_url/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
expected=$(awk -v name="$runtime_tar" '$2 == name { print $1 }' "$stage/SHASUMS256.txt")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo "No pinned checksum for $runtime_tar" >&2; exit 1; }
curl --fail --silent --show-error --location "$dist_url/$runtime_tar" -o "$stage/$runtime_tar"
echo "$expected  $stage/$runtime_tar" | sha256sum --check --status \
  || { echo "Node runtime checksum mismatch" >&2; exit 1; }
tar -xJf "$stage/$runtime_tar" -C "$stage" \
  "node-v$node_version-linux-arm64/bin/node" "node-v$node_version-linux-arm64/LICENSE"
mv "$stage/node-v$node_version-linux-arm64/bin/node" "$stage/bin/node"
mv "$stage/node-v$node_version-linux-arm64/LICENSE" "$stage/bin/LICENSE"
rm -rf "${stage:?}/node-v$node_version-linux-arm64" "${stage:?}/$runtime_tar" "${stage:?}/SHASUMS256.txt"
cp -r dist "$stage/"
cp src/data/text-index.json "$stage/src/data/"
cp package.json package-lock.json LICENSE NOTICE "$stage/"
cp docs/THIRD_PARTY_NOTICES.md "$stage/docs/"
cp deploy/smoke.mjs deploy/import-env.mjs "$stage/deploy/"
printf '{"sha":"%s","platform":"linux","arch":"arm64","node":"%s","built":"%s"}\n' "$sha" "$node_version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage/BUILD.json"
(
  cd "$stage"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  rm -rf node_modules/.bin
  ./bin/node deploy/smoke.mjs
)
if find "$stage" -type l -print -quit | grep -q .; then
  echo 'Release bundles must contain only files and directories' >&2
  exit 1
fi
name="pokemon-card-bot-linux-arm64-$sha.tar.gz"
tar -czf "$output/$name" -C "$stage" .
(
  cd "$output"
  sha256sum "$name" > "$name.sha256"
)
