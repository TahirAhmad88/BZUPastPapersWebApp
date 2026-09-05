# BZU Past Papers — Setup & Deployment Guide (Supabase edition)

A vanilla HTML/CSS/JS archive of past exam papers, backed by Supabase
(Postgres + Storage + Auth). No build step, no server. Every upload
now goes into a **pending review queue** — nothing appears in the
public archive until an admin previews and approves it.

## Files

| File                  | Purpose                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `index.html`          | Page structure                                                                                  |
| `style.css`           | All styling, dark mode, animations, responsive layout                                           |
| `app.js`              | App logic — Supabase calls, search, upload, review queue, admin, favorites                      |
| `supabase-config.js`  | Your Supabase project URL/key go here                                                           |
| `supabase-schema.sql` | Run once in the Supabase SQL editor — creates tables, storage bucket, and all security policies |

## 1. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Pick a name, a database password (save it somewhere — you won't need it for this app, but Supabase asks for it), and a region close to Pakistan (e.g. Singapore).
2. Once it's finished provisioning: **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `supabase-config.js`, replacing the placeholders.

## 2. Run the schema

1. In the dashboard sidebar: **SQL Editor → New query**.
2. Paste in the entire contents of `supabase-schema.sql` from this project and click **Run**.
3. This creates:
   - a `papers` table with a `status` column (`pending` / `approved` / `rejected`) and Row Level Security policies
   - an `admins` table, so only the primary admin can register new admins
   - a `papers` Storage bucket (public read, so anyone with a file's link can view it — write/delete access is controlled by policy)
   - an `increment_download_count()` function that lets any visitor bump a paper's download counter by exactly one, without giving them general write access

## 3. Create the primary admin account

1. **Authentication → Users → Add user → Create new user**.
2. Email: `tahir@admin.com`. Set a password of your choice.
3. **Authentication → Providers → Email**: if you want admins to be able to sign in immediately after being created (rather than confirming an email first), you can turn off **Confirm email** here. This is a project-wide setting — reasonable for a small admin team, but be aware it applies to any account created via sign-up, not just admins.

**Why isn't the admin password hardcoded anywhere in the app?**
Anything shipped in client-side JavaScript is visible to anyone who
opens dev tools, so a password sitting in `app.js` wouldn't be a
secret. Creating the account directly in Supabase means the password
is only ever known to Supabase's Auth system and to you. The rule
that "only `tahir@admin.com` can create other admins" is still
enforced — it lives in `supabase-schema.sql`'s Row Level Security
policy on the `admins` table, on the database side, where it can't be
bypassed by editing the page's JavaScript.

## 4. How the approval workflow works

- A visitor uploads a paper → it's inserted with `status = 'pending'`. It is **not visible** in the public archive (enforced by the `papers` table's RLS policy, not just hidden in the UI).
- Any signed-in admin sees a **Pending** link in the header (with a live count) that any admin who isn't currently logged in never sees.
- The pending queue shows each paper's metadata plus **Preview**, **Reject**, and **Approve** buttons. Preview opens the actual file (PDF or image) in a modal so the admin can check it before deciding — the modal also carries its own Approve/Reject buttons.
- **Approve** sets `status = 'approved'`, and records who approved it and when — the paper immediately becomes visible to everyone.
- **Reject** deletes the paper's record and its file from storage. There's no "rejected" holding area in the UI — a rejected upload is gone, and the uploader is welcome to fix and resubmit it (the duplicate check only blocks against papers that are pending or approved, not rejected ones).
- Any admin can approve or reject — this isn't restricted to the primary admin, only _creating new admin accounts_ is.

One known trade-off, worth knowing about: the Storage bucket is
public for simplicity (so approved papers get plain, fast URLs with
no extra request needed). That means someone who already has the
direct file URL for a _pending_ paper (e.g. they uploaded it
themselves) could still open that specific file, even though it
won't show up anywhere in the archive or search results until
approved. If you want pending files fully inaccessible until
approval, that requires switching to a private bucket with
short-lived signed URLs generated only for admins — a reasonable
follow-up if this matters for your use case, just outside a
no-backend, static-hosting setup.

## 5. Run it locally

Because the app uses ES module imports (`type="module"`), opening
`index.html` directly with `file://` won't work in most browsers — it
needs to be served over `http://`. Any static server works:

```bash
# Python (already on most systems)
python3 -m http.server 8080

# or Node
npx serve .
```

Then visit `http://localhost:8080`.

## 6. Deploy for free

**Option A — GitHub Pages**

1. Push this folder to a GitHub repository.
2. Repo → **Settings → Pages** → Source: deploy from the `main` branch, root folder.
3. Your site will be live at `https://<username>.github.io/<repo>/` within a minute or two.

**Option B — Vercel**

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your GitHub repo.
2. Framework preset: **Other** (no build command needed — it's static files).
3. Deploy. You'll get a `https://<project>.vercel.app` URL.

Supabase's anon key doesn't need the same "restrict by domain" step
Firebase does — access is controlled entirely by the Row Level
Security policies in `supabase-schema.sql`, which apply no matter
where a request comes from.

## 7. Try it out

- Browse and upload as a regular (signed-out) visitor — no login needed. Your upload will say it's pending review.
- Click **Admin** in the header, sign in with `tahir@admin.com` and the password you set in step 3.
- With an admin session active, a **Pending** link appears in the header — open it, preview the paper you just uploaded, and approve it. It'll now show up in **Browse**.
- From the admin panel (click **Admin** again while signed in), the primary admin sees a **Create a new admin** form. Accounts created there can sign in, and can approve/reject/delete papers, but can't create further admins — only `tahir@admin.com` can, enforced in the database.

## What to customize later

- **Departments/subjects list** — subjects are free text with autocomplete built from already-approved uploads; swap in a fixed dropdown of BZU's official subject list if you'd prefer.
- **File size limit** — currently 20MB per file (`MAX_FILE_MB` in `app.js`). Raise it if needed; there's no matching Storage-side limit to update since Supabase doesn't enforce per-file size via RLS the way Firebase does — consider adding one via a Storage bucket file-size limit in the dashboard if this matters to you.
- **Private pending files** — see the trade-off noted in section 4.
- **OCR / full-text search** — outside the "no backend" scope of this build, since it needs a server-side step (e.g. a Supabase Edge Function calling an OCR API on upload). Flag it if you want a follow-up.
