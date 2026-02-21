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

sleep 1

# Optional: start VNC server for visual debugging
if [ "${VNC:-false}" = "true" ]; then
  echo "[entrypoint] Starting VNC server on :5900..."
  fluxbox &
  x11vnc -display :99 -forever -nopw -rfbport 5900 &
  echo "[entrypoint] VNC ready — connect to localhost:5900"
fi

# Rewrite localhost/127.0.0.1 to host.docker.internal in all relevant env vars
# so the container can reach services running on the host machine
for var in DATABASE_URL TARGET_URL; do
  val="${!var}"
  if [ -n "$val" ]; then
    val="${val//localhost/host.docker.internal}"
    val="${val//127.0.0.1/host.docker.internal}"
    export "$var"="$val"
  fi
done

echo "[entrypoint] Starting world-tester..."
exec npm start
