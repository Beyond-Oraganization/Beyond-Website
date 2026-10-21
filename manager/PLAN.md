# Beyondia Manager: plan

This plan explains the parts of the design that are easy to get wrong. It spends words where a mistake would hurt, and stays short everywhere else.

## 1. Goal and non-goals

**Goal.** Change the home page and the GitHub page of the site by editing one config file, with tools to **add**, **remove**, **view** and **configure** its entries. Publishing means: build, commit, push. The values shown on the site come from the config file that lives in the GitHub repository.

**Non-goals.** Editing the story, ideology and other hand-written pages. A web interface. A server. Any third-party dependency. Managing GitHub credentials.

## 2. Decisions, and what was rejected

| # | Decision | Rejected alternative | Why |
|---|----------|----------------------|-----|
| D1 | **Build-time generation.** The manager renders `index.html` and `github.html` from the config and commits them. | Pages fetch the JSON in the browser and render it. | A page opened as a file (`file://`) cannot `fetch` a neighbouring file (browsers block it), the page flashes empty before the script runs, and nothing is visible without JavaScript. Generated files make the Git diff show exactly what will change on the site. The cost is that generated files are committed; section 8 shows how CI removes the risk. |
| D2 | **Python 3.9, standard library only.** | Node, or Python with packages. | Python is already on the machine, there is nothing to install, and `unittest` is built in. Fewer moving parts is fewer ways for the tool to fail while nobody is watching. |
| D3 | **JSON** config. | YAML or TOML. | The standard library reads and writes JSON strictly. YAML needs a package and guesses types (`no` becomes `false`). |
| D4 | **Pure edit functions.** Every operation takes a config and returns a *new* config. | Editing the loaded dictionary in place. | The logic can be tested without touching a disk, and a failed operation can never leave a half-edited config in memory. |

## 3. Data flow

```
 bm tile add ...        (CLI)
        │
        ▼
 load site.config.json ──► validate ──► pure edit ──► validate again ──► atomic save
                                                                             │
 bm build ◄──────────────────────────────────────────────────────────────────┘
        │   render index.html and github.html (escaped, deterministic)
        ▼
 bm publish ──► checks ──► git add (explicit list) ──► commit ──► pull --rebase ──► push
                                                                                     │
                                         GitHub Actions: tests + build --check ◄─────┘
```

Validation runs twice on purpose: before the edit (so a hand-broken file is reported as such, not blamed on the command) and after it (so a command can never write an invalid file).

## 4. The config file and its validation

`site.config.json` has four top-level parts: `site` (names and URLs), `home` (hero, ticker, map tiles), `plans` (page text, up to three lanes of plans, and the roadmap) and `github` (intro and repositories). Every rule below exists because breaking it breaks something visible or unsafe.

| Field | Rule | Reason |
|-------|------|--------|
| `schema` | integer, must equal `1` | A future change of shape can add a migration instead of guessing. |
| `id` of a tile or repo | slug (`a-z`, `0-9`, single hyphens), at most 40 characters, **unique inside its list** | The id is the stable handle used by `remove` and `move`. Titles can change and can collide. |
| Single-line text (`title`, `label`, `kicker`) | non-empty, no line breaks or control characters, length limit | Line breaks and very long text break the layout and make Git diffs noisy. |
| Longer text (`lead`, `text`, `intro`, `description`) | same, with larger limits | Same. |
| URLs (`href`, `url`) | either absolute `https://` or `http://` **with a host**, or a relative `name.html` (optionally `#anchor`) | `javascript:`, `data:` and protocol-relative `//host` URLs are refused because they would run code or leave the site silently. `..` and a leading `/` are refused so a link cannot point outside the site folder. |
| Relative targets | must exist as files | Checked by `bm check`, not by validation, because validation stays pure (no disk). |
| Tiles | at least one tile must be visible | An empty map is a broken home page. |
| Ticker | 1 to 12 items | An empty or huge ticker looks broken. |
| Buttons | 1 to 3, style `solid` or `ghost` | The hero layout is designed for that range. |
| Plan lanes | 1 to 3 lanes; 0 to 12 plans per lane; plan ids unique **across all lanes** | The page lays lanes out in three columns. A plan keeps its id when it moves between lanes, so ids must not collide. |
| Roadmap steps | 0 to 24; each has `when` (at most 30 characters), `title`, `text`, `status` (at most 24) | An empty roadmap shows a plain "no steps yet" line instead of a broken section. |
| Removing a lane | Refused while it still contains plans | So no plan is deleted as a side effect; move it to another lane (`plan to-lane`) or remove it first. |

All problems are collected and reported together, each with its path (for example `home.map.tiles[2].href`). Fixing a config one error at a time would be a poor experience.

## 5. Rendering: escaping and determinism

**Escaping.** Every value from the config is passed through `html.escape(..., quote=True)` when a fragment is built. URLs also pass the allowlist from section 4 first. There is no code path that puts raw config text into HTML. Template placeholders (`{{name}}`) are replaced only with fragments that were already escaped, and an unknown placeholder is an error, so a typo in a template cannot silently print `{{tilez}}` on the live site. A template engine was not used: there are four small templates, and one escaping rule that is easy to audit beats a library nobody here has read.

**Determinism.** The same config produces byte-identical output: no timestamps, no random ids, stable ordering, `\n` line endings, UTF-8, one trailing newline. This is what makes `bm build --check` meaningful (compare bytes) and what keeps Git clean when nothing changed.

**The `{count}` token.** The map title may contain `{count}`, replaced by the number of visible tiles as a word (`Seven`, `Eight`; digits above twenty). Without it, adding or removing a tile would leave a heading that says "Seven doors" over eight doors.

## 6. Writing files safely

**Atomic save.** The config is written to a temporary file *in the same directory*, flushed and `fsync`ed, then moved over the original with `os.replace`. The same directory matters: a rename is atomic only inside one filesystem. This protects against a crash, a power cut or Ctrl-C in the middle of a write: the file is always either the old version or the new one, never half of each.

**Write only if changed.** Generated files are rewritten only when their bytes differ. File times stay untouched and `git status` stays clean.

**Lock against lost updates.** Two terminals running `bm tile add` at the same moment would both read the old file, and the second save would silently erase the first change. Mutating commands therefore take a lock (`.bm.lock` in the site folder, git-ignored, created with `O_CREAT | O_EXCL`, which fails if the file already exists). The lock covers load, edit, save and build; `publish` holds it for its whole run, so nothing can change the config between the build and the commit. A lock older than ten minutes is treated as left behind by a crash and replaced, with a warning.

## 7. Publishing to GitHub

`bm publish -m "message"` does, in this order, and stops at the first failure:

1. Validate the config. Stop if invalid.
2. Build. Stop if rendering fails.
3. Run the site checks (links, anchors, navigation, fonts). Stop on any problem.
4. Confirm the folder is a Git repository, has an `origin`, and is on a branch (not a detached HEAD).
5. Confirm **nothing else is staged**. Otherwise the commit would contain files this tool does not manage.
6. `git add` an **explicit list**: `site.config.json`, `index.html`, `github.html`. Never `git add -A`: that would sweep in unrelated work in progress or a stray secret.
7. If nothing differs from `HEAD`, no commit is made (no empty commits). If an earlier publish committed but its push failed, that commit is still pushed now: "nothing to publish" is printed only when there is also nothing unpushed.
8. Commit with the message.
9. `git pull --rebase --autostash origin <branch>` (only if the branch already exists on GitHub). `--autostash` sets aside unrelated uncommitted edits during the rebase and restores them afterwards; without it Git refuses to rebase over a dirty tree. Rebase, not merge: this is a content repository and a linear history is easier to read. If the rebase conflicts (for example the config was also changed on GitHub), the manager runs `git rebase --abort`, leaves your local commit intact, and prints what to do.
10. `git push origin <branch>`. **Never** with `--force`. If the push is rejected, it is reported as it is.

**Credentials.** The manager uses whatever Git is already set up with (Keychain, SSH key). It never reads, stores or prints a token.

**`--dry-run`** prints the exact file list and commands and changes nothing. A test proves that nothing changed.

| Situation | Behaviour |
|-----------|-----------|
| Not a Git repository / no `origin` / detached HEAD | Refuses before touching anything, with the reason. |
| Something else already staged | Refuses; lists the files. |
| Remote has new commits | Rebases on top, then pushes. |
| Rebase conflict | Aborts the rebase, keeps the local commit, explains. |
| Push rejected or auth fails | Prints Git's own message, exits non-zero. |
| Nothing changed | Exits 0 without a commit. |

## 8. Tests: how they prove it works without us

Run with `manager/run_tests.sh` (or `python3 -m unittest discover -s manager/tests`). No network, no clock, no real credentials: everything uses temporary folders, and Git tests use a local bare repository as the "remote".

| Layer | What it proves |
|-------|----------------|
| Config | Valid configs pass; each invalid case in section 4 is rejected with the right path; saving is atomic (a simulated crash keeps the old file) and deterministic. |
| Edits | Add, remove, move and configure behave as specified; unknown and duplicate ids are refused; the original object is never mutated. |
| Render | Hostile text (`<script>`, quotes) comes out escaped; `javascript:` URLs are refused; hidden tiles are not rendered; `{count}` is right; same input gives the same bytes. |
| Build | A second build changes nothing; a stale or hand-edited generated file is detected by `--check`. |
| Locking | A second writer is refused; a stale lock is recovered. |
| Git | In a real temporary repository: only the allowed files are committed; `--dry-run` changes nothing; unrelated staged files make it refuse; a new remote commit is rebased over; a conflict leaves the repository clean and the local commit intact; no `--force` is ever used. |
| CLI | Every command end to end, including exit codes and error messages. |
| **Site integrity** | Run against the **real** site files: every relative link resolves, every `#anchor` exists, the navigation is identical on all pages, the Google Fonts link loads the families the CSS asks for, and the committed generated pages equal a fresh build. |

**Fixture, not live content.** The functional tests (CLI, web, publish) run on the real *pages* but with a frozen copy of the config (`tests/fixtures/site.config.json`), rebuilt from it. Editing the live site content (removing a plan, hiding a door) therefore never breaks them; this was found the hard way when real edits made four tests fail. Only `test_site.py` reads the live config, because its job is to check the live site.

**Independence.** `.github/workflows/test.yml` runs all of this on every push and pull request. Because CI compares the *committed* generated pages with a fresh build, anyone who edits the config (even on github.com) or a generated page without rebuilding gets a red check. The tests do not depend on a person remembering to run them.

**Do the tests really catch mistakes?** A passing test proves little unless it can also fail. Twelve deliberate bugs were planted one at a time (escaping removed, `javascript:` allowed, `git add -A`, the foreign-staged check disabled, the rebase abort removed, the duplicate-id check removed, the stale-lock recovery removed, the navigation check disabled, and others); the suite failed for every one. One survived at first (a second line of defence masked it), and a test was added to kill it.

**The font check is not theoretical.** While preparing this work, the exported pages turned out to request fonts (Inter, Jost) that the stylesheet no longer used. The pages looked acceptable only because the fallback fonts are similar. The integrity test now fails if this happens again.

**Not covered, and how to cover it.** Visual appearance in a browser, a real push with real credentials, and the GitHub Pages deployment cannot be proven by an automatic test here. The README holds a five-point manual smoke check for them.

## 9. Known gaps and risks

- The design mock in the Claude artifact still has the old, hand-written home page. From now on the repository is the source of truth for `index.html` and `github.html`.
- GitHub Pages must be enabled by the owner (Settings → Pages). The manager cannot do it.
- Windows is not tested; it is not claimed to work.
- Editing the config directly on github.com makes CI fail until `bm build` is run and pushed. This is intentional; an automatic build-and-commit workflow is the next step if wanted.

## 10. Order of work

1. This plan.
2. Config loading, validation, atomic save, locking, with tests.
3. Pure edits, with tests.
4. Rendering and build, with tests.
5. Site checks, with tests (including the real site).
6. Git publishing, with tests.
7. CLI, with end-to-end tests.
8. Templates, the config populated from today's home page, the new GitHub page, CI, README.
9. Final full test run and a manual smoke check.

## 11. The graphical interface (`bm ui`)

**Decision.** A small local web server (`web.py`, standard library only) serving one HTML page (`ui/index.html`). Alternatives rejected: a desktop toolkit (Tkinter looks poor on macOS and cannot show the real pages); a hosted admin site (would need accounts and a server, against the idea of a static site).

**One implementation of every rule.** The CLI and the interface both call `service.py` (`apply_edit`, `publish_site`, `site_status`) and the same pure functions in `model.py`. The interface can therefore not do anything the command line refuses, and tests of one cover the other.

**Why a local server needs a security design.** Any web page you have open can send requests to `localhost`, and a hostile site can point its own name at `127.0.0.1` (DNS rebinding). Without defences, visiting a bad site could change your site or publish. So:

| Threat | Defence | Test |
|--------|---------|------|
| Other computers reach it | Binds to 127.0.0.1 only | `test_server_listens_on_loopback_only` |
| DNS rebinding (hostile name resolves to 127.0.0.1) | Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` | `test_wrong_host_is_refused_everywhere` |
| Cross-site request forgery | Every POST needs a secret token made fresh at start-up and embedded in our page (a hostile page cannot read it), a matching `Origin` if sent, and `Content-Type: application/json` (a cross-site form cannot send that without a permission check the server never grants) | token, origin, content-type tests |
| Asking the server to do something else | A fixed table of operations (`OPS`); each takes only named parameters of exact types; unknown names or types are refused. No parameter can name a file or command | `test_rejections`, `test_no_operation_can_name_a_file_or_command` |
| Reading other files through the preview | Only `name.html`, `.css`, `.jpg` directly in the site folder; traversal, hidden and config files return 404 | `test_only_allow_listed_names_are_served` |
| Script injection into the interface through config text | The interface builds its DOM from text nodes only (no raw markup anywhere); a strict Content-Security-Policy allows no external resources and no framing | `test_ui_source_never_uses_*`, CSP test |
| Huge or malformed requests | 64 KB body limit, strict JSON parsing | body tests |

**Honest limits.** The page script itself is not run by the automated tests (there is no browser in CI). It is covered indirectly: a test fails if the page calls an operation the server does not have, or the server has one the page never uses, and if it contains unsafe DOM calls. Its behaviour was checked by hand in a browser. A token in the page means anyone who can already run code as you on this computer could use the interface; that is true of the command line too.

**Behaviour.** Each action sends one request, and the server answers with the full new state, so the page never shows something the server does not have. Edits rebuild the pages immediately, and the preview reloads. A refused change shows the exact reason and changes nothing. Publishing needs a message and a second click; the Preview button runs the dry run.

## 12. The plans page (added after the first version)

`plans.html` was a hand-written page; it is now generated like `index.html` and `github.html`, so it joins the managed files that `publish` commits and CI compares.

**Two parts, one reason.** The three existing lanes (Writing, Building, Horizon) keep their text exactly (the generated lane markup was compared with the old page and matches). Below them is a new section, the **roadmap**: plans in time order, each with `when`, `title`, `text` and a status pill. Lanes answer "what areas is Beyondia working in"; the roadmap answers "what happens next". The roadmap starts with the two dated plans already on the page ("Tomorrow: a new edit" and "Release of the video edit"). They also still appear in the Horizon lane, since I did not delete content you wrote; hide either copy with one command or one click.

**Status is free text** (up to 24 characters), with suggestions in the interface (Live, In progress, Planned, Next, Tomorrow, Open, Done, Paused). A fixed list would have rejected "Tomorrow", which is already used on the page.

**Schema stays at 1.** The config was never published, so there is no old file to migrate; a missing `plans` section is reported as invalid with its path.

