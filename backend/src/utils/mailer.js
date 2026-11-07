import nodemailer from 'nodemailer'

import config from './config.js'
import logger from './logger.js'

const isTest = process.env.NODE_ENV === 'test'

// in tests nothing leaves the machine: mails are serialized and kept in sentMails
const transporter = isTest
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.MAIL_USER, pass: config.MAIL_PASS }
  })

// test only: every mail sent ({ to, subject, text, html }), so tests can read the token
export const sentMails = []

export const clearSentMails = () => {
  sentMails.length = 0
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// never throws: a failed mail must not break the request (the user can ask again)
const send = async ({ to, subject, text, html }) => {
  try {
    await transporter.sendMail({ from: config.MAIL_FROM, to, subject, text, html })
    if (isTest) sentMails.push({ to, subject, text, html })
    return true
  } catch (error) {
    // no token/link in the log: only who and what failed
    logger.error(`mail "${subject}" to ${to} failed:`, error.message)
    return false
  }
}

export const sendVerificationEmail = (user, token) => {
  const link = `${config.APP_URL}/?verify=${token}`
  const name = escapeHtml(user.username)

  return send({
    to: user.email,
    subject: 'Verificá tu correo',
    text: `Hola ${user.username},\n\n` +
      `Para verificar tu correo entrá a este link:\n${link}\n\n` +
      'El link vence en 24 h.',
    html: `<p>Hola ${name},</p>` +
      '<p>Para verificar tu correo entrá a este link:</p>' +
      `<p><a href="${link}">Verificar correo</a></p>` +
      '<p>El link vence en 24 h.</p>'
  })
}

export const sendResetEmail = (user, token) => {
  const link = `${config.APP_URL}/?reset=${token}`
  const name = escapeHtml(user.username)

  return send({
    to: user.email,
    subject: 'Recuperar contraseña',
    text: `Hola ${user.username},\n\n` +
      `Para elegir una contraseña nueva entrá a este link:\n${link}\n\n` +
      'El link vence en 1 h. Si no fuiste vos, ignorá este mail.',
    html: `<p>Hola ${name},</p>` +
      '<p>Para elegir una contraseña nueva entrá a este link:</p>' +
      `<p><a href="${link}">Recuperar contraseña</a></p>` +
      '<p>El link vence en 1 h. Si no fuiste vos, ignorá este mail.</p>'
  })
}
