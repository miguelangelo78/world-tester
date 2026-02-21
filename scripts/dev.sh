#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

DISPLAY_NUM=99
export DISPLAY=:${DISPLAY_NUM}
VIEWPORT_W=1288
VIEWPORT_H=711
VNC_PORT=5900
VNC_WS_PORT=5901

cleanup() {
  echo ""
  echo "[dev] Shutting down..."
  kill $XVFB_PID $X11VNC_PID $PROXY_PID 2>/dev/null || true
  fuser -k ${VNC_PORT}/tcp 2>/dev/null || true
  fuser -k ${VNC_WS_PORT}/tcp 2>/dev/null || true
  pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
  pkill -f "x11vnc.*:${DISPLAY_NUM}" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Dependency checks — auto-install if missing
missing=()
command -v Xvfb    >/dev/null 2>&1 || missing+=(xvfb)
command -v x11vnc  >/dev/null 2>&1 || missing+=(x11vnc)

if [ ${#missing[@]} -gt 0 ]; then
  echo "[dev] Missing system packages: ${missing[*]}"
  echo "[dev] Installing via apt (requires sudo)..."
  sudo apt-get update -qq && sudo apt-get install -y -qq "${missing[@]}"
fi

# Kill any leftover processes from a previous run
pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "x11vnc.*:${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "ws-vnc-proxy" 2>/dev/null || true
fuser -k ${VNC_PORT}/tcp 2>/dev/null || true
fuser -k ${VNC_WS_PORT}/tcp 2>/dev/null || true
sleep 0.5

# ── Xvfb ──────────────────────────────────────────────────
echo "[dev] Starting Xvfb on :${DISPLAY_NUM} (${VIEWPORT_W}x${VIEWPORT_H})..."
Xvfb :${DISPLAY_NUM} -screen 0 ${VIEWPORT_W}x${VIEWPORT_H}x24 -ac +extension GLX +render -noreset 2>/dev/null &
XVFB_PID=$!

echo -n "[dev] Waiting for Xvfb..."
for i in $(seq 1 30); do
  if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo " FAILED (Xvfb exited)"
    exit 1
  fi
  if xdpyinfo -display :${DISPLAY_NUM} &>/dev/null; then
    echo " ready"
    break
  fi
  echo -n "."
  sleep 0.5
done
if ! xdpyinfo -display :${DISPLAY_NUM} &>/dev/null; then
  echo " FAILED (display :${DISPLAY_NUM} not available)"
  exit 1
fi

# ── x11vnc ────────────────────────────────────────────────
# env -u strips WAYLAND_DISPLAY so x11vnc doesn't bail on WSL2
echo "[dev] Starting x11vnc on :${VNC_PORT}..."
env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE \
  x11vnc -display :${DISPLAY_NUM} -forever -shared -nopw -rfbport ${VNC_PORT} -noxdamage \
  > /tmp/x11vnc-dev.log 2>&1 &
X11VNC_PID=$!

echo -n "[dev] Waiting for x11vnc..."
for i in $(seq 1 30); do
  if ! kill -0 $X11VNC_PID 2>/dev/null; then
    echo " FAILED (x11vnc exited)"
    echo "[dev] x11vnc log:"
    cat /tmp/x11vnc-dev.log 2>/dev/null || true
    exit 1
  fi
  if nc -z localhost ${VNC_PORT} 2>/dev/null; then
    echo " ready"
    break
  fi
  echo -n "."
  sleep 0.5
done
if ! nc -z localhost ${VNC_PORT} 2>/dev/null; then
  echo " FAILED (x11vnc not listening on :${VNC_PORT})"
  echo "[dev] x11vnc log:"
  cat /tmp/x11vnc-dev.log 2>/dev/null || true
  exit 1
fi

# ── WebSocket-to-TCP proxy ────────────────────────────────
echo "[dev] Starting VNC WebSocket proxy on :${VNC_WS_PORT} -> :${VNC_PORT}..."
VNC_PORT=${VNC_PORT} VNC_WS_PORT=${VNC_WS_PORT} node "${SCRIPT_DIR}/ws-vnc-proxy.mjs" &
PROXY_PID=$!

echo -n "[dev] Waiting for proxy..."
for i in $(seq 1 20); do
  if ! kill -0 $PROXY_PID 2>/dev/null; then
    echo " FAILED (proxy exited)"
    exit 1
  fi
  if nc -z localhost ${VNC_WS_PORT} 2>/dev/null; then
    echo " ready"
    break
  fi
  echo -n "."
  sleep 0.5
done
if ! nc -z localhost ${VNC_WS_PORT} 2>/dev/null; then
  echo " FAILED (proxy not listening on :${VNC_WS_PORT})"
  exit 1
fi

echo ""
echo "[dev] VNC ready — raw :${VNC_PORT}, WebSocket :${VNC_WS_PORT}"
echo "[dev] Open http://localhost:3000 to see the browser"
echo ""

# Browser renders to Xvfb (not headless, not visible on desktop)
export HEADLESS=false
export BROWSER_KIOSK=1

exec npx concurrently \
  --names "agent,web" \
  --prefix-colors "cyan,magenta" \
  "npm run agent:server" \
  "npm run web"
