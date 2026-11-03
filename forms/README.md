# The application form

The **Apply** section of `community.html` asks for a name, email, phone and message, and emails each
application, styled in the site's colours, to **beyondia.official@gmail.com**. The site is static (GitHub
Pages cannot send mail), so the sending is done by `application.gs`: a small Google Apps Script web app that
runs on a Google account. It is free, needs no API keys, and stores nothing: the email is the only record.

```
visitor fills the form ──► community.html ──POST──► Apps Script web app ──► styled email to Beyondia
                           (checks the fields)       (checks them again,      (Reply answers the
                                                      blocks bots and floods)  applicant directly)
```

## Connect it (once, about three minutes)

1. Open <https://script.google.com>, signed in as **beyondia.official@gmail.com**, and press **New project**.
   Name it, for example, *Beyondia applications*. (Any Google account works, since the applications always
   go to beyondia.official@gmail.com, but the emails are sent *from* the account that runs the script.)
2. Delete the sample code in `Code.gs`, paste the whole of [`application.gs`](application.gs) in its place,
   and save.
3. **Deploy → New deployment**. Next to *Select type* press the gear and choose **Web app**. Set
   * *Execute as*: **Me**
   * *Who has access*: **Anyone**

   and press **Deploy**. Google asks you to authorise it: it needs to *send email as you*. Because the
   script is your own and not published, Google shows "Google hasn't verified this app": choose
   **Advanced → Go to Beyondia applications**.
4. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`). Open it in a browser: it should
   say *The Beyondia application form is connected*.
5. In `community.html`, replace `https://script.google.com/macros/s/YOUR-DEPLOYMENT-ID/exec` in the
   `<form id="apply-form" action="…">` with your URL. Run `manager/bm build`, commit and push.
6. Send yourself a test application from the site.

Until step 5 is done, the form says it is not connected yet and points people to Telegram and Discord.

## Settings

In the Apps Script project, **Project Settings**:

| Setting | What it does |
|---|---|
| Script property `RECIPIENT` | Send applications to another address instead of beyondia.official@gmail.com (`DEFAULT_RECIPIENT` at the top of `application.gs`) |
| Script property `SITE_URL` | The link back shown to visitors without JavaScript (default: the community page on GitHub Pages) |
| Time zone | The time zone of "Applied …" in the email |

## Changing the script later

Paste the new code, save, then **Deploy → Manage deployments → ✎ (edit) → Version: New version → Deploy**.
The address stays the same. (*New deployment* would create a new address, which `community.html` would then
need.)

## What protects it

* Every field is checked twice: in the page (messages next to the fields) and again by the script.
* A hidden trap field that people never see and bots fill in: such posts are answered "sent" and dropped.
* The same application sent twice within ten minutes (a double click) is mailed once.
* At most 30 applications an hour; and a Gmail account can send 100 emails a day through Apps Script.
* Line breaks are stripped from single-line fields and everything is escaped in the email, so a name cannot
  add mail headers or HTML.

## Without JavaScript

The browser checks the required fields itself and posts the form to the script, which answers with a short
plain-text page ("Thank you, … Your application has reached Beyondia") and the link back to the site.

## Adding or changing a field

A field lives in three places: the form in `community.html`, the application form part of `beyondia.js`
(`FIELDS`, `LIMITS` and its checks) and `application.gs` (`FIELDS`, `LIMITS`, `validate`, and the email).
The tests (`sh manager/run_tests.sh`) check that the three agree on the names and the length limits.
