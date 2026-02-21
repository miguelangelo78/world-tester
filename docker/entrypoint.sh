#!/usr/bin/env bash
set -e

# Start Xvfb virtual display (Chromium needs a display even in headless mode inside Docker)
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

sleep 1

# Optional: start VNC server for visual debugging
if [ "${VNC:-false}" = "true" ]; then
  echo "[entrypoint] Starting VNC server on :5900..."
  fluxbox &
  x11vnc -display :99 -forever -nopw -rfbport 5900 &
  echo "[entrypoint] VNC ready — connect to localhost:5900"
fi

echo "[entrypoint] Starting world-tester..."
exec npm start
