# Lumen Run leaderboard

The hidden game (`/play`) can post finished runs to a shared leaderboard. The scores live in a
Google Sheet that the lab owns; a small script inside that sheet (`Code.gs` in this folder)
receives runs from the website and hands the top scores back.

- Every posted run becomes one row in the **Scores** tab: when, name, email, score and a few
  details of the run.
- The website only ever receives names and scores. **Email addresses stay in the sheet.**
- Each player appears on the board once, with their best score. Players are told apart by name.

## Setting it up (once, about five minutes)

Do this signed in to the Google account that should own the scores.

1. Create a new Google Sheet (https://sheets.new) and give it a name, for example
   "Lumen Run leaderboard".
2. In the sheet, open **Extensions > Apps Script**. Delete the sample code in the editor, paste
   in the whole of [`Code.gs`](Code.gs), and save.
3. Click **Deploy > New deployment**. Click the gear next to "Select type" and choose
   **Web app**. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Then click **Deploy**.

4. Google asks you to authorize the script the first time. It only asks for access to this one
   spreadsheet. If a "Google hasn't verified this app" screen appears, that is expected for a
   script you wrote yourself: choose **Advanced**, then **Go to (project name)**, then **Allow**.
5. Copy the **Web app URL** (it ends in `/exec`). Opening it in a browser should show
   `{"ok":true,"total":0,"entries":[]}`.
6. Put that URL in `src/lib/site.ts` as the default of `LEADERBOARD_URL`:

   ```ts
   export const LEADERBOARD_URL: string =
     import.meta.env.PUBLIC_LEADERBOARD_URL || 'https://script.google.com/macros/s/.../exec';
   ```

   Commit and push. Once the site has redeployed, the leaderboard and the "Post your score"
   button appear on the game page. While the URL is empty, the game runs without them.

If "Anyone" is not offered in step 3 (some organizations only allow sharing inside the
organization), deploy from a personal Google account instead.

## Looking after it

| To do this                 | Do this                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| See who played             | Open the sheet. The **Scores** tab has one row per posted run.            |
| Remove an entry            | Delete its row. The website catches up within a minute.                   |
| Reset the board            | Delete all rows below the header row.                                     |
| Refuse certain names       | Add words to the **Blocked words** tab, one per row.                      |
| Switch the leaderboard off | Set `LEADERBOARD_URL` back to an empty string, or archive the deployment. |

Keep the sheet private (do not share it publicly): it holds the email addresses players chose
to give. The form on the website tells players that their name is public and their email is not.

### Changing the script later

After editing the code in the Apps Script editor, publish it with **Deploy > Manage
deployments > Edit (pencil icon) > Version: New version > Deploy**. That keeps the same URL.
"New deployment" would create a different URL, which would then have to go into `site.ts`.
Keep `Code.gs` in this folder the same as what is deployed.

## What it guards against

- Names are limited to 2 to 20 letters, digits, spaces and `. - _ '`, so nothing a player types
  can act as a spreadsheet formula or as HTML on the page.
- Scores are checked against what the game can produce in the time played. This stops casually
  made-up scores; someone determined could still fake a plausible one, so delete anything that
  looks wrong.
- At most 40 runs are accepted per minute, and the sheet stops taking runs at 20,000 rows.

## Working on it

```bash
npm test
```

runs the tests in `Code.test.mjs` against a spreadsheet held in memory (`fake-google.mjs`).

```bash
npm run leaderboard:dev
```

starts a local stand-in for the deployed script on http://localhost:8787/exec, running the real
`Code.gs` with a few sample players. Point the site at it with:

```bash
PUBLIC_LEADERBOARD_URL=http://localhost:8787/exec npm run dev
```
