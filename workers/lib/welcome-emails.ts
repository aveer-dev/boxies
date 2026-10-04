// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Onboarding and welcome emails for newly provisioned mailboxes.
 *
 * Generates and seeds real, detailed platform emails directly into the inbox
 * before the user opens their mailbox:
 *   1. Welcome to Inboxies — Getting Started & Quick Setup Guide
 *   2. Meet Your Built-in AI Agent — Auto-Drafts, Deep Search & Copilot Instructions
 *   3. Advanced Guide — Sender Triage, Reply Later, Custom Domains & Security
 */

import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import type { EmailAuth } from "./email-auth";
import { computeSnippet } from "./email-content";
import { computeSearchText } from "./email-fts";
import { resolveMailDomain } from "./mail-domain";

export interface WelcomeEmailData {
	id: string;
	subject: string;
	sender: string;
	sender_name: string;
	recipient: string;
	date: string;
	body: string;
	snippet: string;
	search_text: string;
	read: boolean;
	starred: boolean;
	thread_id: string;
	message_id: string;
	raw_headers: string;
	auth: EmailAuth;
}

export interface GenerateWelcomeEmailsOptions {
	recipientEmail: string;
	recipientName?: string | null;
	domain?: string;
	baseDate?: Date;
}

function sanitizeDisplayName(name?: string | null, fallbackEmail?: string): string {
	if (name && name.trim()) return name.trim();
	if (fallbackEmail && fallbackEmail.includes("@")) {
		const local = fallbackEmail.split("@")[0];
		if (local) return local.charAt(0).toUpperCase() + local.slice(1);
	}
	return "there";
}

/**
 * Common HTML email shell styling for consistent Notion-inspired presentation
 * across web iframes, iOS SwiftUI views, and Android Jetpack Compose views.
 */
function emailShell(params: {
	badge: string;
	badgeBg: string;
	badgeColor: string;
	badgeBorder: string;
	title: string;
	subtitle: string;
	contentHtml: string;
}): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${params.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 1.65; -webkit-font-smoothing: antialiased;">
<div style="max-width: 680px; margin: 0 auto; padding: 32px 20px;">
  <!-- Header Badge -->
  <div style="margin-bottom: 14px;">
    <span style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-radius: 9999px; background: ${params.badgeBg}; color: ${params.badgeColor}; border: 1px solid ${params.badgeBorder};">
      ${params.badge}
    </span>
  </div>

  <!-- Header Title & Subtitle -->
  <h1 style="font-size: 24px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; letter-spacing: -0.025em; line-height: 1.3;">
    ${params.title}
  </h1>
  <p style="font-size: 15px; color: #64748b; margin: 0 0 24px 0; line-height: 1.5;">
    ${params.subtitle}
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 24px 0;" />

  <!-- Main Email Body -->
  ${params.contentHtml}

  <!-- Footer -->
  <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
    <p style="margin: 0 0 6px 0;">
      <strong>Inboxies</strong> &bull; Sovereign, edge-native email powered by Cloudflare Workers, Durable Objects, and R2.
    </p>
    <p style="margin: 0;">
      This is a platform notification sent directly to your mailbox. Your emails and personal data remain under your sovereign control at all times.
    </p>
  </div>
</div>
</body>
</html>`;
}

function buildEmail1GettingStarted(recipientEmail: string, displayName: string): {
	subject: string;
	body: string;
	snippet: string;
} {
	const subject = "Welcome to Inboxies — Getting Started & Quick Setup Guide";
	const snippet = `Welcome to your sovereign inbox ${recipientEmail}! Here is your setup checklist, keyboard shortcuts, and guide to connecting iOS and Android devices.`;

	const contentHtml = `
  <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155;">
    Hi <strong>${displayName}</strong>,
  </p>
  <p style="margin: 0 0 20px 0; color: #334155;">
    Welcome to your new inbox at <code style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #0284c7; border: 1px solid #e2e8f0;">${recipientEmail}</code>!
    Inboxies is an edge-native email platform built from the ground up for speed, privacy, and sovereignty. Unlike conventional webmail providers, each mailbox operates in its own isolated <strong>Durable Object</strong> with a dedicated SQLite database, storing bodies and attachments in Cloudflare R2 with zero third-party telemetry.
  </p>

  <!-- Quick Setup Checklist Card -->
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 22px 24px; margin: 24px 0;">
    <h2 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 14px 0; display: flex; align-items: center;">
      <span style="display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: #2563eb; color: #ffffff; text-align: center; line-height: 22px; font-size: 12px; margin-right: 10px;">&check;</span>
      Quick Start Checklist
    </h2>

    <div style="margin-bottom: 18px;">
      <h3 style="font-size: 14.5px; font-weight: 600; color: #1e293b; margin: 0 0 4px 0;">1. Personalize Your Profile & Signature</h3>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        Open <strong>Settings</strong> in the left sidebar. Set your <strong>Display Name</strong> so outgoing messages clearly identify you. Add an optional rich-text <strong>Email Signature</strong> and configure an <strong>Auto-Reply</strong> if you are stepping away.
      </p>
    </div>

    <div style="margin-bottom: 18px;">
      <h3 style="font-size: 14.5px; font-weight: 600; color: #1e293b; margin: 0 0 4px 0;">2. Connect Native Mobile Apps (iOS & Android)</h3>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 8px 0;">
        Inboxies features native client twins for <strong>iOS (SwiftUI)</strong> and <strong>Android (Jetpack Compose)</strong> with Notion-inspired Inter typography and liquid-glass controls.
      </p>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        <strong>Passwordless Device Pairing:</strong> Go to <strong>Settings &rarr; Sign-in methods &rarr; Link another device</strong> to generate a temporary 15-minute pairing code. Enter the code on your phone to link your session securely in seconds. You can also connect <strong>Sign in with Apple</strong> or <strong>Sign in with Google</strong>.
      </p>
    </div>

    <div style="margin-bottom: 18px;">
      <h3 style="font-size: 14.5px; font-weight: 600; color: #1e293b; margin: 0 0 4px 0;">3. Composing & Rich Formatting</h3>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        Click <strong>Compose</strong> or press <kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">c</kbd> to open the editor. The composer supports full formatting (headings, bold, lists, quotes, inline images) and drag-and-drop file attachments up to <strong>5 MiB</strong>. Sent emails display delivery badges showing real-time delivery status.
      </p>
    </div>

    <div>
      <h3 style="font-size: 14.5px; font-weight: 600; color: #1e293b; margin: 0 0 4px 0;">4. Review the Built-in AI Agent</h3>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        Check out the companion email in your inbox: <em>"Meet Your Built-in AI Agent"</em> to learn how automated background drafting and side-panel copilot tools assist your everyday workflow.
      </p>
    </div>
  </div>

  <!-- Essential Keyboard Shortcuts -->
  <h2 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 28px 0 12px 0;">
    Essential Keyboard Shortcuts
  </h2>
  <p style="font-size: 14px; color: #475569; margin: 0 0 14px 0;">
    Designed for speed. Navigate and process your entire inbox without reaching for your mouse:
  </p>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px;">
    <thead>
      <tr style="background: #f1f5f9; text-align: left; color: #334155;">
        <th style="padding: 9px 12px; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #cbd5e1; border-radius: 6px 0 0 0;">Key</th>
        <th style="padding: 9px 12px; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #cbd5e1; border-radius: 0 6px 0 0;">Action</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">c</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Compose a new message</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">j</kbd> / <kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">k</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Select next / previous email in the list</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">Enter</kbd> or <kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">o</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Open selected email conversation</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">r</kbd> / <kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">a</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Reply / Reply All</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">f</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Forward email</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">e</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Archive message</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">l</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Reply Later (snooze to focus queue)</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">s</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Star / Unstar thread</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">#</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Move to Trash</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">/</kbd></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">Focus full-text search</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px;"><kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">Esc</kbd></td>
        <td style="padding: 8px 12px; color: #334155;">Close drawer / Back to email list</td>
      </tr>
    </tbody>
  </table>

  <!-- Pro Tip Box -->
  <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px 18px; border-radius: 6px; margin: 20px 0; color: #166534; font-size: 13.5px;">
    <strong>Pro Tip:</strong> Press <kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: #ffffff; border: 1px solid #86efac; border-radius: 3px; padding: 1px 4px; color: #166534;">?</kbd> at any time inside the web app to open the full interactive shortcut overlay.
  </div>

  <p style="margin: 24px 0 0 0; color: #475569; font-size: 14px;">
    Warm regards,<br />
    <strong style="color: #0f172a;">The Inboxies Team</strong>
  </p>
`;

	const body = emailShell({
		badge: "Getting Started",
		badgeBg: "#e0f2fe",
		badgeColor: "#0369a1",
		badgeBorder: "#bae6fd",
		title: subject,
		subtitle: "Your step-by-step setup checklist, device pairing instructions, and navigation cheat sheet.",
		contentHtml,
	});

	return { subject, body, snippet };
}

function buildEmail2AiAssistant(recipientEmail: string, displayName: string): {
	subject: string;
	body: string;
	snippet: string;
} {
	const subject = "Meet Your Built-in AI Agent — Auto-Drafts, Deep Search & Copilot Instructions";
	const snippet = `Learn how your sovereign AI Email Agent drafts replies on incoming emails, executes FTS5 searches, and assists in the side panel copilot.`;

	const contentHtml = `
  <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155;">
    Hello <strong>${displayName}</strong>,
  </p>
  <p style="margin: 0 0 20px 0; color: #334155;">
    Every Inboxies mailbox includes a dedicated, private AI Email Agent powered by the <strong>Cloudflare Agents SDK</strong> and <strong>Workers AI</strong>. Your agent runs within your mailbox's isolated boundary, with no external LLM vendors retaining or training on your correspondence.
  </p>

  <!-- Core Capability Cards -->
  <div style="display: grid; gap: 16px; margin: 24px 0;">
    <!-- 1. Auto-Drafting -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px;">
      <h2 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        1. Auto-Drafting on Incoming Mail & Human-in-the-Loop
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 10px 0;">
        When a new email arrives, your AI agent evaluates the conversation context and composes an intelligent suggested reply in the background.
      </p>
      <div style="background: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 10px 14px; font-size: 13px; color: #854d0e;">
        <strong>Safety Guarantee:</strong> The agent <em>never sends an email autonomously</em>. Generated replies appear with an <strong>"Approve & Send"</strong> button or an option to edit before sending. You retain 100% control over every outbound email.
      </div>
    </div>

    <!-- 2. Side Panel Copilot -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px;">
      <h2 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        2. Side Panel Copilot & Multi-Conversation History
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 8px 0;">
        Click the sparkle AI icon in the header to open the interactive copilot drawer. You can maintain multiple persistent chat conversations across projects or triage sessions.
      </p>
      <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #475569; line-height: 1.6;">
        <li><em>"Summarize the latest thread with the logistics team in 3 bullet points."</em></li>
        <li><em>"Find all receipts from last month totaling over $100."</em></li>
        <li><em>"Draft a polite refusal to the vendor inquiry received yesterday."</em></li>
      </ul>
    </div>

    <!-- 3. Built-in Email Tools -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px;">
      <h2 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        3. Built-in Tools with Transparent Execution
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 10px 0;">
        Your agent utilizes specialized tools to inspect and interact with your mailbox safely:
      </p>
      <div style="font-size: 13px; color: #334155; line-height: 1.6;">
        <code style="background: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 12px;">search_emails</code> &mdash; Full-text SQLite FTS5 search across all message bodies.<br />
        <code style="background: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 12px;">get_thread</code> &mdash; Hydrates complete conversation trees from R2.<br />
        <code style="background: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 12px;">draft_reply</code> &mdash; Prepares formatted draft responses.<br />
        <code style="background: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 12px;">move_email</code> &mdash; Organizes messages into folders.<br />
      </div>
      <p style="font-size: 13px; color: #64748b; margin: 10px 0 0 0;">
        Every tool call is rendered directly in the chat stream so you can audit the exact arguments and queries executed.
      </p>
    </div>

    <!-- 4. Custom System Prompt -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px;">
      <h2 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        4. Customizing Your Agent's System Prompt
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 8px 0;">
        Teach your agent your specific communication preferences. Head to <strong>Settings &rarr; Agent Prompt</strong> to configure:
      </p>
      <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #475569; line-height: 1.6;">
        <li>Your communication style (e.g. <em>"Direct, concise, professional bullet points"</em>).</li>
        <li>Preferred greetings and sign-offs.</li>
        <li>Specific handling rules (e.g. <em>"Always highlight pending deadlines in bold"</em>).</li>
      </ul>
    </div>

    <!-- 5. Model Context Protocol -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px;">
      <h2 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        5. Developer Extensibility: Model Context Protocol (MCP)
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        Inboxies exposes a standard Model Context Protocol endpoint at <code style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: #e2e8f0; padding: 2px 5px; border-radius: 4px;">/mcp</code>. You can connect desktop AI tools like Claude Desktop, Cursor, or external automation scripts to interface with your mailbox using your authenticated session.
      </p>
    </div>
  </div>

  <p style="margin: 24px 0 0 0; color: #475569; font-size: 14px;">
    At your service,<br />
    <strong style="color: #0f172a;">Inboxies AI Copilot</strong>
  </p>
`;

	const body = emailShell({
		badge: "AI Email Assistant",
		badgeBg: "#f3e8ff",
		badgeColor: "#7e22ce",
		badgeBorder: "#e9d5ff",
		title: subject,
		subtitle: "How background auto-drafting, contextual copilot chats, and sovereign email tools work.",
		contentHtml,
	});

	return { subject, body, snippet };
}

function buildEmail3AdvancedAndSecurity(recipientEmail: string, displayName: string): {
	subject: string;
	body: string;
	snippet: string;
} {
	const subject = "Advanced Guide — Sender Triage, Reply Later, Custom Domains & Security";
	const snippet = `Master power features: Sender Screening (first-time sender triage), Reply Later shelf, custom domain Cloudflare DNS health, and one-click RFC 4155 MBOX export.`;

	const contentHtml = `
  <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155;">
    Dear <strong>${displayName}</strong>,
  </p>
  <p style="margin: 0 0 20px 0; color: #334155;">
    Inboxies is engineered to eliminate email distraction and give you complete sovereignty over your communications. Here is a guide to the advanced capabilities that keep your inbox focused and organized.
  </p>

  <!-- Deep Dive Features -->
  <div style="display: grid; gap: 18px; margin: 24px 0;">
    <!-- 1. The Screener -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
      <h2 style="font-size: 15.5px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        1. The Screener & Sender Triage
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 10px 0;">
        Unfamiliar senders shouldn't break your concentration. With the <strong>Screener</strong> enabled (the default for new mailboxes), any first-time sender is held in the <strong>Screener</strong> folder:
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 10px 0;">
        <tbody>
          <tr>
            <td style="padding: 6px 10px; font-weight: 600; color: #16a34a; width: 110px;">&check; Approve</td>
            <td style="padding: 6px 10px; color: #475569;">Moves to your Inbox and automatically approves all future messages from this sender.</td>
          </tr>
          <tr>
            <td style="padding: 6px 10px; font-weight: 600; color: #dc2626;">&times; Screen Out</td>
            <td style="padding: 6px 10px; color: #475569;">Silently routes this email and all future emails from this sender to Screened Out.</td>
          </tr>
          <tr>
            <td style="padding: 6px 10px; font-weight: 600; color: #2563eb;">&rarr; Categorize</td>
            <td style="padding: 6px 10px; color: #475569;">Route recurring newsletters to <strong>Promotions</strong> or receipts to <strong>Updates</strong>.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 2. Reply Later -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
      <h2 style="font-size: 15.5px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        2. The Reply Later Focus Queue
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        When an email requires thoughtful reply but you don't have time right now, press <kbd style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #ffffff; border: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; border-radius: 4px; padding: 1px 6px;">l</kbd> or click <strong>Reply Later</strong>. The email is neatly cleared from your active inbox into your dedicated Reply Later queue, allowing you to batch your responses during dedicated focus blocks.
      </p>
    </div>

    <!-- 3. Custom Domains & DNS Health -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
      <h2 style="font-size: 15.5px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        3. Custom Domains & Cloudflare DNS Suite
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 10px 0;">
        Domain owners can verify and monitor deliverability settings directly from the <strong>Admin Portal</strong> (<code style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: #e2e8f0; padding: 2px 5px; border-radius: 4px;">/admin</code>):
      </p>
      <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #475569; line-height: 1.6;">
        <li><strong>MX Records:</strong> Routes incoming traffic through Cloudflare Email Routing to your Worker.</li>
        <li><strong>SPF & DKIM:</strong> Pre-configured SPF (<code style="background: #e2e8f0; padding: 1px 4px; border-radius: 3px; font-size: 12px;">include:_spf.mx.cloudflare.net</code>) and cryptographic DKIM signing prevent spoofing.</li>
        <li><strong>DMARC:</strong> Alignment checks ensure outbound messages reach recipient inboxes with maximum deliverability score.</li>
      </ul>
    </div>

    <!-- 4. Mailbox Sharing & Access Control -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
      <h2 style="font-size: 15.5px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        4. Granular Mailbox Sharing (ACL)
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        Share mailbox access with team members, assistants, or family without sharing passwords. In <strong>Settings &rarr; Sharing</strong>, add authorized principals as owners or members. Authorized users see the shared mailbox appear directly in their sidebar account switcher.
      </p>
    </div>

    <!-- 5. Data Sovereignty & MBOX Export -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
      <h2 style="font-size: 15.5px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">
        5. Zero Lock-In: One-Click RFC 4155 MBOX Export
      </h2>
      <p style="font-size: 13.5px; color: #475569; margin: 0 0 10px 0;">
        Your email is yours forever. At any time, you can export your entire mailbox into a standardized RFC 4155 <code style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: #e2e8f0; padding: 2px 5px; border-radius: 4px;">.mbox</code> archive via <strong>Settings &rarr; Export Mailbox</strong>.
      </p>
      <p style="font-size: 13.5px; color: #475569; margin: 0;">
        The export includes full MIME fidelity, HTML bodies, and original binary attachments, ready to import into Apple Mail, Thunderbird, or any standard mail client.
      </p>
    </div>
  </div>

  <p style="margin: 24px 0 0 0; color: #475569; font-size: 14px;">
    To zero inbox noise and complete digital sovereignty,<br />
    <strong style="color: #0f172a;">Inboxies Security & Platform Team</strong>
  </p>
`;

	const body = emailShell({
		badge: "Power Features & Security",
		badgeBg: "#fef3c7",
		badgeColor: "#b45309",
		badgeBorder: "#fde68a",
		title: subject,
		subtitle: "The Screener, Reply Later shelf, custom domain DNS health, and data sovereignty export.",
		contentHtml,
	});

	return { subject, body, snippet };
}

/**
 * Generate the 3 initial onboarding and platform guide emails for a new mailbox.
 * Timestamps are ordered so that Email 1 (Getting Started) is the most recent
 * (top of the inbox), followed by Email 2 (AI Copilot), then Email 3 (Advanced Guide).
 */
export function generateWelcomeEmails(options: GenerateWelcomeEmailsOptions): WelcomeEmailData[] {
	const recipientEmail = options.recipientEmail.trim().toLowerCase();
	const displayName = sanitizeDisplayName(options.recipientName, recipientEmail);
	const emailDomain =
		options.domain ||
		(recipientEmail.includes("@") ? recipientEmail.split("@")[1] : "inboxies.email") ||
		"inboxies.email";

	const baseTime = options.baseDate ? options.baseDate.getTime() : Date.now();

	// Chronological stagger: Email 3 (2 min ago) -> Email 2 (1 min ago) -> Email 1 (now)
	const time3 = new Date(baseTime - 120_000).toISOString();
	const time2 = new Date(baseTime - 60_000).toISOString();
	const time1 = new Date(baseTime).toISOString();

	// 1. Getting Started
	const e1Content = buildEmail1GettingStarted(recipientEmail, displayName);
	const id1 = crypto.randomUUID();
	const sender1 = `welcome@${emailDomain}`;
	const senderName1 = "Inboxies Team";
	const msgId1 = `<welcome-${id1}@${emailDomain}>`;

	const email1: WelcomeEmailData = {
		id: id1,
		subject: e1Content.subject,
		sender: sender1,
		sender_name: senderName1,
		recipient: recipientEmail,
		date: time1,
		body: e1Content.body,
		snippet: e1Content.snippet,
		search_text: computeSearchText(e1Content.body),
		read: false,
		starred: false,
		thread_id: id1,
		message_id: msgId1,
		raw_headers: JSON.stringify([
			{ key: "from", value: `${senderName1} <${sender1}>` },
			{ key: "to", value: recipientEmail },
			{ key: "subject", value: e1Content.subject },
			{ key: "date", value: time1 },
			{ key: "message-id", value: msgId1 },
			{ key: "content-type", value: "text/html; charset=utf-8" },
			{ key: "mime-version", value: "1.0" },
			{ key: "x-inboxies-platform", value: "welcome" },
		]),
		auth: {
			spf: "pass",
			dkim: "pass",
			dmarc: "pass",
			dkimDomain: emailDomain,
			spfMailfrom: sender1,
			headerFrom: sender1,
			envelopeFrom: sender1,
			aligned: true,
			spoofed: false,
			source: "authentication-results",
		},
	};

	// 2. AI Assistant
	const e2Content = buildEmail2AiAssistant(recipientEmail, displayName);
	const id2 = crypto.randomUUID();
	const sender2 = `agent@${emailDomain}`;
	const senderName2 = "Inboxies AI";
	const msgId2 = `<agent-${id2}@${emailDomain}>`;

	const email2: WelcomeEmailData = {
		id: id2,
		subject: e2Content.subject,
		sender: sender2,
		sender_name: senderName2,
		recipient: recipientEmail,
		date: time2,
		body: e2Content.body,
		snippet: e2Content.snippet,
		search_text: computeSearchText(e2Content.body),
		read: false,
		starred: false,
		thread_id: id2,
		message_id: msgId2,
		raw_headers: JSON.stringify([
			{ key: "from", value: `${senderName2} <${sender2}>` },
			{ key: "to", value: recipientEmail },
			{ key: "subject", value: e2Content.subject },
			{ key: "date", value: time2 },
			{ key: "message-id", value: msgId2 },
			{ key: "content-type", value: "text/html; charset=utf-8" },
			{ key: "mime-version", value: "1.0" },
			{ key: "x-inboxies-platform", value: "agent-guide" },
		]),
		auth: {
			spf: "pass",
			dkim: "pass",
			dmarc: "pass",
			dkimDomain: emailDomain,
			spfMailfrom: sender2,
			headerFrom: sender2,
			envelopeFrom: sender2,
			aligned: true,
			spoofed: false,
			source: "authentication-results",
		},
	};

	// 3. Advanced Features & Security
	const e3Content = buildEmail3AdvancedAndSecurity(recipientEmail, displayName);
	const id3 = crypto.randomUUID();
	const sender3 = `security@${emailDomain}`;
	const senderName3 = "Inboxies Platform";
	const msgId3 = `<security-${id3}@${emailDomain}>`;

	const email3: WelcomeEmailData = {
		id: id3,
		subject: e3Content.subject,
		sender: sender3,
		sender_name: senderName3,
		recipient: recipientEmail,
		date: time3,
		body: e3Content.body,
		snippet: e3Content.snippet,
		search_text: computeSearchText(e3Content.body),
		read: false,
		starred: false,
		thread_id: id3,
		message_id: msgId3,
		raw_headers: JSON.stringify([
			{ key: "from", value: `${senderName3} <${sender3}>` },
			{ key: "to", value: recipientEmail },
			{ key: "subject", value: e3Content.subject },
			{ key: "date", value: time3 },
			{ key: "message-id", value: msgId3 },
			{ key: "content-type", value: "text/html; charset=utf-8" },
			{ key: "mime-version", value: "1.0" },
			{ key: "x-inboxies-platform", value: "security-guide" },
		]),
		auth: {
			spf: "pass",
			dkim: "pass",
			dmarc: "pass",
			dkimDomain: emailDomain,
			spfMailfrom: sender3,
			headerFrom: sender3,
			envelopeFrom: sender3,
			aligned: true,
			spoofed: false,
			source: "authentication-results",
		},
	};

	return [email1, email2, email3];
}

export const WELCOME_FLAG_KEY = "welcome_emails_seeded";

/**
 * Seed welcome emails directly into a MailboxDO instance.
 * Idempotent via the `welcome_emails_seeded` DO storage flag.
 */
export async function seedWelcomeEmailsInDO(
	mailboxDO: any,
	options: {
		recipientEmail: string;
		recipientName?: string | null;
		force?: boolean;
	},
): Promise<{ seeded: number }> {
	if (!options.force && (await mailboxDO.ctx.storage.get(WELCOME_FLAG_KEY))) {
		return { seeded: 0 };
	}

	const emails = generateWelcomeEmails({
		recipientEmail: options.recipientEmail,
		recipientName: options.recipientName,
	});

	for (const email of emails) {
		await mailboxDO.createEmail(Folders.INBOX, email, []);
	}

	// Pre-approve platform senders in sender_triage so they are recognized
	const senders = [
		{ sender: emails[0].sender, name: emails[0].sender_name },
		{ sender: emails[1].sender, name: emails[1].sender_name },
		{ sender: emails[2].sender, name: emails[2].sender_name },
	];

	for (const { sender, name } of senders) {
		try {
			if (typeof mailboxDO.upsertSenderTriage === "function") {
				await mailboxDO.upsertSenderTriage({
					sender,
					status: "allowed",
					destination_folder_id: Folders.INBOX,
					display_name: name,
				});
			}
		} catch {
			/* best effort */
		}
	}

	await mailboxDO.ctx.storage.put(WELCOME_FLAG_KEY, "1");
	return { seeded: emails.length };
}

/**
 * Seed welcome emails into a mailbox via its Durable Object stub.
 * Safe to call across all mailbox creation routes.
 */
export async function seedWelcomeEmailsForMailbox(
	env: Env,
	mailboxId: string,
	recipientName?: string | null,
): Promise<{ seeded: number }> {
	try {
		const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
		if (typeof (stub as any).seedWelcomeEmails === "function") {
			return await (stub as any).seedWelcomeEmails({
				recipientEmail: mailboxId,
				recipientName,
			});
		}
	} catch (err) {
		console.error(`Failed to seed welcome emails for ${mailboxId}:`, err);
	}
	return { seeded: 0 };
}
