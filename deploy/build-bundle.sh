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
cp "$(command -v node)" "$stage/bin/node"
cp -r dist "$stage/"
cp src/data/text-index.json "$stage/src/data/"
cp package.json package-lock.json LICENSE NOTICE "$stage/"
cp docs/THIRD_PARTY_NOTICES.md "$stage/docs/"
cp deploy/smoke.mjs deploy/import-env.mjs "$stage/deploy/"
curl --fail --silent --show-error --location "https://nodejs.org/dist/v$node_version/LICENSE" -o "$stage/bin/LICENSE"
printf '{"sha":"%s","platform":"linux","arch":"arm64","node":"%s"}\n' "$sha" "$node_version" > "$stage/BUILD.json"
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
