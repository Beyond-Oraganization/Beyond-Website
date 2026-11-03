/**
 * Beyondia: the application form's mail sender.
 *
 * The site is static, so the form on community.html posts here: a Google Apps Script web app that checks the
 * application and emails it, styled in the site's colours, to the Google account that deploys it. Setup (about
 * three minutes) is in forms/README.md. Nothing is stored: the email is the only record.
 *
 * The form sends four fields (name, email, phone, message), a hidden trap field (website) that people never
 * see and bots fill in, and reply=json when the page's script sends it (without script the browser posts the
 * form itself and gets a short text answer).
 */

// ---------- settings (Project Settings → Script properties overrides the first two) ----------
// RECIPIENT: where applications go. Empty means the Google account that deployed the script.
// SITE_URL: the community page, for the link back after a submission made without script.
var DEFAULT_SITE_URL = 'https://beyond-oraganization.github.io/Beyond-Website/community.html';
var MAX_PER_HOUR = 30;              // more than this in one hour is refused (a flood, not a community)
var REPEAT_WINDOW_SECONDS = 600;    // the same application sent twice in ten minutes is mailed once

var LIMITS = { name: 100, email: 254, phone: 32, message: 3000 };
var FIELDS = ['name', 'email', 'phone', 'message'];
var LABELS = { name: 'Name', email: 'Email', phone: 'Phone', message: 'Message' };

// The site's palette (classic theme), for the email.
var C = {
  navy: '#003049', yellow: '#FCBF49', yellowSoft: '#FDE3A8', red: '#D62828', orange: '#F77F00',
  mute: '#1F4A60', bandMute: '#F3C260', white: '#FFFFFF'
};
var FONT_DISPLAY = "'Archivo Black','Arial Black',Impact,Helvetica,Arial,sans-serif";
var FONT_MONO = "'IBM Plex Mono','Courier New',Courier,monospace";
var FONT_TEXT = "'IBM Plex Sans','Helvetica Neue',Helvetica,Arial,sans-serif";

// ---------- web app entry points ----------

/** Opening the web app address in a browser: a sign that the deployment works. */
function doGet() {
  return ContentService.createTextOutput('The Beyondia application form is connected. Applications go to ' +
    maskEmail(recipient()) + '.');
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  var wantsJson = params.reply === 'json';
  var result;
  try {
    result = handleApplication(params);
  } catch (error) {
    console.error(error);
    result = { ok: false, reason: 'The application could not be sent. Please try again in a few minutes.' };
  }
  return wantsJson ? jsonReply(result) : textReply(result, params);
}

// ---------- the application ----------

/** Checks, deduplicates, rate-limits and mails one application. Returns {ok, errors?, reason?}. */
function handleApplication(params) {
  // The trap field: a person never sees it, so anything in it came from a bot. Answer as if it worked.
  if (clean(params.website, 200)) {
    return { ok: true };
  }

  var application = readApplication(params);
  var errors = validate(application);
  if (Object.keys(errors).length) {
    return { ok: false, errors: errors, reason: 'Please correct the fields marked below.' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, reason: 'The form is busy. Please try again in a moment.' };
  }
  try {
    var cache = CacheService.getScriptCache();
    var repeatKey = 'seen:' + digest(application.email.toLowerCase() + '\n' + application.message);
    if (cache.get(repeatKey)) {
      return { ok: true };                        // a double click or a resend: it is already in the inbox
    }
    var hourKey = 'hour:' + Math.floor(Date.now() / 3600000);
    var sentThisHour = Number(cache.get(hourKey) || 0);
    if (sentThisHour >= MAX_PER_HOUR) {
      return { ok: false, reason: 'Too many applications are arriving right now. Please try again in an hour.' };
    }
    if (MailApp.getRemainingDailyQuota() < 1) {
      return { ok: false, reason: 'The form cannot send any more today. Please try again tomorrow.' };
    }

    sendApplication(application);

    cache.put(hourKey, String(sentThisHour + 1), 3600);
    cache.put(repeatKey, '1', REPEAT_WINDOW_SECONDS);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function readApplication(params) {
  return {
    name: clean(params.name, LIMITS.name + 1),
    email: clean(params.email, LIMITS.email + 1),
    phone: clean(params.phone, LIMITS.phone + 1),
    message: cleanText(params.message, LIMITS.message + 1)
  };
}

/** Field name -> what is wrong with it. The page shows the same messages next to the fields. */
function validate(a) {
  var errors = {};
  if (!a.name) errors.name = 'Enter your name.';
  else if (a.name.length > LIMITS.name) errors.name = 'Use at most ' + LIMITS.name + ' characters.';

  if (!a.email) errors.email = 'Enter your email address.';
  else if (a.email.length > LIMITS.email || !isEmail(a.email)) errors.email = 'Enter an email address like name@example.com.';

  if (!a.phone) errors.phone = 'Enter your phone number.';
  else if (a.phone.length > LIMITS.phone || !isPhone(a.phone)) errors.phone = 'Enter a phone number with 7 to 15 digits, like +44 20 7946 0958.';

  if (!a.message) errors.message = 'Write a few words about yourself.';
  else if (a.message.length > LIMITS.message) errors.message = 'Use at most ' + LIMITS.message + ' characters.';
  return errors;
}

function isEmail(value) {
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)+$/.test(value);
}

function isPhone(value) {
  if (!/^\+?[0-9()\-.\s]+$/.test(value)) return false;
  var digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

// ---------- the email ----------

function sendApplication(a) {
  var when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEEE, d MMMM yyyy 'at' HH:mm z");
  MailApp.sendEmail({
    to: recipient(),
    replyTo: a.email,
    name: 'Beyondia applications',
    subject: 'New member application: ' + a.name,
    body: renderText(a, when),
    htmlBody: renderHtml(a, when)
  });
}

function renderText(a, when) {
  return [
    'NEW MEMBER APPLICATION',
    a.name + ' wants to join Beyondia.',
    when,
    '',
    'Name:    ' + a.name,
    'Email:   ' + a.email,
    'Phone:   ' + a.phone,
    '',
    'Message:',
    a.message,
    '',
    '--',
    'Sent by the application form on the Beyondia website. Reply to this email to answer ' + a.name + ' directly.'
  ].join('\n');
}

function renderHtml(a, when) {
  var name = escapeHtml(a.name);
  var email = escapeHtml(a.email);
  var phone = escapeHtml(a.phone);
  var mailto = 'mailto:' + encodeURIComponent(a.email).replace(/%40/g, '@') +
    '?subject=' + encodeURIComponent('Your application to Beyondia');
  var tel = 'tel:' + a.phone.replace(/(?!^\+)[^0-9]/g, '');
  var message = escapeHtml(a.message).replace(/\r?\n/g, '<br>');
  var preheader = escapeHtml(a.name + ' · ' + a.email + ' · ' + a.phone);

  var label = 'font-family:' + FONT_MONO + ';font-size:12px;line-height:16px;font-weight:700;letter-spacing:2px;' +
    'text-transform:uppercase;color:' + C.mute + ';';
  var value = 'font-family:' + FONT_MONO + ';font-size:19px;line-height:26px;font-weight:700;color:' + C.navy + ';' +
    'word-break:break-word;';
  var link = 'color:' + C.navy + ';text-decoration:underline;';

  function row(caption, content) {
    return '<tr><td style="padding:18px 0 16px;border-top:4px solid ' + C.navy + ';">' +
      '<div style="' + label + 'padding-bottom:6px;">' + caption + '</div>' +
      '<div style="' + value + '">' + content + '</div></td></tr>';
  }

  function button(href, text, solid) {
    return '<td style="padding:0 12px 12px 0;" class="stack">' +
      '<a href="' + escapeHtml(href) + '" style="display:inline-block;padding:16px 26px;border:3px solid ' + C.navy + ';' +
      'background:' + (solid ? C.navy : C.yellow) + ';color:' + (solid ? C.yellow : C.navy) + ';font-family:' + FONT_MONO + ';' +
      'font-size:14px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-decoration:none;">' +
      text + '</a></td>';
  }

  return '<!doctype html>' +
'<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
'<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
'<title>New member application</title>' +
'<style>@media (max-width:620px){.card{padding:28px 22px !important}.title{font-size:32px !important;line-height:34px !important}' +
'.btns{width:100% !important}.stack{display:block !important;width:100% !important;padding-right:0 !important}.stack a{display:block !important;text-align:center !important}}</style>' +
'</head>' +
'<body style="margin:0;padding:0;background:' + C.navy + ';">' +
'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + C.navy + ';">' + preheader + '</div>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + C.navy + '" style="background:' + C.navy + ';">' +
'<tr><td align="center" style="padding:32px 12px 40px;">' +
'<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">' +

  // brand line
  '<tr><td style="padding:0 0 20px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-family:' + FONT_DISPLAY + ';font-size:22px;line-height:24px;letter-spacing:1px;color:' + C.yellow + ';">' +
      '<span style="display:inline-block;width:14px;height:14px;margin-right:10px;background:' + C.orange + ';vertical-align:1px;"></span>BEYONDIA</td>' +
    '<td align="right" style="font-family:' + FONT_MONO + ';font-size:12px;line-height:16px;font-weight:700;letter-spacing:2px;' +
      'text-transform:uppercase;color:' + C.bandMute + ';">Application form</td>' +
    '</tr></table></td></tr>' +

  // the card
  '<tr><td class="card" bgcolor="' + C.yellow + '" style="padding:40px 40px 32px;background:' + C.yellow + ';border:4px solid ' + C.yellow + ';">' +
    '<span style="display:inline-block;padding:6px 12px;background:' + C.red + ';color:' + C.white + ';font-family:' + FONT_MONO + ';' +
      'font-size:13px;line-height:17px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">New member</span>' +
    '<h1 class="title" style="margin:22px 0 12px;font-family:' + FONT_DISPLAY + ';font-weight:400;font-size:42px;line-height:44px;' +
      'letter-spacing:-1px;text-transform:uppercase;color:' + C.navy + ';word-break:break-word;">' + name + ' wants to join.</h1>' +
    '<p style="margin:0 0 32px;font-family:' + FONT_TEXT + ';font-size:16px;line-height:24px;color:' + C.mute + ';">' +
      'Applied ' + escapeHtml(when) + '</p>' +

    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      row('Name', name) +
      row('Email', '<a href="' + escapeHtml(mailto) + '" style="' + link + '">' + email + '</a>') +
      row('Phone', '<a href="' + escapeHtml(tel) + '" style="' + link + '">' + phone + '</a>') +
      '<tr><td style="padding:18px 0 0;border-top:4px solid ' + C.navy + ';">' +
        '<div style="' + label + 'padding-bottom:10px;">Message</div>' +
        '<div style="padding:20px 22px;border:3px solid ' + C.navy + ';background:' + C.yellowSoft + ';font-family:' + FONT_TEXT + ';' +
          'font-size:17px;line-height:27px;color:' + C.navy + ';word-break:break-word;">' + message + '</div>' +
      '</td></tr>' +
    '</table>' +

    '<table role="presentation" class="btns" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;"><tr>' +
      button(mailto, 'Reply to ' + escapeHtml(firstName(a.name)), true) +
      button(tel, 'Call', false) +
    '</tr></table>' +
  '</td></tr>' +

  // the band, like the site's ticker
  '<tr><td bgcolor="' + C.orange + '" style="padding:14px 20px;background:' + C.orange + ';border-top:4px solid ' + C.navy + ';' +
    'font-family:' + FONT_DISPLAY + ';font-size:16px;line-height:20px;letter-spacing:1px;text-transform:uppercase;color:' + C.navy + ';">' +
    'A country of ideas &nbsp;&#9632;&nbsp; A new voice wants in</td></tr>' +

  // footer
  '<tr><td style="padding:24px 4px 0;font-family:' + FONT_TEXT + ';font-size:14px;line-height:21px;color:' + C.bandMute + ';">' +
    'Sent by the application form on the Beyondia website. Press <strong style="color:' + C.yellow + ';">Reply</strong> ' +
    'to answer ' + name + ' directly.</td></tr>' +

'</table></td></tr></table></body></html>';
}

// ---------- replies to the page ----------

function jsonReply(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

/** The answer a browser without script shows after posting the form itself. */
function textReply(result, params) {
  var back = siteUrl();
  var lines;
  if (result.ok) {
    var name = clean(params.name, LIMITS.name);
    lines = ['Thank you' + (name ? ', ' + name : '') + '. Your application has reached Beyondia.',
      'The answer will come by email.', '', 'Back to the site: ' + back];
  } else {
    lines = ['Your application was not sent.', ''];
    if (result.errors) {
      FIELDS.forEach(function (field) {
        if (result.errors[field]) lines.push(LABELS[field] + ': ' + result.errors[field]);
      });
    } else {
      lines.push(result.reason);
    }
    lines.push('', 'Go back, correct it and send it again: ' + back);
  }
  return ContentService.createTextOutput(lines.join('\n'));
}

// ---------- small helpers ----------

function recipient() {
  var configured = PropertiesService.getScriptProperties().getProperty('RECIPIENT');
  return (configured && configured.trim()) || Session.getEffectiveUser().getEmail();
}

function siteUrl() {
  var configured = PropertiesService.getScriptProperties().getProperty('SITE_URL');
  return (configured && configured.trim()) || DEFAULT_SITE_URL;
}

/** One line of text: no control characters (so no header can be smuggled in), spaces collapsed, cut to max. */
function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A paragraph of text: line breaks kept (at most one blank line in a row), other control characters removed. */
function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstName(name) {
  var first = name.split(' ')[0];
  return first.length > 24 ? first.slice(0, 24) : first;
}

function maskEmail(address) {
  var parts = String(address || '').split('@');
  return parts.length === 2 ? parts[0].slice(0, 2) + '…@' + parts[1] : 'the owner of this script';
}

function digest(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}
