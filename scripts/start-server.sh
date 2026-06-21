#!/usr/bin/env bash
set -euo pipefail
# Start the server in the background and record its PID in .server.pid
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

if [ -f .server.pid ]; then
  PID=$(cat .server.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "Server already running (pid $PID)"
    exit 0
  else
    rm -f .server.pid
  fi
fi

# Start via npm start so environment and scripts are consistent
nohup npm start > server.log 2>&1 &
PID=$!
echo "$PID" > .server.pid
echo "Server started (pid $PID). Logs: server.log"
