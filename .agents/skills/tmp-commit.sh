#!/usr/bin/env bash
set -euo pipefail
cd /home/allopze/dev/chome/bodega
git add -A
git commit -F /tmp/commit_msg.txt
echo "COMMIT_DONE=$?"
