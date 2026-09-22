#!/usr/bin/env bash
# ==============================================================================
# PDF Page Studio - macOS One-Click Launcher
# Starts a local lightweight background server (if not already running)
# and opens PDF Page Studio in the default web browser.
# ==============================================================================

PORT=7890
HOST="127.0.0.1"
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Check if server is already running on the target port
if ! lsof -Pi :${PORT} -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    # Start python lightweight HTTP server bound strictly to localhost
    python3 -m http.server ${PORT} --bind ${HOST} >/dev/null 2>&1 &
    # Allow 400ms for socket initialization
    sleep 0.4
fi

# Open the application in the system's default browser
open "http://${HOST}:${PORT}/index.html"
