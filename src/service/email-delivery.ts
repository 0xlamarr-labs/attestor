/**
 * Hosted Email Delivery — SMTP-backed invite/reset delivery first slice.
 *
 * BOUNDARY:
 * - Defaults to manual/API-token delivery unless ATTESTOR_EMAIL_DELIVERY_MODE=smtp
 * - Supports SMTP URL or host/port/user/pass configuration via Nodemailer
 * - Invite/reset links are optional; when unset the email still includes the opaque token
 * - No outbound-provider-specific webhooks, templates, or analytics yet
 * - No WebAuthn/passkey or SSO/SAML delivery surface here
 */

import nodemailer, { type TransportOptions, type Transporter } from 'nodemailer';
import type { AccountUserRole } from './account-user-store.js';
import type { HostedEmailDeliveryProvider } from './email-delivery-event-store.js';
import {
  buildHostedEmailDeliveryId,
} from './email-delivery-event-store.js';
import {
  buildSendGridSmtpApiHeader,
  getSendGridWebhookStatus,
  resolveHostedEmailProvider,
} from './sendgrid-email-webhook.js';
import {
  controlPlaneStoreMode,
  recordHostedEmailDispatchEventState,
} from './control-plane-store.js';

export type HostedEmailDeliveryMode = 'manual' | 'smtp';
export type HostedEmailDeliveryPurpose = 'invite' | 'password_reset';

export interface HostedEmailDeliveryStatus {
  mode: HostedEmailDeliveryMode;
  provider: HostedEmailDeliveryProvider;
  configured: boolean;
  from: string | null;
  replyTo: string | null;
  smtp: {
    configured: boolean;
    host: string | null;
    port: number | null;
    secure: boolean;
    ignoreTls: boolean;
    hasAuth: boolean;
  };
  links: {
    inviteBaseUrl: string | null;
    passwordResetBaseUrl: string | null;
  };
  analytics: {
    storeMode: 'file' | 'shared_postgres';
    sendGridWebhook: {
      configured: boolean;
      publicKeyConfigured: boolean;
      maxAgeSeconds: number;
    };
  };
}

export interface HostedEmailDeliverySummary {
  deliveryId: string;
  mode: HostedEmailDeliveryMode;
  provider: HostedEmailDeliveryProvider;
  channel: 'api_response' | 'smtp';
  delivered: boolean;
  recipient: string;
  messageId: string | null;
  actionUrl: string | null;
  tokenReturned: boolean;
}

export interface DeliverHostedInviteInput {
  accountId: string;
  accountUserId: string | null;
  recipientEmail: string;
  displayName: string;
  role: AccountUserRole;
  accountName: string;
  token: string;
}

export interface DeliverHostedPasswordResetInput {
  accountId: string;
  accountUserId: string | null;
  recipientEmail: string;
  displayName: string | null;
  accountName: string;
  token: string;
}

export class HostedEmailDeliveryError extends Error {
  constructor(
    public readonly code: 'CONFIG' | 'SEND',
    message: string,
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'HostedEmailDeliveryError';
  }
}

interface EmailTransportConfig {
  mode: HostedEmailDeliveryMode;
  from: string | null;
  replyTo: string | null;
  smtpConfigured: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpIgnoreTls: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpUrl: string | null;
  inviteBaseUrl: string | null;
  passwordResetBaseUrl: string | null;
}

let cachedTransportSignature: string | null = null;
let cachedTransporter: Transporter | null = null;

function envTrue(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMode(value: string | undefined): HostedEmailDeliveryMode {
  return value?.trim().toLowerCase() === 'smtp' ? 'smtp' : 'manual';
}

function resolveTransportConfig(): EmailTransportConfig {
  const smtpUrl = process.env.ATTESTOR_SMTP_URL?.trim() || null;
  const smtpHost = process.env.ATTESTOR_SMTP_HOST?.trim() || null;
  const smtpPort = parsePositiveInteger(process.env.ATTESTOR_SMTP_PORT);
  const smtpSecure = envTrue(process.env.ATTESTOR_SMTP_SECURE, false);
  const smtpIgnoreTls = envTrue(process.env.ATTESTOR_SMTP_IGNORE_TLS, false);
  const smtpUser = process.env.ATTESTOR_SMTP_USER?.trim() || null;
  const smtpPass = process.env.ATTESTOR_SMTP_PASS?.trim() || null;
  const smtpConfigured = smtpUrl !== null || (smtpHost !== null && smtpPort !== null);
  return {
    mode: normalizeMode(process.env.ATTESTOR_EMAIL_DELIVERY_MODE),
    from: process.env.ATTESTOR_EMAIL_FROM?.trim() || null,
    replyTo: process.env.ATTESTOR_EMAIL_REPLY_TO?.trim() || null,
    smtpConfigured,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpIgnoreTls,
    smtpUser,
    smtpPass,
    smtpUrl,
    inviteBaseUrl: process.env.ATTESTOR_ACCOUNT_INVITE_BASE_URL?.trim() || null,
    passwordResetBaseUrl: process.env.ATTESTOR_PASSWORD_RESET_BASE_URL?.trim() || null,
  };
}

function requireSmtpConfig(config: EmailTransportConfig): EmailTransportConfig {
  if (config.mode !== 'smtp') return config;
  if (!config.from) {
    throw new HostedEmailDeliveryError('CONFIG', 'ATTESTOR_EMAIL_FROM is required when ATTESTOR_EMAIL_DELIVERY_MODE=smtp.');
  }
  if (!config.smtpConfigured) {
    throw new HostedEmailDeliveryError(
      'CONFIG',
      'SMTP delivery requires ATTESTOR_SMTP_URL or ATTESTOR_SMTP_HOST + ATTESTOR_SMTP_PORT.',
    );
  }
  return config;
}

function buildActionUrl(baseUrl: string | null, token: string): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  } catch {
    return null;
  }
}

function buildInviteText(input: DeliverHostedInviteInput, actionUrl: string | null): string {
  return [
    `Hello ${input.displayName},`,
    '',
    `You have been invited to join ${input.accountName} on Attestor as ${input.role}.`,
    actionUrl
      ? `Open this link to accept the invite and set your password: ${actionUrl}`
      : `Use this invite token to accept the invite and set your password: ${input.token}`,
    '',
    `Invite token: ${input.token}`,
    '',
    'If you were not expecting this invite, you can ignore this email.',
  ].join('\n');
}

function buildResetText(input: DeliverHostedPasswordResetInput, actionUrl: string | null): string {
  const greeting = input.displayName?.trim() ? `Hello ${input.displayName},` : 'Hello,';
  return [
    greeting,
    '',
    `A password reset was requested for your ${input.accountName} Attestor account.`,
    actionUrl
      ? `Open this link to choose a new password: ${actionUrl}`
      : `Use this password reset token to set a new password: ${input.token}`,
    '',
    `Password reset token: ${input.token}`,
    '',
    'If you did not request this change, contact your account administrator.',
  ].join('\n');
}

function buildTransportSignature(config: EmailTransportConfig): string {
  return JSON.stringify({
    smtpUrl: config.smtpUrl,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpIgnoreTls: config.smtpIgnoreTls,
    smtpUser: config.smtpUser,
    smtpPassPresent: Boolean(config.smtpPass),
  });
}

function getTransporter(config: EmailTransportConfig): Transporter {
  const required = requireSmtpConfig(config);
  const signature = buildTransportSignature(required);
  if (cachedTransporter && cachedTransportSignature === signature) {
    return cachedTransporter;
  }

  const transporter = required.smtpUrl
    ? nodemailer.createTransport(required.smtpUrl)
    : nodemailer.createTransport({
      host: required.smtpHost!,
      port: required.smtpPort!,
      secure: required.smtpSecure,
      ignoreTLS: required.smtpIgnoreTls,
      ...(required.smtpUser || required.smtpPass
        ? {
          auth: {
            user: required.smtpUser ?? '',
            pass: required.smtpPass ?? '',
          },
        }
        : {}),
    } as TransportOptions);
  cachedTransporter = transporter;
  cachedTransportSignature = signature;
  return transporter;
}

async function sendHostedEmail(input: {
  purpose: HostedEmailDeliveryPurpose;
  accountId: string;
  accountUserId: string | null;
  to: string;
  subject: string;
  text: string;
  token: string;
  baseUrl: string | null;
}): Promise<HostedEmailDeliverySummary> {
  const config = resolveTransportConfig();
  const provider = resolveHostedEmailProvider(config.mode);
  const deliveryId = buildHostedEmailDeliveryId();
  const actionUrl = buildActionUrl(input.baseUrl, input.token);
  if (config.mode !== 'smtp') {
    const summary: HostedEmailDeliverySummary = {
      deliveryId,
      mode: 'manual',
      provider,
      channel: 'api_response',
      delivered: true,
      recipient: input.to,
      messageId: null,
      actionUrl,
      tokenReturned: true,
    };
    await recordHostedEmailDispatchEventState({
      deliveryId,
      accountId: input.accountId,
      accountUserId: input.accountUserId,
      purpose: input.purpose,
      provider,
      channel: summary.channel,
      recipient: summary.recipient,
      messageId: summary.messageId,
      actionUrl: summary.actionUrl,
      tokenReturned: summary.tokenReturned,
      metadata: {
        subject: input.subject,
      },
    });
    return summary;
  }

  const required = requireSmtpConfig(config);
  const transporter = getTransporter(required);
  const headers: Record<string, string | { prepared: true; value: string }> = {
    'X-Attestor-Delivery-Id': {
      prepared: true,
      value: deliveryId,
    },
  };
  if (provider === 'sendgrid_smtp') {
    headers['X-SMTPAPI'] = {
      prepared: true,
      value: JSON.stringify(buildSendGridSmtpApiHeader({
        deliveryId,
        purpose: input.purpose,
      })),
    };
  }
  try {
    const info = await transporter.sendMail({
      from: required.from!,
      replyTo: required.replyTo ?? undefined,
      to: input.to,
      subject: input.subject,
      text: input.text,
      headers,
    });
    const summary: HostedEmailDeliverySummary = {
      deliveryId,
      mode: 'smtp',
      provider,
      channel: 'smtp',
      delivered: true,
      recipient: input.to,
      messageId: typeof info.messageId === 'string' ? info.messageId : null,
      actionUrl,
      tokenReturned: false,
    };
    await recordHostedEmailDispatchEventState({
      deliveryId,
      accountId: input.accountId,
      accountUserId: input.accountUserId,
      purpose: input.purpose,
      provider,
      channel: summary.channel,
      recipient: summary.recipient,
      messageId: summary.messageId,
      actionUrl: summary.actionUrl,
      tokenReturned: summary.tokenReturned,
      metadata: {
        subject: input.subject,
        providerHeaders: provider === 'sendgrid_smtp'
          ? {
            'X-SMTPAPI': typeof headers['X-SMTPAPI'] === 'string'
              ? headers['X-SMTPAPI']
              : headers['X-SMTPAPI']?.value ?? null,
          }
          : {},
      },
    });
    return summary;
  } catch (error) {
    throw new HostedEmailDeliveryError('SEND', `SMTP delivery failed for ${input.purpose}.`, error);
  }
}

export async function deliverHostedInviteEmail(input: DeliverHostedInviteInput): Promise<HostedEmailDeliverySummary> {
  const config = resolveTransportConfig();
  const actionUrl = buildActionUrl(config.inviteBaseUrl, input.token);
  return sendHostedEmail({
    purpose: 'invite',
    accountId: input.accountId,
    accountUserId: input.accountUserId,
    to: input.recipientEmail,
    subject: `You're invited to ${input.accountName} on Attestor`,
    text: buildInviteText(input, actionUrl),
    token: input.token,
    baseUrl: config.inviteBaseUrl,
  });
}

export async function deliverHostedPasswordResetEmail(
  input: DeliverHostedPasswordResetInput,
): Promise<HostedEmailDeliverySummary> {
  const config = resolveTransportConfig();
  const actionUrl = buildActionUrl(config.passwordResetBaseUrl, input.token);
  return sendHostedEmail({
    purpose: 'password_reset',
    accountId: input.accountId,
    accountUserId: input.accountUserId,
    to: input.recipientEmail,
    subject: `Reset your ${input.accountName} Attestor password`,
    text: buildResetText(input, actionUrl),
    token: input.token,
    baseUrl: config.passwordResetBaseUrl,
  });
}

export function getHostedEmailDeliveryStatus(): HostedEmailDeliveryStatus {
  const config = resolveTransportConfig();
  const mode = config.mode;
  return {
    mode,
    provider: resolveHostedEmailProvider(mode),
    configured: mode === 'manual' ? true : Boolean(config.from && config.smtpConfigured),
    from: config.from,
    replyTo: config.replyTo,
    smtp: {
      configured: config.smtpConfigured,
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      ignoreTls: config.smtpIgnoreTls,
      hasAuth: Boolean(config.smtpUser || config.smtpPass),
    },
    links: {
      inviteBaseUrl: config.inviteBaseUrl,
      passwordResetBaseUrl: config.passwordResetBaseUrl,
    },
    analytics: {
      storeMode: controlPlaneStoreMode() === 'postgres' ? 'shared_postgres' : 'file',
      sendGridWebhook: getSendGridWebhookStatus(),
    },
  };
}

export function resetHostedEmailDeliveryForTests(): void {
  cachedTransporter?.close();
  cachedTransporter = null;
  cachedTransportSignature = null;
}

export function shutdownHostedEmailDelivery(): void {
  cachedTransporter?.close();
  cachedTransporter = null;
  cachedTransportSignature = null;
}
