#!/usr/bin/env bash
set -e

# Ensure browser profile directory is writable (volume may have been created by root)
mkdir -p /app/data/.browser-profile
rm -f /app/data/.browser-profile/SingletonLock \
      /app/data/.browser-profile/SingletonSocket \
      /app/data/.browser-profile/SingletonCookie 2>/dev/null || true

# Start Xvfb virtual display sized to match the browser viewport
Xvfb :99 -screen 0 1288x711x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99
export BROWSER_KIOSK=1

sleep 1

# Optional: start VNC server for visual debugging
if [ "${VNC:-false}" = "true" ]; then
  echo "[entrypoint] Starting VNC server on :5900..."
  env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE \
    x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -noxdamage -quiet &
  echo "[entrypoint] Starting WebSocket proxy on :5901 -> :5900..."
  VNC_PORT=5900 VNC_WS_PORT=5901 node /app/scripts/ws-vnc-proxy.mjs &
  echo "[entrypoint] VNC ready — raw on :5900, WebSocket on :5901"
fi

# Rewrite localhost/127.0.0.1 to host.docker.internal in all relevant env vars
for var in DATABASE_URL TARGET_URL; do
  val="${!var}"
  if [ -n "$val" ]; then
    val="${val//localhost/host.docker.internal}"
    val="${val//127.0.0.1/host.docker.internal}"
    export "$var"="$val"
  fi
done

# Choose mode: server (for frontend integration) or CLI (interactive)
if [ "${AGENT_MODE:-cli}" = "server" ]; then
  echo "[entrypoint] Starting agent in server mode..."
  exec npm run agent:server
else
  echo "[entrypoint] Starting agent in CLI mode..."
  exec npm run agent
fi
