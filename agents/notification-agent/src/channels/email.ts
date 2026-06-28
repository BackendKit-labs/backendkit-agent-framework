// ---------------------------------------------------------------------------
// Channel: Email — Nodemailer SMTP
// ---------------------------------------------------------------------------

import nodemailer from 'nodemailer';
import type { ChannelResult } from '../types/notification.js';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@notification-agent';

export async function sendEmail(params: { to: string | string[]; subject?: string; body: string }): Promise<ChannelResult> {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: 'SMTP no configurado. Usá SMTP_HOST, SMTP_USER y SMTP_PASS en las env vars.',
      latencyMs: 0,
    };
  }

  const start = Date.now();
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const to = Array.isArray(params.to) ? params.to.join(', ') : params.to;

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: params.subject || 'Notificación',
      text: params.body,
    });

    return {
      success: true,
      status: 'sent',
      deliveredAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: `Error al enviar email: ${(err as Error).message}`,
      latencyMs: Date.now() - start,
    };
  }
}
