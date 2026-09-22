# JeWeekSummary

A private, cloud-synchronized weekly work journal. Its desktop home is a book-like table of contents: years are chapters and weeks are entries that open into their own writing view.

JeWeekSummary supports Google authentication, passwordless email sign-in, and synchronized cloud notebooks through Supabase. Run the latest `supabase-schema.sql` in the Supabase SQL Editor after setup changes. Signed-in users own and edit only their notebook; revocable sharing links expose a separate read-only view.

The deployed site is also an installable Progressive Web App. After one online login, each account receives its own IndexedDB offline copy. Offline edits save locally and synchronize to Supabase automatically after the device reconnects.

On Android or desktop Chrome/Edge, use the visible **Install app** button when offered. On iPhone/iPad, open the browser Share menu and choose **Add to Home Screen**.

While online, refreshing or reopening the installed app checks the deployed website for updated files. When a new service worker is ready, the app displays a **New version available — Reload** button. Cached files remain the fallback when offline.

Open `index.html` in a modern browser. Your summaries, entries, and handwritten drawings are saved locally on that device. Use **Export .md** to download a text copy of the current week.

Features:

- Fluid phone layout that automatically fits narrow screens, safe areas, and touch controls
- Optional synchronized to-do list with numbered reordering, high-priority markers, optional due dates, descriptions, and free-text progress notes
- Installable phone and desktop app with an account-isolated offline notebook cache
- Automatic cloud synchronization after reconnecting
- Work-update structure for completed work and the coming week's plan
- Add or safely remove complete year chapters
- Weeks listed chronologically from the beginning of each year
- OneNote-style typed and pressure-sensitive handwriting blocks with adjustable pen width and sensitivity
- Stroke eraser for handwriting blocks
- Numbered block ordering with Up/Down controls and direct position entry
- Resizable handwriting paper with optional horizontal lines and adjustable spacing
- Add, rename, recolor, and safely delete individual blocks
- Toggleable bold, italic, and highlight formatting for selected text, plus lists, free text sizing, font selection (including 宋体/SimSun), and device-local font upload
- LaTeX-style Unicode symbol shortcuts in typing blocks, including `\mu` → `μ`, `R^2` → `R²`, `x_1` → `x₁`, and `\sqrt{R}` → `√R`
- Device-local CSS upload for custom week-page appearance, with external CSS requests blocked
- Per-block Markdown import and export, full-week PDF printing, and editable JSON week backups
- Import an editable JSON week backup into a new or existing account, with overwrite confirmation
- Background color picker with the three previously selected colors
- Permanent self-service account deletion with typed confirmation

- Year-inclusive weekly labels, for example `2026 | 9.14 - 9.20`
- Separate private and public writing blocks for each week
- Private/public visibility setting for handwritten notes
- Pressure-sensitive stylus handwriting through Pointer Events
- Public-only Markdown export

- Month calendar with day, month, and year navigation
- Monday–Sunday week list, shown as date ranges such as `Sep 14–Sep 20`
- One-sentence weekly summary
- Free-form rich-text journal entry
- Mouse, touch, and stylus handwriting canvas
