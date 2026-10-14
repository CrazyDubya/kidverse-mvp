const nodemailer = require('nodemailer');

// SMTP_URL, e.g. smtps://user:pass@smtp.example.com. Without it, development prints the
// message to the console; production logs that mail isn't configured (never the link).
let transport;
const getTransport = () => {
  if (!transport && process.env.SMTP_URL) transport = nodemailer.createTransport(process.env.SMTP_URL);
  return transport;
};

const from = () => process.env.MAIL_FROM || 'KidVerse <no-reply@kidverse.local>';

const send = async ({ to, subject, text }) => {
  const t = getTransport();
  if (t) {
    await t.sendMail({ from: from(), to, subject, text });
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP_URL is not configured; email not sent');
  } else if (process.env.NODE_ENV !== 'test') {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
  }
};

const sendPasswordReset = ({ to, firstName, link, ttlMinutes }) =>
  send({
    to,
    subject: 'Reset your KidVerse password',
    text:
      `Hi ${firstName},\n\n` +
      `Use this link to choose a new KidVerse password. It works once and expires in ${ttlMinutes} minutes:\n\n` +
      `${link}\n\n` +
      `If you didn't ask for this, you can ignore this email; your password hasn't changed.\n`
  });

const sendPasswordChanged = ({ to, firstName }) =>
  send({
    to,
    subject: 'Your KidVerse password was changed',
    text:
      `Hi ${firstName},\n\n` +
      `Your KidVerse password was just changed and you were signed out everywhere.\n` +
      `If this wasn't you, reset your password again right away.\n`
  });

module.exports = { sendPasswordReset, sendPasswordChanged };
