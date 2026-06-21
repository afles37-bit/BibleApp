#!/usr/bin/env bash
set -euo pipefail
# Stop the server started by start-server.sh or kill any process listening on port 3000
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

if [ -f .server.pid ]; then
  PID=$(cat .server.pid)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Stopped server (pid $PID)"
    rm -f .server.pid
    exit 0
  else
    echo "PID $PID not running, removing stale .server.pid"
    rm -f .server.pid
  fi
fi

# Fallback: kill by port
PID_LIST=$(lsof -ti:3000 || true)
if [ -n "$PID_LIST" ]; then
  echo "Killing processes on port 3000: $PID_LIST"
  kill -9 $PID_LIST
  exit 0
fi

echo "No server process found on port 3000"
