# JeWeekSummary

A private, cloud-synchronized weekly work journal. Its desktop home is a book-like table of contents: years are chapters and weeks are entries that open into their own writing view.

JeWeekSummary supports Google authentication, passwordless email sign-in, and synchronized cloud notebooks through Supabase. Run the latest `supabase-schema.sql` in the Supabase SQL Editor after setup changes. Signed-in users own and edit only their notebook; revocable sharing links expose a separate read-only view.

Open `index.html` in a modern browser. Your summaries, entries, and handwritten drawings are saved locally on that device. Use **Export .md** to download a text copy of the current week.

Features:

- Work-update structure for completed work and the coming week's plan
- Add or safely remove complete year chapters
- Weeks listed chronologically from the beginning of each year
- OneNote-style typed and pressure-sensitive handwriting blocks
- Stroke eraser for handwriting blocks
- Add, rename, recolor, and safely delete individual blocks
- Bold, italic, highlight, lists, working font selection (including 宋体/SimSun), and device-local font upload
- Device-local CSS upload for custom week-page appearance, with external CSS requests blocked
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
