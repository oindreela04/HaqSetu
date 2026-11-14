'use strict';
const nodemailer = require('nodemailer');

let transporter = null;
const configured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

if (configured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const FROM = process.env.MAIL_FROM || 'HaqSetu <no-reply@haqsetu.in>';

/** Outbox kept in memory for tests / local development when SMTP is not configured. */
const devOutbox = [];

async function send(to, subject, text) {
  if (!configured) {
    devOutbox.push({ to, subject, text, at: new Date() });
    if (devOutbox.length > 50) devOutbox.shift();
    // Never print message bodies (they contain one-time links) in production logs.
    if (process.env.NODE_ENV === 'production') console.warn(`[mail:not-configured] skipped "${subject}" — set SMTP_* env vars`);
    else if (process.env.NODE_ENV !== 'test') console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
    return { delivered: false };
  }
  await transporter.sendMail({ from: FROM, to, subject, text });
  return { delivered: true };
}

module.exports = { send, configured, devOutbox };
