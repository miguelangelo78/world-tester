#!/usr/bin/env node
/**
 * WebSocket-to-TCP proxy for VNC.
 * Bridges noVNC (WebSocket on WS_PORT) to x11vnc (TCP on VNC_PORT).
 */
import { createServer as createHttpServer } from "http";
import { Socket } from "net";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
const { OPEN } = WebSocket;

const VNC_PORT = parseInt(process.env.VNC_PORT ?? "5900", 10);
const WS_PORT = parseInt(process.env.VNC_WS_PORT ?? "5901", 10);

let connId = 0;

const httpServer = createHttpServer((_req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("WebSocket connections only");
});

const wss = new WebSocketServer({
  server: httpServer,
  handleProtocols(protocols) {
    if (protocols.has("binary")) return "binary";
    return false;
  },
});

wss.on("connection", (ws, req) => {
  const id = ++connId;
  const proto = ws.protocol || "(none)";
  console.log(`[vnc-proxy] #${id} connected  proto=${proto}  from=${req.socket.remoteAddress}`);

  const tcp = new Socket();
  tcp.setNoDelay(true);

  let tcpConnected = false;
  let wsOpen = true;
  let destroyed = false;
  const pendingFromWs = [];

  tcp.connect(VNC_PORT, "127.0.0.1");

  tcp.on("connect", () => {
    tcpConnected = true;
    console.log(`[vnc-proxy] #${id} tcp connected to :${VNC_PORT}`);
    for (const buf of pendingFromWs) tcp.write(buf);
    pendingFromWs.length = 0;
  });

  tcp.on("data", (chunk) => {
    if (wsOpen && ws.readyState === OPEN) {
      const ok = ws.send(chunk, { binary: true, fin: true }, (err) => {
        if (err) destroy("ws send error");
      });
    }
  });

  ws.on("message", (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (tcpConnected) {
      tcp.write(buf);
    } else {
      pendingFromWs.push(buf);
    }
  });

  function destroy(reason) {
    if (destroyed) return;
    destroyed = true;
    wsOpen = false;
    console.log(`[vnc-proxy] #${id} closed  reason=${reason || "unknown"}`);
    tcp.destroy();
    if (ws.readyState === OPEN) ws.close(1000);
  }

  tcp.on("end", () => destroy("tcp end"));
  tcp.on("close", () => destroy("tcp close"));
  tcp.on("error", (err) => destroy(`tcp error: ${err.message}`));
  ws.on("close", (code) => { destroy(`ws close code=${code}`); });
  ws.on("error", (err) => { destroy(`ws error: ${err.message}`); });
});

httpServer.listen(WS_PORT, () => {
  console.log(`[vnc-proxy] WebSocket :${WS_PORT} -> TCP :${VNC_PORT}`);
});
