#!/bin/sh
# Vendor the upstream kit the parity suite compares against.
#
# The port claims to be algorithmically equivalent, so the honest check is to run
# both on the same input. Re-fetch after moving to a new upstream revision.
set -eu
dir="$(dirname "$0")/../test/fixtures/anatomy-kit"
mkdir -p "$dir"
for file in iso-kit.mjs lathe.mjs tube.mjs; do
  curl -sfL "https://raw.githubusercontent.com/wheresryan22/anatomy/main/kit/$file" -o "$dir/$file"
  echo "fetched $file"
done
