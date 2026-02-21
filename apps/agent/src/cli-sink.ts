import type { OutputSink } from "./output-sink.js";
import * as display from "./cli/display.js";

export function createCliSink(): OutputSink {
  return {
    write(text: string) {
      process.stdout.write(text);
    },
    info(msg: string) {
      display.info(msg);
    },
    success(msg: string) {
      display.success(msg);
    },
    warn(msg: string) {
      display.warn(msg);
    },
    error(msg: string) {
      display.error(msg);
    },
    agentMessage(msg: string) {
      display.agentMessage(msg);
    },
    cost(line: string) {
      display.cost(line);
    },
    modeSwitch(from: string, to: string, instruction: string) {
      display.modeSwitch(from, to, instruction);
    },
    testStep(index: number, total: number, action: string, status: "running" | "pass" | "fail" | "skip") {
      display.testStep(index, total, action, status);
    },
    separator() {
      display.separator();
    },
    log(msg: string) {
      console.log(msg);
    },
  };
}
