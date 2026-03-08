import nodemailer from "nodemailer";
import axios from "axios";
import { PrismaClient } from "@prisma/client";

/**
 * Email notification service
 * Supports SMTP, Gmail, or custom transporter configuration
 */
export class EmailNotificationService {
  private transporter: nodemailer.Transporter;

  constructor(config?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    from?: string;
  }) {
    // Use environment variables if config not provided
    const host = config?.host || process.env.SMTP_HOST || "smtp.gmail.com";
    const port = config?.port || parseInt(process.env.SMTP_PORT || "587");
    const user = config?.user || process.env.SMTP_USER;
    const password = config?.password || process.env.SMTP_PASSWORD;
    const from = config?.from || process.env.SMTP_FROM || user;

    if (!user || !password) {
      console.warn("Email notifications disabled: SMTP credentials not configured");
      this.transporter = null as any;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
      from,
    });
  }

  async send(to: string | string[], subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      console.warn("Email notifications disabled, skipping...");
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        to: Array.isArray(to) ? to.join(",") : to,
        subject,
        html,
      });
      console.log(`Email sent: ${info.messageId}`);
    } catch (err) {
      console.error("Failed to send email:", err);
      throw err;
    }
  }

  async sendTestNotification(
    to: string | string[],
    testName: string,
    status: "passed" | "failed",
    details: {
      duration?: number;
      cost?: number;
      error?: string;
      passedSteps?: number;
      totalSteps?: number;
    },
  ): Promise<void> {
    const html = this.generateTestEmailHTML(testName, status, details);
    const subject = `[E2E Test] ${testName} - ${status.toUpperCase()}`;
    await this.send(to, subject, html);
  }

  private generateTestEmailHTML(
    testName: string,
    status: string,
    details: any,
  ): string {
    const color = status === "passed" ? "#22c55e" : "#ef4444";
    const icon = status === "passed" ? "✓" : "✗";

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${color}; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; }
    .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { font-weight: 600; }
    .detail-value { text-align: right; }
    .error { background: #fee; padding: 12px; border-left: 4px solid #ef4444; margin: 12px 0; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${icon} ${testName}</h1>
      <p style="margin: 8px 0 0 0;">${status.toUpperCase()}</p>
    </div>
    <div class="content">
      <div class="detail-row">
        <span class="detail-label">Test:</span>
        <span class="detail-value">${testName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status:</span>
        <span class="detail-value"><strong>${status.toUpperCase()}</strong></span>
      </div>
      ${details.duration ? `
        <div class="detail-row">
          <span class="detail-label">Duration:</span>
          <span class="detail-value">${(details.duration / 1000).toFixed(2)}s</span>
        </div>
      ` : ""}
      ${details.cost ? `
        <div class="detail-row">
          <span class="detail-label">Cost:</span>
          <span class="detail-value">$${details.cost.toFixed(4)}</span>
        </div>
      ` : ""}
      ${details.passedSteps !== undefined ? `
        <div class="detail-row">
          <span class="detail-label">Steps:</span>
          <span class="detail-value">${details.passedSteps}/${details.totalSteps} passed</span>
        </div>
      ` : ""}
      ${details.error ? `
        <div class="error">
          <strong>Error:</strong><br/>
          ${details.error}
        </div>
      ` : ""}
    </div>
  </div>
</body>
</html>
    `;
  }
}

/**
 * Slack notification service
 * Sends formatted messages to Slack via webhook
 */
export class SlackNotificationService {
  constructor(private webhookUrl?: string) {
    this.webhookUrl = webhookUrl || process.env.SLACK_WEBHOOK_URL;
    if (!this.webhookUrl) {
      console.warn("Slack notifications disabled: SLACK_WEBHOOK_URL not configured");
    }
  }

  async send(blocks: any[]): Promise<void> {
    if (!this.webhookUrl) {
      console.warn("Slack notifications disabled, skipping...");
      return;
    }

    try {
      await axios.post(this.webhookUrl, { blocks });
      console.log("Slack notification sent");
    } catch (err) {
      console.error("Failed to send Slack notification:", err);
      throw err;
    }
  }

  async sendTestNotification(
    testName: string,
    status: "passed" | "failed",
    details: {
      duration?: number;
      cost?: number;
      error?: string;
      passedSteps?: number;
      totalSteps?: number;
      runUrl?: string;
    },
  ): Promise<void> {
    const blocks = this.generateTestBlocks(testName, status, details);
    await this.send(blocks);
  }

  private generateTestBlocks(testName: string, status: string, details: any): any[] {
    const color = status === "passed" ? "#22c55e" : "#ef4444";
    const emoji = status === "passed" ? "✅" : "❌";

    const fields = [
      {
        type: "mrkdwn",
        text: `*Status:*\n${status.toUpperCase()}`,
      },
      {
        type: "mrkdwn",
        text: `*Test:*\n${testName}`,
      },
    ];

    if (details.duration) {
      fields.push({
        type: "mrkdwn",
        text: `*Duration:*\n${(details.duration / 1000).toFixed(2)}s`,
      });
    }

    if (details.cost) {
      fields.push({
        type: "mrkdwn",
        text: `*Cost:*\n$${details.cost.toFixed(4)}`,
      });
    }

    if (details.passedSteps !== undefined) {
      fields.push({
        type: "mrkdwn",
        text: `*Steps:*\n${details.passedSteps}/${details.totalSteps}`,
      });
    }

    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} E2E Test: ${testName}`,
        },
      },
      {
        type: "section",
        fields,
      },
    ];

    if (details.error) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Error:*\n\`\`\`${details.error}\`\`\``,
        },
      });
    }

    if (details.runUrl) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Results",
            },
            url: details.runUrl,
          },
        ],
      });
    }

    return blocks;
  }
}

/**
 * Generic webhook notification service
 * Sends JSON payload to custom webhooks
 */
export class WebhookNotificationService {
  async send(webhookUrl: string, payload: any): Promise<void> {
    try {
      await axios.post(webhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });
      console.log("Webhook notification sent");
    } catch (err) {
      console.error("Failed to send webhook notification:", err);
      throw err;
    }
  }

  async sendTestNotification(
    webhookUrl: string,
    testId: string,
    testName: string,
    status: "passed" | "failed",
    details: {
      duration?: number;
      cost?: number;
      error?: string;
      passedSteps?: number;
      totalSteps?: number;
      runId?: string;
    },
  ): Promise<void> {
    const payload = {
      event: "test_completed",
      timestamp: new Date().toISOString(),
      test: {
        id: testId,
        name: testName,
      },
      result: {
        status,
        durationMs: details.duration,
        costUsd: details.cost,
        passedSteps: details.passedSteps,
        totalSteps: details.totalSteps,
        error: details.error,
        runId: details.runId,
      },
    };
    await this.send(webhookUrl, payload);
  }
}

/**
 * Unified notification dispatcher
 * Handles email, Slack, and webhook notifications
 */
export class NotificationDispatcher {
  private emailService: EmailNotificationService;
  private slackService: SlackNotificationService;
  private webhookService: WebhookNotificationService;

  constructor(config?: {
    email?: { host?: string; port?: number; user?: string; password?: string; from?: string };
    slack?: { webhookUrl?: string };
  }) {
    this.emailService = new EmailNotificationService(config?.email);
    this.slackService = new SlackNotificationService(config?.slack?.webhookUrl);
    this.webhookService = new WebhookNotificationService();
  }

  /**
   * Send notifications based on configuration
   */
  async notifyTestResult(
    testId: string,
    testName: string,
    status: "passed" | "failed",
    notificationConfig: any,
    details: {
      duration?: number;
      cost?: number;
      error?: string;
      passedSteps?: number;
      totalSteps?: number;
      runId?: string;
      runUrl?: string;
    },
  ): Promise<void> {
    if (!notificationConfig) return;

    // Only notify on failure by default, unless configured otherwise
    const shouldNotify =
      (status === "failed" && notificationConfig.notifyOnFailure !== false) ||
      (status === "passed" && notificationConfig.notifyOnSuccess === true);

    if (!shouldNotify) return;

    const promises = [];

    // Send email
    if (notificationConfig.emailEnabled && notificationConfig.emailAddresses?.length) {
      promises.push(
        this.emailService
          .sendTestNotification(notificationConfig.emailAddresses, testName, status, details)
          .catch((err) => console.error("Email notification failed:", err)),
      );
    }

    // Send Slack
    if (notificationConfig.slackEnabled && notificationConfig.slackWebhook) {
      promises.push(
        this.slackService
          .sendTestNotification(testName, status, {
            ...details,
            runUrl: details.runUrl,
          })
          .catch((err) => console.error("Slack notification failed:", err)),
      );
    }

    // Send webhook
    if (notificationConfig.webhookEnabled && notificationConfig.webhookUrl) {
      promises.push(
        this.webhookService
          .sendTestNotification(
            notificationConfig.webhookUrl,
            testId,
            testName,
            status,
            details,
          )
          .catch((err) => console.error("Webhook notification failed:", err)),
      );
    }

    await Promise.all(promises);
  }
}
