#!/bin/sh

cd "$(dirname "$0")" || exit 1

echo "Starting Cardwright..."
echo
echo "Open this URL in your browser:"
echo "http://127.0.0.1:8787"
echo
echo "Press Ctrl+C in this window to stop the server."
echo

node server.mjs
