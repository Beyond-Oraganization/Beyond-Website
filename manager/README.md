# Beyondia site manager

Edit the **home page**, the **stories**, the **blog**, the **plans page** and the **GitHub page** of the Beyondia site, from a graphical interface or the command line.
Every change goes into one file, `site.config.json`; the pages `index.html`, `stories.html` (and one page per story), `blog.html` (and one page per post), `plans.html` and `github.html`
are generated from it and published to GitHub with one command.

Needs only `python3` (3.9 or newer). Nothing to install. The design and the reasons behind every
decision are in [PLAN.md](PLAN.md).

```sh
cd beyondia-site
manager/bm --help            # all commands
manager/bm tile list         # what is on the home page map
```

## The graphical interface

```sh
manager/bm ui
```

Opens `http://127.0.0.1:8787/` in your browser. Use `--port 9000` if 8787 is taken, `--no-open` to skip launching the browser, Ctrl+C to stop.

* **Left menu:** Home, Doors, Stories, Blog, Plans, GitHub, Publish. The numbers are item counts.
* **Preview** on the right shows the real page and follows the section you are in. It can be hidden (button at the top), switched to phone width, or opened in its own tab.
* **Rows:** *Edit* opens the form in place; the **⋯** menu holds Move, Hide/Show and Remove; you can also **drag a row** to reorder it.
* **Nothing you type is lost** when the server refuses a change: the reason is shown in plain words above the form and your text stays.
* **Undo** (top right, and in the message after every change) steps back through your last 50 changes, including a removed story and its page. It refuses if something else (the command line, a text editor) changed the config in the meantime, so it never overwrites that work.
* **Ctrl/Cmd+S** saves the form you are in. A marker shows unsaved typing, and the browser asks before you close the tab with unsaved typing.
* **Publish:** press **Preview** to see exactly what would be pushed, then **Publish** (it asks once more).

### Writing stories

*Stories → + New story* (or *Edit story* on a row). Fill in the title, kind, tag, summary and side note, then write the text in the big box. The text is plain text:

| You type | It becomes |
|----------|-----------|
| a paragraph, then a blank line | a paragraph |
| `> text` | the muted opening paragraph |
| `## Title` | a heading inside the story |
| `# Chapter 1` | a chapter heading (for verses) |
| `[1:1] text` | a numbered verse |
| `+ text` right after a verse | another paragraph of that verse |
| `\# text` | a paragraph that really begins with `#`, `>`, `[` or `+` |

Each story is one page (`story<name>.html`, existing pages keep their names). The stories list, the previous/next
links and the number on the home page (“Seven stories so far”) follow automatically. **Make a draft** removes a
story's page without losing the text; **Remove** deletes it. A page you wrote by hand is never deleted.

### Writing blog posts

*Blog → + New post*. A post has a title, a **date** (posts are listed newest first by it), up to four tags, a summary
and the text. The short name (the page name, `blog-<name>.html`) is suggested from the title. The text works like a
story's, plus links: `[words](https://example.com)`. Only `http(s)` addresses and pages of this site are accepted; a
link that is not allowed stops the save and says so. The page shows the date exactly as you chose it (it never uses
the clock) and a reading time. **Make a draft** removes a post's page without losing the text.

## Everyday use (command line)

| I want to... | Command |
|--------------|---------|
| See the doors on the home page | `manager/bm tile list` |
| Add a door | `manager/bm tile add blog --label Blog --title "Notes from the road" --text "Short posts." --href stories.html` |
| Put it in position 2 | add `--position 2` (or later `manager/bm tile move blog 2`) |
| Hide / show a door without deleting it | `manager/bm tile hide blog` / `manager/bm tile unhide blog` |
| Change a door | `manager/bm tile set blog --title "New title"` |
| Remove a door | `manager/bm tile remove blog` |
| Change the headline, lead or map text | `manager/bm home set --lead "New lead."` (also `--title --kicker --map-title --map-kicker --map-intro`) |
| Change the buttons / the moving strip | `manager/bm button add "Read" stories.html --style ghost`, `manager/bm ticker add "A new phrase"` |
| List a repository on the GitHub page | `manager/bm repo add my-repo --name My-Repo --url https://github.com/Beyond-Oraganization/My-Repo --description "What it is." --stack "Python,MySQL"` |
| Hide / change / remove a repository | `manager/bm repo hide ID`, `repo set ID --description "..."`, `repo remove ID` |
| List the blog posts (newest first) | `manager/bm post list` |
| Add a post from a text file | `manager/bm post add hello --title "Hello" --summary "..." --date 2026-10-23 --tags "News, Ideas" --body-file hello.txt` (date defaults to today) |
| Edit a post's text | `manager/bm post body hello > h.txt`, edit it, then `manager/bm post set hello --body-file h.txt` |
| Change title, date, tags or summary | `manager/bm post set ID --title "..." --date 2026-11-01 --tags "News"` |
| Make a draft, publish, remove a post | `manager/bm post hide ID`, `post unhide ID`, `post remove ID` |
| Change the blog list heading | `manager/bm blog set --title "..." --lead "..."` |
| List the stories | `manager/bm story list` |
| Add a story from a text file | `manager/bm story add lighthouse --title "The Lighthouse" --summary "..." --aside "..." --tag Myth --body-file lighthouse.txt` (`--body-file -` reads standard input) |
| Edit a story's text | `manager/bm story body lighthouse > l.txt`, edit `l.txt`, then `manager/bm story set lighthouse --body-file l.txt` |
| Change title, tag, summary or kind | `manager/bm story set ID --title "..." --kind verses` |
| Reorder, make a draft, publish, remove | `manager/bm story move ID 1`, `story hide ID`, `story unhide ID`, `story remove ID` |
| Change the stories list heading | `manager/bm stories set --title "..." --lead "..."` |
| Change the plans page text / roadmap heading | `manager/bm plans set --title "..." --roadmap-title "..."` |
| See the plans in their lanes | `manager/bm plan list` (lanes: `lane list`, roadmap: `step list`) |
| Add a plan to a lane | `manager/bm plan add bot-v2 --lane building --title "Bot version two" --text "A rewrite." --status Planned` |
| Change status, hide, reorder a plan | `manager/bm plan set ID --status Live`, `plan hide ID`, `plan move ID 1` |
| Move a plan to another lane | `manager/bm plan to-lane ID horizon` |
| Add / rename / reorder a lane (1–3) | `manager/bm lane add ideas --label Ideas`, `lane set ID --label ...`, `lane move ID 1` (a lane with plans cannot be removed) |
| Add a roadmap step | `manager/bm step add launch --when Autumn --title "Launch day" --text "We launch." --status Planned` (also `step set/move/hide/unhide/remove`) |
| Change the GitHub page text | `manager/bm github set --title "..." --lead "..."` |
| Publish | `manager/bm publish -m "Describe the change"` (add `--dry-run` to preview) |

Each change command checks the result, saves `site.config.json` and rebuilds the two pages at once.
A change that would make the config invalid is **refused and nothing is written**.

The map title may contain `{count}`, which becomes the number of visible doors in words
("Eight doors into Beyondia.").

Other commands: `validate`, `check` (links, anchors, navigation, fonts of all pages),
`build` / `build --check`, `status`.

## Publishing

`manager/bm publish -m "message"` validates, builds, checks the whole site, commits **only**
`site.config.json`, `index.html`, `plans.html`, `stories.html`, `blog.html`, `github.html`, the story and post pages (including the deletion of a removed page), runs `git pull --rebase`, and pushes.
It never uses `--force`. Your other uncommitted files are not touched or published.
If GitHub has a conflicting change, nothing is pushed and the message tells you what to do.

One-time setup of the folder as a Git working copy (uses your existing Git credentials):

```sh
git init -b main
git remote add origin https://github.com/Beyond-Oraganization/Beyond-Website.git
git fetch origin && git reset origin/main      # keeps your files, only adopts the history
```

## Tests

```sh
sh manager/run_tests.sh
```

Runs about 360 tests in a few seconds, with no network. GitHub Actions runs them on every push
(`.github/workflows/test.yml`), together with `bm build --check` and `bm check`, so a green check
on GitHub means the pages match the config and no link is broken.

## Manual smoke check (what automatic tests cannot see)

After a real publish, once:

1. Open the site and confirm the home page looks right and every door opens.
2. Open the GitHub page: each repository link goes to the right repository.
3. Resize the window to phone width: nothing overflows.
4. Hide a door, publish, and confirm it is gone and the count in the title changed.
5. Unhide it and publish again.

## If something goes wrong

* *"another manager command is changing the config"*: wait, or delete `.bm.lock` if no command is running.
* *Pages out of date* (`build --check` fails): run `manager/bm build`.
* *Config edited by hand and now invalid*: `manager/bm validate` lists every problem with its path.
