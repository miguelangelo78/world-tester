/**
 * Abstraction over output delivery. The CLI sink writes to stdout with chalk
 * colors; the WebSocket sink emits typed messages to connected clients.
 */
export interface OutputSink {
  write(text: string): void;
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  agentMessage(msg: string): void;
  cost(line: string): void;
  modeSwitch(from: string, to: string, instruction: string): void;
  testStep(index: number, total: number, action: string, status: "running" | "pass" | "fail" | "skip"): void;
  separator(): void;
  log(msg: string): void;
}
