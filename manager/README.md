# Beyondia site manager

Edit the **home page**, the **plans page** and the **GitHub page** of the Beyondia site, from a graphical interface or the command line.
Every change goes into one file, `site.config.json`; the pages `index.html`, `plans.html` and `github.html`
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

Opens `http://127.0.0.1:8787/` in your browser: tabs for **Home**, **Doors**, **Plans**, **GitHub** and **Publish**, and a live
preview of the real pages on the right (with a phone-width switch). Everything the command line can do is there:
add, edit, reorder (arrows), hide/show, remove (asks twice), and a **Preview** button on the Publish tab that shows
exactly what would be pushed before you press **Publish**. Use `--port 9000` if 8787 is taken, `--no-open` to skip
launching the browser. Stop it with Ctrl+C.

It is a local program, not a website: it listens on your own computer only, and refuses requests that did not
come from its own page (see PLAN.md section 11). The interface and the command line share the same code, so they
can be mixed freely.

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
`site.config.json`, `index.html`, `plans.html` and `github.html`, runs `git pull --rebase`, and pushes.
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

Runs about 220 tests in a few seconds, with no network. GitHub Actions runs them on every push
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
